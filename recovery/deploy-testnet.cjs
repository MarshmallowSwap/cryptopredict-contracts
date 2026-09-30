'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('ethers');

const EXPECTED_CHAIN = 84532;
const RPC = process.env.RECOVERY_TESTNET_RPC || 'https://sepolia.base.org';
const KEY = process.env.RECOVERY_TESTNET_PRIVATE_KEY || '';
const ACK = process.env.CP_RECOVERY_TESTNET_ONLY || '';

function fail(msg){ console.error('ERROR:', msg); process.exit(1); }
function artifact(name, file){
  const p=path.join(__dirname,'artifacts','contracts',file,name+'.json');
  if(!fs.existsSync(p)) fail('Artefatto mancante: '+p+'; esegui prima npm run compile');
  return JSON.parse(fs.readFileSync(p,'utf8'));
}
async function mined(tx,label){
  const r=await tx.wait();
  if(!r || r.status!==1) fail(label+' non riuscito');
  console.log(label, r.hash);
  return r;
}
(async()=>{
  if(ACK!=='YES') fail('Imposta CP_RECOVERY_TESTNET_ONLY=YES per confermare Base Sepolia testnet.');
  if(!/^0x[0-9a-fA-F]{64}$/.test(KEY)) fail('RECOVERY_TESTNET_PRIVATE_KEY mancante o non valida.');
  const provider=new ethers.JsonRpcProvider(RPC);
  const net=await provider.getNetwork();
  if(Number(net.chainId)!==EXPECTED_CHAIN) fail('RPC non è Base Sepolia (84532).');
  const wallet=new ethers.Wallet(KEY,provider);
  const bal=await provider.getBalance(wallet.address);
  if(bal===0n) fail('Wallet testnet senza ETH per gas.');
  console.log('Deployer testnet:',wallet.address,'ETH:',ethers.formatEther(bal));

  const tokenArt=artifact('RecoveryTestToken','test/RecoveryFixtures.sol');
  const marketArt=artifact('PredictionMarket','PredictionMarket.sol');
  const Token=new ethers.ContractFactory(tokenArt.abi,tokenArt.bytecode,wallet);
  const Market=new ethers.ContractFactory(marketArt.abi,marketArt.bytecode,wallet);

  const cpred=await Token.deploy(18); const cpredRec=await mined(cpred.deploymentTransaction(),'deploy CPRED test'); await cpred.waitForDeployment();
  const usdc=await Token.deploy(6); const usdcRec=await mined(usdc.deploymentTransaction(),'deploy USDC test'); await usdc.waitForDeployment();
  const usdt=await Token.deploy(6); const usdtRec=await mined(usdt.deploymentTransaction(),'deploy USDT test'); await usdt.waitForDeployment();
  const market=await Market.deploy(cpred.target,usdc.target,usdt.target);
  const marketRec=await mined(market.deploymentTransaction(),'deploy PredictionMarket recovery');
  await market.waitForDeployment();

  await mined(await market.setMinCpredToCreate(0),'set min CPRED = 0');
  const [pm,ps,mc,mu,mt]=await Promise.all([
    market.positionMarket(),market.presaleStaking(),market.cpredToken(),market.usdcToken(),market.usdtToken()
  ]);
  if(pm!==ethers.ZeroAddress || ps!==ethers.ZeroAddress) fail('Componente legacy collegato.');
  if(mc.toLowerCase()!==cpred.target.toLowerCase() || mu.toLowerCase()!==usdc.target.toLowerCase() || mt.toLowerCase()!==usdt.target.toLowerCase()) fail('Collateral mismatch.');
  for(const [name,address] of [['CPRED',cpred.target],['USDC',usdc.target],['USDT',usdt.target],['PredictionMarket',market.target]]){
    const code=await provider.getCode(address);
    if(code==='0x') fail('Bytecode mancante per '+name);
  }
  const output={
    schemaVersion:1,
    purpose:'cryptopredict-recovery-base-sepolia',
    generatedAt:new Date().toISOString(),
    chainId:EXPECTED_CHAIN,
    rpc:RPC,
    deployer:wallet.address,
    contracts:{market:market.target,cpred:cpred.target,usdc:usdc.target,usdt:usdt.target},
    legacy:{positionMarket:pm,presaleStaking:ps},
    deploymentTransactions:{market:marketRec.hash,cpred:cpredRec.hash,usdc:usdcRec.hash,usdt:usdtRec.hash},
    realFunds:false,
    note:'Testnet-only recovery deployment. Tokens are fixtures and have no monetary value.'
  };
  const out=path.join(__dirname,'recovery-deployment.base-sepolia.json');
  fs.writeFileSync(out,JSON.stringify(output,null,2)+'\n',{flag:'wx'});
  console.log('OK. Manifest:',out);
})().catch(e=>fail(e.shortMessage||e.message||String(e)));
