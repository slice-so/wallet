// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

/// @title Authorization Revocation Registry
/// @notice An issuer-scoped, monotonic ERC-8128 delegation revocation registry.
contract AuthorizationRevocationRegistry {
    uint256 private constant SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("ERC-8128 Delegation Registry");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 public constant REVOKE_TYPEHASH = keccak256("Revocation(address issuer,bytes32 id)");

    mapping(address issuer => mapping(bytes32 id => bool)) public revoked;
    mapping(address issuer => uint64 epoch) private _currentEpoch;

    event Revoked(address indexed issuer, bytes32 indexed id);
    event EpochAdvanced(address indexed issuer, uint64 newEpoch);

    error InvalidSignature();

    function revoke(bytes32 id) external {
        _revoke(msg.sender, id);
    }

    function revokeBySig(address issuer, bytes32 id, bytes calldata sig) external {
        bytes32 digest = _revocationDigest(issuer, id);
        if (!_isValidIssuerSignature(issuer, digest, sig)) revert InvalidSignature();
        _revoke(issuer, id);
    }

    function advanceEpoch() external returns (uint64 newEpoch) {
        newEpoch = ++_currentEpoch[msg.sender];
        emit EpochAdvanced(msg.sender, newEpoch);
    }

    function currentEpoch(address issuer) external view returns (uint64) {
        return _currentEpoch[issuer];
    }

    function status(address issuer, bytes32 id) external view returns (bool isRevoked, uint64 epoch) {
        return (revoked[issuer][id], _currentEpoch[issuer]);
    }

    /// @notice Returns the EIP-712 domain used by `revokeBySig`, as specified by ERC-5267.
    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        )
    {
        fields = 0x0f;
        name = "ERC-8128 Delegation Registry";
        version = "1";
        chainId = block.chainid;
        verifyingContract = address(this);
        salt = bytes32(0);
        extensions = new uint256[](0);
    }

    function _revoke(address issuer, bytes32 id) internal {
        revoked[issuer][id] = true;
        emit Revoked(issuer, id);
    }

    function _isValidIssuerSignature(address issuer, bytes32 digest, bytes calldata sig) internal view returns (bool) {
        if (issuer.code.length != 0) {
            return SignatureCheckerLib.isValidERC1271SignatureNowCalldata(issuer, digest, sig);
        }
        if (sig.length != 65) return false;

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 0x20))
            v := byte(0, calldataload(add(sig.offset, 0x40)))
        }
        if ((v != 27 && v != 28) || uint256(s) > SECP256K1_HALF_ORDER) return false;
        address recovered = ecrecover(digest, v, r, s);
        return recovered != address(0) && recovered == issuer;
    }

    function _revocationDigest(address issuer, bytes32 id) internal view returns (bytes32) {
        bytes32 domainSeparator =
            keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
        bytes32 structHash = keccak256(abi.encode(REVOKE_TYPEHASH, issuer, id));
        return keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));
    }
}
