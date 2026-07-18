import { buildPackage } from "../../build"
import { dependencies, peerDependencies } from "./package.json"

await buildPackage({
  entrypoints: [
    "./src/index.ts",
    "./src/argon2id.ts",
    "./src/frame.ts",
    "./src/policy.ts",
    "./src/provider.ts",
    "./src/recovery.ts",
    "./src/server.ts",
    "./src/wagmi.ts"
  ],
  external: [...Object.keys(dependencies), ...Object.keys(peerDependencies)],
  target: "browser"
})
