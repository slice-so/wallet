// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {TimelockPolicy} from "../src/policies/TimelockPolicy.sol";

contract DeployTimelockPolicyScript is Script {
    bytes32 internal constant SALT = keccak256("slice.kernel.timelock-policy.v1");

    function run() external returns (address deployed) {
        deployed = computeAddress();
        if (deployed.code.length > 0) return deployed;

        vm.broadcast();
        address created = address(new TimelockPolicy{salt: SALT}());
        require(created == deployed, "TimelockPolicy deployed to unexpected address");
        deployed = created;
    }

    function computeAddress() public view returns (address) {
        bytes32 initCodeHash = keccak256(type(TimelockPolicy).creationCode);
        return vm.computeCreate2Address(SALT, initCodeHash);
    }
}
