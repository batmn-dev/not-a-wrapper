/**
 * Lazy Shiki service tests (plan §7) — run against the REAL fine-grained
 * modules so grammar loading, alias resolution, JS-engine highlighting, and
 * plain-text degradation are exercised end to end, not against a mock.
 */
import { afterEach, describe, expect, it } from "vitest"
import {
  highlightCode,
  resetShikiClientForTests,
  resolveShikiLanguage,
} from "./shiki-client"

afterEach(() => {
  resetShikiClientForTests()
})

describe("resolveShikiLanguage", () => {
  it("resolves canonical ids, aliases, and normalizes case/whitespace", () => {
    expect(resolveShikiLanguage("typescript")).toBe("typescript")
    expect(resolveShikiLanguage("ts")).toBe("typescript")
    expect(resolveShikiLanguage("js")).toBe("javascript")
    expect(resolveShikiLanguage("sh")).toBe("shellscript")
    expect(resolveShikiLanguage("bash")).toBe("shellscript")
    expect(resolveShikiLanguage("zsh")).toBe("shellscript")
    expect(resolveShikiLanguage("c++")).toBe("cpp")
    expect(resolveShikiLanguage("c#")).toBe("csharp")
    expect(resolveShikiLanguage("py")).toBe("python")
    expect(resolveShikiLanguage("yml")).toBe("yaml")
    expect(resolveShikiLanguage(" TS ")).toBe("typescript")
    expect(resolveShikiLanguage("Python")).toBe("python")
  })

  it("covers the ENTIRE historical eager-highlighter language surface", () => {
    // Enumerated 2026-07-27 from the pre-PR-C highlighter:
    // createHighlighter({ langs: <the 35-id DEFAULT_LANGS> }) followed by
    // getLoadedLanguages() — grammar ids, their aliases, AND transitively
    // embedded grammars (cpp → cpp-macro/glsl, ruby → haml, js → regexp).
    // Every id that highlighted before the lazy service must still resolve
    // to a loadable grammar, never to plain text (2026-07-27 review P2).
    const historicalSurface = [
      "bash", "c", "c#", "c++", "cjs", "cpp", "cpp-macro", "cs", "csharp",
      "css", "cts", "diff", "docker", "dockerfile", "glsl", "go", "gql",
      "graphql", "haml", "html", "ini", "java", "javascript", "js", "json",
      "jsx", "kotlin", "kt", "kts", "lua", "make", "makefile", "markdown",
      "md", "mjs", "mts", "perl", "php", "powershell", "properties", "ps",
      "ps1", "py", "python", "rb", "regex", "regexp", "rs", "ruby", "rust",
      "scala", "sh", "shell", "shellscript", "sql", "swift", "toml", "ts",
      "tsx", "typescript", "xml", "yaml", "yml", "zsh",
    ]
    for (const id of historicalSurface) {
      expect(resolveShikiLanguage(id), `lost language id: ${id}`).not.toBe(
        "text"
      )
    }
  })

  it("resolves plain and unknown ids to text", () => {
    expect(resolveShikiLanguage(undefined)).toBe("text")
    expect(resolveShikiLanguage("")).toBe("text")
    expect(resolveShikiLanguage("plaintext")).toBe("text")
    expect(resolveShikiLanguage("txt")).toBe("text")
    expect(resolveShikiLanguage("definitely-not-a-language")).toBe("text")
    // Never throws on hostile ids.
    expect(resolveShikiLanguage("../../etc/passwd")).toBe("text")
  })
})

describe("highlightCode (real modules)", () => {
  it("highlights TypeScript with tokens after demand-loading the grammar", async () => {
    const html = await highlightCode({
      code: "const answer: number = 42",
      language: "ts",
      theme: "github-light",
    })
    expect(html).toContain("<pre")
    expect(html).toContain("shiki")
    // Real tokenization: multiple colored spans, not one plain run.
    expect(html.match(/<span style="color:/g)?.length ?? 0).toBeGreaterThan(2)
    expect(html).toContain("answer")
  })

  it("renders unknown languages as escaped plain text without throwing", async () => {
    const hostile = '<script>alert("xss")</script>'
    const html = await highlightCode({
      code: hostile,
      language: "not-a-real-language",
      theme: "github-dark",
    })
    // Escaped (Shiki emits &#x3C; for <): never a live element.
    expect(html).not.toContain("<script>")
    expect(html).toContain("&#x3C;script>")
  })

  it("applies the requested theme", async () => {
    const dark = await highlightCode({
      code: "x = 1",
      language: "python",
      theme: "github-dark",
    })
    const light = await highlightCode({
      code: "x = 1",
      language: "python",
      theme: "github-light",
    })
    expect(dark).toContain("github-dark")
    expect(light).toContain("github-light")
    expect(dark).not.toBe(light)
  })

  it("deduplicates concurrent initialization and same-grammar loads", async () => {
    // Fire concurrent highlights for the same not-yet-loaded grammar plus a
    // second grammar; all must resolve consistently from one core instance.
    const [a, b, c] = await Promise.all([
      highlightCode({ code: "let a = 1", language: "js", theme: "github-light" }),
      highlightCode({ code: "let a = 1", language: "javascript", theme: "github-light" }),
      highlightCode({ code: "SELECT 1;", language: "sql", theme: "github-light" }),
    ])
    expect(a).toBe(b)
    expect(c).toContain("SELECT")
  })
})
