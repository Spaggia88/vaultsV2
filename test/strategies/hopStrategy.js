const {
  loadFixture,
  mine,
  time,
  reset,
} = require("@nomicfoundation/hardhat-network-helpers");
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants");
const { expect } = require("chai");
const { utils, BigNumber } = require("ethers");
const { ethers } = require("hardhat");

const { getEnv } = require("../../scripts/utils");

const IERC20_SOURCE = "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20";

const ARBITRUM_NODE = getEnv("ARBITRUM_NODE");
const ARBITRUM_FORK_BLOCK = getEnv("ARBITRUM_FORK_BLOCK");

// upgrades.silenceWarnings();

describe("JOEStrategy", function () {
  const TOKENS = {
    USDC: {
      address: "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8",
      whale: "0x62383739d68dd0f844103db8dfb05a7eded5bbe6",
      decimals: 6,
    },
  };

  async function deployContractAndSetVariables() {
    await reset(ARBITRUM_NODE, Number(ARBITRUM_FORK_BLOCK));
    const [deployer, governance, treasury, whale] = await ethers.getSigners();
    const USDC_ADDRESS = TOKENS.USDC.address;
    const want = await ethers.getContractAt(IERC20_SOURCE, USDC_ADDRESS);
    const name = "lvDCI";
    const symbol = "vDeFi";
    const Vault = await ethers.getContractFactory("Vault");
    const vault = await Vault.deploy();
    await vault.deployed();
    await vault["initialize(address,address,address,string,string)"](
      want.address,
      deployer.address,
      treasury.address,
      name,
      symbol
    );
    await vault["setDepositLimit(uint256)"](ethers.utils.parseEther("10000"));

    const Strategy = await ethers.getContractFactory("HopStrategy");

    const strategy = await upgrades.deployProxy(
      Strategy,
      [vault.address, deployer.address],
      {
        initializer: "initialize",
        kind: "transparent",
        constructorArgs: [vault.address],
        unsafeAllow: ["constructor"],
      }
    );
    await strategy.deployed();

    await vault["addStrategy(address,uint256,uint256,uint256,uint256)"](
      strategy.address,
      10000,
      0,
      ethers.utils.parseEther("10000"),
      0
    );

    await dealTokensToAddress(whale.address, TOKENS.USDC, "1000");
    await want
      .connect(whale)
      ["approve(address,uint256)"](vault.address, ethers.constants.MaxUint256);

    return {
      vault,
      deployer,
      want,
      whale,
      governance,
      treasury,
      strategy,
      want,
    };
  }

  async function dealTokensToAddress(
    address,
    dealToken,
    amountUnscaled = "100"
  ) {
    const token = await ethers.getContractAt(IERC20_SOURCE, dealToken.address);

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [dealToken.whale],
    });
    const tokenWhale = await ethers.getSigner(dealToken.whale);

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [TOKENS.ETH.whale],
    });
    const ethWhale = await ethers.getSigner(TOKENS.ETH.whale);

    await ethWhale.sendTransaction({
      to: tokenWhale.address,
      value: utils.parseEther("50"),
    });

    await token
      .connect(tokenWhale)
      .transfer(address, utils.parseUnits(amountUnscaled, dealToken.decimals));
  }

  it("should deploy strategy", async function () {
    const { vault, strategy } = await loadFixture(
      deployContractAndSetVariables
    );
    expect(await strategy.vault()).to.equal(vault.address);
    expect(await strategy.name()).to.equal("HopStrategy");
  });

  it("should get reasonable prices from oracle", async function () {
    const { strategy } = await loadFixture(deployContractAndSetVariables);
    const oneUnit = utils.parseEther("1");

    expect(Number(await strategy.LpToWant(oneUnit))).to.be.greaterThan(0);
    expect(Number(await strategy.HopToWant(oneUnit))).to.be.greaterThan(0);
  });

  it("should harvest with a profit", async function () {
    const { vault, strategy, whale, deployer, want } = await loadFixture(
      deployContractAndSetVariables
    );

    // Simulating whale depositing 1000 USDC into vault
    const balanceBefore = await want.balanceOf(whale.address);
    await vault.connect(whale)["deposit(uint256)"](balanceBefore);
    expect(await want.balanceOf(vault.address)).to.equal(balanceBefore);
    await strategy.connect(deployer).harvest();
    expect(await strategy.estimatedTotalAssets()).to.be.closeTo(
      balanceBefore,
      ethers.utils.parseUnits("100", 6)
    );
    // We are dropping some USDC to staking contract to simulate profit from JOE staking
    await dealTokensToAddress(whale.address, TOKENS.USDC, "1000000");
    const deposit = await want.balanceOf(whale.address);
    await ethers.provider.send("evm_increaseTime", [100 * 24 * 60 * 60]);

    await vault.connect(whale)["deposit(uint256)"](deposit);
    const tx = await strategy.connect(deployer).harvest();

    await tx.wait();
    // expect(Number(await strategy.rewardss())).to.be.greaterThan(0);
    await ethers.provider.send("evm_increaseTime", [50 * 24 * 60 * 60]);

    // Previous harvest indicated some profit and it was withdrawn to vault
    expect(Number(await want.balanceOf(vault.address))).to.be.greaterThan(0);
    // All profit from strategy was withdrawn to vault
    expect(Number(await want.balanceOf(strategy.address))).to.be.equal(0);

    // Vault reinvesing its profit back to strategy
    await strategy.connect(deployer).harvest();
    expect(Number(await strategy.estimatedTotalAssets())).to.be.greaterThan(
      Number(balanceBefore)
    );

    // Mining blocks for unlocking all profit so whale can withdraw
    mine(36000);

    await vault
      .connect(whale)
      ["withdraw(uint256,address,uint256)"](
        await vault.balanceOf(whale.address),
        whale.address,
        1000
      );
    expect(Number(await want.balanceOf(whale.address))).to.be.greaterThan(
      Number(balanceBefore)
    );
  });

  it("should withdraw requested amount", async function () {
    const { vault, strategy, whale, deployer, want } = await loadFixture(
      deployContractAndSetVariables
    );

    const balanceBefore = await want.balanceOf(whale.address);
    await vault.connect(whale)["deposit(uint256)"](balanceBefore);
    expect(await want.balanceOf(vault.address)).to.equal(balanceBefore);

    await strategy.connect(deployer).harvest();
    expect(await strategy.estimatedTotalAssets()).to.be.closeTo(
      balanceBefore,
      ethers.utils.parseUnits("100", 6)
    );
    await vault
      .connect(whale)
      ["withdraw(uint256,address,uint256)"](
        await vault.balanceOf(whale.address),
        whale.address,
        1000
      );
    expect(Number(await want.balanceOf(whale.address))).to.be.closeTo(
      balanceBefore,
      ethers.utils.parseUnits("100", 6)
    );

    const newWhaleBalance = await want.balanceOf(whale.address);
    await vault.connect(whale)["deposit(uint256)"](newWhaleBalance);
    expect(Number(await want.balanceOf(whale.address))).to.be.equal(0);

    await strategy.harvest();

    await dealTokensToAddress(strategy.address, TOKENS.USDC, "1000");
    await vault
      .connect(whale)
      ["withdraw(uint256,address,uint256)"](
        await vault.balanceOf(whale.address),
        whale.address,
        1000
      );
    expect(Number(await want.balanceOf(whale.address))).to.be.closeTo(
      newWhaleBalance,
      ethers.utils.parseUnits("100", 6)
    );
  });

  it("should withdraw with loss", async function () {
    const { vault, strategy, whale, deployer, want } = await loadFixture(
      deployContractAndSetVariables
    );

    const balanceBefore = await want.balanceOf(whale.address);
    await vault.connect(whale)["deposit(uint256)"](balanceBefore);
    expect(await want.balanceOf(vault.address)).to.equal(balanceBefore);

    await strategy.connect(deployer).harvest();
    expect(await strategy.estimatedTotalAssets()).to.be.closeTo(
      balanceBefore,
      ethers.utils.parseUnits("100", 6)
    );

    await strategy.connect(deployer).tend();

    await vault
      .connect(whale)
      ["withdraw(uint256,address,uint256)"](
        await vault.balanceOf(whale.address),
        whale.address,
        1000
      );
    expect(Number(await want.balanceOf(whale.address))).to.be.lessThan(
      Number(balanceBefore)
    );
    expect(Number(await want.balanceOf(whale.address))).to.be.closeTo(
      balanceBefore,
      ethers.utils.parseUnits("100", 6)
    );
  });

  it("should not withdraw with loss", async function () {
    const { vault, strategy, whale, deployer, want } = await loadFixture(
      deployContractAndSetVariables
    );

    const balanceBefore = await want.balanceOf(whale.address);
    await vault.connect(whale)["deposit(uint256)"](balanceBefore);
    expect(await want.balanceOf(vault.address)).to.equal(balanceBefore);

    await strategy.connect(deployer).harvest();
    expect(await strategy.estimatedTotalAssets()).to.be.closeTo(
      balanceBefore,
      ethers.utils.parseUnits("100", 6)
    );

    await strategy.connect(deployer).tend();

    await expect(
      vault
        .connect(whale)
        ["withdraw(uint256,address,uint256)"](
          await vault.balanceOf(whale.address),
          whale.address,
          0
        )
    ).to.be.reverted;
  });

  it("should emergency exit", async function () {
    const { vault, strategy, whale, deployer, want } = await loadFixture(
      deployContractAndSetVariables
    );

    const balanceBefore = await want.balanceOf(whale.address);
    await vault.connect(whale)["deposit(uint256)"](balanceBefore);
    expect(await want.balanceOf(vault.address)).to.equal(balanceBefore);

    await strategy.connect(deployer).harvest();
    expect(await strategy.estimatedTotalAssets()).to.be.closeTo(
      balanceBefore,
      ethers.utils.parseUnits("100", 6)
    );

    await strategy.setEmergencyExit();
    await strategy.harvest();

    expect(await strategy.estimatedTotalAssets()).to.equal(0);
    expect(Number(await want.balanceOf(vault.address))).to.be.closeTo(
      balanceBefore,
      ethers.utils.parseUnits("100", 6)
    );
  });

  it("should migrate", async function () {
    const { vault, strategy, whale, deployer, want } = await loadFixture(
      deployContractAndSetVariables
    );

    const balanceBefore = await want.balanceOf(whale.address);
    await vault.connect(whale)["deposit(uint256)"](balanceBefore);
    expect(await want.balanceOf(vault.address)).to.equal(balanceBefore);

    await strategy.connect(deployer).harvest();
    expect(await strategy.estimatedTotalAssets()).to.be.closeTo(
      balanceBefore,
      ethers.utils.parseUnits("100", 6)
    );

    const JOEStrategy = await ethers.getContractFactory("HopStrategy");
    const newStrategy = await upgrades.deployProxy(
      JOEStrategy,
      [vault.address, deployer.address],
      {
        initializer: "initialize",
        kind: "transparent",
        constructorArgs: [vault.address],
        unsafeAllow: ["constructor"],
      }
    );
    await newStrategy.deployed();

    const joeStaked = await strategy.balanceOfStaked();

    await vault["migrateStrategy(address,address)"](
      strategy.address,
      newStrategy.address
    );

    expect(await strategy.estimatedTotalAssets()).to.be.equal(0);
    expect(await newStrategy.estimatedTotalAssets()).to.be.closeTo(
      balanceBefore,
      ethers.utils.parseUnits("100", 6)
    );

    expect(Number(await want.balanceOf(strategy.address))).to.be.equal(0);
    expect(Number(await strategy.balanceOfStaked())).to.be.equal(0);
    expect(Number(await newStrategy.balanceOfStaked())).to.be.equal(0);

    expect(Number(await want.balanceOf(newStrategy.address))).to.be.closeTo(
      balanceBefore,
      ethers.utils.parseUnits("100", 6)
    );

    expect(Number(await strategy.balanceOfUnstaked())).to.be.equal(0);
    expect(Number(await newStrategy.balanceOfUnstaked())).to.be.closeTo(
      balanceBefore,
      ethers.utils.parseUnits("100", 6)
    );
    await newStrategy.harvest();

    expect(Number(await strategy.balanceOfStaked())).to.be.equal(0);
    expect(BigNumber.from(await newStrategy.balanceOfStaked())).to.be.closeTo(
      BigNumber.from(joeStaked),
      ethers.utils.parseUnits("1", 18)
    );
  });

  it("should withdraw on vault shutdown", async function () {
    const { vault, strategy, whale, deployer, want } = await loadFixture(
      deployContractAndSetVariables
    );

    const balanceBefore = await want.balanceOf(whale.address);
    await vault.connect(whale)["deposit(uint256)"](balanceBefore);
    expect(await want.balanceOf(vault.address)).to.equal(balanceBefore);

    await strategy.connect(deployer).harvest();
    expect(await strategy.estimatedTotalAssets()).to.be.closeTo(
      balanceBefore,
      ethers.utils.parseUnits("100", 6)
    );

    await vault["setEmergencyShutdown(bool)"](true);
    mine(1);
    await vault
      .connect(whale)
      ["withdraw(uint256,address,uint256)"](
        await vault.balanceOf(whale.address),
        whale.address,
        1000
      );
    expect(await want.balanceOf(whale.address)).to.be.closeTo(
      balanceBefore,
      ethers.utils.parseUnits("100", 6)
    );
  });
});
