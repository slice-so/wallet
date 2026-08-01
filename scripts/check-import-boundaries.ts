import { relative, resolve, sep } from "node:path"
import ts from "typescript"

const defaultPackageRoot = resolve(import.meta.dir, "..")

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

export const getSliceWalletSourceImportBoundaryViolations = ({
  filePath,
  packageRoot,
  sourceRoot,
  sourceText
}: {
  filePath: string
  packageRoot: string
  sourceRoot: string
  sourceText: string
}) => {
  const violations: string[] = []
  const relativePath = relative(packageRoot, filePath).split(sep).join("/")
  const isExecution = relativePath.startsWith("src/execution/")
  const isTypes = relativePath.startsWith("src/types/")
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )

  const checkSpecifier = (specifier: string) => {
    if (specifier === "@slicekit/abi" && isExecution) return
    if (specifier === "@slicekit/erc8128" && isTypes) return
    if (
      isExecution &&
      (specifier === "react" || specifier.startsWith("react/"))
    ) {
      violations.push(`${relativePath} imports React from the execution layer`)
      return
    }
    if (specifier.startsWith("@slice/") || specifier.startsWith("@slicekit/")) {
      violations.push(
        `${relativePath} imports internal Slice package "${specifier}"`
      )
      return
    }
    if (!specifier.startsWith(".")) return

    const resolvedImport = resolve(filePath, "..", specifier)
    const reactRoot = resolve(sourceRoot, "react")
    if (
      isExecution &&
      (resolvedImport === reactRoot ||
        resolvedImport.startsWith(`${reactRoot}${sep}`))
    ) {
      violations.push(
        `${relativePath} imports the React layer from the execution layer via "${specifier}"`
      )
      return
    }
    if (
      resolvedImport !== sourceRoot &&
      !resolvedImport.startsWith(`${sourceRoot}${sep}`)
    ) {
      violations.push(
        `${relativePath} escapes the wallet source boundary via "${specifier}"`
      )
    }
  }

  const visit = (node: ts.Node) => {
    const specifier = getModuleSpecifier(node)
    if (specifier !== null) checkSpecifier(specifier)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return violations
}

export const checkSliceWalletImportBoundaries = async ({
  packageRoot = defaultPackageRoot,
  sourceRoot = resolve(packageRoot, "src")
}: {
  packageRoot?: string
  sourceRoot?: string
} = {}) => {
  const sourceGlob = new Bun.Glob("**/*.{ts,tsx}")
  const violations: string[] = []

  for await (const relativePath of sourceGlob.scan({
    absolute: false,
    cwd: sourceRoot,
    onlyFiles: true
  })) {
    const filePath = resolve(sourceRoot, relativePath)
    violations.push(
      ...getSliceWalletSourceImportBoundaryViolations({
        filePath,
        packageRoot,
        sourceRoot,
        sourceText: await Bun.file(filePath).text()
      })
    )
  }

  return violations
}

if (import.meta.main) {
  const violations = await checkSliceWalletImportBoundaries()
  if (violations.length > 0) {
    for (const violation of violations) console.error(violation)
    process.exitCode = 1
  }
}
