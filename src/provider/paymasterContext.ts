import { keccak256, stringToBytes } from "viem"
import type { SliceWalletProviderValue } from "../types"
import type {
  SliceWalletCanonicalPaymasterContext,
  SliceWalletPaymasterContextValue
} from "../types/providerInternal"
import { invalidProviderRequest } from "./errors"

const maxArrayLength = 128
const maxContextBytes = 8_192
const maxContextDepth = 8
const maxContextKeys = 128

const invalidContext = (reason: string): never => {
  throw invalidProviderRequest(`Paymaster context ${reason}.`)
}

export const canonicalizeSliceWalletPaymasterContext = (
  value: SliceWalletProviderValue
): SliceWalletCanonicalPaymasterContext => {
  let keyCount = 0
  const stack = new WeakSet<object>()

  const serialize = (
    current: SliceWalletProviderValue | undefined,
    depth: number
  ): string => {
    if (current === undefined || typeof current === "bigint") {
      return invalidContext("must contain only JSON-compatible values")
    }
    if (current === null || typeof current === "boolean") {
      return String(current)
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        return invalidContext("must contain only finite numbers")
      }
      return JSON.stringify(current)
    }
    if (typeof current === "string") return JSON.stringify(current)
    if (depth > maxContextDepth) {
      return invalidContext(`exceeds the maximum depth of ${maxContextDepth}`)
    }
    if (stack.has(current)) return invalidContext("must not contain cycles")
    stack.add(current)

    let serialized: string
    if (Array.isArray(current)) {
      if (current.length > maxArrayLength) {
        return invalidContext(
          `exceeds the maximum array length of ${maxArrayLength}`
        )
      }
      const keys = Object.keys(current)
      if (
        keys.length !== current.length ||
        keys.some((key, index) => key !== String(index))
      ) {
        return invalidContext("must not contain sparse or extended arrays")
      }
      serialized = `[${current
        .map((item) => serialize(item, depth + 1))
        .join(",")}]`
    } else {
      const objectValue = current as {
        readonly [key: string]: SliceWalletProviderValue | undefined
      }
      const prototype = Object.getPrototypeOf(objectValue)
      if (prototype !== Object.prototype && prototype !== null) {
        return invalidContext("must contain only plain objects")
      }
      if (Object.getOwnPropertySymbols(objectValue).length > 0) {
        return invalidContext("must not contain symbol keys")
      }
      const keys = Object.keys(objectValue).sort()
      keyCount += keys.length
      if (keyCount > maxContextKeys) {
        return invalidContext(`exceeds the maximum of ${maxContextKeys} keys`)
      }
      const entries = keys.map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(objectValue, key)
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          !descriptor.enumerable
        ) {
          return invalidContext("must contain only enumerable data properties")
        }
        return `${JSON.stringify(key)}:${serialize(objectValue[key], depth + 1)}`
      })
      serialized = `{${entries.join(",")}}`
    }

    stack.delete(current)
    return serialized
  }

  const canonicalJson = serialize(value, 0)
  if (new TextEncoder().encode(canonicalJson).length > maxContextBytes) {
    invalidContext(`exceeds ${maxContextBytes} serialized bytes`)
  }
  const normalized = JSON.parse(
    canonicalJson
  ) as SliceWalletPaymasterContextValue
  const freeze = (
    current: SliceWalletPaymasterContextValue
  ): SliceWalletPaymasterContextValue => {
    if (typeof current !== "object" || current === null) return current
    for (const child of Array.isArray(current)
      ? current
      : Object.values(current)) {
      freeze(child as SliceWalletPaymasterContextValue)
    }
    return Object.freeze(current)
  }
  return {
    canonicalHash: keccak256(stringToBytes(canonicalJson)),
    canonicalJson,
    value: freeze(normalized)
  }
}
