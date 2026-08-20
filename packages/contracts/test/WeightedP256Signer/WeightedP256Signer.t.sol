// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {DeployWeightedP256SignerScript} from "../../script/DeployWeightedP256Signer.s.sol";
import {PackedUserOperation} from "../../src/account-abstraction/interfaces/PackedUserOperation.sol";
import {WeightedP256Signer} from "../../src/signers/WeightedP256Signer.sol";
import {P256VerifierEtcher} from "../utils/P256VerifierEtcher.sol";

contract WeightedP256SignerHarness is WeightedP256Signer {
    bytes32 private constant TEST_PROPOSAL_TYPEHASH =
        keccak256("Proposal(address account,bytes32 id,bytes callData,uint256 nonce,uint48 validUntil)");
    bytes32 private constant TEST_COSIGN_TYPEHASH = keccak256("CoSign(bytes32 userOperationHash,uint48 validUntil)");

    function hashProposal(address account, bytes32 id, bytes calldata callData, uint256 nonce, uint48 validUntil)
        external
        view
        returns (bytes32)
    {
        return _hashTypedData(
            keccak256(abi.encode(TEST_PROPOSAL_TYPEHASH, account, id, keccak256(callData), nonce, validUntil))
        );
    }

    function hashCoSign(bytes32 userOperationHash, uint48 validUntil) external view returns (bytes32) {
        return _hashTypedData(keccak256(abi.encode(TEST_COSIGN_TYPEHASH, userOperationHash, validUntil)));
    }
}

