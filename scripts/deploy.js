const hre = require("hardhat");
const fs = require("fs");

// Contratti esistenti — non rideploya
const EXISTING = {
  CryptoPredictToken: "0x699304A362E41539d918E44188E1033999202cA0",
  PredictionMarket:   "0x160842b6b4b253F9c9EfA17FC0EfBB3c4B2c6c45",
  PresaleStaking:     "0x5dB131b4e81297c7e200017dA54eC28820454491",
  CPREDPresale:       "", // v2 — rideploya
};

const STAKING_REWARDS = hre.ethers.parseEther("5000000"); // 5M già nel vecchio, usiamo solo il nuovo presale

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🚀 Deployer:", deployer.address);
  console.log("   Balance:", hre.ethers.formatEther(
    await hre.ethers.provider.getBalance(deployer.address)), "ETH\n");

  const GAS = {
    gasLimit: 4_000_000,
    maxFeePerGas:         hre.ethers.parseUnits("0.15", "gwei"),
    maxPriorityFeePerGas: hre.ethers.parseUnits("0.05", "gwei"),
  };

  const tokenAddr   = EXISTING.CryptoPredictToken;
  const marketAddr  = EXISTING.PredictionMarket;
  const stakingAddr = EXISTING.PresaleStaking;
  let   presaleAddr = EXISTING.CPREDPresale;

  console.log("⏭  CryptoPredictToken:", tokenAddr);
  console.log("⏭  PredictionMarket:  ", marketAddr);
  console.log("⏭  PresaleStaking:    ", stakingAddr);

  // ── Deploy CPREDPresale v2 ────────────────────────────────────
  if (!presaleAddr) {
    console.log("\n📦 Deploying CPREDPresale v2...");
    const Presale = await hre.ethers.getContractFactory("CPREDPresale");
    const presale = await Presale.deploy(tokenAddr, GAS);
    await presale.waitForDeployment();
    presaleAddr = await presale.getAddress();
    console.log("✅ CPREDPresale v2:", presaleAddr);
    await sleep(3000);

    // Trasferisci 45M CPRED al nuovo contratto presale
    console.log("\n🔄 Trasferimento 45M CPRED al nuovo presale...");
    const token = await hre.ethers.getContractAt("CryptoPredictToken", tokenAddr);
    const PRESALE_SUPPLY = hre.ethers.parseEther("45000000");
    const tx = await token.transfer(presaleAddr, PRESALE_SUPPLY, GAS);
    await tx.wait();
    console.log("✅ 45M CPRED trasferiti");
    await sleep(2000);

    // Verifica saldo
    const bal = await token.balanceOf(presaleAddr);
    console.log("   Saldo presale contract:", hre.ethers.formatEther(bal), "CPRED");

    // Verifica stage
    const stageInfo = await presale.getStageInfo();
    console.log("\n📊 Stage configurati:");
    console.log(`   Stage 1: $0.0${stageInfo[0].priceUsdCents} · ${hre.ethers.formatEther(stageInfo[0].allocation)} CPRED · 3 giorni`);
    console.log(`   Stage 2: $0.0${stageInfo[1].priceUsdCents} · ${hre.ethers.formatEther(stageInfo[1].allocation)} CPRED · 3 giorni`);
    console.log(`   Stage 3: $0.${stageInfo[2].priceUsdCents} · ${hre.ethers.formatEther(stageInfo[2].allocation)} CPRED · 3 giorni`);

    const endsAt = await presale.currentStageEndsAt();
    const endsDate = new Date(Number(endsAt) * 1000);
    console.log(`\n⏱  Stage 1 scade il: ${endsDate.toISOString()}`);
  } else {
    console.log("⏭  CPREDPresale già deployato:", presaleAddr);
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
  console.log("   CPREDPresale v2:", presaleAddr);
  console.log(`   https://sepolia.basescan.org/address/${presaleAddr}`);
  console.log("\n💡 Stage avanzano automaticamente dopo 3 giorni O sell-out");
  console.log("💡 I token rimasti per stage vengono bruciati automaticamente");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(e => { console.error(e); process.exitCode = 1; });
