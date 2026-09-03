#!/usr/bin/env bash
# Usage: add SENTRY_AUTH_TOKEN to .env.local or export it, then run this script.
# Optional: set SENTRY_ENV_FILE, SENTRY_ORG, SENTRY_PROJECT, or SENTRY_STATS_PERIOD.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
sentry_env_file="${SENTRY_ENV_FILE:-${script_dir}/../.env.local}"

if [[ -z "${SENTRY_AUTH_TOKEN:-}" && -f "${sentry_env_file}" ]]; then
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    if [[ "${line}" =~ ^[[:space:]]*(export[[:space:]]+)?SENTRY_AUTH_TOKEN[[:space:]]*=(.*)$ ]]; then
      token_value="${BASH_REMATCH[2]%%[[:space:]]#*}"
      token_value="${token_value#"${token_value%%[![:space:]]*}"}"
      token_value="${token_value%"${token_value##*[![:space:]]}"}"

      if [[ "${#token_value}" -ge 2 ]]; then
        first_character="${token_value:0:1}"
        last_character="${token_value: -1}"
        if [[
          ("${first_character}" == '"' && "${last_character}" == '"') ||
          ("${first_character}" == "'" && "${last_character}" == "'")
        ]]; then
          token_value="${token_value:1:${#token_value}-2}"
        fi
      fi

      export SENTRY_AUTH_TOKEN="${token_value}"
    fi
  done <"${sentry_env_file}"
fi

if [[ -z "${SENTRY_AUTH_TOKEN:-}" ]]; then
  echo "Error: SENTRY_AUTH_TOKEN is required in the environment or ${sentry_env_file}." >&2
  exit 2
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required." >&2
  exit 2
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is required." >&2
  exit 2
fi

if ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)'; then
  echo "Error: python3 must be 3.9 or newer." >&2
  exit 2
fi

sentry_org="${SENTRY_ORG:-wrapper}"
sentry_project="${SENTRY_PROJECT:-4511010034941952}"
sentry_stats_period="${SENTRY_STATS_PERIOD:-14d}"
sentry_api_url="https://sentry.io/api/0/organizations/${sentry_org}/issues/"
sentry_tmp_dir="$(mktemp -d)"
sentry_pages_file="${sentry_tmp_dir}/pages.jsonl"
trap 'rm -rf "${sentry_tmp_dir}"' EXIT

# The token goes to curl through a private file, never through argv or the
# environment, so it cannot be read from the process list.
sentry_auth_header_file="${sentry_tmp_dir}/auth-header.txt"
(umask 077 && printf 'Authorization: Bearer %s\n' "${SENTRY_AUTH_TOKEN}" >"${sentry_auth_header_file}")
unset SENTRY_AUTH_TOKEN

