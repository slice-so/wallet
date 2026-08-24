import { readdirSync } from "node:fs"
import { dependencies } from "./package.json"
import { buildPackage } from "./tooling/build"
import { bundleDeclarationTypes } from "./tooling/build-declarations"

await buildPackage({
  bundleDeclarations: bundleDeclarationTypes,
  entrypoints: [
    "./src/index.ts",
    "./src/assets.ts",
    "./src/protocol/index.ts",
    "./src/protocol/kernel.ts",
    "./src/protocol/policy.ts",
    "./src/execution.ts",
    "./src/argon2id.ts",
    "./src/ceremonyRoutes.ts",
    "./src/frame.ts",
    "./src/permissions.ts",
    "./src/provider.ts",
    "./src/recovery.ts",
    "./src/server.ts"
  ],
  external: Object.keys(dependencies),
  root: "./src",
  sourcemap: "none",
  splitting: true,
  target: "browser"
})

const outputFiles = readdirSync("./dist/esm")
if (!outputFiles.some((filename) => /^chunk-.+\.js$/.test(filename))) {
  throw new Error("Wallet build did not emit shared ESM chunks.")
}
