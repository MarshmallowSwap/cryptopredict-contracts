'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {ethers}=require('ethers');

const RPC=process.env.RECOVERY_TESTNET_RPC||'https://sepolia.base.org';
const KEY=process.env.RECOVERY_TESTNET_PRIVATE_KEY||'';
const ACK=process.env.CP_RECOVERY_TESTNET_ONLY||'';
const CHAIN=84532;
const ADDR={
  market:'0x76f9660a8801f97a8F5D1AC2036b9a9C22495436',
  cpred:'0xEc937bF3123874115EDcBBE1b3802C95f572e8E5',
  usdc:'0x8A54f0e841CFCA5fA654912AF33cCD121D182311',
  usdt:'0xaBB48e1693Df04fb894843e52B239D5C5d0ab871'
};
const MARKET_ABI=[
  'function createMarket(string,string,string,uint256,bool,uint256,uint8,uint256) returns(uint256)',
  'function placeBetERC20(uint256,bool,uint8,uint256)',
  'function marketCount() view returns(uint256)',
  'function getMarket(uint256) view returns(tuple(uint256 id,address creator,string question,string category,string assetSymbol,uint256 targetPrice,bool targetAbove,uint256 expiresAt,uint256 yesPool,uint256 noPool,uint256 yieldAccrued,uint8 status,uint8 outcome,address resolver,uint8 currency))',
  'function getPosition(uint256,address) view returns(tuple(uint256 marketId,bool side,uint256 amount,bool claimed))',
  'function marketEscrow(uint256) view returns(uint256)',
  'function totalEscrow(uint8) view returns(uint256)',
  'function positionMarket() view returns(address)',
  'function presaleStaking() view returns(address)'
];
const TOKEN_ABI=[
  'function faucet()',
  'function balanceOf(address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)',
  'function allowance(address,address) view returns(uint256)'
];

function fail(m){throw Error(m)}
async function mined(tx,label){
  const r=await tx.wait();
  if(!r||r.status!==1)fail(label+' fallito');
  console.log(label+':',r.hash);
  return r;
}
(async()=>{
  if(ACK!=='YES')fail('Imposta CP_RECOVERY_TESTNET_ONLY=YES');
  if(!/^0x[0-9a-fA-F]{64}$/.test(KEY))fail('Private key testnet mancante/non valida');
  const provider=new ethers.JsonRpcProvider(RPC);
  const net=await provider.getNetwork();
  if(Number(net.chainId)!==CHAIN)fail('RPC non Base Sepolia');
  const wallet=new ethers.Wallet(KEY,provider);
  const ethBefore=await provider.getBalance(wallet.address);
  if(ethBefore===0n)fail('Wallet senza ETH Base Sepolia');

  const market=new ethers.Contract(ADDR.market,MARKET_ABI,wallet);
  const usdc=new ethers.Contract(ADDR.usdc,TOKEN_ABI,wallet);

  const [pm,ps]=await Promise.all([market.positionMarket(),market.presaleStaking()]);
  if(pm!==ethers.ZeroAddress||ps!==ethers.ZeroAddress)fail('Componenti legacy collegati');

  const before=await usdc.balanceOf(wallet.address);
  console.log('Wallet:',wallet.address);
  console.log('ETH before:',ethers.formatEther(ethBefore));
  console.log('USDC before:',ethers.formatUnits(before,6));

  // Faucet storico: 10,000 MockUSDC testnet.
  const faucetRec=await mined(await usdc.faucet(),'faucet MockUSDC');
  const afterFaucet=await usdc.balanceOf(wallet.address);
  if(afterFaucet<=before)fail('Faucet USDC non ha aumentato il saldo');

  const seed=ethers.parseUnits('100',6);
  const bet=ethers.parseUnits('25',6);
  const totalNeeded=seed+bet;
  if(afterFaucet<totalNeeded)fail('Saldo USDC insufficiente per test');

  let allowance=await usdc.allowance(wallet.address,ADDR.market);
  if(allowance<totalNeeded){
    await mined(await usdc.approve(ADDR.market,totalNeeded),'approve MockUSDC');
  }

  const countBefore=await market.marketCount();
  const block=await provider.getBlock('latest');
  const expires=BigInt(block.timestamp+7200);

  const createRec=await mined(await market.createMarket(
    'BTC sarà sopra il livello test del recovery alla scadenza?',
    'crypto','BTC',10000000000n,true,expires,1,seed
  ),'createMarket USDC');

  const countAfter=await market.marketCount();
  if(countAfter!==countBefore+1n)fail('marketCount non incrementato');
  const marketId=countBefore;

  await mined(await market.placeBetERC20(marketId,false,1,bet),'placeBet NO 25 USDC');

  const m=await market.getMarket(marketId);
  const pos=await market.getPosition(marketId,wallet.address);
  const escrow=await market.marketEscrow(marketId);
  const totalEscrow=await market.totalEscrow(1);
  const usdcAfter=await usdc.balanceOf(wallet.address);
  const ethAfter=await provider.getBalance(wallet.address);

  if(m.yesPool!==seed)fail('YES pool inatteso');
  if(m.noPool!==bet)fail('NO pool inatteso');
  if(escrow!==seed+bet)fail('Escrow mercato inatteso');
  if(pos.amount!==seed) {
    // creator already owns YES position; same wallet cannot bet opposite side.
    // This branch should never be reached because placeBetERC20(NO) should revert.
  }

  const out={
    schemaVersion:1,purpose:'cryptopredict-recovery-base-sepolia-smoke',
    generatedAt:new Date().toISOString(),chainId:CHAIN,wallet:wallet.address,
    contracts:ADDR,
    transactions:{faucet:faucetRec.hash,createMarket:createRec.hash},
    note:'The same creator wallet cannot bet the opposite side; a second wallet is required for a true two-sided market smoke test.',
    state:{
      marketId:marketId.toString(),
      yesPool:m.yesPool.toString(),
      noPool:m.noPool.toString(),
      escrow:escrow.toString(),
      totalEscrow:totalEscrow.toString(),
      walletUsdcBefore:before.toString(),
      walletUsdcAfterFaucet:afterFaucet.toString(),
      walletUsdcAfter:usdcAfter.toString(),
      walletEthBefore:ethBefore.toString(),
      walletEthAfter:ethAfter.toString()
    }
  };
  fs.writeFileSync(path.join(__dirname,'base-sepolia-smoke.json'),JSON.stringify(out,null,2)+'\n',{flag:'wx'});
  console.log('OK smoke manifest written');
})().catch(e=>{console.error('ERROR:',e.shortMessage||e.reason||e.message||e);process.exit(1)});
