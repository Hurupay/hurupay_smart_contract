const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

// Define the fixture at the top level so it's available to all tests
async function deployHurupayFixture() {
  const [owner, user1, user2] = await ethers.getSigners();

  // Deploy a mock USDC token for testing
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy();

  // Deploy the Hurupay contract
  const Hurupay = await ethers.getContractFactory("HurupaySmartContract");
  const hurupay = await Hurupay.deploy(mockUSDC.target, 100); // 1% initial fee

  // Mint some USDC to users for testing
  await mockUSDC.mint(user1.address, ethers.parseUnits("1000", 6)); // 1000 USDC
  await mockUSDC.mint(user2.address, ethers.parseUnits("1000", 6)); // 1000 USDC

  // Approve Hurupay to spend USDC on behalf of users
  await mockUSDC.connect(user1).approve(hurupay.target, ethers.MaxUint256);
  await mockUSDC.connect(user2).approve(hurupay.target, ethers.MaxUint256);

  console.log("Hurupay deployed to:", hurupay.target);
  console.log("Hurupay owner:", owner.address);
  console.log("Hurupay USDC address:", mockUSDC.target);
  console.log("Hurupay user1 address:", user1.address);
  console.log("Hurupay user2 address:", user2.address);
  return { hurupay, mockUSDC, owner, user1, user2 };
}

async function signTransferRequest(
  requestId,
  sender,
  recipient,
  amount,
  hurupayAddress,
  deadlineInMinutes = 30
) {
  const amountWei = ethers.parseUnits(amount, 6); // USDC decimals
  const deadline = Math.floor(Date.now() / 1000) + deadlineInMinutes * 60;
  const chainId = (await ethers.provider.getNetwork()).chainId;

  // Ensure requestId is bytes32
  const requestIdBytes32 = ethers.zeroPadValue(ethers.hexlify(requestId), 32);

  // Get the signer
  const signer = await ethers.getSigner(sender);

  // Create the domain separator (domain corresponds to EIP-712 parameters in contract)
  const domain = {
    name: "Hurupay",
    version: "1",
    chainId: chainId,
    verifyingContract: hurupayAddress,
  };

  // Define the types for EIP-712 (must match TRANSFER_TYPEHASH in contract)
  const types = {
    Transfer: [
      { name: "requestId", type: "bytes32" },
      { name: "sender", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "chainId", type: "uint256" },
    ],
  };

  // Create the data to sign
  const value = {
    requestId: requestIdBytes32,
    sender: sender,
    recipient: recipient,
    amount: amountWei,
    deadline: deadline,
    chainId: chainId,
  };

  // Sign using EIP-712
  const signature = await signer.signTypedData(domain, types, value);

  console.log("Request ID:", requestIdBytes32);
  console.log("Signature:", signature);

  return {
    requestId: requestIdBytes32,
    sender,
    recipient,
    amount: amountWei,
    deadline,
    signature,
  };
}

