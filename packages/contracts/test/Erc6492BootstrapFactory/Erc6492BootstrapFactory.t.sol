// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {LibZip} from "solady/utils/LibZip.sol";
import {Erc6492BootstrapFactory, KernelInstall} from "../../src/factories/Erc6492BootstrapFactory.sol";

contract KernelFactoryMock {
    address internal constant EXPECTED_ACCOUNT = 0x1111111111111111111111111111111111111111;

    function deploy(KernelInstall[] calldata, uint256) external payable returns (address account) {
        return EXPECTED_ACCOUNT;
    }
}

contract Erc6492BootstrapFactoryTest is Test {
    Erc6492BootstrapFactory internal bootstrap;

    function setUp() public {
        bootstrap = new Erc6492BootstrapFactory();
        vm.etch(bootstrap.KERNEL_FACTORY(), type(KernelFactoryMock).runtimeCode);
    }

    function testForwardsCompressedCanonicalKernelV4Deployment() public {
        KernelInstall[] memory packages = new KernelInstall[](1);
        packages[0] =
            KernelInstall({moduleType: 1, module: address(0x1234), moduleData: new bytes(2_000), internalData: hex""});
        bytes memory factoryData = abi.encodeCall(bootstrap.deploy, (packages, 7));
        bytes memory compressed = LibZip.cdCompress(factoryData);

        assertLt(compressed.length, factoryData.length / 10);
        (bool success, bytes memory result) = address(bootstrap).call(compressed);

        assertTrue(success);
        assertEq(abi.decode(result, (address)), 0x1111111111111111111111111111111111111111);
    }

    function testPinsCanonicalDeploymentAddress() public view {
        bytes32 salt = keccak256("slice.kernel.erc6492-bootstrap-factory.v2");
        assertEq(
            vm.computeCreate2Address(salt, keccak256(type(Erc6492BootstrapFactory).creationCode)),
            0x4765Db45368788d3e07A9F756c13D948C32e6ed9
        );
    }
}
