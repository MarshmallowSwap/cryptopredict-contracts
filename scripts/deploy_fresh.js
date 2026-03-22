const hre = require("hardhat");
const fs  = require("fs");
const path = require("path");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("\n🚀 DEPLOY FRESH — CryptoPredict Testnet");
  console.log("   Deployer:", deployer.address);
  console.log("   Balance: ", hre.ethers.formatEther(bal), "ETH\n");

  const r = {};

  // ── 1. MockUSDC ──────────────────────────────────────────────────
  console.log("📦 [1/6] MockUSDC...");
  const Mock = await hre.ethers.getContractFactory("MockERC20");
  const usdc = await Mock.deploy("USD Coin (Testnet)", "USDC", 6);
  await usdc.waitForDeployment();
  r.MockUSDC = await usdc.getAddress();
  console.log("✅ MockUSDC:", r.MockUSDC);
  await sleep(2000);

  // ── 2. MockUSDT ──────────────────────────────────────────────────
  console.log("📦 [2/6] MockUSDT...");
  const usdt = await Mock.deploy("Tether USD (Testnet)", "USDT", 6);
  await usdt.waitForDeployment();
  r.MockUSDT = await usdt.getAddress();
  console.log("✅ MockUSDT:", r.MockUSDT);
  await sleep(2000);

  // ── 3. CPRED — minta tutto al deployer per distribuire sotto ─────
  console.log("📦 [3/6] CryptoPredictToken...");
  const Token = await hre.ethers.getContractFactory("CryptoPredictToken");
  const token = await Token.deploy(
    deployer.address,  // presale   45M → deployer, poi trasferiamo
    deployer.address,  // liquidity 30M
    deployer.address,  // team      15M
    deployer.address   // ecosystem 10M
  );
  await token.waitForDeployment();
  r.CryptoPredictToken = await token.getAddress();
  console.log("✅ CryptoPredictToken:", r.CryptoPredictToken);
  await sleep(2000);

  // ── 4. PredictionMarket v2 ───────────────────────────────────────
  console.log("📦 [4/6] PredictionMarket v2...");
  const Market = await hre.ethers.getContractFactory("PredictionMarket");
  const market = await Market.deploy(r.CryptoPredictToken, r.MockUSDC, r.MockUSDT);
  await market.waitForDeployment();
  r.PredictionMarket = await market.getAddress();
  console.log("✅ PredictionMarket v2:", r.PredictionMarket);
  await sleep(2000);

  // Aggiungi team wallet come resolver
  const TEAM_WALLET = "0x1902b780b12833C0a3bE28C5210db58409a7374E";
  const addTx = await market.addResolver(TEAM_WALLET);
  await addTx.wait();
  console.log("✅ Resolver:", TEAM_WALLET);
  await sleep(1500);

  // Crea mercati demo
  console.log("\n🎯 Mercati demo...");
  const now = Math.floor(Date.now() / 1000);
  const demos = [
    ["BTC supererà $100,000 entro fine mese?",     "crypto", "BTC", now + 30*86400],
    ["ETF SOL approvato dalla SEC nel 2025?",       "macro",  "SOL", now + 90*86400],
    ["ETH supererà $3,000 entro questa settimana?", "crypto", "ETH", now + 7*86400],
  ];
  for (const [q, cat, asset, exp] of demos) {
    // Currency.ETH = 0, liquidityAmount = 0 (usa msg.value per ETH)
    const tx = await market.createMarket(q, cat, asset, 0n, true, BigInt(exp), 0, 0n,
      { value: hre.ethers.parseEther("0.0025") });
    await tx.wait();
    console.log("✅", q.slice(0, 40) + "...");
    await sleep(1500);
  }

  // ── 5. CPREDPresale v2 ───────────────────────────────────────────
  console.log("\n📦 [5/6] CPREDPresale v2...");
  const Presale = await hre.ethers.getContractFactory("CPREDPresale");
  const presale = await Presale.deploy(r.CryptoPredictToken);
  await presale.waitForDeployment();
  r.CPREDPresale = await presale.getAddress();
  console.log("✅ CPREDPresale v2:", r.CPREDPresale);
  await sleep(2000);

  // Finanzia presale con 45M CPRED subito dopo il deploy
  console.log("💰 Trasferimento 45M CPRED alla presale...");
  const PRESALE_SUPPLY = hre.ethers.parseEther("45000000");
  const txP = await token.transfer(r.CPREDPresale, PRESALE_SUPPLY);
  await txP.wait();
  await sleep(4000); // attendi che il nodo indicizzi il blocco
  const presaleBal = await token.balanceOf(r.CPREDPresale);
  console.log("✅ Presale finanziata:", hre.ethers.formatEther(presaleBal), "CPRED");
  if (presaleBal === 0n) console.log("⚠️  Balance ancora 0 — normale su testnet, il tx è confermato");
  await sleep(2000);

  // ── 6. PresaleStaking ────────────────────────────────────────────
  console.log("\n📦 [6/6] PresaleStaking...");
  const Staking = await hre.ethers.getContractFactory("PresaleStaking");
  const presaleEndsAt = Math.floor(Date.now() / 1000) + 90 * 86400; // 90 giorni
  const staking = await Staking.deploy(r.CryptoPredictToken, presaleEndsAt);
  await staking.waitForDeployment();
  r.PresaleStaking = await staking.getAddress();
  console.log("✅ PresaleStaking:", r.PresaleStaking);
  await sleep(2000);

  // Collega PresaleStaking al PredictionMarket per il check CPRED
  const setStakingTx = await market.setPresaleStaking(r.PresaleStaking);
  await setStakingTx.wait();
  console.log("✅ PresaleStaking collegato al Market");
  await sleep(1500);

  // Finanzia staking con 5M CPRED
  console.log("💰 Trasferimento 5M CPRED allo staking...");
  const STAKING_SUPPLY = hre.ethers.parseEther("5000000");
  const txS = await token.transfer(r.PresaleStaking, STAKING_SUPPLY);
  await txS.wait();
  await sleep(4000);
  const stakingBal = await token.balanceOf(r.PresaleStaking);
  console.log("✅ Staking finanziato:", hre.ethers.formatEther(stakingBal), "CPRED");

  // ── SUMMARY ──────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(55));
  console.log("🎉 DEPLOY COMPLETATO!");
  console.log("=".repeat(55));
  console.log("   CryptoPredictToken:", r.CryptoPredictToken);
  console.log("   PredictionMarket v2:", r.PredictionMarket);
  console.log("   CPREDPresale v2:    ", r.CPREDPresale);
  console.log("   PresaleStaking:     ", r.PresaleStaking);
  console.log("   MockUSDC:           ", r.MockUSDC);
  console.log("   MockUSDT:           ", r.MockUSDT);
  console.log("=".repeat(55));
  console.log("BaseScan:", "https://sepolia.basescan.org/address/" + r.PredictionMarket);

  // Salva su file
  const out = { network: "base-sepolia", timestamp: new Date().toISOString(), ...r };
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync("deployments/base-sepolia.json", JSON.stringify(out, null, 2));
  console.log("\n📄 Salvato in deployments/base-sepolia.json");
}

main().catch(console.error);
