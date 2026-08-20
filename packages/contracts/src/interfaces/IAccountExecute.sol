// SPDX-License-Identifier: MIT
//
// Vendored from the eth-infinitism/account-abstraction dependency pinned by
// zerodevapp/kernel commit f2a84a332ec5a722e7e95a0d64601905c3c87fe9:
// https://github.com/eth-infinitism/account-abstraction/blob/86fcd84cf7263fe384d61d078ee747b16e69a496/contracts/interfaces/IAccountExecute.sol
// Source modification below this header:
// - Remapped the PackedUserOperation import to this package's local vendored path.
// - Applied this package's Foundry formatting to the function declaration.
pragma solidity ^0.8.28;

import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";

interface IAccountExecute {
    /**
     * Account may implement this execute method.
     * passing this methodSig at the beginning of callData will cause the entryPoint to pass the full UserOp (and hash)
     * to the account.
     * The account should skip the methodSig, and use the callData (and optionally, other UserOp fields)
     *
     * @param userOp              - The operation that was just validated.
     * @param userOpHash          - Hash of the user's request data.
     */
    function executeUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash) external;
}
