import { describe, expect, test } from "bun:test"
import {
  type Address,
  encodeAbiParameters,
  keccak256,
  padHex,
  stringToHex,
  toHex,
  zeroAddress
} from "viem"
import { collectSliceWalletSimulationAssetChanges } from "./simulationAssets"

const account = "0x1000000000000000000000000000000000000001"
const counterparty = "0x2000000000000000000000000000000000000002"
const erc20 = "0x3000000000000000000000000000000000000003"
const erc721 = "0x4000000000000000000000000000000000000004"
const erc1155 = "0x5000000000000000000000000000000000000005"
const operator = "0x6000000000000000000000000000000000000006"

const topic = (signature: string) => keccak256(stringToHex(signature))
const addressTopic = (address: Address) => padHex(address, { size: 32 })

describe("simulation asset discovery", () => {
  test("keeps fungible and NFT transfers in their correct asset models", () => {
    const changes = collectSliceWalletSimulationAssetChanges(
      [
        {
          address: erc20,
          data: toHex(25n, { size: 32 }),
          topics: [
            topic("Transfer(address,address,uint256)"),
            addressTopic(account),
            addressTopic(counterparty)
          ]
        },
        {
          address: erc721,
          data: "0x",
          topics: [
            topic("Transfer(address,address,uint256)"),
            addressTopic(counterparty),
            addressTopic(account),
            toHex(42n, { size: 32 })
          ]
        },
        {
          address: erc1155,
          data: encodeAbiParameters(
            [{ type: "uint256" }, { type: "uint256" }],
            [7n, 3n]
          ),
          topics: [
            topic("TransferSingle(address,address,address,uint256,uint256)"),
            addressTopic(operator),
            addressTopic(account),
            addressTopic(counterparty)
          ]
        }
      ],
      account
    )

    expect([...changes.tokens.values()]).toEqual([erc20])
    expect(changes.nftTransfers).toEqual([
      {
        amount: "1",
        collection: erc721,
        direction: "in",
        from: counterparty,
        standard: "erc721",
        to: account,
        tokenId: "42"
      },
      {
        amount: "3",
        collection: erc1155,
        direction: "out",
        from: account,
        standard: "erc1155",
        to: counterparty,
        tokenId: "7"
      }
    ])
  })

  test("decodes bounded ERC-1155 batches and wallet self-transfers", () => {
    const changes = collectSliceWalletSimulationAssetChanges(
      [
        {
          address: erc1155,
          data: encodeAbiParameters(
            [{ type: "uint256[]" }, { type: "uint256[]" }],
            [
              [1n, 2n],
              [4n, 5n]
            ]
          ),
          topics: [
            topic("TransferBatch(address,address,address,uint256[],uint256[])"),
            addressTopic(zeroAddress),
            addressTopic(account),
            addressTopic(account)
          ]
        }
      ],
      account
    )

    expect(
      changes.nftTransfers.map(({ amount, direction, tokenId }) => ({
        amount,
        direction,
        tokenId
      }))
    ).toEqual([
      { amount: "4", direction: "self", tokenId: "1" },
      { amount: "5", direction: "self", tokenId: "2" }
    ])
  })

  test("decodes ERC-721/1155 operator grants and revocations for the account", () => {
    const changes = collectSliceWalletSimulationAssetChanges(
      [
        {
          address: erc721,
          data: toHex(1n, { size: 32 }),
          topics: [
            topic("ApprovalForAll(address,address,bool)"),
            addressTopic(counterparty),
            addressTopic(operator)
          ]
        },
        {
          address: erc1155,
          data: toHex(0n, { size: 32 }),
          topics: [
            topic("ApprovalForAll(address,address,bool)"),
            addressTopic(account),
            addressTopic(operator)
          ]
        },
        {
          address: erc721,
          data: toHex(0n, { size: 32 }),
          topics: [
            topic("ApprovalForAll(address,address,bool)"),
            addressTopic(account),
            addressTopic(counterparty)
          ]
        }
      ],
      account
    )

    expect(
      [...changes.nftApprovals.values()].sort((left, right) =>
        left.collection
          .toLowerCase()
          .localeCompare(right.collection.toLowerCase())
      )
    ).toEqual([
      { approved: false, collection: erc721, operator: counterparty },
      { approved: false, collection: erc1155, operator }
    ])
    // Grants made by other owners never enter the result.
    expect(
      changes.nftApprovals.has(`${erc721.toLowerCase()}:${operator}`)
    ).toBe(false)
  })

  test("keeps the last operator event when a collection emits several", () => {
    const changes = collectSliceWalletSimulationAssetChanges(
      [
        {
          address: erc721,
          data: toHex(1n, { size: 32 }),
          topics: [
            topic("ApprovalForAll(address,address,bool)"),
            addressTopic(account),
            addressTopic(operator)
          ]
        },
        {
          address: erc721,
          data: toHex(0n, { size: 32 }),
          topics: [
            topic("ApprovalForAll(address,address,bool)"),
            addressTopic(account),
            addressTopic(operator)
          ]
        }
      ],
      account
    )

    expect([...changes.nftApprovals.values()]).toEqual([
      { approved: false, collection: erc721, operator }
    ])
  })

  test("ignores operator events with non-boolean approval data", () => {
    const changes = collectSliceWalletSimulationAssetChanges(
      [
        {
          address: erc721,
          data: toHex(2n, { size: 32 }),
          topics: [
            topic("ApprovalForAll(address,address,bool)"),
            addressTopic(account),
            addressTopic(operator)
          ]
        }
      ],
      account
    )

    expect(changes.nftApprovals.size).toBe(0)
  })

  test("bounds collectible transfers and reports the omitted remainder", () => {
    const transfers: readonly {
      address: `0x${string}`
      data: `0x${string}`
      topics: readonly `0x${string}`[]
    }[] = Array.from({ length: 70 }, (_, index) => ({
      address: erc721,
      data: "0x",
      topics: [
        topic("Transfer(address,address,uint256)"),
        addressTopic(zeroAddress),
        addressTopic(account),
        toHex(BigInt(index), { size: 32 })
      ]
    }))
    const changes = collectSliceWalletSimulationAssetChanges(transfers, account)

    expect(changes.nftTransfers).toHaveLength(64)
    expect(changes.nftTransfersOmitted).toBe(6)
  })

  test("counts every item of an oversized ERC-1155 batch, retained or omitted", () => {
    const batchIds = Array.from({ length: 130 }, (_, index) => BigInt(index))
    const batchAmounts = batchIds.map((id) => id + 1n)
    const changes = collectSliceWalletSimulationAssetChanges(
      [
        {
          address: erc1155,
          data: encodeAbiParameters(
            [{ type: "uint256[]" }, { type: "uint256[]" }],
            [batchIds, batchAmounts]
          ),
          topics: [
            topic("TransferBatch(address,address,address,uint256[],uint256[])"),
            addressTopic(zeroAddress),
            addressTopic(account),
            addressTopic(counterparty)
          ]
        }
      ],
      account
    )

    expect(changes.nftTransfers).toHaveLength(64)
    expect(changes.nftTransfersOmitted).toBe(66)
    // The retained items are the first ones in batch order.
    expect(changes.nftTransfers[0]).toMatchObject({ tokenId: "0" })
    expect(changes.nftTransfers[63]).toMatchObject({ tokenId: "63" })
  })

  test("accounts for every item of a very large batch without retaining it", () => {
    const itemCount = 5000
    const batchIds = Array.from({ length: itemCount }, (_, index) =>
      BigInt(index)
    )
    const changes = collectSliceWalletSimulationAssetChanges(
      [
        {
          address: erc1155,
          data: encodeAbiParameters(
            [{ type: "uint256[]" }, { type: "uint256[]" }],
            [batchIds, batchIds]
          ),
          topics: [
            topic("TransferBatch(address,address,address,uint256[],uint256[])"),
            addressTopic(zeroAddress),
            addressTopic(account),
            addressTopic(counterparty)
          ]
        }
      ],
      account
    )

    expect(changes.nftTransfers).toHaveLength(64)
    expect(changes.nftTransfersOmitted).toBe(itemCount - 64)
  })

  test("ignores unrelated batches entirely, including their size", () => {
    const batchIds = Array.from({ length: 5000 }, (_, index) => BigInt(index))
    const changes = collectSliceWalletSimulationAssetChanges(
      [
        {
          address: erc1155,
          data: encodeAbiParameters(
            [{ type: "uint256[]" }, { type: "uint256[]" }],
            [batchIds, batchIds]
          ),
          topics: [
            topic("TransferBatch(address,address,address,uint256[],uint256[])"),
            addressTopic(zeroAddress),
            addressTopic(operator),
            addressTopic(counterparty)
          ]
        }
      ],
      account
    )

    expect(changes.nftTransfers).toHaveLength(0)
    expect(changes.nftTransfersOmitted).toBe(0)
  })
})
