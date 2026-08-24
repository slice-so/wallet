// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {AuthorizationRevocationRegistry} from "../../src/registries/AuthorizationRevocationRegistry.sol";

contract AuthorizationRevocationRegistryHandler is Test {
    struct Revocation {
        bytes32 authorizationId;
        address root;
    }

    AuthorizationRevocationRegistry public immutable registry;
    address[] internal roots;
    Revocation[] internal revocations;
    mapping(address => bool) internal knownRoot;
    mapping(bytes32 => bool) internal knownRevocation;
    mapping(address => uint64) public ghostEpoch;

    constructor(AuthorizationRevocationRegistry registry_) {
        registry = registry_;
    }

    function revoke(address root, bytes32 authorizationId) external {
        if (root == address(0)) root = address(1);
        _rememberRoot(root);
        bytes32 key = keccak256(abi.encode(root, authorizationId));
        if (!knownRevocation[key]) {
            knownRevocation[key] = true;
            revocations.push(Revocation({authorizationId: authorizationId, root: root}));
        }
        vm.prank(root);
        registry.revoke(authorizationId);
    }

    function advanceEpoch(address root) external {
        if (root == address(0)) root = address(1);
        _rememberRoot(root);
        if (ghostEpoch[root] == type(uint64).max) return;
        vm.prank(root);
        uint64 nextEpoch = registry.advanceEpoch();
        ghostEpoch[root] = nextEpoch;
    }

    function rootsLength() external view returns (uint256) {
        return roots.length;
    }

    function rootAt(uint256 index) external view returns (address) {
        return roots[index];
    }

    function revocationsLength() external view returns (uint256) {
        return revocations.length;
    }

    function revocationAt(uint256 index) external view returns (address root, bytes32 authorizationId) {
        Revocation memory entry = revocations[index];
        return (entry.root, entry.authorizationId);
    }

    function _rememberRoot(address root) internal {
        if (knownRoot[root]) return;
        knownRoot[root] = true;
        roots.push(root);
    }
}

contract AuthorizationRevocationRegistryInvariantTest is StdInvariant, Test {
    AuthorizationRevocationRegistry internal registry;
    AuthorizationRevocationRegistryHandler internal handler;

    function setUp() public {
        registry = new AuthorizationRevocationRegistry();
        handler = new AuthorizationRevocationRegistryHandler(registry);
        targetContract(address(handler));
    }

    function invariantEpochMatchesSuccessfulAdvances() public view {
        for (uint256 index; index < handler.rootsLength(); ++index) {
            address root = handler.rootAt(index);
            (, uint64 currentEpoch) = registry.status(root, bytes32(0));
            assertEq(currentEpoch, handler.ghostEpoch(root));
        }
    }

    function invariantRevocationsArePermanent() public view {
        for (uint256 index; index < handler.revocationsLength(); ++index) {
            (address root, bytes32 authorizationId) = handler.revocationAt(index);
            assertTrue(registry.revoked(root, authorizationId));
        }
    }
}
