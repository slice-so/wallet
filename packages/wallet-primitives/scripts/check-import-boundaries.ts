import { readdir } from "node:fs/promises"
import { extname, relative, resolve, sep } from "node:path"
import ts from "typescript"

// Wallet Primitives must stay portable: no private monorepo packages, no
// higher-level Slice SDKs, no browser/React/wagmi/ZeroDev SDK surface, and no
// imports that escape the package source tree.
const forbiddenExactOrPrefix = [
  "@slice/",
  "@slicekit/wallet",
  "@slicekit/core",
  "@slicekit/react",
  "@slicekit/commerce",
  "@slicekit/id",
  "@slicekit/id-primitives",
  "@zerodev/sdk",
  "@zerodev/ecdsa-validator",
  "connectkit",
  "react",
  "wagmi",
  "@wagmi/core"
] as const

const packageRoot = resolve(import.meta.dir, "..")
const sourceRoot = resolve(packageRoot, "src")

const getModuleSpecifier = (node: ts.Node) => {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length === 1 &&
    ts.isStringLiteral(node.arguments[0])
  ) {
    return node.arguments[0].text
  }
  if (
    ts.isImportTypeNode(node) &&
    ts.isLiteralTypeNode(node.argument) &&
    ts.isStringLiteral(node.argument.literal)
  ) {
    return node.argument.literal.text
  }
  return null
}

const isForbiddenSpecifier = (specifier: string) =>
  forbiddenExactOrPrefix.some((rule) =>
    rule.endsWith("/")
      ? specifier.startsWith(rule)
      : specifier === rule || specifier.startsWith(`${rule}/`)
  )

export const getWalletPrimitivesImportBoundaryViolations = ({
  filePath,
  sourceText
}: {
  filePath: string
  sourceText: string
}) => {
  const violations: string[] = []
  const relativePath = relative(packageRoot, filePath).split(sep).join("/")
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const check = (specifier: string) => {
    if (isForbiddenSpecifier(specifier)) {
      violations.push(`${relativePath} imports forbidden module "${specifier}"`)
      return
    }
    if (specifier.startsWith("@slicekit/wallet-primitives")) {
      violations.push(
        `${relativePath} imports its own package by name; use a relative path`
      )
      return
    }
    if (!specifier.startsWith(".")) return
    const resolved = resolve(filePath, "..", specifier)
    if (relative(sourceRoot, resolved).startsWith("..")) {
      violations.push(
        `${relativePath} imports "${specifier}" outside the package source`
      )
    }
  }
  const visit = (node: ts.Node) => {
    const specifier = getModuleSpecifier(node)
    if (specifier !== null) check(specifier)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return violations
}

const sourceFiles = async (directory: string): Promise<string[]> => {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)))
    else if ([".ts", ".tsx"].includes(extname(entry.name))) files.push(path)
  }
  return files
}

if (import.meta.main) {
  const violations: string[] = []
  for (const filePath of await sourceFiles(sourceRoot)) {
    violations.push(
      ...getWalletPrimitivesImportBoundaryViolations({
        filePath,
        sourceText: await Bun.file(filePath).text()
      })
    )
  }
  if (violations.length > 0) {
    throw new Error(
      `Wallet Primitives import boundary violations:\n${violations.join("\n")}`
    )
  }
  console.log("Wallet Primitives import boundaries verified.")
}
