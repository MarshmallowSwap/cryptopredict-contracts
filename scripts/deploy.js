const hre = require("hardhat");
const fs = require("fs");

const EXISTING = {
  CryptoPredictToken: "0x699304A362E41539d918E44188E1033999202cA0",
  PredictionMarket:   "0x160842b6b4b253F9c9EfA17FC0EfBB3c4B2c6c45",
  CPREDPresale:       "0xC9173e1C16Bc82D67f41Ffd025a89CC4f6C4Ac17",
  PresaleStaking:     "", // da deployare
};

// Presale dura 90 giorni dal deploy
const PRESALE_DURATION_DAYS = 90;
// 5M CPRED dal pool Ecosystem per i reward staking
const STAKING_REWARDS = hre.ethers.parseEther("5000000");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🚀 Deploying with:", deployer.address);
  console.log("   Balance:", hre.ethers.formatEther(
    await hre.ethers.provider.getBalance(deployer.address)), "ETH");

  const GAS = {
    gasLimit: 4_000_000,
    maxFeePerGas:         hre.ethers.parseUnits("0.15", "gwei"),
    maxPriorityFeePerGas: hre.ethers.parseUnits("0.05", "gwei"),
  };

  const tokenAddr   = EXISTING.CryptoPredictToken;
  const marketAddr  = EXISTING.PredictionMarket;
  const presaleAddr = EXISTING.CPREDPresale;
  let stakingAddr   = EXISTING.PresaleStaking;

  console.log("⏭  CryptoPredictToken:", tokenAddr);
  console.log("⏭  PredictionMarket:", marketAddr);
  console.log("⏭  CPREDPresale:", presaleAddr);

  // ── Deploy PresaleStaking ─────────────────────────────────────
  if (!stakingAddr) {
    console.log("\n📦 Deploying PresaleStaking...");
    const presaleEndsAt = Math.floor(Date.now() / 1000) + PRESALE_DURATION_DAYS * 86400;
    const Staking = await hre.ethers.getContractFactory("PresaleStaking");
    const staking = await Staking.deploy(tokenAddr, presaleEndsAt, GAS);
    await staking.waitForDeployment();
    stakingAddr = await staking.getAddress();
    console.log("✅ PresaleStaking:", stakingAddr);
    await sleep(3000);

    // Deposita 5M CPRED come reward pool (dall'allocazione Ecosystem)
    console.log("\n🔄 Depositing 5M CPRED rewards into staking pool...");
    const token = await hre.ethers.getContractAt("CryptoPredictToken", tokenAddr);

    // Prima approva
    const approveTx = await token.approve(stakingAddr, STAKING_REWARDS, GAS);
    await approveTx.wait();
    console.log("✅ Approved");
    await sleep(2000);

    // Poi deposita
    const stakingC = await hre.ethers.getContractAt("PresaleStaking", stakingAddr);
    const depositTx = await stakingC.depositRewards(STAKING_REWARDS, GAS);
    await depositTx.wait();
    console.log("✅ 5M CPRED depositati nel reward pool");
  } else {
    console.log("⏭  PresaleStaking già deployato:", stakingAddr);
  }

  // Salva
  const deployment = {
    network: "base-sepolia",
    chainId: 84532,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      CryptoPredictToken: tokenAddr,
      PredictionMarket:   marketAddr,
      CPREDPresale:       presaleAddr,
      PresaleStaking:     stakingAddr,
    }
  };

  fs.mkdirSync("./deployments", { recursive: true });
  fs.writeFileSync("./deployments/base-sepolia.json", JSON.stringify(deployment, null, 2));

  console.log("\n🎉 Deploy completato!");
  console.log("   PresaleStaking:", stakingAddr);
  console.log(`   https://sepolia.basescan.org/address/${stakingAddr}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(e => { console.error(e); process.exitCode = 1; });
