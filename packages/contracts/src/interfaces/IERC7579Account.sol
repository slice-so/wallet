// SPDX-License-Identifier: MIT
//
// Vendored from zerodevapp/kernel at commit
// f2a84a332ec5a722e7e95a0d64601905c3c87fe9:
// https://github.com/zerodevapp/kernel/blob/f2a84a332ec5a722e7e95a0d64601905c3c87fe9/src/interfaces/IERC7579Account.sol
// Source modification below this header:
// - Retained only the execute(bytes32,bytes) selector used by Slice policies.
pragma solidity ^0.8.21;

interface IERC7579Account {
    /**
     * @dev Executes a transaction on behalf of the account.
     *         This function is intended to be called by ERC-4337 EntryPoint.sol
     * @dev Ensure adequate authorization control: i.e. onlyEntryPointOrSelf
     *
     * @dev MSA MUST implement this function signature.
     * If a mode is requested that is not supported by the Account, it MUST revert
     * @param mode The encoded execution mode of the transaction. See ModeLib.sol for details
     * @param executionCalldata The encoded execution call data
     */
    function execute(bytes32 mode, bytes calldata executionCalldata) external payable;
}