contract WeightedP256SignerTest is Test {
    using P256VerifierEtcher for Vm;

    uint256 private constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 private constant P256_HALF_N = 0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8;
    uint256 private constant SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
    uint256 private constant P256_FIELD = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff;

    bytes32 private constant PERMISSION_ID = bytes32(bytes4(0x01020304));
    bytes32 private constant OTHER_PERMISSION_ID = bytes32(bytes4(0x05060708));
    address private constant KERNEL = address(0x1234);
    uint256 private constant SESSION_PRIVATE_KEY = 0xA11CE;
    uint256 private constant OTHER_SESSION_PRIVATE_KEY = 0xDAD;
    uint256 private constant COSIGNER_PRIVATE_KEY = 0xB0B;
    uint256 private constant WRONG_PRIVATE_KEY = 0xCAFE;
    bytes32 private constant USER_OP_HASH = keccak256("slice-user-op");
    uint48 private constant VALID_UNTIL = 2_000_000_000;
    bytes4 private constant ERC1271_INVALID = 0xffffffff;
    address private constant PINNED_CREATE2_ADDRESS = 0x963B1377e87701a94357b924c9C1cF2d9263FB06;

    WeightedP256SignerHarness private signer;
    uint256 private sessionX;
    uint256 private sessionY;
    address private coSigner;

    function setUp() public {
        vm.etch();
        signer = new WeightedP256SignerHarness();
        (sessionX, sessionY) = vm.publicKeyP256(SESSION_PRIVATE_KEY);
        coSigner = vm.addr(COSIGNER_PRIVATE_KEY);
        install(PERMISSION_ID, sessionX, sessionY, coSigner);
    }

    function testValidSplitSignature() public {
        PackedUserOperation memory unsignedUserOp = userOperation("");
        PackedUserOperation memory signedUserOp = userOperation(splitSignature(PERMISSION_ID, unsignedUserOp));

        vm.prank(KERNEL);
        assertEq(signer.checkUserOpSignature(PERMISSION_ID, signedUserOp, USER_OP_HASH), uint256(VALID_UNTIL) << 160);
    }

    function testSessionOnlyFails() public {
        PackedUserOperation memory unsignedUserOp = userOperation("");
        PackedUserOperation memory signedUserOp = userOperation(proposalSignature(PERMISSION_ID, unsignedUserOp));

        vm.prank(KERNEL);
        assertEq(signer.checkUserOpSignature(PERMISSION_ID, signedUserOp, USER_OP_HASH), 1);
    }

    function testWrongSessionKeyFails() public {
        PackedUserOperation memory unsignedUserOp = userOperation("");
        bytes memory signature = abi.encodePacked(
            p256Signature(OTHER_SESSION_PRIVATE_KEY, proposalDigest(PERMISSION_ID, unsignedUserOp, VALID_UNTIL)),
            ecdsaSignature(COSIGNER_PRIVATE_KEY, signer.hashCoSign(USER_OP_HASH, VALID_UNTIL)),
            bytes6(VALID_UNTIL)
        );

        vm.prank(KERNEL);
        assertEq(signer.checkUserOpSignature(PERMISSION_ID, userOperation(signature), USER_OP_HASH), 1);
    }

    function testWrongCoSignerFails() public {
        PackedUserOperation memory unsignedUserOp = userOperation("");
        bytes memory signature = abi.encodePacked(
            proposalSignature(PERMISSION_ID, unsignedUserOp),
            ecdsaSignature(WRONG_PRIVATE_KEY, signer.hashCoSign(USER_OP_HASH, VALID_UNTIL)),
            bytes6(VALID_UNTIL)
        );

        vm.prank(KERNEL);
        assertEq(signer.checkUserOpSignature(PERMISSION_ID, userOperation(signature), USER_OP_HASH), 1);
    }

    function testHighSP256SignatureFails() public {
        PackedUserOperation memory unsignedUserOp = userOperation("");
        bytes32 digest = proposalDigest(PERMISSION_ID, unsignedUserOp, VALID_UNTIL);
        (bytes32 r, bytes32 s) = vm.signP256(SESSION_PRIVATE_KEY, digest);
        uint256 normalizedS = uint256(s) > P256_HALF_N ? P256_N - uint256(s) : uint256(s);
        bytes32 highS = bytes32(P256_N - normalizedS);
        // Allow-list the malleated tuple so the verifier double would accept it; only Solady's
        // low-s malleability gate can now reject it, making this a real regression guard.
        vm.allow(digest, r, highS, sessionX, sessionY);
        bytes memory signature = abi.encodePacked(
            r,
            highS,
            ecdsaSignature(COSIGNER_PRIVATE_KEY, signer.hashCoSign(USER_OP_HASH, VALID_UNTIL)),
            bytes6(VALID_UNTIL)
        );

        vm.prank(KERNEL);
        assertEq(signer.checkUserOpSignature(PERMISSION_ID, userOperation(signature), USER_OP_HASH), 1);
    }

    function testHighSCoSignatureFails() public {
        PackedUserOperation memory unsignedUserOp = userOperation("");
        bytes32 coSignDigest = signer.hashCoSign(USER_OP_HASH, VALID_UNTIL);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(COSIGNER_PRIVATE_KEY, coSignDigest);
        uint8 malleatedV = v == 27 ? 28 : 27;
        bytes32 highS = bytes32(SECP256K1_N - uint256(s));
        assertEq(ecrecover(coSignDigest, malleatedV, r, highS), coSigner);

        bytes memory signature = abi.encodePacked(
            proposalSignature(PERMISSION_ID, unsignedUserOp), r, highS, malleatedV, bytes6(VALID_UNTIL)
        );

        vm.prank(KERNEL);
        assertEq(signer.checkUserOpSignature(PERMISSION_ID, userOperation(signature), USER_OP_HASH), 1);
    }

    function testDummySignatureSoftFails() public {
        vm.prank(KERNEL);
        assertEq(signer.checkUserOpSignature(PERMISSION_ID, userOperation(new bytes(135)), USER_OP_HASH), 1);
    }

    function testPermissionIsolation() public {
        (uint256 otherX, uint256 otherY) = vm.publicKeyP256(OTHER_SESSION_PRIVATE_KEY);
        install(OTHER_PERMISSION_ID, otherX, otherY, vm.addr(WRONG_PRIVATE_KEY));
        PackedUserOperation memory unsignedUserOp = userOperation("");
        PackedUserOperation memory signedUserOp = userOperation(splitSignature(PERMISSION_ID, unsignedUserOp));

        vm.prank(KERNEL);
        assertEq(signer.checkUserOpSignature(OTHER_PERMISSION_ID, signedUserOp, USER_OP_HASH), 1);
    }

    function testCheckSignatureIsDisabled() public {
        PackedUserOperation memory unsignedUserOp = userOperation("");
        vm.prank(KERNEL);
        assertEq(
            signer.checkSignature(
                PERMISSION_ID, address(0xbeef), keccak256("slice-1271"), splitSignature(PERMISSION_ID, unsignedUserOp)
            ),
            ERC1271_INVALID
        );
    }

    function testRejectsZeroDeadline() public {
        PackedUserOperation memory unsignedUserOp = userOperation("");
        bytes memory signature = abi.encodePacked(
            proposalSignature(PERMISSION_ID, unsignedUserOp),
            ecdsaSignature(COSIGNER_PRIVATE_KEY, signer.hashCoSign(USER_OP_HASH, 0)),
            bytes6(0)
        );

        vm.prank(KERNEL);
        assertEq(signer.checkUserOpSignature(PERMISSION_ID, userOperation(signature), USER_OP_HASH), 1);
    }

    function testCoSignatureBindsDeadline() public {
        PackedUserOperation memory unsignedUserOp = userOperation("");
        bytes memory signature = abi.encodePacked(
            proposalSignatureForDeadline(PERMISSION_ID, unsignedUserOp, VALID_UNTIL + 1),
            ecdsaSignature(COSIGNER_PRIVATE_KEY, signer.hashCoSign(USER_OP_HASH, VALID_UNTIL)),
            bytes6(VALID_UNTIL + 1)
        );

        vm.prank(KERNEL);
        assertEq(signer.checkUserOpSignature(PERMISSION_ID, userOperation(signature), USER_OP_HASH), 1);
    }

    function testP256SignatureBindsDeadline() public {
        PackedUserOperation memory unsignedUserOp = userOperation("");
        bytes memory signature = abi.encodePacked(
            proposalSignature(PERMISSION_ID, unsignedUserOp),
            ecdsaSignature(COSIGNER_PRIVATE_KEY, signer.hashCoSign(USER_OP_HASH, VALID_UNTIL + 1)),
            bytes6(VALID_UNTIL + 1)
        );

        vm.prank(KERNEL);
        assertEq(signer.checkUserOpSignature(PERMISSION_ID, userOperation(signature), USER_OP_HASH), 1);
    }

    function testRejectsMalformedInstallLength() public {
        vm.expectRevert(WeightedP256Signer.InvalidInstallDataLength.selector);
        vm.prank(KERNEL);
        signer.onInstall(abi.encodePacked(OTHER_PERMISSION_ID, new bytes(95)));

        vm.expectRevert(WeightedP256Signer.InvalidInstallDataLength.selector);
        vm.prank(KERNEL);
        signer.onInstall(abi.encodePacked(OTHER_PERMISSION_ID, new bytes(97)));
    }

    function testRejectsInvalidInstallValues() public {
        expectInvalidPublicKey(0, sessionY);
        expectInvalidPublicKey(sessionX, 0);
        expectInvalidPublicKey(P256_FIELD, sessionY);
        expectInvalidPublicKey(1, 1);

        vm.expectRevert(WeightedP256Signer.InvalidCoSigner.selector);
        install(OTHER_PERMISSION_ID, sessionX, sessionY, address(0));
    }

    function testReinstallAndUninstall() public {
        assertTrue(signer.isInitialized(KERNEL));

        vm.expectRevert(abi.encodeWithSignature("AlreadyInitialized(address)", KERNEL));
        install(PERMISSION_ID, sessionX, sessionY, coSigner);

        vm.prank(KERNEL);
        signer.onUninstall(abi.encodePacked(PERMISSION_ID));
        assertFalse(signer.isInitialized(KERNEL));

        PackedUserOperation memory unsignedUserOp = userOperation("");
        vm.prank(KERNEL);
        assertEq(
            signer.checkUserOpSignature(
                PERMISSION_ID, userOperation(splitSignature(PERMISSION_ID, unsignedUserOp)), USER_OP_HASH
            ),
            1
        );
    }

    function testKernelV4LifecycleTracksMultiplePermissions() public {
        (uint256 otherX, uint256 otherY) = vm.publicKeyP256(OTHER_SESSION_PRIVATE_KEY);
        install(OTHER_PERMISSION_ID, otherX, otherY, vm.addr(WRONG_PRIVATE_KEY));

        vm.prank(KERNEL);
        signer.onUninstall(abi.encodePacked(PERMISSION_ID));
        assertTrue(signer.isInitialized(KERNEL));

        vm.prank(KERNEL);
        signer.onUninstall(abi.encodePacked(OTHER_PERMISSION_ID));
        assertFalse(signer.isInitialized(KERNEL));
    }

    function testCreate2AddressIsPinned() public {
        DeployWeightedP256SignerScript deployer = new DeployWeightedP256SignerScript();
        assertEq(deployer.computeAddress(), PINNED_CREATE2_ADDRESS);
    }

    function testFuzzMalformedSignatureLength(bytes calldata signature) public {
        vm.assume(signature.length != 135);
        vm.prank(KERNEL);
        assertEq(signer.checkUserOpSignature(PERMISSION_ID, userOperation(signature), USER_OP_HASH), 1);
    }

    function expectInvalidPublicKey(uint256 x, uint256 y) private {
        vm.expectRevert(WeightedP256Signer.InvalidSessionPublicKey.selector);
        install(OTHER_PERMISSION_ID, x, y, coSigner);
    }

    function install(bytes32 permissionId, uint256 x, uint256 y, address configuredCoSigner) private {
        vm.prank(KERNEL);
        signer.onInstall(abi.encodePacked(permissionId, abi.encode(x, y, configuredCoSigner)));
    }

    function userOperation(bytes memory signature) private pure returns (PackedUserOperation memory) {
        return PackedUserOperation({
            sender: KERNEL,
            nonce: 9,
            initCode: "",
            callData: hex"1234",
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: "",
            signature: signature
        });
    }

    function splitSignature(bytes32 permissionId, PackedUserOperation memory unsignedUserOp)
        private
        returns (bytes memory)
    {
        return abi.encodePacked(
            proposalSignature(permissionId, unsignedUserOp),
            ecdsaSignature(COSIGNER_PRIVATE_KEY, signer.hashCoSign(USER_OP_HASH, VALID_UNTIL)),
            bytes6(VALID_UNTIL)
        );
    }

    function proposalSignature(bytes32 permissionId, PackedUserOperation memory unsignedUserOp)
        private
        returns (bytes memory)
    {
        return proposalSignatureForDeadline(permissionId, unsignedUserOp, VALID_UNTIL);
    }

    function proposalSignatureForDeadline(
        bytes32 permissionId,
        PackedUserOperation memory unsignedUserOp,
        uint48 validUntil
    ) private returns (bytes memory) {
        bytes32 digest = proposalDigest(permissionId, unsignedUserOp, validUntil);
        bytes memory signature = p256Signature(SESSION_PRIVATE_KEY, digest);
        allowSessionSignature(digest, signature);
        return signature;
    }

    function proposalDigest(bytes32 permissionId, PackedUserOperation memory unsignedUserOp, uint48 validUntil)
        private
        view
        returns (bytes32)
    {
        return sha256(
            abi.encodePacked(
                signer.hashProposal(KERNEL, permissionId, unsignedUserOp.callData, unsignedUserOp.nonce, validUntil)
            )
        );
    }

    function allowSessionSignature(bytes32 digest, bytes memory signature) private {
        vm.allow(digest, bytes32(slice(signature, 0, 32)), bytes32(slice(signature, 32, 64)), sessionX, sessionY);
    }

    function slice(bytes memory data, uint256 start, uint256 end) private pure returns (bytes memory result) {
        result = new bytes(end - start);
        for (uint256 i = start; i < end; i++) {
            result[i - start] = data[i];
        }
    }

    function p256Signature(uint256 privateKey, bytes32 digest) private pure returns (bytes memory) {
        (bytes32 r, bytes32 s) = vm.signP256(privateKey, digest);
        uint256 normalizedS = uint256(s) > P256_HALF_N ? P256_N - uint256(s) : uint256(s);
        return abi.encodePacked(r, bytes32(normalizedS));
    }

    function ecdsaSignature(uint256 privateKey, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}

/// @notice End-to-end signature check against Base's real RIP-7212 P-256 verifier (no test double).
/// @dev Exercises the sha256-wrap -> P256.verifySignature path with real EC math. Gated on
///      RPC_URL_BASE so a local `forge test` without a Base RPC skips instead of failing.
contract WeightedP256SignerForkTest is Test {
    using P256VerifierEtcher for Vm;

    uint256 private constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 private constant P256_HALF_N = 0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8;

    bytes32 private constant PERMISSION_ID = bytes32(bytes4(0x01020304));
    address private constant KERNEL = address(0x1234);
    uint256 private constant SESSION_PRIVATE_KEY = 0xA11CE;
    uint256 private constant COSIGNER_PRIVATE_KEY = 0xB0B;
    bytes32 private constant USER_OP_HASH = keccak256("slice-user-op");
    uint48 private constant VALID_UNTIL = 2_000_000_000;

    WeightedP256SignerHarness private signer;
    uint256 private sessionX;
    uint256 private sessionY;
    address private coSigner;

    function setUp() public {
        string memory rpc = vm.envOr("RPC_URL_BASE", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        vm.etchBaseVerifier();
        signer = new WeightedP256SignerHarness();
        (sessionX, sessionY) = vm.publicKeyP256(SESSION_PRIVATE_KEY);
        coSigner = vm.addr(COSIGNER_PRIVATE_KEY);
        vm.prank(KERNEL);
        signer.onInstall(abi.encodePacked(PERMISSION_ID, abi.encode(sessionX, sessionY, coSigner)));
    }

    function testRealVerifierAcceptsValidRejectsMalleated() public {
        if (address(signer) == address(0)) {
            vm.skip(true);
            return;
        }

        PackedUserOperation memory unsignedUserOp = userOperation("");
        bytes32 digest = sha256(
            abi.encodePacked(
                signer.hashProposal(KERNEL, PERMISSION_ID, unsignedUserOp.callData, unsignedUserOp.nonce, VALID_UNTIL)
            )
        );
        (bytes32 r, bytes32 s) = vm.signP256(SESSION_PRIVATE_KEY, digest);
        uint256 lowS = uint256(s) > P256_HALF_N ? P256_N - uint256(s) : uint256(s);
        (uint8 v, bytes32 cr, bytes32 cs) = vm.sign(COSIGNER_PRIVATE_KEY, signer.hashCoSign(USER_OP_HASH, VALID_UNTIL));
        bytes memory coSignature = abi.encodePacked(cr, cs, v);

        bytes memory validSignature = abi.encodePacked(r, bytes32(lowS), coSignature, bytes6(VALID_UNTIL));
        vm.prank(KERNEL);
        assertEq(
            signer.checkUserOpSignature(PERMISSION_ID, userOperation(validSignature), USER_OP_HASH),
            uint256(VALID_UNTIL) << 160
        );

        // Real verifier + Solady low-s gate must reject the malleated (high-s) P-256 half.
        bytes memory highSSignature = abi.encodePacked(r, bytes32(P256_N - lowS), coSignature, bytes6(VALID_UNTIL));
        vm.prank(KERNEL);
        assertEq(signer.checkUserOpSignature(PERMISSION_ID, userOperation(highSSignature), USER_OP_HASH), 1);

        // Real verifier must reject a wrong P-256 r component.
        bytes memory wrongSignature =
            abi.encodePacked(bytes32(uint256(r) ^ 1), bytes32(lowS), coSignature, bytes6(VALID_UNTIL));
        vm.prank(KERNEL);
        assertEq(signer.checkUserOpSignature(PERMISSION_ID, userOperation(wrongSignature), USER_OP_HASH), 1);
    }

    function userOperation(bytes memory signature) private pure returns (PackedUserOperation memory) {
        return PackedUserOperation({
            sender: KERNEL,
            nonce: 9,
            initCode: "",
            callData: hex"1234",
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: "",
            signature: signature
        });
    }
}
