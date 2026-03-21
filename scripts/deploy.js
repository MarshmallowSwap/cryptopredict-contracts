const hre = require("hardhat");
const fs = require("fs");

// Indirizzi già deployati — saltiamo se presenti
const EXISTING = {
  CryptoPredictToken:  "0x699304A362E41539d918E44188E1033999202cA0",
  PredictionMarket:    "0x160842b6b4b253F9c9EfA17FC0EfBB3c4B2c6c45",
  CPREDPresale:        "",
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🚀 Deploying with:", deployer.address);
  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("   Balance:", hre.ethers.formatEther(bal), "ETH");

  // Gas settings per Base Sepolia
  const GAS = {
    gasLimit: 3_000_000,
    maxFeePerGas:         hre.ethers.parseUnits("0.15", "gwei"),
    maxPriorityFeePerGas: hre.ethers.parseUnits("0.05", "gwei"),
  };

  let tokenAddr   = EXISTING.CryptoPredictToken;
  let marketAddr  = EXISTING.PredictionMarket;
  let presaleAddr = EXISTING.CPREDPresale;

  // ── Token (già deployato) ──────────────────────────────────────────
  if (tokenAddr) {
    console.log("⏭  CryptoPredictToken già deployato:", tokenAddr);
  } else {
    console.log("\n📦 Deploying CryptoPredictToken...");
    const Token = await hre.ethers.getContractFactory("CryptoPredictToken");
    const token = await Token.deploy(
      deployer.address, deployer.address, deployer.address, deployer.address,
      GAS
    );
    await token.waitForDeployment();
    tokenAddr = await token.getAddress();
    console.log("✅ CPRED Token:", tokenAddr);
    await sleep(3000);
  }

  // ── PredictionMarket (già deployato) ─────────────────────────────
  if (marketAddr) {
    console.log("⏭  PredictionMarket già deployato:", marketAddr);
  } else {
    console.log("\n📦 Deploying PredictionMarket...");
    const Market = await hre.ethers.getContractFactory("PredictionMarket");
    const market = await Market.deploy(tokenAddr, GAS);
    await market.waitForDeployment();
    marketAddr = await market.getAddress();
    console.log("✅ PredictionMarket:", marketAddr);
    await sleep(3000);
  }

  // ── Presale (nuovo deploy) ────────────────────────────────────────
  if (presaleAddr) {
    console.log("⏭  CPREDPresale già deployato:", presaleAddr);
  } else {
    console.log("\n📦 Deploying CPREDPresale...");
    const Presale = await hre.ethers.getContractFactory("CPREDPresale");
    const presale = await Presale.deploy(tokenAddr, GAS);
    await presale.waitForDeployment();
    presaleAddr = await presale.getAddress();
    console.log("✅ CPREDPresale:", presaleAddr);
    await sleep(3000);
  }

  // ── Transfer tokens al presale contract ──────────────────────────
  const token = await hre.ethers.getContractAt("CryptoPredictToken", tokenAddr);
  const presaleBal = await token.balanceOf(presaleAddr);
  if (presaleBal === 0n) {
    console.log("\n🔄 Transferring 45M CPRED to presale contract...");
    const PRESALE_SUPPLY = hre.ethers.parseEther("45000000");
    const tx = await token.transfer(presaleAddr, PRESALE_SUPPLY, GAS);
    await tx.wait();
    console.log("✅ 45M CPRED trasferiti");
    await sleep(2000);
  } else {
    console.log("⏭  CPRED già trasferiti al presale");
  }

  // ── Crea mercati demo (solo se PredictionMarket è nuovo) ──────────
  const market = await hre.ethers.getContractAt("PredictionMarket", marketAddr);
  const mktCount = await market.marketCount();

  if (mktCount === 0n) {
    console.log("\n🎯 Creating demo markets...");
    const now = Math.floor(Date.now() / 1000);

    const m1 = await market.createMarket(
      "BTC supererà $100,000 entro fine mese?", "crypto", "BTC",
      100000_00000000n, true, now + 30 * 86400,
      { ...GAS, value: hre.ethers.parseEther("0.005") }
    );
    await m1.wait(); console.log("✅ Market 0: BTC $100K");
    await sleep(2000);

    const m2 = await market.createMarket(
      "ETF SOL approvato dalla SEC nel 2025?", "macro", "SOL",
      0n, true, now + 90 * 86400,
      { ...GAS, value: hre.ethers.parseEther("0.005") }
    );
    await m2.wait(); console.log("✅ Market 1: SOL ETF");
    await sleep(2000);

    const m3 = await market.createMarket(
      "ETH supererà $3,000 entro questa settimana?", "crypto", "ETH",
      3000_00000000n, true, now + 7 * 86400,
      { ...GAS, value: hre.ethers.parseEther("0.005") }
    );
    await m3.wait(); console.log("✅ Market 2: ETH $3K");
  } else {
    console.log(`⏭  ${mktCount} mercati già presenti`);
  }

  // ── Salva indirizzi ───────────────────────────────────────────────
  const deployment = {
    network: "base-sepolia",
    chainId: 84532,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      CryptoPredictToken: tokenAddr,
      PredictionMarket:   marketAddr,
      CPREDPresale:       presaleAddr,
    }
  };

  fs.mkdirSync("./deployments", { recursive: true });
  fs.writeFileSync("./deployments/base-sepolia.json", JSON.stringify(deployment, null, 2));

  console.log("\n🎉 Deploy completato!");
  console.log("   CPRED Token:      ", tokenAddr);
  console.log("   PredictionMarket: ", marketAddr);
  console.log("   CPREDPresale:     ", presaleAddr);
  console.log("\n📋 Verifica su BaseScan:");
  console.log(`   https://sepolia.basescan.org/address/${marketAddr}`);
  console.log(`   https://sepolia.basescan.org/address/${presaleAddr}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch((e) => { console.error(e); process.exitCode = 1; });
