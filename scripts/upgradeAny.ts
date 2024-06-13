// const hre = require("hardhat");
import hre from "hardhat";

async function main() {
  const TARGET_ADDRESS = "0x6318938F825F57d439B3a9E25C38F04EF97987D8";
  const TARGET_STRATEGY = "Vault";
  let provider = new hre.ethers.JsonRpcProvider(
    process.env.ARBITRUM_NODE || ""
  );
  let wallet = new hre.ethers.Wallet(
    process.env.DEPLOYER_PRIVATE_KEY || ""
  ).connect(provider);
  console.log(await wallet.getAddress());
  const TargetContract = await hre.ethers.getContractFactory(
    TARGET_STRATEGY,
    wallet
  );

  const upgraded = await hre.upgrades.upgradeProxy(
    TARGET_ADDRESS,
    TargetContract
  );

  console.log(
    "Successfully upgraded implementation of",
    await upgraded.getAddress()
  );

  await hre.run("verify:verify", {
    address: await upgraded.getAddress(),
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
