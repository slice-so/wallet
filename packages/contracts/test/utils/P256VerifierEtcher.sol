// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {P256} from "solady/utils/P256.sol";

address constant SOLADY_P256_VERIFIER = 0x000000000000D01eA45F9eFD5c54f037Fa57Ea1a;
address constant RIP7212_PRECOMPILE = address(0x100);

contract P256VerifierTestDouble {
    mapping(bytes32 inputHash => bool) private validInputs;

    function allow(bytes calldata input) external {
        validInputs[keccak256(input)] = true;
    }

    fallback(bytes calldata input) external returns (bytes memory) {
        return abi.encode(validInputs[keccak256(input)] ? uint256(1) : uint256(0));
    }
}

library P256VerifierEtcher {
    function etch(Vm vm) internal {
        P256VerifierTestDouble implementation = new P256VerifierTestDouble();
        vm.etch(SOLADY_P256_VERIFIER, address(implementation).code);
    }

    function allow(Vm, bytes32 digest, bytes32 r, bytes32 s, uint256 x, uint256 y) internal {
        P256VerifierTestDouble(SOLADY_P256_VERIFIER).allow(abi.encode(digest, r, s, bytes32(x), bytes32(y)));
    }

    function etchBaseVerifier(Vm vm) internal {
        // Recent Foundry versions emulate Base's RIP-7212 precompile and reject
        // attempts to overwrite it. Older versions still need the deployed
        // Solady verifier copied into the precompile address.
        if (P256.hasPrecompile()) return;
        bytes memory verifierCode = SOLADY_P256_VERIFIER.code;
        require(verifierCode.length != 0, "Base P-256 verifier is not deployed");
        vm.etch(RIP7212_PRECOMPILE, verifierCode);
    }
}
