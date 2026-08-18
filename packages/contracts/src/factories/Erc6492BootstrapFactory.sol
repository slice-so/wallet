// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibZip} from "solady/utils/LibZip.sol";

struct KernelInstall {
    uint256 moduleType;
    address module;
    bytes moduleData;
    bytes internalData;
}

/// @notice Expands compressed Kernel v4 factory calldata for ERC-6492 verification.
/// @dev This factory is stateless and verification-only. ERC-4337 deployment
/// continues to use the canonical KernelFactory directly.
contract Erc6492BootstrapFactory {
    address public constant KERNEL_FACTORY = 0xA299A4eFee7BBFb2Ea5668b30218C45fff78356c;

    /// @notice Mirrors and forwards the canonical Kernel v4 deployment call.
    /// @dev Unnamed arguments preserve KernelFactory's selector without decoding
    /// or re-encoding its calldata after LibZip expands it.
    function deploy(KernelInstall[] calldata, uint256) external payable returns (address account) {
        (bool success, bytes memory result) = KERNEL_FACTORY.call{value: msg.value}(msg.data);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
        account = abi.decode(result, (address));
    }

    /// @dev Solady compression negates the first four bytes, so compressed calls
    /// enter here, decompress, and delegate back into deploy(Install[],uint256).
    fallback() external payable {
        LibZip.cdFallback();
    }

    receive() external payable {}
}
