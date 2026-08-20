export const coinbaseSmartWalletExecutionAbi = [
  {
    type: "function",
    name: "execute",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "executeBatch",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      }
    ],
    outputs: [],
    stateMutability: "payable"
  }
] as const

export const simpleAccountBatchExecutionAbi = [
  {
    type: "function",
    name: "executeBatch",
    inputs: [
      { name: "dest", type: "address[]" },
      { name: "value", type: "uint256[]" },
      { name: "func", type: "bytes[]" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  }
] as const

export const zeroValueBatchExecutionAbi = [
  {
    type: "function",
    name: "executeBatch",
    inputs: [
      { name: "target", type: "address[]" },
      { name: "data", type: "bytes[]" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  }
] as const

export const operationAwareExecutionAbi = [
  {
    type: "function",
    name: "execute",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" }
    ],
    outputs: [],
    stateMutability: "payable"
  }
] as const

export const safeExecutionAbi = [
  {
    type: "function",
    name: "execTransactionFromModule",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" }
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "execTransactionFromModuleReturnData",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" }
    ],
    outputs: [
      { name: "success", type: "bool" },
      { name: "returnData", type: "bytes" }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "execTransaction",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "signatures", type: "bytes" }
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "payable"
  }
] as const

export const ambireAccountExecutionAbi = [
  {
    type: "function",
    name: "execute",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      },
      { name: "signature", type: "bytes" }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "executeBySender",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "executeBySelf",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "executeBySelfSingle",
    inputs: [
      {
        name: "call",
        type: "tuple",
        components: [
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "executeMultiple",
    inputs: [
      {
        name: "toExec",
        type: "tuple[]",
        components: [
          {
            name: "calls",
            type: "tuple[]",
            components: [
              { name: "to", type: "address" },
              { name: "value", type: "uint256" },
              { name: "data", type: "bytes" }
            ]
          },
          { name: "signature", type: "bytes" }
        ]
      }
    ],
    outputs: [],
    stateMutability: "payable"
  }
] as const

export const erc7579AccountExecutionAbi = [
  {
    type: "function",
    name: "execute",
    inputs: [
      { name: "execMode", type: "bytes32" },
      { name: "executionCalldata", type: "bytes" }
    ],
    outputs: [],
    stateMutability: "payable"
  }
] as const

export const metaMaskDelegatorExecutionAbi = [
  {
    type: "function",
    name: "execute",
    inputs: [
      {
        name: "execution",
        type: "tuple",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "callData", type: "bytes" }
        ]
      }
    ],
    outputs: [],
    stateMutability: "payable"
  }
] as const

export const erc7579BatchExecutionAbiParameters = [
  {
    components: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "callData", type: "bytes" }
    ],
    name: "executions",
    type: "tuple[]"
  }
] as const

export const kernelTimelockPolicyCancelAbi = [
  {
    type: "function",
    name: "cancelProposal",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "account", type: "address" },
      { name: "callData", type: "bytes" },
      { name: "nonce", type: "uint256" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  }
] as const
