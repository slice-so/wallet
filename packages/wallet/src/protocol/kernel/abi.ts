export const kernelInstallAbiParameter = {
  components: [
    { name: "moduleType", type: "uint256" },
    { name: "module", type: "address" },
    { name: "moduleData", type: "bytes" },
    { name: "internalData", type: "bytes" }
  ],
  name: "packages",
  type: "tuple[]"
} as const

export const kernelFactoryAbi = [
  {
    inputs: [kernelInstallAbiParameter, { name: "nonce", type: "uint256" }],
    name: "deploy",
    outputs: [{ name: "account", type: "address" }],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [kernelInstallAbiParameter, { name: "nonce", type: "uint256" }],
    name: "getAddress",
    outputs: [{ name: "account", type: "address" }],
    stateMutability: "view",
    type: "function"
  }
] as const

export const kernelValidationManagementAbi = [
  {
    inputs: [kernelInstallAbiParameter],
    name: "installModule",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      { name: "moduleType", type: "uint256" },
      { name: "module", type: "address" },
      { name: "deInitData", type: "bytes" }
    ],
    name: "uninstallModule",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      { name: "nonceKey", type: "uint192" },
      { name: "seq", type: "uint64" }
    ],
    name: "setNonce",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  }
] as const

export const kernelAccountAbi = [
  {
    inputs: [
      { name: "mode", type: "bytes32" },
      { name: "executionData", type: "bytes" }
    ],
    name: "execute",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  kernelValidationManagementAbi[0],
  {
    inputs: [
      { name: "moduleType", type: "uint256" },
      { name: "module", type: "address" },
      { name: "initData", type: "bytes" }
    ],
    name: "installModule",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  kernelValidationManagementAbi[1],
  {
    inputs: [
      { name: "moduleType", type: "uint256" },
      { name: "module", type: "address" },
      { name: "additionalContext", type: "bytes" }
    ],
    name: "isModuleInstalled",
    outputs: [{ name: "installed", type: "bool" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ name: "key", type: "uint192" }],
    name: "nonce",
    outputs: [{ name: "value", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  kernelValidationManagementAbi[2]
] as const

export const kernelWebAuthnValidatorLifecycleAbi = [
  {
    inputs: [{ name: "data", type: "bytes" }],
    name: "onInstall",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [{ name: "data", type: "bytes" }],
    name: "onUninstall",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  }
] as const

export const kernelEntryPointNonceAbi = [
  {
    inputs: [
      { name: "sender", type: "address" },
      { name: "key", type: "uint192" }
    ],
    name: "getNonce",
    outputs: [{ name: "nonce", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  }
] as const
