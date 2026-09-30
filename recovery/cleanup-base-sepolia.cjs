'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {ethers}=require('ethers');

const RPC=process.env.RECOVERY_TESTNET_RPC||'https://sepolia.base.org';
const KEY=process.env.RECOVERY_TESTNET_PRIVATE_KEY||'';
const ACK=process.env.CP_RECOVERY_TESTNET_ONLY||'';
const MARKET='0x76f9660a8801f97a8F5D1AC2036b9a9C22495436';
const USDC='0x8A54f0e841CFCA5fA654912AF33cCD121D182311';
const ABI=[
  'function marketCount() view returns(uint256)',
  'function getMarket(uint256) view returns(tuple(uint256 id,address creator,string question,string category,string assetSymbol,uint256 targetPrice,bool targetAbove,uint256 expiresAt,uint256 yesPool,uint256 noPool,uint256 yieldAccrued,uint8 status,uint8 outcome,address resolver,uint8 currency))',
  'function getPosition(uint256,address) view returns(tuple(uint256 marketId,bool side,uint256 amount,bool claimed))',
  'function cancelMarket(uint256)',
  'function claimRefund(uint256)',
  'function marketEscrow(uint256) view returns(uint256)',
  'function totalEscrow(uint8) view returns(uint256)'
];
const ERC20=['function balanceOf(address) view returns(uint256)'];
function fail(m){throw Error(m)}
async function mined(tx,label){const r=await tx.wait();if(!r||r.status!==1)fail(label+' fallito');console.log(label+':',r.hash);return r;}
(async()=>{
  if(ACK!=='YES')fail('Imposta CP_RECOVERY_TESTNET_ONLY=YES');
  if(!/^0x[0-9a-fA-F]{64}$/.test(KEY))fail('Private key testnet mancante/non valida');
  const p=new ethers.JsonRpcProvider(RPC);
  const n=await p.getNetwork(); if(Number(n.chainId)!==84532)fail('RPC non Base Sepolia');
  const w=new ethers.Wallet(KEY,p);
  const m=new ethers.Contract(MARKET,ABI,w);
  const usdc=new ethers.Contract(USDC,ERC20,p);
  const count=await m.marketCount();
  const before=await usdc.balanceOf(w.address);
  const totalBefore=await m.totalEscrow(1);
  const actions=[];
  for(let i=0n;i<count;i++){
    const mk=await m.getMarket(i);
    const pos=await m.getPosition(i,w.address);
    if(Number(mk.currency)!==1)continue;
    if(Number(mk.status)===0){
      const r=await mined(await m.cancelMarket(i),'cancel market '+i);
      actions.push({marketId:i.toString(),action:'cancel',tx:r.hash});
    }
    const mk2=await m.getMarket(i);
    const pos2=await m.getPosition(i,w.address);
    if(Number(mk2.status)===3 && pos2.amount>0n && !pos2.claimed){
      const r=await mined(await m.claimRefund(i),'refund market '+i);
      actions.push({marketId:i.toString(),action:'refund',tx:r.hash,amount:pos2.amount.toString()});
    }
  }
  const after=await usdc.balanceOf(w.address);
  const totalAfter=await m.totalEscrow(1);
  const states=[];
  for(let i=0n;i<count;i++){
    const mk=await m.getMarket(i); const e=await m.marketEscrow(i); const pos=await m.getPosition(i,w.address);
    states.push({id:i.toString(),status:Number(mk.status),currency:Number(mk.currency),escrow:e.toString(),positionAmount:pos.amount.toString(),claimed:pos.claimed});
  }
  const out={chainId:84532,wallet:w.address,market:MARKET,before:{usdc:before.toString(),totalEscrowUSDC:totalBefore.toString()},after:{usdc:after.toString(),totalEscrowUSDC:totalAfter.toString()},actions,states,pass:totalAfter===0n};
  fs.writeFileSync(path.join(__dirname,'cleanup-base-sepolia.json'),JSON.stringify(out,null,2)+'\n',{flag:'wx'});
  if(totalAfter!==0n)fail('Escrow USDC residuo dopo cleanup: '+totalAfter);
  console.log('OK cleanup. totalEscrow USDC = 0');
})().catch(e=>{console.error('ERROR:',e.shortMessage||e.reason||e.message||e);process.exit(1)});
