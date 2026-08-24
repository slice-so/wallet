// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {AuthorizationRevocationRegistry} from "../src/registries/AuthorizationRevocationRegistry.sol";

contract DeployAuthorizationRevocationRegistryScript is Script {
    bytes32 internal constant SALT = keccak256("slice.kernel.authorization-revocation-registry.v1");

    function run() external returns (address deployed) {
        deployed = computeAddress();
        if (deployed.code.length > 0) return deployed;

        vm.broadcast();
        address created = address(new AuthorizationRevocationRegistry{salt: SALT}());
        require(created == deployed, "AuthorizationRevocationRegistry deployed to unexpected address");
        deployed = created;
    }

    function computeAddress() public view returns (address) {
        bytes32 initCodeHash = keccak256(type(AuthorizationRevocationRegistry).creationCode);
        return vm.computeCreate2Address(SALT, initCodeHash);
    }
}
