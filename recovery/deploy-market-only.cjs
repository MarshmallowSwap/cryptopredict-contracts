'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {ethers}=require('ethers');

const RPC=process.env.RECOVERY_TESTNET_RPC||'https://sepolia.base.org';
const KEY=process.env.RECOVERY_TESTNET_PRIVATE_KEY||'';
const ACK=process.env.CP_RECOVERY_TESTNET_ONLY||'';
const CHAIN=84532;
const TOKENS={
  cpred:'0xEc937bF3123874115EDcBBE1b3802C95f572e8E5',
  usdc:'0x8A54f0e841CFCA5fA654912AF33cCD121D182311',
  usdt:'0xaBB48e1693Df04fb894843e52B239D5C5d0ab871'
};
const ERC20_ABI=[
  'function decimals() view returns(uint8)',
  'function totalSupply() view returns(uint256)',
  'function balanceOf(address) view returns(uint256)'
];

function fail(m){throw Error(m)}
function art(){
  const p=path.join(__dirname,'artifacts/contracts/PredictionMarket.sol/PredictionMarket.json');
  if(!fs.existsSync(p)) fail('Artefatto PredictionMarket mancante; esegui npm run compile');
  return JSON.parse(fs.readFileSync(p,'utf8'));
}
(async()=>{
  if(ACK!=='YES') fail('Imposta CP_RECOVERY_TESTNET_ONLY=YES');
  if(!/^0x[0-9a-fA-F]{64}$/.test(KEY)) fail('Private key testnet mancante/non valida');
  const provider=new ethers.JsonRpcProvider(RPC);
  const net=await provider.getNetwork();
  if(Number(net.chainId)!==CHAIN) fail('RPC non Base Sepolia');
  const checks={};
  for(const [name,address] of Object.entries(TOKENS)){
    const code=await provider.getCode(address);
    if(code==='0x') fail(name+' storico senza bytecode');
    const t=new ethers.Contract(address,ERC20_ABI,provider);
    const [dec,supply]=await Promise.all([t.decimals(),t.totalSupply()]);
    const expected=name==='cpred'?18:6;
    if(Number(dec)!==expected) fail(name+' decimals inattesi: '+dec);
    if(supply<=0n) fail(name+' totalSupply zero');
    checks[name]={address,codeBytes:(code.length-2)/2,decimals:Number(dec),totalSupply:supply.toString()};
  }
  const wallet=new ethers.Wallet(KEY,provider);
  const eth=await provider.getBalance(wallet.address);
  if(eth===0n) fail('Wallet senza ETH Base Sepolia');
  console.log('Deployer:',wallet.address,'ETH',ethers.formatEther(eth));
  console.log('Token storici verificati:',checks);

  const A=art();
  const F=new ethers.ContractFactory(A.abi,A.bytecode,wallet);
  const m=await F.deploy(TOKENS.cpred,TOKENS.usdc,TOKENS.usdt);
  const dep=await m.deploymentTransaction().wait();
  await m.waitForDeployment();
  if(!dep||dep.status!==1) fail('Deploy PredictionMarket fallito');

  const [pm,ps,cp,uc,ut]=await Promise.all([
    m.positionMarket(),m.presaleStaking(),m.cpredToken(),m.usdcToken(),m.usdtToken()
  ]);
  if(pm!==ethers.ZeroAddress||ps!==ethers.ZeroAddress) fail('Componente legacy collegato');
  if(cp.toLowerCase()!==TOKENS.cpred.toLowerCase()||uc.toLowerCase()!==TOKENS.usdc.toLowerCase()||ut.toLowerCase()!==TOKENS.usdt.toLowerCase()) fail('Collateral mismatch');
  const code=await provider.getCode(m.target); if(code==='0x') fail('PredictionMarket senza bytecode');

  const minTx=await m.setMinCpredToCreate(0); const minRec=await minTx.wait();
  if(!minRec||minRec.status!==1) fail('setMinCpredToCreate fallito');

  const manifest={
    schemaVersion:1,purpose:'cryptopredict-recovery-market-only-base-sepolia',
    generatedAt:new Date().toISOString(),chainId:CHAIN,rpc:RPC,deployer:wallet.address,
    reusedTokens:true,tokenChecks:checks,
    contracts:{market:m.target,cpred:TOKENS.cpred,usdc:TOKENS.usdc,usdt:TOKENS.usdt},
    legacy:{positionMarket:pm,presaleStaking:ps},
    transactions:{deploy:dep.hash,setMinCpredToCreate:minRec.hash},
    realFunds:false,note:'Base Sepolia recovery. Historical test tokens reused after live ERC20 checks.'
  };
  const out=path.join(__dirname,'recovery-deployment.base-sepolia.json');
  if(fs.existsSync(out)) fail('Manifest già esistente: usa una cartella pulita');
  fs.writeFileSync(out,JSON.stringify(manifest,null,2)+'\n');
  console.log('OK PredictionMarket:',m.target);
  console.log('Manifest:',out);
})().catch(e=>{console.error('ERROR:',e.shortMessage||e.message||e);process.exit(1)});
