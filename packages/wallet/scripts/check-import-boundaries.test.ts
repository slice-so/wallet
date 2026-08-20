import { describe, expect, it } from "bun:test"
import { resolve } from "node:path"
import {
  checkSliceWalletImportBoundaries,
  getSliceWalletSourceImportBoundaryViolations
} from "./check-import-boundaries"

const packageRoot = resolve(import.meta.dir, "..")
const sourceRoot = resolve(packageRoot, "src")

describe("Slice wallet import boundaries", () => {
  it("keeps the production source tree within its package boundaries", async () => {
    expect(await checkSliceWalletImportBoundaries()).toEqual([])
  }, 15_000)

  it("rejects Slice package imports and relative imports escaping src", () => {
    const violations = getSliceWalletSourceImportBoundaryViolations({
      filePath: resolve(sourceRoot, "nested/fixture.ts"),
      packageRoot,
      sourceRoot,
      sourceText: [
        'import "@slicekit/abi"',
        'export * from "@slice/database"',
        'import { toCallPolicy } from "@zerodev/permissions/policies"',
        'import { useAccount } from "wagmi"',
        'const external = import("../../outside")',
        'type External = import("@slice/database").SliceWallet'
      ].join("\n")
    })

    expect(violations).toEqual([
      'src/nested/fixture.ts imports internal Slice package "@slicekit/abi"',
      'src/nested/fixture.ts imports internal Slice package "@slice/database"',
      'src/nested/fixture.ts imports a ZeroDev SDK "@zerodev/permissions/policies"',
      'src/nested/fixture.ts imports browser integration module "wagmi"',
      'src/nested/fixture.ts escapes the wallet source boundary via "../../outside"',
      'src/nested/fixture.ts imports internal Slice package "@slice/database"'
    ])
  })

  it("keeps the protocol subtree runtime-neutral and self-contained", () => {
    const filePath = resolve(sourceRoot, "protocol/execution/fixture.ts")
    expect(
      getSliceWalletSourceImportBoundaryViolations({
        filePath,
        packageRoot,
        sourceRoot,
        sourceText: [
          'import { getProductsModuleAddress } from "@slicekit/abi/deployments"',
          'import { isAddress } from "viem"',
          'import { policy } from "../policy"'
        ].join("\n")
      })
    ).toEqual([])

    expect(
      getSliceWalletSourceImportBoundaryViolations({
        filePath,
        packageRoot,
        sourceRoot,
        sourceText: [
          'import { createWallet } from "../../index"',
          'import { authenticate } from "@slicekit/id"',
          'import { useAccount } from "wagmi"'
        ].join("\n")
      })
    ).toEqual([
      'src/protocol/execution/fixture.ts escapes the wallet protocol boundary via "../../index"',
      'src/protocol/execution/fixture.ts imports internal Slice package "@slicekit/id"',
      'src/protocol/execution/fixture.ts imports browser integration module "wagmi"'
    ])
  })
})
