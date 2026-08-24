// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {DeployAuthorizationRevocationRegistryScript} from "../../script/DeployAuthorizationRevocationRegistry.s.sol";
import {AuthorizationRevocationRegistry} from "../../src/registries/AuthorizationRevocationRegistry.sol";

contract AuthorizationRevocationRegistryDeployTest is Test {
    bytes32 internal constant PINNED_SALT = 0x78ae68d0fb163bab4124ca2f9976e3e2327e0b5e8620c29e925d7d0d967a3c95;
    bytes32 internal constant PINNED_INIT_CODE_HASH =
        0xd5697d56cb34fed956d7078f3efd4ca7017428ef517332c8949f414f8447048b;
    bytes32 internal constant PINNED_RUNTIME_CODE_HASH =
        0x5a93f9fbc9de24c9d2b5fe7e9fd81ac3b59a8bb6919977a844c24227b7d58804;
    address internal constant PINNED_CREATE2_ADDRESS = 0xB2A9330825D6AabBf7Cc7004Bc0916291C3322AD;

    function testCreate2InputsAndAddressArePinned() public {
        DeployAuthorizationRevocationRegistryScript deployer = new DeployAuthorizationRevocationRegistryScript();

        assertEq(keccak256("slice.kernel.authorization-revocation-registry.v1"), PINNED_SALT);
        assertEq(keccak256(type(AuthorizationRevocationRegistry).creationCode), PINNED_INIT_CODE_HASH);
        assertEq(keccak256(type(AuthorizationRevocationRegistry).runtimeCode), PINNED_RUNTIME_CODE_HASH);
        assertEq(deployer.computeAddress(), PINNED_CREATE2_ADDRESS);
    }

    function testRuntimeCodeIsChainInvariant() public {
        vm.chainId(1);
        AuthorizationRevocationRegistry ethereumRegistry = new AuthorizationRevocationRegistry();
        bytes32 ethereumRuntimeHash = address(ethereumRegistry).codehash;

        vm.chainId(8453);
        AuthorizationRevocationRegistry baseRegistry = new AuthorizationRevocationRegistry();

        assertEq(address(baseRegistry).codehash, ethereumRuntimeHash);
        assertEq(address(baseRegistry).codehash, keccak256(type(AuthorizationRevocationRegistry).runtimeCode));
    }
}
