const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🚀 Deploying with:", deployer.address);
  console.log("   Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH");

  // ── 1. Deploy CPRED Token ──────────────────────────────────────────
  console.log("\n📦 Deploying CryptoPredictToken...");
  const Token = await hre.ethers.getContractFactory("CryptoPredictToken");
  const token = await Token.deploy(
    deployer.address,   // presale wallet
    deployer.address,   // liquidity wallet
    deployer.address,   // team wallet
    deployer.address,   // ecosystem wallet
  );
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("✅ CPRED Token:", tokenAddr);

  // ── 2. Deploy PredictionMarket ────────────────────────────────────
  console.log("\n📦 Deploying PredictionMarket...");
  const Market = await hre.ethers.getContractFactory("PredictionMarket");
  const market = await Market.deploy(tokenAddr);
  await market.waitForDeployment();
  const marketAddr = await market.getAddress();
  console.log("✅ PredictionMarket:", marketAddr);

  // ── 3. Deploy Presale ─────────────────────────────────────────────
  console.log("\n📦 Deploying CPREDPresale...");
  const Presale = await hre.ethers.getContractFactory("CPREDPresale");
  const presale = await Presale.deploy(tokenAddr);
  await presale.waitForDeployment();
  const presaleAddr = await presale.getAddress();
  console.log("✅ CPREDPresale:", presaleAddr);

  // ── 4. Transfer presale tokens to presale contract ────────────────
  console.log("\n🔄 Transferring presale allocation to presale contract...");
  const PRESALE_SUPPLY = hre.ethers.parseEther("45000000"); // 45M
  const tx = await token.transfer(presaleAddr, PRESALE_SUPPLY);
  await tx.wait();
  console.log("✅ 45M CPRED transferiti al presale contract");

  // ── 5. Create demo markets on testnet ─────────────────────────────
  console.log("\n🎯 Creating demo markets...");
  const now = Math.floor(Date.now() / 1000);

  const m1 = await market.createMarket(
    "BTC supererà $100,000 entro fine mese?",
    "crypto",
    "BTC",
    100000_00000000n,  // $100k in 1e8
    true,              // above
    now + 30 * 24 * 3600,  // 30 giorni
    { value: hre.ethers.parseEther("0.01") }
  );
  await m1.wait();
  console.log("✅ Market 0: BTC $100K");

  const m2 = await market.createMarket(
    "ETF SOL approvato dalla SEC nel 2025?",
    "macro",
    "SOL",
    0n,
    true,
    now + 90 * 24 * 3600,  // 90 giorni
    { value: hre.ethers.parseEther("0.02") }
  );
  await m2.wait();
  console.log("✅ Market 1: SOL ETF");

  const m3 = await market.createMarket(
    "ETH supererà $3,000 entro questa settimana?",
    "crypto",
    "ETH",
    3000_00000000n,
    true,
    now + 7 * 24 * 3600,   // 7 giorni
    { value: hre.ethers.parseEther("0.005") }
  );
  await m3.wait();
  console.log("✅ Market 2: ETH $3K");

  // ── 6. Salva indirizzi ────────────────────────────────────────────
  const deployment = {
    network: "base-sepolia",
    chainId: 84532,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      CryptoPredictToken: tokenAddr,
      PredictionMarket: marketAddr,
      CPREDPresale: presaleAddr,
    }
  };

  fs.writeFileSync(
    "./deployments/base-sepolia.json",
    JSON.stringify(deployment, null, 2)
  );

  console.log("\n🎉 Deploy completato!");
  console.log("   CPRED Token:      ", tokenAddr);
  console.log("   PredictionMarket: ", marketAddr);
  console.log("   CPREDPresale:     ", presaleAddr);
  console.log("\n📋 Verifica su BaseScan:");
  console.log(`   https://sepolia.basescan.org/address/${marketAddr}`);
  console.log("\n💾 Indirizzi salvati in deployments/base-sepolia.json");
  console.log("\n🔍 Per verificare i contratti:");
  console.log(`   npx hardhat verify --network base-sepolia ${tokenAddr} <arg1> <arg2> <arg3> <arg4>`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