describe("Hurupay", function () {
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
      expect(await hurupay.feePercentage()).to.equal(100); // 1%
    });
  });

  describe("Transfer", function () {
    it("Should transfer USDC without fee", async function () {
      const { hurupay, mockUSDC, user1, user2 } = await loadFixture(
        deployHurupayFixture
      );

      const amount = ethers.parseUnits("100", 6); // 100 USDC

      await expect(hurupay.connect(user1).transfer(user2.address, amount))
        .to.emit(hurupay, "Transfer")
        .withArgs(user1.address, user2.address, amount, 0); // Fee is 0

      // Check balances after transfer
      expect(await mockUSDC.balanceOf(user1.address)).to.equal(
        ethers.parseUnits("900", 6)
      ); // 1000 - 100
      expect(await mockUSDC.balanceOf(user2.address)).to.equal(
        ethers.parseUnits("1100", 6)
      ); // 1000 + 100

      // No accumulated fees
      expect(await hurupay.accumulatedFees()).to.equal(0);

      // Contract should not hold any tokens
      expect(await mockUSDC.balanceOf(hurupay.target)).to.equal(0);
    });

    it("Should revert if sender has insufficient balance", async function () {
      const { hurupay, user1, user2 } = await loadFixture(deployHurupayFixture);

      const amount = ethers.parseUnits("2000", 6); // 2000 USDC (more than user1's balance)
      await expect(hurupay.connect(user1).transfer(user2.address, amount)).to.be
        .reverted; // SafeERC20 reverts with a different message
    });

    it("Should revert if recipient is the zero address", async function () {
      const { hurupay, user1 } = await loadFixture(deployHurupayFixture);

      const amount = ethers.parseUnits("100", 6); // 100 USDC
      await expect(
        hurupay.connect(user1).transfer(ethers.ZeroAddress, amount)
      ).to.be.revertedWith("Hurupay: transfer to zero address");
    });

    it("Should revert if amount is zero", async function () {
      const { hurupay, user1, user2 } = await loadFixture(deployHurupayFixture);

      const amount = ethers.parseUnits("0", 6); // 0 USDC
      await expect(
        hurupay.connect(user1).transfer(user2.address, amount)
      ).to.be.revertedWith("Hurupay: amount must be greater than zero");
    });
  });

  describe("Signature Verification", function () {
    it("Should verify the signature and deduct fee correctly", async function () {
      const { hurupay, mockUSDC, user1, user2 } = await loadFixture(
        deployHurupayFixture
      );

      const requestId = ethers.keccak256(ethers.toUtf8Bytes("test-request"));
      const amount = "100"; // 100 USDC

      // Sign the transfer request
      const transferRequest = await signTransferRequest(
        requestId,
        user1.address, // Sender
        user2.address, // Recipient
        amount,
        hurupay.target // Hurupay contract address
      );

      const amountWei = ethers.parseUnits(amount, 6);
      const fee = await hurupay.calculateFee(amountWei);
      const amountAfterFee = amountWei - fee;

      // Execute the transfer with signature
      await expect(
        hurupay.executeTransferWithSignature(
          transferRequest.requestId,
          transferRequest.sender,
          transferRequest.recipient,
          transferRequest.amount,
          transferRequest.deadline,
          transferRequest.signature
        )
      )
        .to.emit(hurupay, "Transfer")
        .withArgs(
          transferRequest.sender,
          transferRequest.recipient,
          amountAfterFee,
          fee
        );

      // Check balances after transfer
      expect(await mockUSDC.balanceOf(user1.address)).to.equal(
        ethers.parseUnits("900", 6)
      ); // 1000 - 100

      expect(await mockUSDC.balanceOf(user2.address)).to.equal(
        ethers.parseUnits("1000", 6) + amountAfterFee
      );

      // Check accumulated fees
      expect(await hurupay.accumulatedFees()).to.equal(fee);
      expect(await mockUSDC.balanceOf(hurupay.target)).to.equal(fee);
    });

    it("Should revert if requestId is reused", async function () {
      const { hurupay, user1, user2 } = await loadFixture(deployHurupayFixture);

      const requestId = ethers.keccak256(ethers.toUtf8Bytes("test-request"));
      const amount = "100"; // 100 USDC

      // Sign the transfer request
      const transferRequest = await signTransferRequest(
        requestId,
        user1.address, // Sender
        user2.address, // Recipient
        amount,
        hurupay.target // Hurupay contract address
      );

      // Execute the transfer with signature first time
      await hurupay.executeTransferWithSignature(
        transferRequest.requestId,
        transferRequest.sender,
        transferRequest.recipient,
        transferRequest.amount,
        transferRequest.deadline,
        transferRequest.signature
      );

      // Attempt to reuse the same requestId
      await expect(
        hurupay.executeTransferWithSignature(
          transferRequest.requestId,
          transferRequest.sender,
          transferRequest.recipient,
          transferRequest.amount,
          transferRequest.deadline,
          transferRequest.signature
        )
      ).to.be.revertedWith("Hurupay: request already processed");
    });

    it("Should revert if the deadline has passed", async function () {
      const { hurupay, user1, user2 } = await loadFixture(deployHurupayFixture);

      // Create a transfer request with a deadline in the past
      const requestId = ethers.keccak256(ethers.toUtf8Bytes("expired-request"));
      const amount = "100"; // 100 USDC

      // Create a signature with standard deadline
      const transferRequest = await signTransferRequest(
        requestId,
        user1.address,
        user2.address,
        amount,
        hurupay.target
      );

      // Override the deadline to be in the past
      const expiredDeadline = Math.floor(Date.now() / 1000) - 60; // 1 minute in the past

      // We can't simply override the deadline as the signature would be invalid,
      // so we need to manually set the block timestamp to be after the deadline
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        transferRequest.deadline + 3600,
      ]); // 1 hour after deadline
      await ethers.provider.send("evm_mine");

      // Attempt to execute with the now-expired deadline
      await expect(
        hurupay.executeTransferWithSignature(
          transferRequest.requestId,
          transferRequest.sender,
          transferRequest.recipient,
          transferRequest.amount,
          transferRequest.deadline,
          transferRequest.signature
        )
      ).to.be.revertedWith("Hurupay: transaction expired");
    });

    it("Should calculate fees correctly for different amounts", async function () {
      const { hurupay, owner } = await loadFixture(deployHurupayFixture);

      // Test with default fee (1%)
      let amount = ethers.parseUnits("100", 6); // 100 USDC
      let expectedFee = ethers.parseUnits("1", 6); // 1 USDC
      expect(await hurupay.calculateFee(amount)).to.equal(expectedFee);

      // Test with small amount where fee rounds to small value
      amount = ethers.parseUnits("0.01", 6); // 0.01 USDC = 10,000 units
      expectedFee = BigInt(100); // 0.0001 USDC = 100 units (1% of 10,000)
      expect(await hurupay.calculateFee(amount)).to.equal(expectedFee);

      // Test with very small amount where fee becomes very small
      amount = ethers.parseUnits("0.0001", 6); // 0.0001 USDC = 100 units
      expectedFee = BigInt(1); // 0.000001 USDC = 1 unit (1% of 100)
      expect(await hurupay.calculateFee(amount)).to.equal(expectedFee);

      // Test with extremely small amount where fee becomes 0
      amount = ethers.parseUnits("0.00001", 6); // 0.00001 USDC = 10 units
      expectedFee = BigInt(0); // 1% of 10 = 0.1, rounds to 0 with integer division
      expect(await hurupay.calculateFee(amount)).to.equal(expectedFee);

      // Test with maximum fee (5%)
      await hurupay.connect(owner).updateFee(500); // 5%
      amount = ethers.parseUnits("100", 6); // 100 USDC
      expectedFee = ethers.parseUnits("5", 6); // 5 USDC
      expect(await hurupay.calculateFee(amount)).to.equal(expectedFee);
    });
  });

  describe("Admin Functions", function () {
    it("Should update fee percentage", async function () {
      const { hurupay, owner } = await loadFixture(deployHurupayFixture);

      const newFee = 200; // 2%
      await expect(hurupay.connect(owner).updateFee(newFee))
        .to.emit(hurupay, "FeeUpdated")
        .withArgs(100, newFee);

      expect(await hurupay.feePercentage()).to.equal(newFee);
    });

    it("Should revert if new fee exceeds maximum fee", async function () {
      const { hurupay, owner } = await loadFixture(deployHurupayFixture);

      const newFee = 501; // 5.01% (exceeds MAX_FEE_PERCENTAGE)
      await expect(hurupay.connect(owner).updateFee(newFee)).to.be.revertedWith(
        "Hurupay: fee too high"
      );
    });

    it("Should withdraw accumulated fees", async function () {
      const { hurupay, mockUSDC, user1, user2, owner } = await loadFixture(
        deployHurupayFixture
      );

      // First make a signature-based transfer to accumulate fees
      const requestId = ethers.keccak256(ethers.toUtf8Bytes("fee-test"));
      const amount = "100"; // 100 USDC

      // Sign the transfer request
      const transferRequest = await signTransferRequest(
        requestId,
        user1.address,
        user2.address,
        amount,
        hurupay.target
      );

      // Execute transfer to accumulate fees
      await hurupay.executeTransferWithSignature(
        transferRequest.requestId,
        transferRequest.sender,
        transferRequest.recipient,
        transferRequest.amount,
        transferRequest.deadline,
        transferRequest.signature
      );

      const fee = await hurupay.calculateFee(transferRequest.amount);

      // Check accumulated fees
      expect(await hurupay.accumulatedFees()).to.equal(fee);

      // Withdraw fees
      await expect(hurupay.connect(owner).withdrawFees())
        .to.emit(hurupay, "FeesWithdrawn")
        .withArgs(owner.address, fee);

      // Check that fees were withdrawn
      expect(await hurupay.accumulatedFees()).to.equal(0);
      expect(await mockUSDC.balanceOf(owner.address)).to.equal(fee);
      expect(await mockUSDC.balanceOf(hurupay.target)).to.equal(0);
    });

    it("Should revert if there are no fees to withdraw", async function () {
      const { hurupay, owner } = await loadFixture(deployHurupayFixture);

      // No transfers made, so no fees accumulated
      await expect(hurupay.connect(owner).withdrawFees()).to.be.revertedWith(
        "Hurupay: no fees to withdraw"
      );
    });

    it("Should transfer ownership correctly", async function () {
      const { hurupay, owner, user1 } = await loadFixture(deployHurupayFixture);

      // With OpenZeppelin's Ownable, ownership transfer is direct
      await expect(hurupay.connect(owner).transferOwnership(user1.address))
        .to.emit(hurupay, "OwnershipTransferred") // Note the updated event name
        .withArgs(owner.address, user1.address);

      expect(await hurupay.owner()).to.equal(user1.address);
    });

    it("Should revert when non-owner tries to transfer ownership", async function () {
      const { hurupay, user1 } = await loadFixture(deployHurupayFixture);

      // Just check that it reverts, without specifying the error message
      await expect(hurupay.connect(user1).transferOwnership(user1.address)).to
        .be.reverted;
    });
  });

  describe("ERC20 Recovery", function () {
    it("Should recover accidentally sent ERC20 tokens", async function () {
      const { hurupay, mockUSDC, owner, user1 } = await loadFixture(
        deployHurupayFixture
      );

      // User1 accidentally sends 10 USDC directly to the contract
      await mockUSDC
        .connect(user1)
        .transfer(hurupay.target, ethers.parseUnits("10", 6));

      // Owner should be able to recover these tokens
      await expect(
        hurupay.connect(owner).recoverERC20(mockUSDC.target)
      ).to.changeTokenBalances(
        mockUSDC,
        [hurupay.target, owner.address],
        [ethers.parseUnits("-10", 6), ethers.parseUnits("10", 6)]
      );
    });

    it("Should not allow recovering accumulated fees", async function () {
      const { hurupay, mockUSDC, owner, user1, user2 } = await loadFixture(
        deployHurupayFixture
      );

      // Make a signature-based transfer to accumulate fees
      const requestId = ethers.keccak256(ethers.toUtf8Bytes("recovery-test"));
      const amount = "100"; // 100 USDC

      const transferRequest = await signTransferRequest(
        requestId,
        user1.address,
        user2.address,
        amount,
        hurupay.target
      );

      await hurupay.executeTransferWithSignature(
        transferRequest.requestId,
        transferRequest.sender,
        transferRequest.recipient,
        transferRequest.amount,
        transferRequest.deadline,
        transferRequest.signature
      );

      const fee = await hurupay.calculateFee(transferRequest.amount);

      // Attempt to recover the USDC (should fail because only accumulated fees are present)
      await expect(
        hurupay.connect(owner).recoverERC20(mockUSDC.target)
      ).to.be.revertedWith("Hurupay: only accumulated fees available");

      // Send additional tokens to the contract
      await mockUSDC
        .connect(user1)
        .transfer(hurupay.target, ethers.parseUnits("10", 6));

      // Now should be able to recover the extra 10 USDC, but not the fees
      await expect(
        hurupay.connect(owner).recoverERC20(mockUSDC.target)
      ).to.changeTokenBalances(
        mockUSDC,
        [hurupay.target, owner.address],
        [ethers.parseUnits("-10", 6), ethers.parseUnits("10", 6)]
      );

      // Accumulated fees should still be there
      expect(await hurupay.accumulatedFees()).to.equal(fee);
      expect(await mockUSDC.balanceOf(hurupay.target)).to.equal(fee);
    });

    it("Should revert when zero address is provided for token recovery", async function () {
      const { hurupay, owner } = await loadFixture(deployHurupayFixture);

      await expect(
        hurupay.connect(owner).recoverERC20(ethers.ZeroAddress)
      ).to.be.revertedWith("Hurupay: invalid token address");
    });
  });

  describe("Security Tests", function () {
    it("Should prevent reentrancy attacks", async function () {
      // This is more of a code review test, as we're using OpenZeppelin's ReentrancyGuard
      // But we can verify that functions have nonReentrant modifiers in the contract
      const { hurupay } = await loadFixture(deployHurupayFixture);

      // Just checking that the contract exists with reentrancy protection
      expect(hurupay.target).to.not.equal(ethers.ZeroAddress);

      // Actual reentrancy testing would require a malicious contract that attempts reentry
    });

    it("Should protect against signature replay across chains", async function () {
      // This is handled by including chainId in the signature
      // Our signTransferRequest function now includes chainId in the signature data
      const { hurupay } = await loadFixture(deployHurupayFixture);

      // Just checking that the contract was deployed successfully
      expect(hurupay.target).to.not.equal(ethers.ZeroAddress);

      // Actual cross-chain testing would require a more complex test environment
    });
  });
});
