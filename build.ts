import { buildPackage } from "../../build"
import { dependencies, peerDependencies } from "./package.json"

await buildPackage({
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
  target: "browser"
})
