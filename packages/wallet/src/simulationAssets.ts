import {
  type Address,
  decodeAbiParameters,
  getAddress,
  type Hex,
  isAddress,
  keccak256,
  stringToHex
} from "viem"
import type { SliceWalletNftTransfer } from "./types"

const transferTopic = keccak256(
  stringToHex("Transfer(address,address,uint256)")
)
const approvalTopic = keccak256(
  stringToHex("Approval(address,address,uint256)")
)
const approvalForAllTopic = keccak256(
  stringToHex("ApprovalForAll(address,address,bool)")
)
const transferSingleTopic = keccak256(
  stringToHex("TransferSingle(address,address,address,uint256,uint256)")
)
const transferBatchTopic = keccak256(
  stringToHex("TransferBatch(address,address,address,uint256[],uint256[])")
)
const nativeTransferEmitter = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

/** Display bound so log-heavy transactions cannot flood the confirmation frame. */
const maximumNftTransfers = 64

const topicAddress = (value: Hex): Address | null => {
  if (
    value.length !== 66 ||
    value.slice(2, 26) !== "000000000000000000000000"
  ) {
    return null
  }
  const candidate = `0x${value.slice(26)}`
  return isAddress(candidate) ? getAddress(candidate) : null
}

const word = (value: Hex): bigint | null =>
  value.length === 66 ? BigInt(value) : null

const direction = (
  account: string,
  from: Address,
  to: Address
): SliceWalletNftTransfer["direction"] =>
  from.toLowerCase() === account
    ? to.toLowerCase() === account
      ? "self"
      : "out"
    : "in"

const nftTransfer = ({
  account,
  amount,
  collection,
  from,
  standard,
  to,
  tokenId
}: {
  account: string
  amount: bigint
  collection: Address
  from: Address
  standard: SliceWalletNftTransfer["standard"]
  to: Address
  tokenId: bigint
}): SliceWalletNftTransfer | null =>
  from.toLowerCase() !== account && to.toLowerCase() !== account
    ? null
    : {
        amount: amount.toString(),
        collection,
        direction: direction(account, from, to),
        from,
        standard,
        to,
        tokenId: tokenId.toString()
      }

export const collectSliceWalletSimulationAssetChanges = (
  logs: readonly {
    address: Address
    data: Hex
    topics: readonly Hex[]
  }[],
  account: Address
) => {
  const normalizedAccount = account.toLowerCase()
  const approvals = new Map<string, { spender: Address; token: Address }>()
  const nftApprovals = new Map<
    string,
    { approved: boolean; collection: Address; operator: Address }
  >()
  const nftTransfers: SliceWalletNftTransfer[] = []
  let nftTransfersOmitted = 0
  const tokens = new Map<string, Address>()
  const recordTransfer = (transfer: SliceWalletNftTransfer | null) => {
    if (transfer === null) return
    if (nftTransfers.length >= maximumNftTransfers) {
      nftTransfersOmitted += 1
      return
    }
    nftTransfers.push(transfer)
  }
  for (const log of logs) {
    const topic = log.topics[0]?.toLowerCase()
    if (topic === transferTopic && log.topics.length === 3) {
      const from = topicAddress(log.topics[1] as Hex)
      const to = topicAddress(log.topics[2] as Hex)
      const amount = word(log.data)
      if (from === null || to === null || amount === null) continue
      if (
        log.address.toLowerCase() !== nativeTransferEmitter &&
        (from.toLowerCase() === normalizedAccount ||
          to.toLowerCase() === normalizedAccount)
      ) {
        tokens.set(log.address.toLowerCase(), log.address)
      }
      continue
    }
    if (topic === transferTopic && log.topics.length === 4) {
      const from = topicAddress(log.topics[1] as Hex)
      const to = topicAddress(log.topics[2] as Hex)
      const tokenId = word(log.topics[3] as Hex)
      if (from === null || to === null || tokenId === null) continue
      recordTransfer(
        nftTransfer({
          account: normalizedAccount,
          amount: 1n,
          collection: log.address,
          from,
          standard: "erc721",
          to,
          tokenId
        })
      )
      continue
    }
    if (topic === transferSingleTopic && log.topics.length === 4) {
      const from = topicAddress(log.topics[2] as Hex)
      const to = topicAddress(log.topics[3] as Hex)
      if (from === null || to === null) continue
      try {
        const [tokenId, amount] = decodeAbiParameters(
          [{ type: "uint256" }, { type: "uint256" }],
          log.data
        )
        recordTransfer(
          nftTransfer({
            account: normalizedAccount,
            amount,
            collection: log.address,
            from,
            standard: "erc1155",
            to,
            tokenId
          })
        )
      } catch {}
      continue
    }
    if (topic === transferBatchTopic && log.topics.length === 4) {
      const from = topicAddress(log.topics[2] as Hex)
      const to = topicAddress(log.topics[3] as Hex)
      if (from === null || to === null) continue
      // A batch event moves every item between the same pair, so wallet
      // relevance is decided once for the whole event. Unrelated batches
      // never touch retained slots or the omitted count.
      if (
        from.toLowerCase() !== normalizedAccount &&
        to.toLowerCase() !== normalizedAccount
      ) {
        continue
      }
      try {
        const [tokenIds, amounts] = decodeAbiParameters(
          [{ type: "uint256[]" }, { type: "uint256[]" }],
          log.data
        )
        if (tokenIds.length !== amounts.length) continue
        // Every batch item is counted: items beyond the remaining display
        // slots land in nftTransfersOmitted instead of disappearing, and the
        // loop stops at those slots so huge batches cannot stall the frame.
        const slots = maximumNftTransfers - nftTransfers.length
        if (tokenIds.length > slots) {
          nftTransfersOmitted += tokenIds.length - slots
        }
        for (const [index, tokenId] of tokenIds.slice(0, slots).entries()) {
          const amount = amounts[index]
          if (amount === undefined) continue
          recordTransfer(
            nftTransfer({
              account: normalizedAccount,
              amount,
              collection: log.address,
              from,
              standard: "erc1155",
              to,
              tokenId
            })
          )
        }
      } catch {}
      continue
    }
    if (topic === approvalForAllTopic && log.topics.length === 3) {
      const owner = topicAddress(log.topics[1] as Hex)
      const operator = topicAddress(log.topics[2] as Hex)
      const approved = word(log.data)
      if (
        owner === null ||
        operator === null ||
        approved === null ||
        owner.toLowerCase() !== normalizedAccount ||
        (approved !== 0n && approved !== 1n)
      ) {
        continue
      }
      // Last event wins so replayed grant/revoke sequences reflect the final state.
      nftApprovals.set(
        `${log.address.toLowerCase()}:${operator.toLowerCase()}`,
        {
          approved: approved === 1n,
          collection: log.address,
          operator
        }
      )
      continue
    }
    if (topic !== approvalTopic || log.topics.length !== 3) continue
    const owner = topicAddress(log.topics[1] as Hex)
    const spender = topicAddress(log.topics[2] as Hex)
    const amount = word(log.data)
    if (
      owner === null ||
      spender === null ||
      amount === null ||
      owner.toLowerCase() !== normalizedAccount
    ) {
      continue
    }
    const key = `${log.address.toLowerCase()}:${spender.toLowerCase()}`
    approvals.set(key, { spender, token: log.address })
    tokens.set(log.address.toLowerCase(), log.address)
  }
  return { approvals, nftApprovals, nftTransfers, nftTransfersOmitted, tokens }
}
