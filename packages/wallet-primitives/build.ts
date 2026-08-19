import { buildPackage } from "../../tooling/build"
import { bundleDeclarationTypes } from "../../tooling/build-declarations"
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
  sourcemap: "none",
  splitting: true,
  target: "browser"
})
