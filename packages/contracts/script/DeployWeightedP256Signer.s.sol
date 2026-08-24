// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {WeightedP256Signer} from "../src/signers/WeightedP256Signer.sol";

contract DeployWeightedP256SignerScript is Script {
    bytes32 internal constant SALT = keccak256("slice.kernel.weighted-p256-signer.v1");

    function run() external returns (address deployed) {
        deployed = computeAddress();
        if (deployed.code.length > 0) return deployed;

        vm.broadcast();
        address created = address(new WeightedP256Signer{salt: SALT}());
        require(created == deployed, "WeightedP256Signer deployed to unexpected address");
        deployed = created;
    }

    function computeAddress() public view returns (address) {
        return vm.computeCreate2Address(SALT, keccak256(type(WeightedP256Signer).creationCode));
    }
}
