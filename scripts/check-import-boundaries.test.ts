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
  })

  it("rejects Slice package imports and relative imports escaping src", () => {
    const violations = getSliceWalletSourceImportBoundaryViolations({
      filePath: resolve(sourceRoot, "nested/fixture.ts"),
      packageRoot,
      sourceRoot,
      sourceText: [
        'import "@slicekit/abi"',
        'export * from "@slice/indexer-shared"',
        'const external = import("../../outside")',
        'type External = import("@slicekit/common").SliceWallet'
      ].join("\n")
    })

    expect(violations).toEqual([
      'src/nested/fixture.ts imports internal Slice package "@slicekit/abi"',
      'src/nested/fixture.ts imports internal Slice package "@slice/indexer-shared"',
      'src/nested/fixture.ts escapes the wallet source boundary via "../../outside"',
      'src/nested/fixture.ts imports internal Slice package "@slicekit/common"'
    ])
  })

  it("allows the shared delegation contract in exported wallet types", () => {
    expect(
      getSliceWalletSourceImportBoundaryViolations({
        filePath: resolve(sourceRoot, "types/session.ts"),
        packageRoot,
        sourceRoot,
        sourceText: 'import type { DelegationGrant } from "@slicekit/erc8128"'
      })
    ).toEqual([])
  })
})
