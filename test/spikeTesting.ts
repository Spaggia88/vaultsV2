import {
  time,
  loadFixture,
  impersonateAccount,
  reset,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import {
  ERC20,
  Vault,
  BaseStrategy,
  BeefyCompoundArb,
  BeefyCurveStrategy,
} from "../typechain-types";

import hre, { upgrades, ethers } from "hardhat";

const url = process.env.ARBITRUM_NODE || "";
const blockNumber = 218148028;
const chainId = 110;

const vaultAddress = "0x6318938F825F57d439B3a9E25C38F04EF97987D8";
const strategy1Address = "0xC4E7d7c15b8F5c2D77512460b84802D1D3693692";
const strategy2Address = "0x57c817253E0ee2B260468e81628BC6Ccdd67C23f";
const harvester = "0x3C2792d5Ea8f9C03e8E73738E9Ed157aeB4FeCBe";
const gov = "0x942f39555d430efb3230dd9e5b86939eff185f0a";
describe("Vault Spike Test", () => {
  async function upgradeVault() {
    await impersonateAccount(gov);
    const signer = await ethers.getSigner(gov);
    const VaultFactory = await ethers.getContractFactory("Vault", signer);
    await upgrades.upgradeProxy(vaultAddress, VaultFactory);
  }

  async function attachOmnichainVault() {
    // Deploy the Vault contract
    await reset(url, blockNumber);
    const [admin] = await ethers.getSigners();
    await impersonateAccount(harvester);
    const signer = await ethers.getSigner(harvester);

    await impersonateAccount(gov);
    const gov_sig = await ethers.getSigner(gov);
    const tx = await admin.sendTransaction({
      to: await signer.getAddress(),
      value: hre.ethers.parseEther("100"),
    });
    const tx2 = await admin.sendTransaction({
      to: await gov_sig.getAddress(),
      value: hre.ethers.parseEther("100"),
    });
    await tx.wait();

    const VaultFactory = await ethers.getContractFactory("Vault", signer);
    const VaultUntyped = VaultFactory.attach(vaultAddress);
    const vault = VaultUntyped as Vault;

    const StrategyFactory1 = await ethers.getContractFactory(
      "BeefyCompoundArb",
      signer
    );
    const StrategyUntyped = StrategyFactory1.attach(strategy1Address);
    const strategy1 = StrategyUntyped as BaseStrategy;

    const StrategyFactory2 = await ethers.getContractFactory(
      "BeefyCurveStrategy",
      signer
    );
    const StrategyUntyped2 = StrategyFactory2.attach(strategy2Address);
    const strategy2 = StrategyUntyped2 as BaseStrategy;
    await vault
      .connect(gov_sig)
      .setStrategist(chainId, strategy1Address, await admin.getAddress());
    await vault
      .connect(gov_sig)
      .setStrategist(chainId, strategy2Address, await admin.getAddress());
    await strategy1
      .connect(gov_sig)
      .setOperators(await admin.getAddress(), await admin.getAddress());
    await strategy2
      .connect(gov_sig)
      .setOperators(await admin.getAddress(), await admin.getAddress());
    await upgradeVault();
    return { vault, strategy1, strategy2, signer, admin };
  }

  describe("Spike test cases", function () {
    it("set fork and test spike", async function () {
      const { vault, strategy1, strategy2, signer, admin } = await loadFixture(
        attachOmnichainVault
      );

      let totalDebt = (
        await vault.connect(signer).strategies(chainId, strategy1Address)
      ).totalDebt;

      let debtOutstanding = await vault
        .connect(signer)
        .debtOutstanding(chainId, strategy1Address);
      let creditAvailable = await vault
        .connect(signer)
        .creditAvailable(chainId, strategy1Address);
      let debtRatio = (
        await vault.connect(signer).strategies(chainId, strategy1Address)
      ).debtRatio;
      console.log(totalDebt, debtOutstanding, creditAvailable, debtRatio);
      let signPayload = await strategy1.strategistSignMessageHash();
      console.log(
        "pps before harvest",
        await vault.connect(signer).pricePerShare()
      );
      let signature = await admin.signMessage(ethers.getBytes(signPayload));
      await strategy1
        .connect(admin)
        .harvest(
          totalDebt,
          debtOutstanding,
          creditAvailable,
          debtRatio,
          signature
        );
      console.log(
        "pps after harvest",
        await vault.connect(signer).pricePerShare()
      );

      totalDebt = (
        await vault.connect(signer).strategies(chainId, strategy2Address)
      ).totalDebt;

      debtOutstanding = await vault
        .connect(signer)
        .debtOutstanding(chainId, strategy2Address);
      creditAvailable = await vault
        .connect(signer)
        .creditAvailable(chainId, strategy2Address);
      debtRatio = (
        await vault.connect(signer).strategies(chainId, strategy2Address)
      ).debtRatio;
      console.log(totalDebt, debtOutstanding, creditAvailable, debtRatio);
      signPayload = await strategy2.strategistSignMessageHash();
      console.log(
        "pps before harvest",
        await vault.connect(signer).pricePerShare()
      );
      signature = await admin.signMessage(ethers.getBytes(signPayload));
      await strategy2
        .connect(admin)
        .harvest(
          totalDebt,
          debtOutstanding,
          creditAvailable,
          debtRatio,
          signature
        );
      console.log(
        "pps after harvest",
        await vault.connect(signer).pricePerShare()
      );
    });

    it("set fork and test spike", async function () {
      const { vault, strategy1, strategy2, signer, admin } = await loadFixture(
        attachOmnichainVault
      );

      let totalDebt = (
        await vault.connect(signer).strategies(chainId, strategy2Address)
      ).totalDebt;

      let debtOutstanding = await vault
        .connect(signer)
        .debtOutstanding(chainId, strategy2Address);
      let creditAvailable = await vault
        .connect(signer)
        .creditAvailable(chainId, strategy2Address);
      let debtRatio = (
        await vault.connect(signer).strategies(chainId, strategy2Address)
      ).debtRatio;
      console.log(totalDebt, debtOutstanding, creditAvailable, debtRatio);
      let signPayload = await strategy2.strategistSignMessageHash();
      console.log(
        "pps before harvest",
        await vault.connect(signer).pricePerShare()
      );
      let signature = await admin.signMessage(ethers.getBytes(signPayload));
      await strategy2
        .connect(admin)
        .harvest(
          totalDebt,
          debtOutstanding,
          creditAvailable,
          debtRatio,
          signature
        );
      console.log(
        "pps after harvest",
        await vault.connect(signer).pricePerShare()
      );
    });
  });
});
