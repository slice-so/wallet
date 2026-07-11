import { buildPackage } from "../../build"
import { dependencies, peerDependencies } from "./package.json"

await buildPackage({
  external: [...Object.keys(dependencies), ...Object.keys(peerDependencies)],
  target: "browser"
})

const secondaryBuild = await Bun.build({
  entrypoints: [
    "./src/frame.ts",
    "./src/policy.ts",
    "./src/provider.ts",
    "./src/recovery.ts",
    "./src/server.ts",
    "./src/wagmi.ts"
  ],
  external: [...Object.keys(dependencies), ...Object.keys(peerDependencies)],
  format: "esm",
  minify: true,
  outdir: "./dist/esm",
  sourcemap: "external",
  target: "browser"
})

if (!secondaryBuild.success) {
  throw new AggregateError(
    secondaryBuild.logs,
    "Slice wallet subpath build failed"
  )
}
