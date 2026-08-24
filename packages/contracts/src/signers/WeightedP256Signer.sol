// SPDX-License-Identifier: MIT
//
// Based on the split-signature UserOperation flow from zerodevapp/kernel-7579-plugins
// at commit 332deed6eeef3d6279cde50aa1d51eff53728bd4:
// https://github.com/zerodevapp/kernel-7579-plugins/blob/332deed6eeef3d6279cde50aa1d51eff53728bd4/src/signers/WeightedECDSASigner.sol
// Intentional deviations from that baseline:
// - Fixed-role 2-of-2 signer instead of configurable weighted ECDSA guardians.
// - The proposal signer is a P-256 browser key; the final signer is Slice's ECDSA co-signer.
// - Both signatures bind a per-operation deadline returned as ERC-4337 validation data.
// - ECDSA co-signatures reject high-s values, matching P256.verifySignature's canonicality check.
// - ERC-1271 and stateless validation are disabled because this signer is checkout-only.
pragma solidity ^0.8.30;

import {ECDSA} from "solady/utils/ECDSA.sol";
import {EIP712} from "solady/utils/EIP712.sol";
import {P256} from "solady/utils/P256.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {SignerBase} from "src/base/SignerBase.sol";
import {ERC1271_INVALID, SIG_VALIDATION_FAILED_UINT} from "src/types/Constants.sol";

struct WeightedP256SignerStorage {
    uint256 sessionX;
    uint256 sessionY;
    address coSigner;
    bool initialized;
}

/// @notice Fixed-role 2-of-2 signer for a P-256 session key and an ECDSA policy co-signer.
/// @dev P256 verification can revert if the configured fallback verifier call itself fails.
///      Base provides the RIP-7212 precompile, so ordinary invalid signatures soft-fail there.
contract WeightedP256Signer is EIP712, SignerBase {
    // Gas is deliberately excluded so a rejected operation can be repriced.
    // The P-256 half binds account, permission, calls, nonce, and deadline; the required
    // ECDSA co-signature below binds the finalized full userOpHash.
    bytes32 private constant PROPOSAL_TYPEHASH =
        keccak256("Proposal(address account,bytes32 id,bytes callData,uint256 nonce,uint48 validUntil)");
    bytes32 private constant COSIGN_TYPEHASH = keccak256("CoSign(bytes32 userOperationHash,uint48 validUntil)");

    uint256 private constant P256_FIELD = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff;
    uint256 private constant P256_B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b;
    uint256 private constant SECP256K1_HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    uint256 private constant INSTALL_DATA_LENGTH = 96;
    uint256 private constant SIGNATURE_LENGTH = 135;

    error InvalidInstallDataLength();
    error InvalidSessionPublicKey();
    error InvalidCoSigner();

    mapping(bytes32 id => mapping(address kernel => WeightedP256SignerStorage)) public weightedP256Storage;

    function _domainNameAndVersion() internal pure override returns (string memory, string memory) {
        return ("WeightedP256Signer", "0.0.1");
    }

    function _signerOninstall(bytes32 id, bytes calldata data) internal override {
        if (_isInitialized(id, msg.sender)) revert AlreadyInitialized(msg.sender);
        if (data.length != INSTALL_DATA_LENGTH) revert InvalidInstallDataLength();

        (uint256 sessionX, uint256 sessionY, address coSigner) = abi.decode(data, (uint256, uint256, address));
        if (!_isValidPublicKey(sessionX, sessionY)) revert InvalidSessionPublicKey();
        if (coSigner == address(0)) revert InvalidCoSigner();

        weightedP256Storage[id][msg.sender] =
            WeightedP256SignerStorage({sessionX: sessionX, sessionY: sessionY, coSigner: coSigner, initialized: true});
    }

    function _signerOnUninstall(bytes32 id, bytes calldata) internal override {
        if (!_isInitialized(id, msg.sender)) revert NotInitialized(msg.sender);
        delete weightedP256Storage[id][msg.sender];
    }

    function checkUserOpSignature(bytes32 id, PackedUserOperation calldata userOp, bytes32 userOpHash)
        external
        payable
        override
        returns (uint256)
    {
        WeightedP256SignerStorage storage config = weightedP256Storage[id][msg.sender];
        if (!config.initialized || userOp.signature.length != SIGNATURE_LENGTH) {
            return SIG_VALIDATION_FAILED_UINT;
        }
        uint48 validUntil = uint48(bytes6(userOp.signature[129:135]));
        if (validUntil == 0) return SIG_VALIDATION_FAILED_UINT;

        bytes32 proposalHash = _hashTypedData(
            keccak256(
                abi.encode(PROPOSAL_TYPEHASH, userOp.sender, id, keccak256(userOp.callData), userOp.nonce, validUntil)
            )
        );

        if (!_verifyP256(sha256(abi.encodePacked(proposalHash)), userOp.signature[0:64], config)) {
            return SIG_VALIDATION_FAILED_UINT;
        }

        bytes32 coSignDigest = _hashTypedData(keccak256(abi.encode(COSIGN_TYPEHASH, userOpHash, validUntil)));
        if (!_verifyCoSignature(coSignDigest, userOp.signature[64:129], config.coSigner)) {
            return SIG_VALIDATION_FAILED_UINT;
        }

        return uint256(validUntil) << 160;
    }

    function checkSignature(bytes32, address, bytes32, bytes calldata) external pure override returns (bytes4) {
        return ERC1271_INVALID;
    }

    function _isInitialized(bytes32 id, address smartAccount) internal view returns (bool) {
        return weightedP256Storage[id][smartAccount].initialized;
    }

    function _verifyP256(bytes32 digest, bytes calldata signature, WeightedP256SignerStorage storage config)
        private
        view
        returns (bool)
    {
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        return P256.verifySignature(digest, r, s, bytes32(config.sessionX), bytes32(config.sessionY));
    }

    function _verifyCoSignature(bytes32 digest, bytes calldata signature, address coSigner)
        private
        view
        returns (bool)
    {
        if (uint256(bytes32(signature[32:64])) > SECP256K1_HALF_N) return false;
        return ECDSA.tryRecoverCalldata(digest, signature) == coSigner;
    }

    function _isValidPublicKey(uint256 x, uint256 y) private pure returns (bool) {
        if (x == 0 || y == 0 || x >= P256_FIELD || y >= P256_FIELD) return false;

        uint256 ySquared = mulmod(y, y, P256_FIELD);
        uint256 xSquared = mulmod(x, x, P256_FIELD);
        uint256 xCubed = mulmod(xSquared, x, P256_FIELD);
        uint256 minusThreeX = P256_FIELD - mulmod(3, x, P256_FIELD);
        uint256 expectedY = addmod(addmod(xCubed, minusThreeX, P256_FIELD), P256_B, P256_FIELD);
        return ySquared == expectedY;
    }
}
