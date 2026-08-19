import { buildPackage } from "../../build"
import { bundleDeclarationTypes } from "../../build-declarations"
import { dependencies } from "./package.json"

await buildPackage({
  bundleDeclarations: bundleDeclarationTypes,
  entrypoints: [
    "./src/index.ts",
    "./src/execution.ts",
    "./src/policy.ts",
    "./src/server.ts"
  ],
  external: Object.keys(dependencies),
  root: "./src",
  splitting: true,
  target: "browser"
})
