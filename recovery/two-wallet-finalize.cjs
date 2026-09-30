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
const ID=process.env.CP_TEST_MARKET_ID||'';
const MABI=[
 'function getMarket(uint256) view returns(tuple(uint256 id,address creator,string question,string category,string assetSymbol,uint256 targetPrice,bool targetAbove,uint256 expiresAt,uint256 yesPool,uint256 noPool,uint256 yieldAccrued,uint8 status,uint8 outcome,address resolver,uint8 currency))',
 'function getPosition(uint256,address) view returns(tuple(uint256 marketId,bool side,uint256 amount,bool claimed))',
 'function resolveMarket(uint256,bool)',
 'function claimPayout(uint256)',
 'function previewPayout(uint256,address) view returns(uint256 gross,uint256 net,uint256 creatorFee,uint256 protocolFee)',
 'function marketEscrow(uint256) view returns(uint256)',
 'function totalEscrow(uint8) view returns(uint256)',
 'function creatorFees(uint8,address) view returns(uint256)',
 'function protocolFees(uint8) view returns(uint256)'
];
const TABI=['function balanceOf(address) view returns(uint256)'];
function fail(m){throw Error(m)}
async function mined(tx,label){const r=await tx.wait();if(!r||r.status!==1)fail(label+' fallito');console.log(label+':',r.hash);return r;}
(async()=>{
 if(ACK!=='YES')fail('Imposta CP_RECOVERY_TESTNET_ONLY=YES');
 if(!/^\d+$/.test(ID))fail('CP_TEST_MARKET_ID mancante/non valido');
 for(const [n,k] of [['A',KEY_A],['B',KEY_B]]) if(!/^0x[0-9a-fA-F]{64}$/.test(k))fail('Private key '+n+' non valida');
 const p=new ethers.JsonRpcProvider(RPC); const net=await p.getNetwork();if(Number(net.chainId)!==84532)fail('Wrong chain');
 const a=new ethers.Wallet(KEY_A,p), b=new ethers.Wallet(KEY_B,p);
 const ma=new ethers.Contract(MARKET,MABI,a), mb=new ethers.Contract(MARKET,MABI,b);
 const u=new ethers.Contract(USDC,TABI,p); const id=BigInt(ID);
 let m=await ma.getMarket(id); const block=await p.getBlock('latest');
 if(block.timestamp<Number(m.expiresAt))fail('Mercato non ancora scaduto. Scade: '+new Date(Number(m.expiresAt)*1000).toISOString());
 const beforeA=await u.balanceOf(a.address), beforeB=await u.balanceOf(b.address);
 const quote=await mb.previewPayout(id,b.address);
 const rr=await mined(await ma.resolveMarket(id,false),'resolve NO');
 const quote2=await mb.previewPayout(id,b.address);
 if(quote2.net===0n)fail('Payout B zero dopo resolve');
 const cr=await mined(await mb.claimPayout(id),'claim wallet B');
 m=await ma.getMarket(id);
 const [afterA,afterB,esc,total,cf,pf,pb]=await Promise.all([
   u.balanceOf(a.address),u.balanceOf(b.address),ma.marketEscrow(id),ma.totalEscrow(1),
   ma.creatorFees(1,a.address),ma.protocolFees(1),ma.getPosition(id,b.address)
 ]);
 const expectedNet=ethers.parseUnits('196',6);
 if(afterB-beforeB!==expectedNet)fail('Payout netto B inatteso: '+ethers.formatUnits(afterB-beforeB,6));
 if(esc!==0n)fail('Escrow mercato non zero');
 if(cf!==ethers.parseUnits('2',6)||pf<ethers.parseUnits('2',6))fail('Fee inattese');
 if(!pb.claimed)fail('Posizione B non marcata claimed');
 const out={schemaVersion:1,purpose:'cryptopredict-recovery-two-wallet-final',
 generatedAt:new Date().toISOString(),chainId:84532,marketId:ID,walletA:a.address,walletB:b.address,
 transactions:{resolve:rr.hash,claimB:cr.hash},
 balances:{beforeA:beforeA.toString(),beforeB:beforeB.toString(),afterA:afterA.toString(),afterB:afterB.toString(),payoutB:(afterB-beforeB).toString()},
 accounting:{marketEscrow:esc.toString(),totalEscrowUSDC:total.toString(),creatorFeesA:cf.toString(),protocolFees:pf.toString()},
 pass:true};
 fs.writeFileSync(path.join(__dirname,'two-wallet-final.json'),JSON.stringify(out,null,2)+'\n',{flag:'wx'});
 console.log('OK final. Wallet B payout',ethers.formatUnits(afterB-beforeB,6),'USDC');
})().catch(e=>{console.error('ERROR:',e.shortMessage||e.reason||e.message||e);process.exit(1)});
