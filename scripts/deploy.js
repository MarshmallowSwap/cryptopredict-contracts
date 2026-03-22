const hre = require("hardhat");
const fs = require("fs");

const EXISTING = {
  CryptoPredictToken: "0xdA65d2571D3166dC31F7F019D8b27cb525b262A2",
  CPREDPresale:       "0x892e088bB1aB86F0B7fbE0f2e70429C57419a425",
  PresaleStaking:     "0xf35c3623335B1a0a59c4ba9862a21631E912f0AB",
  MockUSDC:           "0xD56eFf0a7230e5FC88Aa1BE61A04Dea9Dfa40908",
  MockUSDT:           "0xfE20e95290a1D9dB2DaDdfdCd6f87047dC2DB61b",
  PredictionMarket:   "0x121668978cdf98672B1F60C2c1d64ce71A1CEFD9",
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
