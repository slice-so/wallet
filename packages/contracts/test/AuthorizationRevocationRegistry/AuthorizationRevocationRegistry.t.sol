// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {AuthorizationRevocationRegistry} from "../../src/registries/AuthorizationRevocationRegistry.sol";
import {Mock1271} from "./Mock1271.sol";

contract AuthorizationRevocationRegistryTest is Test {
    AuthorizationRevocationRegistry internal registry;

    uint256 internal rootKey = 0xA11CE;
    address internal root;
    address internal otherRoot = address(0xB0B);
    bytes32 internal authorizationId = keccak256("authorization");

    function setUp() public {
        registry = new AuthorizationRevocationRegistry();
        root = vm.addr(rootKey);
    }

    function testRevokeIsPermanentRootScopedAndIdempotent() public {
        vm.expectEmit(true, true, false, false);
        emit AuthorizationRevocationRegistry.Revoked(root, authorizationId);
        vm.prank(root);
        registry.revoke(authorizationId);

        vm.recordLogs();
        vm.prank(root);
        registry.revoke(authorizationId);

        assertTrue(registry.revoked(root, authorizationId));
        assertFalse(registry.revoked(otherRoot, authorizationId));
        assertEq(vm.getRecordedLogs().length, 1);
    }

    function testAdvanceEpochIsMonotonicAndRootScoped() public {
        vm.expectEmit(true, false, false, true);
        emit AuthorizationRevocationRegistry.EpochAdvanced(root, 1);
        vm.prank(root);
        assertEq(registry.advanceEpoch(), 1);
        vm.prank(root);
        assertEq(registry.advanceEpoch(), 2);

        assertEq(registry.currentEpoch(root), 2);
        assertEq(registry.currentEpoch(otherRoot), 0);
    }

    function testStatusReturnsRevocationAndCurrentEpoch() public {
        vm.prank(root);
        registry.revoke(authorizationId);
        vm.prank(root);
        registry.advanceEpoch();

        (bool isRevoked, uint64 epoch) = registry.status(root, authorizationId);
        assertTrue(isRevoked);
        assertEq(epoch, 1);
    }

    function testEip712DomainMatchesRevocationSignatureDomain() public view {
        (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        ) = registry.eip712Domain();

        assertEq(fields, bytes1(0x0f));
        assertEq(name, "ERC-8128 Delegation Registry");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifyingContract, address(registry));
        assertEq(salt, bytes32(0));
        assertEq(extensions.length, 0);
    }

    function testRevokeBySigAcceptsEoaAnd1271Roots() public {
        vm.expectEmit(true, true, false, false);
        emit AuthorizationRevocationRegistry.Revoked(root, authorizationId);
        registry.revokeBySig(root, authorizationId, signRevocation(root, rootKey, authorizationId));
        assertTrue(registry.revoked(root, authorizationId));

        Mock1271 smartRoot = new Mock1271();
        bytes32 smartId = keccak256("smart authorization");
        bytes memory signature = hex"1234";
        smartRoot.configure(revocationDigest(address(smartRoot), smartId), signature, true);
        registry.revokeBySig(address(smartRoot), smartId, signature);
        assertTrue(registry.revoked(address(smartRoot), smartId));
    }

    function testRevokeBySigRejectsInvalidProofAndDomain() public {
        bytes memory signature = signRevocation(root, rootKey, authorizationId);
        vm.expectRevert(AuthorizationRevocationRegistry.InvalidSignature.selector);
        registry.revokeBySig(otherRoot, authorizationId, signature);

        AuthorizationRevocationRegistry second = new AuthorizationRevocationRegistry();
        vm.expectRevert(AuthorizationRevocationRegistry.InvalidSignature.selector);
        second.revokeBySig(root, authorizationId, signature);
    }

    function testRevokeBySigRejectsHighSAndCompactEoaSignatures() public {
        bytes32 digest = revocationDigest(root, authorizationId);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(rootKey, digest);
        uint256 curveOrder = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory highS = abi.encodePacked(r, bytes32(curveOrder - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(AuthorizationRevocationRegistry.InvalidSignature.selector);
        registry.revokeBySig(root, authorizationId, highS);

        bytes32 compactS = bytes32(uint256(s) | (uint256(v - 27) << 255));
        vm.expectRevert(AuthorizationRevocationRegistry.InvalidSignature.selector);
        registry.revokeBySig(root, authorizationId, abi.encodePacked(r, compactS));
    }

    function testRevokeBySigRejectsNegative1271Response() public {
        Mock1271 smartRoot = new Mock1271();
        bytes memory signature = hex"1234";
        smartRoot.configure(revocationDigest(address(smartRoot), authorizationId), signature, false);

        vm.expectRevert(AuthorizationRevocationRegistry.InvalidSignature.selector);
        registry.revokeBySig(address(smartRoot), authorizationId, signature);
    }

    function testAdvanceEpochRevertsAtUint64Maximum() public {
        bytes32 epochSlot = keccak256(abi.encode(root, uint256(1)));
        vm.store(address(registry), epochSlot, bytes32(uint256(type(uint64).max)));

        vm.expectRevert();
        vm.prank(root);
        registry.advanceEpoch();
    }

    function testFuzzRevokeIsolation(address candidateRoot, bytes32 candidateId) public {
        vm.assume(candidateRoot != address(0));
        vm.prank(candidateRoot);
        registry.revoke(candidateId);
        assertTrue(registry.revoked(candidateRoot, candidateId));
        if (candidateRoot != otherRoot) assertFalse(registry.revoked(otherRoot, candidateId));
    }

    function signRevocation(address root_, uint256 key, bytes32 id) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, revocationDigest(root_, id));
        return abi.encodePacked(r, s, v);
    }

    function revocationDigest(address root_, bytes32 id) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(registry.REVOKE_TYPEHASH(), root_, id));
        return keccak256(abi.encodePacked(hex"1901", domainSeparator(address(registry)), structHash));
    }

    function domainSeparator(address verifyingContract) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ERC-8128 Delegation Registry"),
                keccak256("1"),
                block.chainid,
                verifyingContract
            )
        );
    }
}