if [[ ! "${sentry_org}" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "Error: SENTRY_ORG contains invalid characters." >&2
  exit 2
fi

if [[ ! "${sentry_project}" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "Error: SENTRY_PROJECT contains invalid characters." >&2
  exit 2
fi

if [[ ! "${sentry_stats_period}" =~ ^[0-9]+[dhmsw]$ ]]; then
  echo "Error: SENTRY_STATS_PERIOD must look like 14d or 24h." >&2
  exit 2
fi

page_number=0
cursor=""
while true; do
  page_number=$((page_number + 1))
  if [[ "${page_number}" -gt 100 ]]; then
    echo "Error: Sentry pagination exceeded 100 pages." >&2
    exit 2
  fi

  headers_file="${sentry_tmp_dir}/headers-${page_number}.txt"
  body_file="${sentry_tmp_dir}/body-${page_number}.json"

  curl_args=(
    --silent
    --show-error
    --fail
    --connect-timeout 10
    --max-time 60
    --retry 2
    --retry-delay 1
    --dump-header "${headers_file}"
    --output "${body_file}"
    --header "@${sentry_auth_header_file}"
    --header "Accept: application/json"
    --get
    --data-urlencode "query=is:unresolved"
    --data-urlencode "project=${sentry_project}"
    --data-urlencode "statsPeriod=${sentry_stats_period}"
    --data-urlencode "sort=date"
    --data-urlencode "limit=100"
  )

  if [[ -n "${cursor}" ]]; then
    curl_args+=(--data-urlencode "cursor=${cursor}")
  fi

  if ! curl "${curl_args[@]}" "${sentry_api_url}"; then
    echo "Error: Sentry API request failed on page ${page_number}." >&2
    exit 2
  fi

  if ! python3 - "${body_file}" >>"${sentry_pages_file}" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as response_file:
        page = json.load(response_file)
    if not isinstance(page, list):
        raise ValueError("expected a JSON array")
    print(json.dumps(page, separators=(",", ":")))
except (OSError, ValueError, json.JSONDecodeError) as error:
    print(f"Error: invalid Sentry API response: {error}", file=sys.stderr)
    raise SystemExit(2)
PY
  then
    exit 2
  fi

  next_cursor="$(python3 - "${headers_file}" "${sentry_org}" <<'PY'
import re
import sys
from urllib.parse import parse_qs, urlparse

with open(sys.argv[1], encoding="utf-8", errors="replace") as headers_file:
    link_value = " ".join(
        line.split(":", 1)[1].strip()
        for line in headers_file
        if line.lower().startswith("link:")
    )

for link in re.split(r",\s*(?=<)", link_value):
    if 'rel="next"' in link and 'results="true"' in link:
        match = re.search(r"<([^>]+)>", link)
        if match:
            parsed = urlparse(match.group(1))
            expected_path = f"/api/0/organizations/{sys.argv[2]}/issues/"
            if (
                parsed.scheme != "https"
                or parsed.netloc != "sentry.io"
                or parsed.path != expected_path
            ):
                print("Error: Sentry returned an unsafe pagination URL.", file=sys.stderr)
                raise SystemExit(2)
            cursor = parse_qs(parsed.query).get("cursor", [""])[0]
            if not cursor:
                print("Error: Sentry pagination URL has no cursor.", file=sys.stderr)
                raise SystemExit(2)
            print(cursor)
            break
PY
)"

  if [[ -n "${next_cursor}" && "${next_cursor}" == "${cursor}" ]]; then
    echo "Error: Sentry returned a repeated pagination cursor." >&2
    exit 2
  fi

  cursor="${next_cursor}"
  if [[ -z "${cursor}" ]]; then
    break
  fi
done

python3 - "${sentry_pages_file}" <<'PY'
import json
import re
import sys


# Sentry titles are attacker-influenced; drop C0/C1 control characters so
# nothing can smuggle escape sequences into the terminal.
CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f-\x9f]")


def sanitized(value: object) -> str:
    return " ".join(CONTROL_CHARACTERS.sub("", str(value or "")).split())


def truncated(value: object, limit: int) -> str:
    text = sanitized(value)
    return text if len(text) <= limit else f"{text[: limit - 3]}..."


try:
    issues = []
    with open(sys.argv[1], encoding="utf-8") as pages_file:
        for line in pages_file:
            page = json.loads(line)
            if not isinstance(page, list):
                raise ValueError("expected every page to be a JSON array")
            issues.extend(page)
except (OSError, ValueError, json.JSONDecodeError) as error:
    print(f"Error: could not parse Sentry issues: {error}", file=sys.stderr)
    raise SystemExit(2)

rows = []
high_priority_count = 0
for issue in issues:
    if not isinstance(issue, dict):
        print("Error: Sentry returned an invalid issue entry.", file=sys.stderr)
        raise SystemExit(2)

    priority = str(issue.get("priority") or "unknown").lower()
    try:
        event_count = int(issue.get("count") or 0)
    except (TypeError, ValueError):
        event_count = 0

    is_high_priority = priority == "high"
    if is_high_priority:
        high_priority_count += 1

    rows.append(
        (
            "WARNING" if is_high_priority or event_count > 10 else "",
            truncated(issue.get("shortId") or issue.get("id") or "unknown", 24),
            truncated(issue.get("title") or "Untitled issue", 80),
            truncated(priority, 10),
            str(event_count),
            sanitized(issue.get("firstSeen") or "unknown")[:10],
        )
    )

headers = ("", "ISSUE", "TITLE", "PRIORITY", "EVENTS", "FIRST SEEN")
widths = tuple(
    max([len(headers[index]), *(len(row[index]) for row in rows)])
    for index in range(len(headers))
)

def print_row(row: tuple[str, ...]) -> None:
    print("  ".join(value.ljust(widths[index]) for index, value in enumerate(row)).rstrip())


print_row(headers)
print_row(tuple("-" * width for width in widths))
for row in rows:
    print_row(row)

print()
print(f"Total unresolved issues: {len(issues)}")
print(f"SENTRY_UNRESOLVED_TOTAL={len(issues)}")
print(f"SENTRY_HIGH_PRIORITY_TOTAL={high_priority_count}")
raise SystemExit(1 if high_priority_count else 0)
PY
