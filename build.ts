import { readdirSync, readFileSync } from "node:fs"
import { buildPackage } from "../../build"
import { bundleDeclarationTypes } from "../../build-declarations"
import { dependencies, peerDependencies } from "./package.json"

await buildPackage({
  bundleDeclarations: bundleDeclarationTypes,
  clientEntrypoints: ["./src/react.ts"],
  entrypoints: [
    "./src/index.ts",
    "./src/execution.ts",
    "./src/argon2id.ts",
    "./src/ceremonyRoutes.ts",
    "./src/frame.ts",
    "./src/permissions.ts",
    "./src/policy.ts",
    "./src/provider.ts",
    "./src/recovery.ts",
    "./src/react.ts",
    "./src/server.ts",
    "./src/wagmi.ts"
  ],
  external: [...Object.keys(dependencies), ...Object.keys(peerDependencies)],
  root: "./src",
  splitting: true,
  target: "browser"
})

const outputFiles = readdirSync("./dist/esm")
if (!outputFiles.some((filename) => /^chunk-.+\.js$/.test(filename))) {
  throw new Error("Wallet build did not emit shared ESM chunks.")
}
for (const entrypoint of ["react.js", "wagmi.js"]) {
  if (
    readFileSync(`./dist/esm/${entrypoint}`, "utf8").includes(
      "slice-wallet:frame-ready"
    )
  ) {
    throw new Error(`${entrypoint} inlined the shared signer-frame client.`)
  }
}
