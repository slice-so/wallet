import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { getWalletPrimitivesImportBoundaryViolations } from "./check-import-boundaries"

const filePath = resolve(import.meta.dir, "../src/execution/example.ts")

describe("wallet primitives import boundaries", () => {
  test("rejects private, higher-level, browser, and escaping imports", () => {
    const violations = getWalletPrimitivesImportBoundaryViolations({
      filePath,
      sourceText: [
        'import { a } from "@slice/database"',
        'import { b } from "@slicekit/wallet/server"',
        'import { c } from "@slicekit/commerce"',
        'import { d } from "@zerodev/sdk"',
        'import { e } from "react"',
        'import { f } from "../../../slicekit-wallet/src/index"',
        'import { g } from "@slicekit/wallet-primitives/server"',
        'const h = await import("wagmi")',
        'type I = import("@slicekit/id").X'
      ].join("\n")
    })
    expect(violations).toHaveLength(9)
  })

  test("allows dependencies and in-package relative imports", () => {
    expect(
      getWalletPrimitivesImportBoundaryViolations({
        filePath,
        sourceText: [
          'import { a } from "@slicekit/abi"',
          'import { b } from "@slicekit/erc8128"',
          'import { c } from "@zerodev/permissions"',
          'import { d } from "viem"',
          'import { e } from "../policy"',
          'import type { f } from "./utils/sliceCallPolicy"'
        ].join("\n")
      })
    ).toEqual([])
  })
})
