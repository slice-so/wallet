import type { PolicyFlags } from "@zerodev/permissions"
import type { Address } from "viem"

export type SliceTimelockPolicyParameters = {
  delaySec?: number
  expirationSec?: number
  guardian?: Address
  policyAddress?: Address
  policyFlag?: PolicyFlags
}
