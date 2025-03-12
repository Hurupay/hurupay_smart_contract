const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");

describe("Hurupay", function () {
  // Fixture to deploy the contract and set up initial state
  async function deployHurupayFixture() {
    const [owner, user1, user2] = await ethers.getSigners();

    // Deploy a mock USDC token for testing
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy();

    // Deploy the Hurupay contract
    const Hurupay = await ethers.getContractFactory("Hurupay");
    const hurupay = await Hurupay.deploy(mockUSDC.target, 100); // 1% initial fee

    // Mint some USDC to users for testing
    await mockUSDC.mint(user1.address, ethers.parseUnits("1000", 6)); // 1000 USDC
    await mockUSDC.mint(user2.address, ethers.parseUnits("1000", 6)); // 1000 USDC

    // Approve Hurupay to spend USDC on behalf of users
    await mockUSDC.connect(user1).approve(hurupay.target, ethers.MaxUint256);
    await mockUSDC.connect(user2).approve(hurupay.target, ethers.MaxUint256);

    return { hurupay, mockUSDC, owner, user1, user2 };
  }

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { hurupay, owner } = await loadFixture(deployHurupayFixture);
      expect(await hurupay.owner()).to.equal(owner.address);
    });

    it("Should set the right USDC address", async function () {
      const { hurupay, mockUSDC } = await loadFixture(deployHurupayFixture);
      expect(await hurupay.usdc()).to.equal(mockUSDC.target);
    });

    it("Should set the right initial fee percentage", async function () {
      const { hurupay } = await loadFixture(deployHurupayFixture);
      expect(await hurupay.withdrawalFeePercentage()).to.equal(100); // 1%
    });
  });

  describe("Transfer", function () {
    it("Should transfer USDC and deduct fee", async function () {
      const { hurupay, mockUSDC, user1, user2 } = await loadFixture(
        deployHurupayFixture
      );

      const amount = ethers.parseUnits("100", 6); // 100 USDC
      const fee = await hurupay.calculateFee(amount);

      await expect(hurupay.connect(user1).transfer(user2.address, amount))
        .to.emit(hurupay, "Transfer")
        .withArgs(user1.address, user2.address, amount - fee, fee);

      // Check balances after transfer
      expect(await mockUSDC.balanceOf(user1.address)).to.equal(
        ethers.parseUnits("900", 6)
      ); // 1000 - 100
      expect(await mockUSDC.balanceOf(user2.address)).to.equal(
        ethers.parseUnits("1100", 6) - fee
      ); // 1000 + (100 - fee)
    });

    it("Should revert if sender has insufficient balance", async function () {
      const { hurupay, user1, user2 } = await loadFixture(deployHurupayFixture);

      const amount = ethers.parseUnits("2000", 6); // 2000 USDC (more than user1's balance)
      await expect(
        hurupay.connect(user1).transfer(user2.address, amount)
      ).to.be.revertedWith("Hurupay: insufficient balance");
    });

    it("Should revert if recipient is the zero address", async function () {
      const { hurupay, user1 } = await loadFixture(deployHurupayFixture);

      const amount = ethers.parseUnits("100", 6); // 100 USDC
      await expect(
        hurupay.connect(user1).transfer(ethers.ZeroAddress, amount)
      ).to.be.revertedWith("Hurupay: transfer to zero address");
    });
  });

  describe("Withdraw", function () {
    it("Should withdraw USDC and deduct fee", async function () {
      const { hurupay, mockUSDC, user1, user2 } = await loadFixture(
        deployHurupayFixture
      );

      const amount = ethers.parseUnits("100", 6); // 100 USDC
      const fee = await hurupay.calculateFee(amount);

      await expect(hurupay.connect(user1).withdraw(user2.address, amount))
        .to.emit(hurupay, "WithdrawalProcessed")
        .withArgs(user1.address, amount - fee, fee);

      // Check balances after withdrawal
      expect(await mockUSDC.balanceOf(user1.address)).to.equal(
        ethers.parseUnits("900", 6)
      ); // 1000 - 100
      expect(await mockUSDC.balanceOf(user2.address)).to.equal(
        ethers.parseUnits("1100", 6) - fee
      ); // 1000 + (100 - fee)
    });

    it("Should revert if sender has insufficient balance", async function () {
      const { hurupay, user1, user2 } = await loadFixture(deployHurupayFixture);

      const amount = ethers.parseUnits("2000", 6); // 2000 USDC (more than user1's balance)
      await expect(
        hurupay.connect(user1).withdraw(user2.address, amount)
      ).to.be.revertedWith("Hurupay: insufficient balance");
    });

    it("Should revert if recipient is the zero address", async function () {
      const { hurupay, user1 } = await loadFixture(deployHurupayFixture);

      const amount = ethers.parseUnits("100", 6); // 100 USDC
      await expect(
        hurupay.connect(user1).withdraw(ethers.ZeroAddress, amount)
      ).to.be.revertedWith("Hurupay: withdraw to zero address");
    });
  });

  describe("Admin Functions", function () {
    it("Should update fee percentage", async function () {
      const { hurupay, owner } = await loadFixture(deployHurupayFixture);

      const newFee = 200; // 2%
      await expect(hurupay.connect(owner).updateFee(newFee))
        .to.emit(hurupay, "FeeUpdated")
        .withArgs(100, newFee);

      expect(await hurupay.withdrawalFeePercentage()).to.equal(newFee);
    });

    it("Should revert if non-owner tries to update fee", async function () {
      const { hurupay, user1 } = await loadFixture(deployHurupayFixture);

      const newFee = 200; // 2%
      await expect(hurupay.connect(user1).updateFee(newFee)).to.be.revertedWith(
        "Hurupay: caller is not the owner"
      );
    });

    it("Should update minimum fee", async function () {
      const { hurupay, owner } = await loadFixture(deployHurupayFixture);

      const newMinimumFee = ethers.parseUnits("0.5", 6); // 0.5 USDC
      await expect(hurupay.connect(owner).updateMinimumFee(newMinimumFee))
        .to.emit(hurupay, "MinimumFeeUpdated")
        .withArgs(ethers.parseUnits("0.2", 6), newMinimumFee);

      expect(await hurupay.minimumFee()).to.equal(newMinimumFee);
    });
  });
});
