// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {Erc6492BootstrapFactory} from "../src/factories/Erc6492BootstrapFactory.sol";
import {AuthorizationRevocationRegistry} from "../src/registries/AuthorizationRevocationRegistry.sol";
import {SlicerRegistryPolicy} from "../src/policies/SlicerRegistryPolicy.sol";
import {TimelockPolicy} from "../src/policies/TimelockPolicy.sol";
import {WeightedECDSASigner} from "../src/signers/WeightedECDSASigner.sol";
import {WeightedP256Signer} from "../src/signers/WeightedP256Signer.sol";

/// @notice Idempotently deploys the Slice-owned wallet contracts selected by
/// `SLICE_WALLET_DEPLOYMENT_MASK` at their canonical CREATE2 addresses. The
/// repository deployment command sets the mask to contracts missing on the
/// target chain, then verifies and records the resulting runtime bytecode.
contract DeploySliceWalletContractsScript is Script {
    uint256 private constant AUTHORIZATION_REGISTRY = 1 << 0;
    uint256 private constant SLICER_REGISTRY_POLICY = 1 << 1;
    uint256 private constant TIMELOCK_POLICY = 1 << 2;
    uint256 private constant WEIGHTED_ECDSA_SIGNER = 1 << 3;
    uint256 private constant WEIGHTED_P256_SIGNER = 1 << 4;
    uint256 private constant ERC6492_BOOTSTRAP_FACTORY = 1 << 5;
    uint256 private constant ALL_CONTRACTS = (1 << 6) - 1;

    bytes32 private constant AUTHORIZATION_REGISTRY_SALT =
        keccak256("slice.kernel.authorization-revocation-registry.v1");
    bytes32 private constant SLICER_REGISTRY_POLICY_SALT = keccak256("slice.kernel.slicer-registry-policy.v1");
    bytes32 private constant TIMELOCK_POLICY_SALT = keccak256("slice.kernel.timelock-policy.v1");
    bytes32 private constant WEIGHTED_ECDSA_SIGNER_SALT = keccak256("slice.kernel.weighted-ecdsa-signer.v1");
    bytes32 private constant WEIGHTED_P256_SIGNER_SALT = keccak256("slice.kernel.weighted-p256-signer.v1");
    bytes32 private constant ERC6492_BOOTSTRAP_FACTORY_SALT = keccak256("slice.kernel.erc6492-bootstrap-factory.v2");

    function run() external returns (address[6] memory deployed) {
        uint256 deploymentMask = vm.envOr("SLICE_WALLET_DEPLOYMENT_MASK", ALL_CONTRACTS);
        require(deploymentMask <= ALL_CONTRACTS, "Invalid Slice wallet deployment mask");

        if (deploymentMask & AUTHORIZATION_REGISTRY != 0) deployed[0] = _deployAuthorizationRegistry();
        if (deploymentMask & SLICER_REGISTRY_POLICY != 0) deployed[1] = _deploySlicerRegistryPolicy();
        if (deploymentMask & TIMELOCK_POLICY != 0) deployed[2] = _deployTimelockPolicy();
        if (deploymentMask & WEIGHTED_ECDSA_SIGNER != 0) deployed[3] = _deployWeightedEcdsaSigner();
        if (deploymentMask & WEIGHTED_P256_SIGNER != 0) deployed[4] = _deployWeightedP256Signer();
        if (deploymentMask & ERC6492_BOOTSTRAP_FACTORY != 0) deployed[5] = _deployErc6492BootstrapFactory();
    }

    function _deployAuthorizationRegistry() private returns (address deployed) {
        deployed = vm.computeCreate2Address(
            AUTHORIZATION_REGISTRY_SALT, keccak256(type(AuthorizationRevocationRegistry).creationCode)
        );
        if (deployed.code.length > 0) return deployed;
        vm.broadcast();
        address created = address(new AuthorizationRevocationRegistry{salt: AUTHORIZATION_REGISTRY_SALT}());
        require(created == deployed, "AuthorizationRevocationRegistry deployed to unexpected address");
    }

    function _deploySlicerRegistryPolicy() private returns (address deployed) {
        deployed =
            vm.computeCreate2Address(SLICER_REGISTRY_POLICY_SALT, keccak256(type(SlicerRegistryPolicy).creationCode));
        if (deployed.code.length > 0) return deployed;
        vm.broadcast();
        address created = address(new SlicerRegistryPolicy{salt: SLICER_REGISTRY_POLICY_SALT}());
        require(created == deployed, "SlicerRegistryPolicy deployed to unexpected address");
    }

    function _deployTimelockPolicy() private returns (address deployed) {
        deployed = vm.computeCreate2Address(TIMELOCK_POLICY_SALT, keccak256(type(TimelockPolicy).creationCode));
        if (deployed.code.length > 0) return deployed;
        vm.broadcast();
        address created = address(new TimelockPolicy{salt: TIMELOCK_POLICY_SALT}());
        require(created == deployed, "TimelockPolicy deployed to unexpected address");
    }

    function _deployWeightedEcdsaSigner() private returns (address deployed) {
        deployed =
            vm.computeCreate2Address(WEIGHTED_ECDSA_SIGNER_SALT, keccak256(type(WeightedECDSASigner).creationCode));
        if (deployed.code.length > 0) return deployed;
        vm.broadcast();
        address created = address(new WeightedECDSASigner{salt: WEIGHTED_ECDSA_SIGNER_SALT}());
        require(created == deployed, "WeightedECDSASigner deployed to unexpected address");
    }

    function _deployWeightedP256Signer() private returns (address deployed) {
        deployed = vm.computeCreate2Address(WEIGHTED_P256_SIGNER_SALT, keccak256(type(WeightedP256Signer).creationCode));
        if (deployed.code.length > 0) return deployed;
        vm.broadcast();
        address created = address(new WeightedP256Signer{salt: WEIGHTED_P256_SIGNER_SALT}());
        require(created == deployed, "WeightedP256Signer deployed to unexpected address");
    }

    function _deployErc6492BootstrapFactory() private returns (address deployed) {
        deployed = vm.computeCreate2Address(
            ERC6492_BOOTSTRAP_FACTORY_SALT, keccak256(type(Erc6492BootstrapFactory).creationCode)
        );
        if (deployed.code.length > 0) return deployed;
        vm.broadcast();
        address created = address(new Erc6492BootstrapFactory{salt: ERC6492_BOOTSTRAP_FACTORY_SALT}());
        require(created == deployed, "Erc6492BootstrapFactory deployed to unexpected address");
    }
}
