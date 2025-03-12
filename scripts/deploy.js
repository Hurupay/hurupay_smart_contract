const hre = require("hardhat");

async function main() {
  // USDC address on Base
  const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const initialFeePercentage = 10;

  const Hurupay = await hre.ethers.getContractFactory("Hurupay");
  console.log("Deploying Hurupay...");

  // Get the deployment transaction
  const hurupay = await Hurupay.deploy(usdcAddress, initialFeePercentage);
  const deploymentTx = hurupay.deploymentTransaction();
  console.log("Deployment transaction hash:", deploymentTx.hash);

  // Get the deployed contract address
  await hurupay.waitForDeployment();
  const hurupayAddress = await hurupay.getAddress();
  console.log("Hurupay deployed to:", hurupayAddress);

  // You can also get the transaction receipt after deployment
  const receipt = await deploymentTx.wait();
  console.log("Block number:", receipt.blockNumber);
  console.log("Gas used:", receipt.gasUsed.toString());
}

// Run the deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
