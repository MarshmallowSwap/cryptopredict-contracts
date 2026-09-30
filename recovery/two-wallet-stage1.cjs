'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {ethers}=require('ethers');

const RPC=process.env.RECOVERY_TESTNET_RPC||'https://sepolia.base.org';
const KEY_A=process.env.RECOVERY_TESTNET_PRIVATE_KEY_A||'';
const KEY_B=process.env.RECOVERY_TESTNET_PRIVATE_KEY_B||'';
const ACK=process.env.CP_RECOVERY_TESTNET_ONLY||'';
const MARKET='0x76f9660a8801f97a8F5D1AC2036b9a9C22495436';
const USDC='0x8A54f0e841CFCA5fA654912AF33cCD121D182311';
const MABI=[
 'function createMarket(string,string,string,uint256,bool,uint256,uint8,uint256) returns(uint256)',
 'function placeBetERC20(uint256,bool,uint8,uint256)',
 'function marketCount() view returns(uint256)',
 'function getMarket(uint256) view returns(tuple(uint256 id,address creator,string question,string category,string assetSymbol,uint256 targetPrice,bool targetAbove,uint256 expiresAt,uint256 yesPool,uint256 noPool,uint256 yieldAccrued,uint8 status,uint8 outcome,address resolver,uint8 currency))',
 'function getPosition(uint256,address) view returns(tuple(uint256 marketId,bool side,uint256 amount,bool claimed))',
 'function marketEscrow(uint256) view returns(uint256)',
 'function totalEscrow(uint8) view returns(uint256)'
];
const TABI=[
 'function faucet()',
 'function balanceOf(address) view returns(uint256)',
 'function approve(address,uint256) returns(bool)',
 'function allowance(address,address) view returns(uint256)'
];
function fail(m){throw Error(m)}
async function mined(tx,label){const r=await tx.wait();if(!r||r.status!==1)fail(label+' fallito');console.log(label+':',r.hash);return r;}
(async()=>{
 if(ACK!=='YES')fail('Imposta CP_RECOVERY_TESTNET_ONLY=YES');
 for(const [n,k] of [['A',KEY_A],['B',KEY_B]]) if(!/^0x[0-9a-fA-F]{64}$/.test(k))fail('Private key '+n+' non valida');
 const p=new ethers.JsonRpcProvider(RPC);
 const net=await p.getNetwork(); if(Number(net.chainId)!==84532)fail('RPC non Base Sepolia');
 const a=new ethers.Wallet(KEY_A,p), b=new ethers.Wallet(KEY_B,p);
 if(a.address.toLowerCase()===b.address.toLowerCase())fail('Wallet A e B devono essere diversi');
 const [ea,eb]=await Promise.all([p.getBalance(a.address),p.getBalance(b.address)]);
 if(ea===0n||eb===0n)fail('Entrambi i wallet devono avere ETH Base Sepolia per gas');
 const ma=new ethers.Contract(MARKET,MABI,a), mb=new ethers.Contract(MARKET,MABI,b);
 const ua=new ethers.Contract(USDC,TABI,a), ub=new ethers.Contract(USDC,TABI,b);
 let [ba,bb]=await Promise.all([ua.balanceOf(a.address),ub.balanceOf(b.address)]);
 console.log('Wallet A',a.address,'ETH',ethers.formatEther(ea),'USDC',ethers.formatUnits(ba,6));
 console.log('Wallet B',b.address,'ETH',ethers.formatEther(eb),'USDC',ethers.formatUnits(bb,6));
 const need=ethers.parseUnits('100',6);
 const txs={};
 if(bb<need){const r=await mined(await ub.faucet(),'faucet USDC wallet B');txs.faucetB=r.hash;bb=await ub.balanceOf(b.address);}
 if(ba<need){const r=await mined(await ua.faucet(),'faucet USDC wallet A');txs.faucetA=r.hash;ba=await ua.balanceOf(a.address);}
 if(ba<need||bb<need)fail('Saldo USDC insufficiente');
 if(await ua.allowance(a.address,MARKET)<need){const r=await mined(await ua.approve(MARKET,need),'approve A');txs.approveA=r.hash;}
 if(await ub.allowance(b.address,MARKET)<need){const r=await mined(await ub.approve(MARKET,need),'approve B');txs.approveB=r.hash;}
 const count=await ma.marketCount();
 const block=await p.getBlock('latest');
 const expires=BigInt(block.timestamp+3900); // 65 minutes, safely > 1h
 const cr=await mined(await ma.createMarket(
   'Recovery live test: il risultato scelto sarà NO?',
   'recovery','TEST',0n,false,expires,1,need
 ),'create market A YES 100');
 txs.create=cr.hash;
 const br=await mined(await mb.placeBetERC20(count,false,1,need),'wallet B NO 100');
 txs.betB=br.hash;
 const m=await ma.getMarket(count), pa=await ma.getPosition(count,a.address), pb=await ma.getPosition(count,b.address);
 const esc=await ma.marketEscrow(count);
 if(m.yesPool!==need||m.noPool!==need||esc!==need*2n)fail('Pool/escrow inattesi');
 if(!pa.side||pa.amount!==need||pb.side||pb.amount!==need)fail('Posizioni inattese');
 const out={
   schemaVersion:1,purpose:'cryptopredict-recovery-two-wallet-stage1',
   generatedAt:new Date().toISOString(),chainId:84532,market:MARKET,usdc:USDC,
   walletA:a.address,walletB:b.address,marketId:count.toString(),
   expiresAt:Number(m.expiresAt),expiresAtIso:new Date(Number(m.expiresAt)*1000).toISOString(),
   transactions:txs,
   state:{yesPool:m.yesPool.toString(),noPool:m.noPool.toString(),escrow:esc.toString(),
     positionA:{side:pa.side,amount:pa.amount.toString(),claimed:pa.claimed},
     positionB:{side:pb.side,amount:pb.amount.toString(),claimed:pb.claimed}},
   next:'After expiresAt, resolve NO with wallet A and claim payout with wallet B.'
 };
 fs.writeFileSync(path.join(__dirname,'two-wallet-stage1.json'),JSON.stringify(out,null,2)+'\n',{flag:'wx'});
 console.log('OK stage1. Market',count.toString(),'expires',out.expiresAtIso);
})().catch(e=>{console.error('ERROR:',e.shortMessage||e.reason||e.message||e);process.exit(1)});
