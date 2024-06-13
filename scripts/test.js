// const hre = require("hardhat");
const { ethers, upgrades } = require("hardhat");
const bridgeConfig = require("../constants/bridgeConfig.json");
const helpers = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const {
  impersonateAccount,
  mine,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");
const ABI = [
  "function estimatedTotalAssets() external view returns(uint256)",
  "function setManagementFee(uint256) external",
  "function swapUsdPlusToWant() external",
  "function balanceOf(address) external view returns(uint256)",
  "function adjustPosition(uint256)",
  "function harvest(uint256,uint256,uint256,uint256,bytes) external",
  "function migrate(address) external",
  "function owner() external view returns(address)",
  "function migrateStrategy(uint16,address,address) external",
  "function pricePerShare() external view returns(uint256)",
  "function depositLimit() external view returns(uint256)",
  "function setDepositLimit(uint256) external",
];
const { vaultChain } = require("../utils");

const TOKEN = "USDC";

async function main() {
  // const sigs = await ethers.getSigners();
  const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_NODE || "");
  console.log(1);
  let wallet = new hre.ethers.Wallet(
    process.env.DEPLOYER_PRIVATE_KEY || ""
  ).connect(provider);
  // await deployStrategy()

  // await impersonateAccount("0x942f39555D430eFB3230dD9e5b86939EFf185f0A");

  // const governance = await ethers.provider.getSigner(
  //   "0x942f39555D430eFB3230dD9e5b86939EFf185f0A"
  // );
  // await upgradeVault()

  // const tx2 = await sigs[0].sendTransaction({
  //   to: await governance.getAddress(),
  //   value: ethers.parseEther("300"),
  // });
  //0xC4E7d7c15b8F5c2D77512460b84802D1D3693692
  // await tx2.wait();
  // console.log("funds send");
  // const strategy = await ethers.getContractAt(
  //   ABI,
  //   "0xC4E7d7c15b8F5c2D77512460b84802D1D3693692"
  // );

  const vault = await ethers.getContractAt(
    ABI,
    "0x6318938F825F57d439B3a9E25C38F04EF97987D8"
  );

  // await upgradeVault();
  console.log(await vault.depositLimit());
  await vault.connect(wallet).setDepositLimit(500000000000);
  console.log(await vault.depositLimit());
  // console.log(await vault.pricePerShare());

  // await mine(1000);
  // await time.increase(1000)
  // console.log(await vault.owner())
  // console.log(await strategy.connect(governance).estimatedTotalAssets());
  // console.log(await vault.pricePerShare());
  // console.log(await strategy.connect(governance).estimatedTotalAssets());
  // console.log(
  //   await strategy
  //     .connect(governance)
  //     .harvest(
  //       BigInt("59732324365"),
  //       0,
  //       BigInt("8545474143"),
  //       3100,
  //       "0x2050de7ef13d946df93f44f55f918911159cb00a2548fea966b911359a44036c2d32d8a33a5d7baf797954587a81da38eb85bd1316de66af585cc35f5c67910a1b",
  //       {
  //         gasLimit: 30000000,
  //       }
  //     )
  // );
  // console.log("---------------------------------");
  // console.log(await vault.pricePerShare());
  // console.log(await strategy.connect(governance).estimatedTotalAssets());
  // console.log(await newStrategy.connect(governance).estimatedTotalAssets());
}

async function upgradeVault() {
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  await impersonateAccount("0x942f39555D430eFB3230dD9e5b86939EFf185f0A");

  // console.log("upgrading");
  const owner = await ethers.provider.getSigner(
    "0x942f39555D430eFB3230dD9e5b86939EFf185f0A"
  );
  // await proxy
  //   .connect(owner)
  //   .transferOwnership("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
  // console.log(await proxy.owner());
  const vault = await hre.ethers.getContractFactory("Vault", owner);
  console.log("upgrading");
  const upgraded = await hre.upgrades.upgradeProxy(
    "0x6318938F825F57d439B3a9E25C38F04EF97987D8",
    vault
  );
  console.log("upgrading");
  console.log(
    "Successfully upgraded implementation of",
    await upgraded.getAddress()
  );
}

async function deployStrategy() {
  const sigs = await hre.ethers.getSigners();

  const config = bridgeConfig["arbitrumOne"];
  const vaultConfig = bridgeConfig[vaultChain("arbitrumOne")];
  const HopStrategy = await ethers.getContractFactory("HopStrategy");
  const hopStrategy = await upgrades.deployProxy(
    HopStrategy,
    [
      config.lzEndpoint,
      config.strategist,
      config.harvester,
      config[TOKEN].address,
      vaultConfig.vault,
      vaultConfig.chainId,
      config.chainId,
      config.sgBridge,
      config.sgRouter,
    ],
    {
      initializer: "initialize",
      kind: "uups",
    }
  );
  console.log("done");
  await hopStrategy.waitForDeployment();

  console.log("HopStrategy deployed to:", await hopStrategy.getAddress());
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .then(() => {
    process.exitCode = 1;
  });
