// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {Erc6492BootstrapFactory} from "../src/factories/Erc6492BootstrapFactory.sol";
import {SlicerRegistryPolicy} from "../src/policies/SlicerRegistryPolicy.sol";
import {TimelockPolicy} from "../src/policies/TimelockPolicy.sol";
import {WeightedP256Signer} from "../src/signers/WeightedP256Signer.sol";

abstract contract SeedHelpers is Script {
    function _setCode(address target, bytes memory bytecode) internal {
        string memory params = string.concat('["', vm.toString(target), '","', vm.toString(bytecode), '"]');
        _rpcWithoutDecodingResult("anvil_setCode", params);
    }

    function _rpcWithoutDecodingResult(string memory method, string memory params) private {
        (bool success,) = address(vm).call(abi.encodeWithSignature("rpc(string,string)", method, params));
        require(success, "Anvil RPC seed operation failed");
    }
}

/// @notice Reproduces the signed Kernel v4.0 release on local Anvil chains.
/// Core initcode is read from ZeroDev's v4.0 manifest pinned by the caller to
/// commit f2a84a332ec5a722e7e95a0d64601905c3c87fe9. Existing Slice modules are
/// copied from Base and Slice-owned modules are seeded from local bytecode.
contract SeedKernelScript is SeedHelpers {
    address private constant ENTRY_POINT = 0x433709009B8330FDa32311DF1C2AFA402eD8D009;
    address private constant ENTRY_POINT_SENDER_CREATOR = 0x0A630a99Df908A81115A3022927Be82f9299987e;
    address private constant MULTICALL3 = 0xcA11bde05977b3631167028862bE2a173976CA11;
    address private constant KERNEL_STAKER = 0x58E2fD56990250b0eE784d15905C9856209226aE;
    address private constant KERNEL_IMPLEMENTATION = 0xC842fE2aC44046AE3cEf033A16c67a9BC287cbD2;
    address private constant KERNEL_IMMUTABLE_ECDSA = 0x6F0999265B6E1dFbe875F104548b875a99A65d37;
    address private constant KERNEL_FACTORY = 0xA299A4eFee7BBFb2Ea5668b30218C45fff78356c;

    address private constant KERNEL_WEBAUTHN_VALIDATOR = 0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69;
    address private constant KERNEL_WEBAUTHN_SIGNER = 0x65DEeC8fEe717dc044D0CFD63cCf55F02cCaC2b3;
    address private constant KERNEL_SUDO_POLICY = 0x67b436caD8a6D025DF6C82C5BB43fbF11fC5B9B7;
    address private constant P256_VERIFIER = 0xc2b78104907F722DABAc4C69f826a522B2754De4;
    address private constant SOLADY_P256_VERIFIER = 0x000000000000D01eA45F9eFD5c54f037Fa57Ea1a;
    address private constant KERNEL_ECDSA_SIGNER = 0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF;
    address private constant KERNEL_CALL_POLICY_V5 = 0x85770b902D1e503D5f5141d9eaC16d0d08eEaDd2;
    address private constant KERNEL_TIMESTAMP_POLICY = 0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F;
    address private constant KERNEL_RATE_LIMIT_POLICY = 0xf63d4139B25c836334edD76641356c6b74C86873;
    address private constant AUTHORIZATION_REVOCATION_REGISTRY = 0xB2A9330825D6AabBf7Cc7004Bc0916291C3322AD;

    bytes32 private constant SLICE_WEIGHTED_P256_SIGNER_SALT = keccak256("slice.kernel.weighted-p256-signer.v1");
    bytes32 private constant SLICE_TIMELOCK_POLICY_SALT = keccak256("slice.kernel.timelock-policy.v1");
    bytes32 private constant SLICE_SLICER_REGISTRY_POLICY_SALT = keccak256("slice.kernel.slicer-registry-policy.v1");
    bytes32 private constant SLICE_ERC6492_BOOTSTRAP_FACTORY_SALT =
        keccak256("slice.kernel.erc6492-bootstrap-factory.v1");

    function _deployReleaseContract(string memory manifest, string memory path, address expected) private {
        if (expected.code.length != 0) return;
        bytes memory initCode = vm.parseJsonBytes(manifest, path);
        vm.startBroadcast();
        (bool success,) = CREATE2_FACTORY.call(bytes.concat(bytes32(0), initCode));
        vm.stopBroadcast();
        require(success && expected.code.length != 0, "Kernel v4 CREATE2 deployment failed");
    }

    function _deployLocalContract(bytes32 salt, bytes memory initCode, address expected) private {
        if (expected.code.length != 0) return;
        vm.startBroadcast();
        (bool success,) = CREATE2_FACTORY.call(bytes.concat(salt, initCode));
        vm.stopBroadcast();
        require(success && expected.code.length != 0, "Slice module CREATE2 deployment failed");
    }

    function run() external {
        address sliceWeightedP256Signer =
            vm.computeCreate2Address(SLICE_WEIGHTED_P256_SIGNER_SALT, keccak256(type(WeightedP256Signer).creationCode));
        address sliceTimelockPolicy =
            vm.computeCreate2Address(SLICE_TIMELOCK_POLICY_SALT, keccak256(type(TimelockPolicy).creationCode));
        address sliceSlicerRegistryPolicy = vm.computeCreate2Address(
            SLICE_SLICER_REGISTRY_POLICY_SALT, keccak256(type(SlicerRegistryPolicy).creationCode)
        );
        address sliceErc6492BootstrapFactory = vm.computeCreate2Address(
            SLICE_ERC6492_BOOTSTRAP_FACTORY_SALT, keccak256(type(Erc6492BootstrapFactory).creationCode)
        );
        address[13] memory targets = [
            CREATE2_FACTORY,
            ENTRY_POINT,
            ENTRY_POINT_SENDER_CREATOR,
            MULTICALL3,
            KERNEL_WEBAUTHN_VALIDATOR,
            KERNEL_WEBAUTHN_SIGNER,
            KERNEL_SUDO_POLICY,
            P256_VERIFIER,
            SOLADY_P256_VERIFIER,
            KERNEL_ECDSA_SIGNER,
            KERNEL_CALL_POLICY_V5,
            KERNEL_TIMESTAMP_POLICY,
            KERNEL_RATE_LIMIT_POLICY
        ];

        bool seedFromActiveFork = vm.envOr("SEED_KERNEL_FROM_ACTIVE_FORK", false);
        uint256 localFork;
        if (!seedFromActiveFork) {
            localFork = vm.activeFork();
            uint256 baseFork = vm.createFork(vm.envOr("RPC_URL_BASE", string("https://mainnet.base.org")));
            vm.selectFork(baseFork);
        }

        bytes[] memory runtimeCodes = new bytes[](targets.length);
        for (uint256 i = 0; i < targets.length; i++) {
            runtimeCodes[i] = targets[i].code;
            require(runtimeCodes[i].length > 0, "Empty runtime code from Base");
        }
        bytes memory revocationRegistryCode = AUTHORIZATION_REVOCATION_REGISTRY.code;

        if (!seedFromActiveFork) vm.selectFork(localFork);
        for (uint256 i = 0; i < targets.length; i++) {
            _setCode(targets[i], runtimeCodes[i]);
        }
        if (revocationRegistryCode.length != 0) _setCode(AUTHORIZATION_REVOCATION_REGISTRY, revocationRegistryCode);
        _deployLocalContract(
            SLICE_WEIGHTED_P256_SIGNER_SALT, type(WeightedP256Signer).creationCode, sliceWeightedP256Signer
        );
        _deployLocalContract(SLICE_TIMELOCK_POLICY_SALT, type(TimelockPolicy).creationCode, sliceTimelockPolicy);
        _deployLocalContract(
            SLICE_SLICER_REGISTRY_POLICY_SALT, type(SlicerRegistryPolicy).creationCode, sliceSlicerRegistryPolicy
        );
        _deployLocalContract(
            SLICE_ERC6492_BOOTSTRAP_FACTORY_SALT,
            type(Erc6492BootstrapFactory).creationCode,
            sliceErc6492BootstrapFactory
        );

        string memory manifest = vm.envString("KERNEL_V4_RELEASE_MANIFEST_JSON");
        _deployReleaseContract(manifest, ".contracts[0].init_code", KERNEL_STAKER);
        _deployReleaseContract(manifest, ".contracts[1].init_code", KERNEL_IMPLEMENTATION);
        _deployReleaseContract(manifest, ".contracts[2].init_code", KERNEL_IMMUTABLE_ECDSA);
        _deployReleaseContract(manifest, ".contracts[3].init_code", KERNEL_FACTORY);
    }
}
