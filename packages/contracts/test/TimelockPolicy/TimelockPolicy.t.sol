// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {DeployTimelockPolicyScript} from "../../script/DeployTimelockPolicy.s.sol";
import {PackedUserOperation} from "../../src/account-abstraction/interfaces/PackedUserOperation.sol";
import {TimelockPolicy} from "../../src/policies/TimelockPolicy.sol";

contract TimelockPolicyTest is Test {
    TimelockPolicy internal policy;

    bytes32 internal constant POLICY_ID = bytes32(bytes4(0x11223344));
    address internal constant ACCOUNT = address(0x1234);
    address internal constant STRANGER = address(0x5678);
    address internal constant PINNED_CREATE2_ADDRESS = 0x50D5667ced5Db7F67a3BcE741cd3471b313F9DC8;
    uint48 internal constant DELAY = 3 days;
    uint48 internal constant EXPIRATION = 30 days;

    event ProposalCreated(
        address indexed wallet,
        bytes32 indexed id,
        bytes32 indexed proposalHash,
        bytes callData,
        uint256 nonce,
        uint256 epoch,
        uint256 validAfter,
        uint256 validUntil
    );
    event TimelockConfigUpdated(
        address indexed wallet,
        bytes32 indexed id,
        uint256 delay,
        uint256 expirationPeriod,
        address guardian,
        uint256 epoch
    );
    event TimelockConfigRemoved(address indexed wallet, bytes32 indexed id, uint256 epoch);

    function setUp() public {
        policy = new TimelockPolicy();

        vm.prank(ACCOUNT);
        policy.onInstall(abi.encodePacked(POLICY_ID, abi.encode(DELAY, EXPIRATION, address(0))));
    }

    function testCreate2AddressIsPinned() public {
        DeployTimelockPolicyScript deployer = new DeployTimelockPolicyScript();

        assertEq(deployer.computeAddress(), PINNED_CREATE2_ADDRESS);
    }

    function testKernelV4Lifecycle() public {
        assertTrue(policy.isInitialized(ACCOUNT));

        vm.prank(ACCOUNT);
        policy.onUninstall(abi.encodePacked(POLICY_ID));

        assertFalse(policy.isInitialized(ACCOUNT));
    }

    function testNoOpCreatesProposalAndAccountCancelsIt() public {
        bytes memory proposedCallData = hex"12345678";
        uint256 proposedNonce = 42;
        PackedUserOperation memory userOp =
            baseUserOperation({callData: "", signature: proposalSignature(proposedCallData, proposedNonce)});

        vm.warp(1_000_000);

        bytes32 proposalHash = policy.computeUserOpKey(ACCOUNT, proposedCallData, proposedNonce);
        vm.expectEmit(true, true, true, true, address(policy));
        emit ProposalCreated(
            ACCOUNT,
            POLICY_ID,
            proposalHash,
            proposedCallData,
            proposedNonce,
            1,
            block.timestamp + DELAY,
            block.timestamp + DELAY + EXPIRATION
        );

        vm.prank(ACCOUNT);
        assertEq(policy.checkUserOpPolicy(POLICY_ID, userOp), 0);

        (TimelockPolicy.ProposalStatus status, uint256 validAfter, uint256 validUntil) =
            policy.getProposal(ACCOUNT, proposedCallData, proposedNonce, POLICY_ID, ACCOUNT);

        assertEq(uint256(status), uint256(TimelockPolicy.ProposalStatus.Pending));
        assertEq(validAfter, block.timestamp + DELAY);
        assertEq(validUntil, block.timestamp + DELAY + EXPIRATION);

        vm.prank(ACCOUNT);
        policy.cancelProposal(POLICY_ID, ACCOUNT, proposedCallData, proposedNonce);

        (status,,) = policy.getProposal(ACCOUNT, proposedCallData, proposedNonce, POLICY_ID, ACCOUNT);
        assertEq(uint256(status), uint256(TimelockPolicy.ProposalStatus.Cancelled));
    }

    function testExecutionReturnsTimelockWindowAndMarksProposalExecuted() public {
        bytes memory proposedCallData = hex"12345678";
        uint256 proposedNonce = 42;

        vm.prank(ACCOUNT);
        policy.checkUserOpPolicy(
            POLICY_ID, baseUserOperation({callData: "", signature: proposalSignature(proposedCallData, proposedNonce)})
        );

        PackedUserOperation memory executionUserOp = baseUserOperation({callData: proposedCallData, signature: ""});
        executionUserOp.nonce = proposedNonce;

        vm.prank(ACCOUNT);
        uint256 validationData = policy.checkUserOpPolicy(POLICY_ID, executionUserOp);

        (TimelockPolicy.ProposalStatus status, uint256 validAfter, uint256 validUntil) =
            policy.getProposal(ACCOUNT, proposedCallData, proposedNonce, POLICY_ID, ACCOUNT);

        assertEq(uint256(status), uint256(TimelockPolicy.ProposalStatus.Executed));
        assertEq(validationData, validAfter << 208 | validUntil << 160);
    }

    function testStrangerCannotCancelWhenGuardianIsZero() public {
        bytes memory proposedCallData = hex"12345678";
        uint256 proposedNonce = 42;

        vm.prank(ACCOUNT);
        policy.checkUserOpPolicy(
            POLICY_ID, baseUserOperation({callData: "", signature: proposalSignature(proposedCallData, proposedNonce)})
        );

        vm.expectRevert(TimelockPolicy.OnlyAccount.selector);
        vm.prank(STRANGER);
        policy.cancelProposal(POLICY_ID, ACCOUNT, proposedCallData, proposedNonce);
    }

    function testReinstallEpochInvalidatesOldProposal() public {
        bytes memory proposedCallData = hex"12345678";
        uint256 proposedNonce = 42;

        vm.prank(ACCOUNT);
        policy.checkUserOpPolicy(
            POLICY_ID, baseUserOperation({callData: "", signature: proposalSignature(proposedCallData, proposedNonce)})
        );

        vm.expectEmit(true, true, false, true, address(policy));
        emit TimelockConfigRemoved(ACCOUNT, POLICY_ID, 1);
        vm.prank(ACCOUNT);
        policy.onUninstall(abi.encodePacked(POLICY_ID));

        vm.expectEmit(true, true, false, true, address(policy));
        emit TimelockConfigUpdated(ACCOUNT, POLICY_ID, DELAY, EXPIRATION, address(0), 2);
        vm.prank(ACCOUNT);
        policy.onInstall(abi.encodePacked(POLICY_ID, abi.encode(DELAY, EXPIRATION, address(0))));

        assertEq(policy.currentEpoch(POLICY_ID, ACCOUNT), 2);

        PackedUserOperation memory executionUserOp = baseUserOperation({callData: proposedCallData, signature: ""});
        executionUserOp.nonce = proposedNonce;

        vm.prank(ACCOUNT);
        assertEq(policy.checkUserOpPolicy(POLICY_ID, executionUserOp), 1);
    }

    function testUninstallEmitsCurrentEpoch() public {
        vm.expectEmit(true, true, false, true, address(policy));
        emit TimelockConfigRemoved(ACCOUNT, POLICY_ID, 1);

        vm.prank(ACCOUNT);
        policy.onUninstall(abi.encodePacked(POLICY_ID));
    }

    function testExactKeyCanBeReproposedAfterEpochBump() public {
        bytes memory proposedCallData = hex"12345678";
        uint256 proposedNonce = 42;

        vm.prank(ACCOUNT);
        policy.checkUserOpPolicy(
            POLICY_ID, baseUserOperation({callData: "", signature: proposalSignature(proposedCallData, proposedNonce)})
        );

        PackedUserOperation memory executionUserOp = baseUserOperation({callData: proposedCallData, signature: ""});
        executionUserOp.nonce = proposedNonce;
        vm.prank(ACCOUNT);
        policy.checkUserOpPolicy(POLICY_ID, executionUserOp);

        vm.prank(ACCOUNT);
        policy.onUninstall(abi.encodePacked(POLICY_ID));
        vm.prank(ACCOUNT);
        policy.onInstall(abi.encodePacked(POLICY_ID, abi.encode(DELAY, EXPIRATION, address(0))));

        bytes32 proposalHash = policy.computeUserOpKey(ACCOUNT, proposedCallData, proposedNonce);
        vm.expectEmit(true, true, true, true, address(policy));
        emit ProposalCreated(
            ACCOUNT,
            POLICY_ID,
            proposalHash,
            proposedCallData,
            proposedNonce,
            2,
            block.timestamp + DELAY,
            block.timestamp + DELAY + EXPIRATION
        );

        vm.prank(ACCOUNT);
        assertEq(
            policy.checkUserOpPolicy(
                POLICY_ID,
                baseUserOperation({callData: "", signature: proposalSignature(proposedCallData, proposedNonce)})
            ),
            0
        );

        (TimelockPolicy.ProposalStatus status,,, uint256 epoch) = policy.proposals(proposalHash, POLICY_ID, ACCOUNT);
        assertEq(uint256(status), uint256(TimelockPolicy.ProposalStatus.Pending));
        assertEq(epoch, 2);
    }

    function testSameEpochDuplicateProposalIsRejectedForEveryStatus() public {
        bytes[] memory callDatas = new bytes[](3);
        callDatas[0] = hex"11111111";
        callDatas[1] = hex"22222222";
        callDatas[2] = hex"33333333";

        for (uint256 i; i < callDatas.length; i++) {
            uint256 nonce = i + 1;
            vm.prank(ACCOUNT);
            policy.checkUserOpPolicy(
                POLICY_ID, baseUserOperation({callData: "", signature: proposalSignature(callDatas[i], nonce)})
            );

            if (i == 1) {
                PackedUserOperation memory executionUserOp = baseUserOperation({callData: callDatas[i], signature: ""});
                executionUserOp.nonce = nonce;
                vm.prank(ACCOUNT);
                policy.checkUserOpPolicy(POLICY_ID, executionUserOp);
            } else if (i == 2) {
                vm.prank(ACCOUNT);
                policy.cancelProposal(POLICY_ID, ACCOUNT, callDatas[i], nonce);
            }

            vm.prank(ACCOUNT);
            assertEq(
                policy.checkUserOpPolicy(
                    POLICY_ID, baseUserOperation({callData: "", signature: proposalSignature(callDatas[i], nonce)})
                ),
                1
            );
        }

        _assertProposalStatus(callDatas[0], 1, TimelockPolicy.ProposalStatus.Pending);
        _assertProposalStatus(callDatas[1], 2, TimelockPolicy.ProposalStatus.Executed);
        _assertProposalStatus(callDatas[2], 3, TimelockPolicy.ProposalStatus.Cancelled);
    }

    function testExpiredProposalReturnsExpiredValidationWindow() public {
        bytes memory proposedCallData = hex"12345678";
        uint256 proposedNonce = 42;

        vm.prank(ACCOUNT);
        policy.checkUserOpPolicy(
            POLICY_ID, baseUserOperation({callData: "", signature: proposalSignature(proposedCallData, proposedNonce)})
        );

        vm.warp(block.timestamp + DELAY + EXPIRATION + 1);
        PackedUserOperation memory executionUserOp = baseUserOperation({callData: proposedCallData, signature: ""});
        executionUserOp.nonce = proposedNonce;

        vm.prank(ACCOUNT);
        uint256 validationData = policy.checkUserOpPolicy(POLICY_ID, executionUserOp);

        (, uint256 validAfter, uint256 validUntil) =
            policy.getProposal(ACCOUNT, proposedCallData, proposedNonce, POLICY_ID, ACCOUNT);
        assertLt(validUntil, block.timestamp);
        assertEq(validationData, validAfter << 208 | validUntil << 160);
    }

    function baseUserOperation(bytes memory callData, bytes memory signature)
        internal
        pure
        returns (PackedUserOperation memory)
    {
        return PackedUserOperation({
            sender: ACCOUNT,
            nonce: 0,
            initCode: "",
            callData: callData,
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: "",
            signature: signature
        });
    }

    function proposalSignature(bytes memory callData, uint256 nonce) internal pure returns (bytes memory) {
        return abi.encodePacked(uint256(callData.length), callData, nonce);
    }

    function _assertProposalStatus(bytes memory callData, uint256 nonce, TimelockPolicy.ProposalStatus expected)
        internal
        view
    {
        (TimelockPolicy.ProposalStatus status,,) = policy.getProposal(ACCOUNT, callData, nonce, POLICY_ID, ACCOUNT);
        assertEq(uint256(status), uint256(expected));
    }
}
