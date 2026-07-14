import { relative, resolve, sep } from "node:path"
import ts from "typescript"

const packageRoot = resolve(import.meta.dir, "..")
const sourceRoot = resolve(packageRoot, "src")
const sourceGlob = new Bun.Glob("**/*.ts")
const violations: string[] = []

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

const assertImportBoundary = ({
  filePath,
  specifier
}: {
  filePath: string
  specifier: string
}) => {
  if (specifier.startsWith("@slice/") || specifier.startsWith("@slicekit/")) {
    violations.push(
      `${relative(packageRoot, filePath)} imports internal Slice package "${specifier}"`
    )
    return
  }
  if (!specifier.startsWith(".")) return

  const resolvedImport = resolve(filePath, "..", specifier)
  if (
    resolvedImport !== sourceRoot &&
    !resolvedImport.startsWith(`${sourceRoot}${sep}`)
  ) {
    violations.push(
      `${relative(packageRoot, filePath)} escapes the wallet source boundary via "${specifier}"`
    )
  }
}

for await (const relativePath of sourceGlob.scan({
  absolute: false,
  cwd: sourceRoot,
  onlyFiles: true
})) {
  const filePath = resolve(sourceRoot, relativePath)
  const sourceText = await Bun.file(filePath).text()
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )

  const visit = (node: ts.Node) => {
    const specifier = getModuleSpecifier(node)
    if (specifier !== null) assertImportBoundary({ filePath, specifier })
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

if (violations.length > 0) {
  for (const violation of violations) console.error(violation)
  process.exitCode = 1
}
