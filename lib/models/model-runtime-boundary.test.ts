import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

async function collectTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        return collectTypeScriptFiles(entryPath)
      }
      if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        return [entryPath]
      }
      return []
    })
  )

  return files.flat()
}

const forbiddenImports = [
  "@/lib/openproviders",
  "@ai-sdk/",
  "@openrouter/ai-sdk-provider",
]

function isStringLike(
  node: ts.Node | undefined
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return Boolean(
    node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  )
}

function extractImportSpecifiers(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const specifiers: string[] = []

  function addSpecifier(node: ts.Node | undefined) {
    if (isStringLike(node)) {
      specifiers.push(node.text)
    }
  }

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addSpecifier(node.moduleSpecifier)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addSpecifier(node.moduleReference.expression)
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      addSpecifier(node.arguments[0])
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return specifiers
}

function isInsidePath(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath)
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  )
}

function matchesPackageImport(
  specifier: string,
  forbiddenImport: string
): boolean {
  if (forbiddenImport.endsWith("/")) {
    return specifier.startsWith(forbiddenImport)
  }

  return (
    specifier === forbiddenImport || specifier.startsWith(`${forbiddenImport}/`)
  )
}

function resolveLocalImport(file: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) {
    return path.resolve(process.cwd(), specifier.slice(2))
  }

  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(file), specifier)
  }

  return null
}

function findForbiddenImport(
  file: string,
  specifier: string,
  forbiddenImports: string[]
): string | null {
  for (const forbiddenImport of forbiddenImports) {
    if (!forbiddenImport.startsWith("@/")) {
      if (matchesPackageImport(specifier, forbiddenImport)) {
        return forbiddenImport
      }
      continue
    }

    const resolvedImport = resolveLocalImport(file, specifier)
    if (!resolvedImport) continue

    const forbiddenPath = path.resolve(process.cwd(), forbiddenImport.slice(2))
    if (isInsidePath(forbiddenPath, resolvedImport)) {
      return forbiddenImport
    }
  }

  return null
}

describe("model catalog runtime boundary", () => {
  it("recognizes forbidden imports by resolved path and package target", () => {
    const modelFile = path.join(process.cwd(), "lib/models/data/claude.ts")

    expect(
      findForbiddenImport(
        modelFile,
        "../../openproviders/env",
        forbiddenImports
      )
    ).toBe("@/lib/openproviders")
    expect(
      findForbiddenImport(
        modelFile,
        "@/lib/openproviders/env",
        forbiddenImports
      )
    ).toBe("@/lib/openproviders")
    expect(
      findForbiddenImport(modelFile, "@ai-sdk/provider", forbiddenImports)
    ).toBe("@ai-sdk/")
    expect(
      findForbiddenImport(
        modelFile,
        "@openrouter/ai-sdk-provider",
        forbiddenImports
      )
    ).toBe("@openrouter/ai-sdk-provider")
  })

  it("keeps lib/models free of provider runtime imports", async () => {
    const modelFiles = await collectTypeScriptFiles(
      path.join(process.cwd(), "lib/models")
    )

    const violations: string[] = []
    for (const file of modelFiles) {
      const source = await readFile(file, "utf8")
      const importSpecifiers = extractImportSpecifiers(source, file)
      for (const importSpecifier of importSpecifiers) {
        const forbiddenImport = findForbiddenImport(
          file,
          importSpecifier,
          forbiddenImports
        )
        if (forbiddenImport) {
          const relativeFile = path.relative(process.cwd(), file)
          violations.push(
            `${relativeFile} imports ${importSpecifier} (${forbiddenImport})`
          )
        }
      }
    }

    expect(violations).toEqual([])
  })
})
