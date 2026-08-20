// SPDX-License-Identifier: MIT
//
// Built on the PolicyBase contract vendored from zerodevapp/kernel-7579-plugins
// at commit 332deed6eeef3d6279cde50aa1d51eff53728bd4.
// Slice-specific behavior below this header:
// - AND-composes with Kernel's CallPolicy to restrict dynamic Slicer targets.
// - Resolves each target's slicerId against the canonical SliceCore registry.
// - Rejects direct and wrapped role mutation from management sessions.
pragma solidity ^0.8.0;

import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {PolicyBase} from "src/base/PolicyBase.sol";
import {IAccountExecute} from "src/interfaces/IAccountExecute.sol";
import {IERC7579Account} from "src/interfaces/IERC7579Account.sol";
import {SIG_VALIDATION_FAILED_UINT, SIG_VALIDATION_SUCCESS_UINT} from "src/types/Constants.sol";
import {LibERC7579} from "solady/accounts/LibERC7579.sol";

interface ISliceCoreRegistry {
    function slicers(uint256 slicerId) external view returns (address);
}

interface ISlicerIdentity {
    function slicerId() external view returns (uint128);
}

/**
 * @title SlicerRegistryPolicy
 * @notice Restricts Slice management calls with dynamic targets to canonical Slicer contracts.
 * @dev This policy is intentionally incomplete on its own. Kernel composes it with
 *      CallPolicy, which remains responsible for selectors, values, and parameter rules.
 * @dev Canonical-Slicer validation reads target and SliceCore storage during ERC-4337
 *      validation. Production admission therefore requires a bundler lane that accepts
 *      these reads under its ERC-7562 validation rules.
 */
contract SlicerRegistryPolicy is PolicyBase {
    ISliceCoreRegistry private constant SLICE_CORE = ISliceCoreRegistry(0x5Cef0380cE0aD3DAEefef8bDb85dBDeD7965adf9);

    bytes4 private constant ADD_CURRENCIES_SELECTOR = bytes4(keccak256("_addCurrencies(address[])"));
    bytes4 private constant GRANT_ROLES_SELECTOR = bytes4(keccak256("grantRoles(bytes32,address)"));
    bytes4 private constant MULTICALL_SELECTOR = bytes4(keccak256("multicall(bytes[])"));
    bytes4 private constant RENOUNCE_ROLES_SELECTOR = bytes4(keccak256("renounceRoles(bytes32)"));
    bytes4 private constant REVOKE_ROLES_SELECTOR = bytes4(keccak256("revokeRoles(bytes32,address)"));
    bytes4 private constant SET_ROLES_SELECTOR = bytes4(keccak256("setRoles(bytes32,address)"));
    bytes4 private constant RELEASE_SELECTOR = bytes4(keccak256("release(address,address,bool)"));

    mapping(bytes32 => mapping(address => bool)) public initialized;

    error InvalidConfiguration();
    error SignatureValidationNotSupported();

    function _policyOninstall(bytes32 id, bytes calldata data) internal override {
        if (data.length != 0) revert InvalidConfiguration();
        if (initialized[id][msg.sender]) revert AlreadyInitialized(msg.sender);
        initialized[id][msg.sender] = true;
    }

    function _policyOnUninstall(bytes32 id, bytes calldata data) internal override {
        if (data.length != 0) revert InvalidConfiguration();
        if (!initialized[id][msg.sender]) revert NotInitialized(msg.sender);
        delete initialized[id][msg.sender];
    }

    function checkUserOpPolicy(bytes32 id, PackedUserOperation calldata userOp)
        external
        payable
        override
        returns (uint256)
    {
        if (!initialized[id][msg.sender]) return SIG_VALIDATION_FAILED_UINT;
        return _allowsExecution(userOp.callData) ? SIG_VALIDATION_SUCCESS_UINT : SIG_VALIDATION_FAILED_UINT;
    }

    function checkSignaturePolicy(bytes32, address, bytes32, bytes calldata) external pure override returns (uint256) {
        revert SignatureValidationNotSupported();
    }

    function _allowsExecution(bytes calldata accountCallData) private view returns (bool) {
        if (accountCallData.length >= 4 && bytes4(accountCallData[0:4]) == IAccountExecute.executeUserOp.selector) {
            accountCallData = accountCallData[4:];
        }

        if (accountCallData.length < 100 || bytes4(accountCallData[0:4]) != IERC7579Account.execute.selector) {
            return false;
        }

        bytes32 mode = bytes32(accountCallData[4:36]);
        bytes calldata executionData = _executionData(accountCallData);
        if (executionData.length == 0) return false;

        bytes1 callType = LibERC7579.getCallType(mode);
        if (callType == LibERC7579.CALLTYPE_SINGLE) {
            (address target,, bytes calldata data) = LibERC7579.decodeSingle(executionData);
            return _allowsCall(target, data);
        }
        if (callType == LibERC7579.CALLTYPE_BATCH) {
            bytes32[] calldata executions = LibERC7579.decodeBatch(executionData);
            for (uint256 i = 0; i < executions.length; i++) {
                (address target,, bytes calldata data) = LibERC7579.getExecution(executions, i);
                if (!_allowsCall(target, data)) return false;
            }
            return executions.length != 0;
        }
        return false;
    }

    function _executionData(bytes calldata accountCallData) private pure returns (bytes calldata executionData) {
        uint256 offset = uint256(bytes32(accountCallData[36:68]));
        if (offset > accountCallData.length - 36) return accountCallData[0:0];

        uint256 lengthPosition = 4 + offset;
        uint256 dataPosition = lengthPosition + 32;
        if (dataPosition > accountCallData.length) return accountCallData[0:0];

        uint256 dataLength = uint256(bytes32(accountCallData[lengthPosition:dataPosition]));
        if (dataLength > accountCallData.length - dataPosition) return accountCallData[0:0];
        return accountCallData[dataPosition:dataPosition + dataLength];
    }

    function _allowsCall(address target, bytes calldata data) private view returns (bool) {
        // A self-call could recursively invoke Kernel.execute without another policy-validation pass.
        if (target == msg.sender) return false;
        if (data.length < 4) return true;

        bytes4 selector = bytes4(data[0:4]);
        // Slicer.multicall delegate-calls its inner payloads, so allowing the wrapper would bypass
        // the role-selector checks below.
        if (selector == MULTICALL_SELECTOR || _isRoleMutation(selector)) return false;
        if (selector != ADD_CURRENCIES_SELECTOR && selector != RELEASE_SELECTOR) {
            return true;
        }
        return _isCanonicalSlicer(target);
    }

    function _isRoleMutation(bytes4 selector) private pure returns (bool) {
        return selector == GRANT_ROLES_SELECTOR || selector == RENOUNCE_ROLES_SELECTOR
            || selector == REVOKE_ROLES_SELECTOR || selector == SET_ROLES_SELECTOR;
    }

    function _isCanonicalSlicer(address target) private view returns (bool) {
        (bool identityRead, bytes memory identityData) = target.staticcall(abi.encodeCall(ISlicerIdentity.slicerId, ()));
        if (!identityRead || identityData.length != 32) return false;

        // Safe after the exact 32-byte ABI-word check above.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 slicerId = uint256(bytes32(identityData));
        (bool registryRead, bytes memory registryData) =
            address(SLICE_CORE).staticcall(abi.encodeCall(ISliceCoreRegistry.slicers, (slicerId)));
        // Safe after the exact 32-byte ABI-word check below.
        // forge-lint: disable-next-line(unsafe-typecast)
        return registryRead && registryData.length == 32 && address(uint160(uint256(bytes32(registryData)))) == target;
    }
}
