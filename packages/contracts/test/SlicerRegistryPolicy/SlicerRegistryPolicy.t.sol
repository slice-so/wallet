// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {DeploySlicerRegistryPolicyScript} from "../../script/DeploySlicerRegistryPolicy.s.sol";
import {PackedUserOperation} from "../../src/account-abstraction/interfaces/PackedUserOperation.sol";
import {IAccountExecute} from "../../src/interfaces/IAccountExecute.sol";
import {IERC7579Account} from "../../src/interfaces/IERC7579Account.sol";
import {ISliceCoreRegistry, SlicerRegistryPolicy} from "../../src/policies/SlicerRegistryPolicy.sol";
import {LibERC7579} from "solady/accounts/LibERC7579.sol";

contract MockSlicerIdentity {
    uint128 public immutable slicerId;

    constructor(uint128 id) {
        slicerId = id;
    }
}

contract SlicerRegistryPolicyTest is Test {
    struct Execution {
        address target;
        uint256 value;
        bytes callData;
    }

    address internal constant ACCOUNT = address(0x1234);
    address internal constant SLICE_CORE = 0x5Cef0380cE0aD3DAEefef8bDb85dBDeD7965adf9;
    address internal constant PINNED_CREATE2_ADDRESS = 0x20Cc5bF73f9276Bc520395958E45a3D41B299420;
    bytes32 internal constant POLICY_ID = bytes32(bytes4(0x11223344));
    bytes4 internal constant ADD_CURRENCIES_SELECTOR = bytes4(keccak256("_addCurrencies(address[])"));
    bytes4 internal constant GRANT_ROLES_SELECTOR = bytes4(keccak256("grantRoles(bytes32,address)"));
    bytes4 internal constant MULTICALL_SELECTOR = bytes4(keccak256("multicall(bytes[])"));
    bytes4 internal constant RENOUNCE_ROLES_SELECTOR = bytes4(keccak256("renounceRoles(bytes32)"));
    bytes4 internal constant RELEASE_SELECTOR = bytes4(keccak256("release(address,address,bool)"));
    bytes4 internal constant REVOKE_ROLES_SELECTOR = bytes4(keccak256("revokeRoles(bytes32,address)"));
    bytes4 internal constant SET_ROLES_SELECTOR = bytes4(keccak256("setRoles(bytes32,address)"));

    SlicerRegistryPolicy internal policy;
    MockSlicerIdentity internal slicer;
    MockSlicerIdentity internal impostor;

    function setUp() public {
        policy = new SlicerRegistryPolicy();
        slicer = new MockSlicerIdentity(7);
        impostor = new MockSlicerIdentity(7);

        vm.mockCall(SLICE_CORE, abi.encodeCall(ISliceCoreRegistry.slicers, (uint256(7))), abi.encode(address(slicer)));
        vm.prank(ACCOUNT);
        policy.onInstall(abi.encodePacked(POLICY_ID));
    }

    function testAllowsDynamicManagementCallToCanonicalSlicer() public {
        PackedUserOperation memory userOp =
            userOperation(singleExecution(address(slicer), abi.encodePacked(ADD_CURRENCIES_SELECTOR)));

        vm.prank(ACCOUNT);
        assertEq(policy.checkUserOpPolicy(POLICY_ID, userOp), 0);
    }

    function testCreate2AddressIsPinned() public {
        DeploySlicerRegistryPolicyScript deployer = new DeploySlicerRegistryPolicyScript();
        assertEq(deployer.computeAddress(), PINNED_CREATE2_ADDRESS);
    }

    function testKernelV4Lifecycle() public {
        assertTrue(policy.isInitialized(ACCOUNT));

        vm.prank(ACCOUNT);
        policy.onUninstall(abi.encodePacked(POLICY_ID));

        assertFalse(policy.isInitialized(ACCOUNT));
    }

    function testRejectsDynamicManagementCallToContractClaimingRegisteredId() public {
        PackedUserOperation memory userOp =
            userOperation(singleExecution(address(impostor), abi.encodePacked(ADD_CURRENCIES_SELECTOR)));

        vm.prank(ACCOUNT);
        assertEq(policy.checkUserOpPolicy(POLICY_ID, userOp), 1);
    }

    function testAllowsUnrelatedCallForCallPolicyToValidate() public {
        PackedUserOperation memory userOp =
            userOperation(singleExecution(address(impostor), abi.encodePacked(bytes4(keccak256("other()")))));

        vm.prank(ACCOUNT);
        assertEq(policy.checkUserOpPolicy(POLICY_ID, userOp), 0);
    }

    function testAllowsExecuteUserOpPrefixedExecution() public {
        bytes memory callData = abi.encodePacked(
            IAccountExecute.executeUserOp.selector,
            singleExecution(address(slicer), abi.encodePacked(ADD_CURRENCIES_SELECTOR))
        );
        PackedUserOperation memory userOp = userOperation(callData);

        vm.prank(ACCOUNT);
        assertEq(policy.checkUserOpPolicy(POLICY_ID, userOp), 0);
    }

    function testRejectsEveryRoleMutationEvenForCanonicalSlicer() public {
        bytes4[4] memory selectors =
            [GRANT_ROLES_SELECTOR, RENOUNCE_ROLES_SELECTOR, REVOKE_ROLES_SELECTOR, SET_ROLES_SELECTOR];

        for (uint256 i; i < selectors.length; i++) {
            PackedUserOperation memory userOp =
                userOperation(singleExecution(address(slicer), abi.encodePacked(selectors[i])));

            vm.prank(ACCOUNT);
            assertEq(policy.checkUserOpPolicy(POLICY_ID, userOp), 1);
        }
    }

    function testRejectsRoleMutationWrappedInSlicerMulticall() public {
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodePacked(GRANT_ROLES_SELECTOR);
        PackedUserOperation memory userOp =
            userOperation(singleExecution(address(slicer), abi.encodeWithSelector(MULTICALL_SELECTOR, calls)));

        vm.prank(ACCOUNT);
        assertEq(policy.checkUserOpPolicy(POLICY_ID, userOp), 1);
    }

    function testRejectsRoleMutationWrappedInKernelSelfCall() public {
        bytes memory nestedExecution = singleExecution(address(slicer), abi.encodePacked(GRANT_ROLES_SELECTOR));
        PackedUserOperation memory userOp = userOperation(singleExecution(ACCOUNT, nestedExecution));

        vm.prank(ACCOUNT);
        assertEq(policy.checkUserOpPolicy(POLICY_ID, userOp), 1);
    }

    function testRejectsReleaseToNonCanonicalTarget() public {
        PackedUserOperation memory userOp =
            userOperation(singleExecution(address(impostor), abi.encodePacked(RELEASE_SELECTOR)));

        vm.prank(ACCOUNT);
        assertEq(policy.checkUserOpPolicy(POLICY_ID, userOp), 1);
    }

    function testBatchRejectsOneNonCanonicalDynamicTarget() public {
        Execution[] memory calls = new Execution[](2);
        calls[0] = Execution({target: address(slicer), value: 0, callData: abi.encodePacked(RELEASE_SELECTOR)});
        calls[1] = Execution({target: address(impostor), value: 0, callData: abi.encodePacked(ADD_CURRENCIES_SELECTOR)});
        bytes32 mode =
            LibERC7579.encodeMode(LibERC7579.CALLTYPE_BATCH, LibERC7579.EXECTYPE_DEFAULT, bytes4(0), bytes22(0));
        PackedUserOperation memory userOp =
            userOperation(abi.encodeCall(IERC7579Account.execute, (mode, abi.encode(calls))));

        vm.prank(ACCOUNT);
        assertEq(policy.checkUserOpPolicy(POLICY_ID, userOp), 1);
    }

    function testRejectsDelegatecallMode() public {
        bytes32 mode =
            LibERC7579.encodeMode(LibERC7579.CALLTYPE_DELEGATECALL, LibERC7579.EXECTYPE_DEFAULT, bytes4(0), bytes22(0));
        PackedUserOperation memory userOp =
            userOperation(abi.encodeCall(IERC7579Account.execute, (mode, abi.encodePacked(address(slicer)))));

        vm.prank(ACCOUNT);
        assertEq(policy.checkUserOpPolicy(POLICY_ID, userOp), 1);
    }

    function testRejectsMalformedExecutionOffset() public {
        bytes memory callData =
            abi.encodePacked(IERC7579Account.execute.selector, bytes32(0), bytes32(type(uint256).max), bytes32(0));
        PackedUserOperation memory userOp = userOperation(callData);

        vm.prank(ACCOUNT);
        assertEq(policy.checkUserOpPolicy(POLICY_ID, userOp), 1);
    }

    function testRejectsEmptyBatch() public {
        Execution[] memory calls = new Execution[](0);
        bytes32 mode =
            LibERC7579.encodeMode(LibERC7579.CALLTYPE_BATCH, LibERC7579.EXECTYPE_DEFAULT, bytes4(0), bytes22(0));
        PackedUserOperation memory userOp =
            userOperation(abi.encodeCall(IERC7579Account.execute, (mode, abi.encode(calls))));

        vm.prank(ACCOUNT);
        assertEq(policy.checkUserOpPolicy(POLICY_ID, userOp), 1);
    }

    function testUninstalledPolicyFailsClosed() public {
        vm.prank(ACCOUNT);
        policy.onUninstall(abi.encodePacked(POLICY_ID));

        PackedUserOperation memory userOp =
            userOperation(singleExecution(address(slicer), abi.encodePacked(ADD_CURRENCIES_SELECTOR)));
        vm.prank(ACCOUNT);
        assertEq(policy.checkUserOpPolicy(POLICY_ID, userOp), 1);
    }

    function singleExecution(address target, bytes memory data) internal pure returns (bytes memory) {
        bytes32 mode =
            LibERC7579.encodeMode(LibERC7579.CALLTYPE_SINGLE, LibERC7579.EXECTYPE_DEFAULT, bytes4(0), bytes22(0));
        return abi.encodeCall(IERC7579Account.execute, (mode, abi.encodePacked(target, uint256(0), data)));
    }

    function userOperation(bytes memory callData) internal pure returns (PackedUserOperation memory) {
        return PackedUserOperation({
            sender: ACCOUNT,
            nonce: 0,
            initCode: "",
            callData: callData,
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: "",
            signature: ""
        });
    }
}
