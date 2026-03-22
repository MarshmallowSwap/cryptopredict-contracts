const hre = require("hardhat");
const fs = require("fs");

const EXISTING = {
  CryptoPredictToken: "0x964037302F0DDEba0d5CCc05D0AadC9072441537",
  CPREDPresale:       "0x5aadc00ef73dC4f1F0906225F6805E2697Cde506",
  PresaleStaking:     "0x7a13e7eFC571A8ab2A4128E48fAff798164F4451",
  MockUSDC:           "0x5D9dce17290B38774D3cc4706C8f20c689C47419",
  MockUSDT:           "0x431096b64586c5b73f50d94D9FddF29ad9564E25",
  PredictionMarket:   "0x87B5060d985550a88aa43461a77D17335102ae46",  // v2 con resolver whitelist
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🚀 Deployer:", deployer.address);
  console.log("   Balance:", hre.ethers.formatEther(
    await hre.ethers.provider.getBalance(deployer.address)), "ETH\n");

  const GAS = {
    gasLimit: 5_000_000,
    maxFeePerGas:         hre.ethers.parseUnits("0.15", "gwei"),
    maxPriorityFeePerGas: hre.ethers.parseUnits("0.05", "gwei"),
  };

  const tokenAddr = EXISTING.CryptoPredictToken;
  let usdcAddr  = EXISTING.MockUSDC;
  let usdtAddr  = EXISTING.MockUSDT;
  let marketAddr = EXISTING.PredictionMarket;
  let presaleAddr = EXISTING.CPREDPresale;
  const stakingAddr = EXISTING.PresaleStaking;

  console.log("⏭  CryptoPredictToken:", tokenAddr);
  console.log("⏭  PresaleStaking:    ", stakingAddr);

  // ── Deploy Mock USDC ─────────────────────────────────────────
  if (!usdcAddr) {
    console.log("\n📦 Deploying Mock USDC...");
    const Mock = await hre.ethers.getContractFactory("MockERC20");
    const usdc = await Mock.deploy("USD Coin (Testnet)", "USDC", 6, GAS);
    await usdc.waitForDeployment();
    usdcAddr = await usdc.getAddress();
    console.log("✅ MockUSDC:", usdcAddr);
    await sleep(2000);
  } else {
    console.log("⏭  MockUSDC:", usdcAddr);
  }

  // ── Deploy Mock USDT ─────────────────────────────────────────
  if (!usdtAddr) {
    console.log("\n📦 Deploying Mock USDT...");
    const Mock = await hre.ethers.getContractFactory("MockERC20");
    const usdt = await Mock.deploy("Tether USD (Testnet)", "USDT", 6, GAS);
    await usdt.waitForDeployment();
    usdtAddr = await usdt.getAddress();
    console.log("✅ MockUSDT:", usdtAddr);
    await sleep(2000);
  } else {
    console.log("⏭  MockUSDT:", usdtAddr);
  }

  // ── Deploy PredictionMarket v2 ────────────────────────────────
  if (!marketAddr) {
    console.log("\n📦 Deploying PredictionMarket v2 (multi-currency)...");
    const Market = await hre.ethers.getContractFactory("PredictionMarket");
    const market = await Market.deploy(tokenAddr, usdcAddr, usdtAddr);
    await market.waitForDeployment();
    marketAddr = await market.getAddress();
    console.log("✅ PredictionMarket v2:", marketAddr);
    await sleep(3000);

    // Crea mercati demo
    console.log("\n🎯 Creating demo markets...");
    const now = Math.floor(Date.now() / 1000);
    const m1 = await market.createMarket(
      "BTC supererà $100,000 entro fine mese?", "crypto", "BTC",
      100000_00000000n, true, now + 30 * 86400,
      { ...GAS, value: hre.ethers.parseEther("0.005") }
    );
    await m1.wait();
    console.log("✅ Market 0: BTC $100K");
    await sleep(2000);

    const m2 = await market.createMarket(
      "ETF SOL approvato dalla SEC nel 2025?", "macro", "SOL",
      0n, true, now + 90 * 86400,
      { ...GAS, value: hre.ethers.parseEther("0.005") }
    );
    await m2.wait();
    console.log("✅ Market 1: SOL ETF");
    await sleep(2000);

    const m3 = await market.createMarket(
      "ETH supererà $3,000 entro questa settimana?", "crypto", "ETH",
      3000_00000000n, true, now + 7 * 86400,
      { ...GAS, value: hre.ethers.parseEther("0.005") }
    );
    await m3.wait();
    console.log("✅ Market 2: ETH $3K");
  } else {
    console.log("⏭  PredictionMarket v2:", marketAddr);
  }

  // ── Deploy CPREDPresale v2 ────────────────────────────────────
  if (!presaleAddr) {
    // Aggiungi team wallet come resolver autorizzato
    console.log("\n🔑 Aggiunta team wallet come resolver...");
    const addResolverTx = await market.addResolver("0x1902b780b12833C0a3bE28C5210db58409a7374E");
    await addResolverTx.wait();
    console.log("✅ Resolver aggiunto:", "0x1902b780b12833C0a3bE28C5210db58409a7374E");
    await sleep(2000);

    console.log("\n📦 Deploying CPREDPresale v2...");
    const Presale = await hre.ethers.getContractFactory("CPREDPresale");
    const presale = await Presale.deploy(tokenAddr, GAS);
    await presale.waitForDeployment();
    presaleAddr = await presale.getAddress();
    console.log("✅ CPREDPresale v2:", presaleAddr);
    await sleep(2000);

    const token = await hre.ethers.getContractAt("CryptoPredictToken", tokenAddr);
    const tx = await token.transfer(presaleAddr, hre.ethers.parseEther("45000000"), GAS);
    await tx.wait();
    console.log("✅ 45M CPRED trasferiti al presale");
  } else {
    console.log("⏭  CPREDPresale v2:", presaleAddr);
  }

  // Salva
  const deployment = {
    network: "base-sepolia", chainId: 84532,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      CryptoPredictToken: tokenAddr,
      PredictionMarket:   marketAddr,
      CPREDPresale:       presaleAddr,
      PresaleStaking:     stakingAddr,
      MockUSDC:           usdcAddr,
      MockUSDT:           usdtAddr,
    }
  };
  fs.mkdirSync("./deployments", { recursive: true });
  fs.writeFileSync("./deployments/base-sepolia.json", JSON.stringify(deployment, null, 2));

  console.log("\n🎉 Deploy completato!");
  console.log("   PredictionMarket v2:", marketAddr);
  console.log("   CPREDPresale v2:    ", presaleAddr);
  console.log("   MockUSDC:           ", usdcAddr);
  console.log("   MockUSDT:           ", usdtAddr);
  console.log(`\n   https://sepolia.basescan.org/address/${marketAddr}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(e => { console.error(e); process.exitCode = 1; });
