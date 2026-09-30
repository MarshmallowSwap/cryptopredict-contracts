'use strict';
// Actual local EVM rehearsal. Does not re-run or replace the 47 baseline tests.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createEngine}=require('./engine.cjs');
async function main(){
 const engine=await createEngine();
 async function action(action,actor,extra={}){return engine.execute({action,actor,requestId:crypto.randomUUID(),...extra});}
 let s=await engine.state();assert.equal(s.chainId,31337);assert.equal(s.accounts[1].balance,'1000.0');
 await action('create',0);await action('bet',1,{marketId:0,side:false,amount:'100'});
 await action('expire',0,{marketId:0});await action('resolve',0,{marketId:0,side:false});
 s=await action('claim',1,{marketId:0});
 assert.equal(s.accounts[1].balance,'1096.0');assert.equal(s.accounting.escrow,'0.0');
 assert.equal(s.accounting.creatorFees,'2.0');assert.equal(s.accounting.protocolFees,'2.0');
 await assert.rejects(()=>action('claim',1,{marketId:0}));
 await action('create',0);await action('bet',2,{marketId:1,side:true,amount:'25'});
 await action('cancel',0,{marketId:1});await action('refund',2,{marketId:1});
 s=await action('refund',0,{marketId:1});
 assert.equal(s.accounts[2].balance,'1000.0');assert.equal(s.accounts[0].balance,'900.0');
 assert.equal(s.accounting.balance,'4.0');assert.equal(s.accounting.escrow,'0.0');
 assert.equal(s.accounting.covered,true);
 const report=await engine.report();assert(report.receipts.filter(x=>x.transactionHash).every(x=>x.status===1));
 fs.writeFileSync(path.join(__dirname,'../lab-smoke-report.json'),JSON.stringify({status:'PASSED',
  scenarios:['create-bet-expire-resolve-claim','double-claim-denied','cancel-full-refunds'],...report},null,2)+'\n');
 console.log('LOCAL_LAB_SMOKE_PASSED: settlement, duplicate claim and refunds. No public-chain transaction.');
}
if(require.main===module)main().catch(e=>{console.error('LOCAL_LAB_SMOKE_FAILED:',e.message);process.exitCode=1;});
