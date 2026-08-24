// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract Mock1271 {
    bytes32 public digest;
    bytes public signature;
    bool public accepts = true;

    function configure(bytes32 digest_, bytes calldata signature_, bool accepts_) external {
        digest = digest_;
        signature = signature_;
        accepts = accepts_;
    }

    function isValidSignature(bytes32 digest_, bytes calldata signature_) external view returns (bytes4) {
        return accepts && digest_ == digest && keccak256(signature_) == keccak256(signature)
            ? bytes4(0x1626ba7e)
            : bytes4(0xffffffff);
    }
}
