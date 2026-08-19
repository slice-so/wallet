import type { SliceWalletProtocolValue } from "@slicekit/wallet-primitives/server"
import { bytesToHex, hexToBytes, isAddress, isAddressEqual, isHex } from "viem"
import type {
  SliceWalletBridgeUnlockChallenge,
  SliceWalletBridgeUnlockRecord,
  SliceWalletBridgeUnlockResponse
} from "../types"

const getBridgeCandidates = (currentWindow: Window) => {
  const host =
    currentWindow.opener ??
    (currentWindow.parent === currentWindow ? null : currentWindow.parent)
  if (host === null) return []
  const candidates: WindowProxy[] = []
  try {
    for (let index = 0; index < host.frames.length; index += 1) {
      const frame = host.frames[index]
      if (frame !== undefined && frame !== currentWindow) candidates.push(frame)
    }
  } catch {
    return currentWindow.opener === host ? [host] : []
  }
  return candidates.length === 0 && currentWindow.opener === host
    ? [host]
    : candidates
}

const parseUnlockRecord = (
  value: SliceWalletProtocolValue,
  challenge: SliceWalletBridgeUnlockChallenge,
  appOrigin: string
): SliceWalletBridgeUnlockRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Signer unlock record is invalid.")
  }
  const input = value as { readonly [key: string]: SliceWalletProtocolValue }
  if (
    Object.keys(input).length !== 5 ||
    input.type !== "slice-wallet:bridge-unlock-record" ||
    input.version !== 1 ||
    input.nonce !== challenge.nonce ||
    typeof input.account !== "string" ||
    !isAddress(input.account) ||
    !isAddressEqual(input.account, challenge.account) ||
    typeof input.origin !== "string" ||
    new URL(input.origin).origin !== appOrigin
  ) {
    throw new Error("Signer unlock record does not match the ceremony.")
  }
  return {
    account: input.account,
    nonce: challenge.nonce,
    origin: appOrigin,
    type: "slice-wallet:bridge-unlock-record",
    version: 1
  }
}

const parseUnlockResponse = (
  value: SliceWalletProtocolValue,
  challenge: SliceWalletBridgeUnlockChallenge
): SliceWalletBridgeUnlockResponse => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Signer unlock response is invalid.")
  }
  const input = value as { readonly [key: string]: SliceWalletProtocolValue }
  if (
    Object.keys(input).length !== 4 ||
    input.type !== "slice-wallet:bridge-unlocked" ||
    input.version !== 1 ||
    input.nonce !== challenge.nonce ||
    typeof input.account !== "string" ||
    !isAddress(input.account) ||
    !isAddressEqual(input.account, challenge.account)
  ) {
    throw new Error("Signer unlock response does not match the ceremony.")
  }
  return {
    account: input.account,
    nonce: challenge.nonce,
    type: "slice-wallet:bridge-unlocked",
    version: 1
  }
}

const unlockCandidate = ({
  appOrigin,
  candidate,
  challenge,
  selfOrigin,
  timeoutMs
}: {
  appOrigin: string
  candidate: WindowProxy
  challenge: SliceWalletBridgeUnlockChallenge
  selfOrigin: string
  timeoutMs: number
}) =>
  new Promise<boolean>((resolve) => {
    const channel = new MessageChannel()
    let phase: "record" | "response" = "record"
    const finish = (unlocked: boolean) => {
      clearTimeout(timeout)
      channel.port1.close()
      resolve(unlocked)
    }
    const timeout = setTimeout(() => finish(false), timeoutMs)
    channel.port1.addEventListener(
      "message",
      (event: MessageEvent<SliceWalletProtocolValue>) => {
        try {
          if (phase === "record") {
            parseUnlockRecord(event.data, challenge, appOrigin)
            phase = "response"
            channel.port1.postMessage({
              account: challenge.account,
              nonce: challenge.nonce,
              type: "slice-wallet:bridge-unlock",
              version: 1
            })
            return
          }
          parseUnlockResponse(event.data, challenge)
          finish(true)
        } catch {
          finish(false)
        }
      }
    )
    channel.port1.start()
    try {
      candidate.postMessage(challenge, selfOrigin, [channel.port2])
    } catch {
      finish(false)
    }
  })

/** Called only after the trusted Slice ID ceremony verifies the root passkey. */
export const unlockSliceWalletSignerFrames = async ({
  account,
  appOrigin,
  currentWindow = window,
  selfOrigin = location.origin,
  timeoutMs = 5_000
}: {
  account: `0x${string}`
  appOrigin: string
  currentWindow?: Window
  selfOrigin?: string
  timeoutMs?: number
}) => {
  const nonceBytes = new Uint8Array(32)
  currentWindow.crypto.getRandomValues(nonceBytes)
  const nonce = bytesToHex(nonceBytes)
  if (!isHex(nonce, { strict: true }) || hexToBytes(nonce).length !== 32) {
    throw new Error("Unable to create a wallet unlock nonce.")
  }
  const challenge = {
    account,
    nonce,
    type: "slice-wallet:bridge-unlock-challenge",
    version: 1
  } as const satisfies SliceWalletBridgeUnlockChallenge
  const candidates = getBridgeCandidates(currentWindow)
  if (candidates.length === 0) return 0
  return new Promise<number>((resolve) => {
    let remaining = candidates.length
    let resolved = false
    for (const candidate of candidates) {
      void unlockCandidate({
        appOrigin: new URL(appOrigin).origin,
        candidate,
        challenge,
        selfOrigin: new URL(selfOrigin).origin,
        timeoutMs
      }).then((unlocked) => {
        if (resolved) return
        if (unlocked) {
          resolved = true
          resolve(1)
          return
        }
        remaining -= 1
        if (remaining === 0) resolve(0)
      })
    }
  })
}
