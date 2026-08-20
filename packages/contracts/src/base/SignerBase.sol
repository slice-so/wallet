// SPDX-License-Identifier: MIT
//
// Adapted from zerodevapp/kernel-7579-plugins at commit
// 332deed6eeef3d6279cde50aa1d51eff53728bd4:
// https://github.com/zerodevapp/kernel-7579-plugins/blob/332deed6eeef3d6279cde50aa1d51eff53728bd4/src/base/SignerBase.sol
// Source modifications below this header:
// - Implements Kernel v4's isInitialized(address) lifecycle interface by tracking
//   the number of installed permissions per smart account.
// - Defines lifecycle errors locally because Kernel v4's IModule does not declare them.
pragma solidity ^0.8.0;

import {ISigner} from "src/interfaces/IERC7579Modules.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";

abstract contract SignerBase is ISigner {
    mapping(address smartAccount => uint256 installationCount) private _installations;

    error AlreadyInitialized(address smartAccount);
    error NotInitialized(address smartAccount);

    function onInstall(bytes calldata data) external payable {
        bytes32 id = bytes32(data[0:32]);
        bytes calldata _data = data[32:];
        _signerOninstall(id, _data);
        _installations[msg.sender]++;
    }

    function onUninstall(bytes calldata data) external payable {
        bytes32 id = bytes32(data[0:32]);
        bytes calldata _data = data[32:];
        _signerOnUninstall(id, _data);
        _installations[msg.sender]--;
    }

    function isModuleType(uint256 id) external pure virtual returns (bool) {
        return id == 6;
    }

    function isInitialized(address smartAccount) external view returns (bool) {
        return _installations[smartAccount] != 0;
    }

    function checkUserOpSignature(bytes32 id, PackedUserOperation calldata userOp, bytes32 userOpHash)
        external
        payable
        virtual
        returns (uint256);
    function checkSignature(bytes32 id, address sender, bytes32 hash, bytes calldata sig)
        external
        view
        virtual
        returns (bytes4);

    function _signerOninstall(bytes32 id, bytes calldata _data) internal virtual;
    function _signerOnUninstall(bytes32 id, bytes calldata _data) internal virtual;
}
