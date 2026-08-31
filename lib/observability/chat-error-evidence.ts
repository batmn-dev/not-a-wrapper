type ErrorRecord = {
  statusCode?: unknown
  status?: unknown
  code?: unknown
  message?: unknown
  name?: unknown
  error_type?: unknown
  metadata?: unknown
  responseBody?: unknown
  error?: unknown
  cause?: unknown
  lastError?: unknown
  errors?: unknown
}

type ChatErrorEvidence = {
  statuses: number[]
  codes: string[]
  names: string[]
  messages: string[]
  errorTypes: string[]
  root?: {
    code?: string
    message?: string
    statuses: number[]
  }
}

const MAX_ERROR_DEPTH = 4
const MAX_ERROR_RECORDS = 32

function asRecord(value: unknown): ErrorRecord | null {
  return value && typeof value === "object" ? (value as ErrorRecord) : null
}

function parseStatus(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function lowerString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.toLowerCase()
    : undefined
}

function firstLowerString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = lowerString(value)
    if (normalized) return normalized
  }
  return undefined
}

function responseBodyEvidence(responseBody: unknown): {
  message?: string
  errorType?: string
} {
  if (typeof responseBody !== "string" || responseBody.length === 0) return {}

  try {
    const parsed = JSON.parse(responseBody) as {
      error?:
        | {
            message?: unknown
            error_type?: unknown
            metadata?: { error_type?: unknown }
          }
        | string
      message?: unknown
      error_type?: unknown
      metadata?: { error_type?: unknown }
    }
    if (parsed.error && typeof parsed.error === "object") {
      const message = lowerString(parsed.error.message)
      const errorType = firstLowerString(
        parsed.error.error_type,
        parsed.error.metadata?.error_type
      )
      return {
        ...(message ? { message } : {}),
        ...(errorType ? { errorType } : {}),
      }
    }

    const message = firstLowerString(parsed.error, parsed.message)
    const errorType = firstLowerString(
      parsed.error_type,
      parsed.metadata?.error_type
    )
    return {
      ...(message ? { message } : {}),
      ...(errorType ? { errorType } : {}),
    }
  } catch {
    return {}
  }
}

function collectRecords(error: unknown): ErrorRecord[] {
  const queue: Array<{ value: unknown; depth: number }> = [
    { value: error, depth: 0 },
  ]
  const seen = new Set<object>()
  const records: ErrorRecord[] = []

  while (queue.length > 0 && records.length < MAX_ERROR_RECORDS) {
    const current = queue.shift()
    if (!current) continue

    const record = asRecord(current.value)
    if (!record || seen.has(record)) continue
    seen.add(record)
    records.push(record)

    if (current.depth >= MAX_ERROR_DEPTH) continue
    const nested = [record.error, record.cause, record.lastError]
    if (Array.isArray(record.errors)) nested.push(...record.errors)
    for (const value of nested) {
      if (value && typeof value === "object") {
        queue.push({ value, depth: current.depth + 1 })
      }
    }
  }

  return records
}

/** Extracts bounded, cycle-safe facts without deciding how they may be exposed. */
export function collectChatErrorEvidence(error: unknown): ChatErrorEvidence {
  const records = collectRecords(error)
  const statuses = records.flatMap((record) =>
    [record.statusCode, record.status, record.code]
      .map(parseStatus)
      .filter((status): status is number => status !== undefined)
  )
  const responseBodies = records.map((record) =>
    responseBodyEvidence(record.responseBody)
  )
  const compact = (values: Array<string | undefined>) =>
    values.filter((value): value is string => value !== undefined)
  const root = records[0]

  return {
    statuses,
    codes: compact(records.map((record) => lowerString(record.code))),
    names: compact(records.map((record) => lowerString(record.name))),
    messages: compact([
      ...(typeof error === "string" ? [lowerString(error)] : []),
      ...records.flatMap((record, index) => [
        lowerString(record.message),
        responseBodies[index]?.message,
      ]),
    ]),
    errorTypes: compact(
      records.flatMap((record, index) => {
        const metadata = asRecord(record.metadata)
        return [
          firstLowerString(record.error_type, metadata?.error_type),
          responseBodies[index]?.errorType,
        ]
      })
    ),
    ...(root
      ? {
          root: {
            ...(typeof root.code === "string" ? { code: root.code } : {}),
            ...(typeof root.message === "string"
              ? { message: root.message }
              : {}),
            statuses: [root.statusCode, root.status, root.code]
              .map(parseStatus)
              .filter((status): status is number => status !== undefined),
          },
        }
      : {}),
  }
}
