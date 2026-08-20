import { entryPoint09Abi, entryPoint09Address } from "viem/account-abstraction"

export const kernelVersion = "0.4.0" as const

export const kernelDummyEcdsaSignature =
  "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c" as const

export const kernelEntryPoint = {
  abi: entryPoint09Abi,
  address: entryPoint09Address,
  version: "0.9"
} as const

export const kernelModuleType = {
  executor: 2n,
  fallback: 3n,
  hook: 4n,
  policy: 5n,
  signer: 6n,
  validator: 1n
} as const

export const kernelValidationMode = {
  enable: 0x08,
  enableReplayable: 0x0c,
  normal: 0x00,
  replayable: 0x40
} as const

export const kernelValidationType = {
  permission: 0x02,
  root: 0x00,
  validator: 0x01
} as const

export const kernelSingleExecutionMode =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const
export const kernelBatchExecutionMode =
  "0x0100000000000000000000000000000000000000000000000000000000000000" as const
