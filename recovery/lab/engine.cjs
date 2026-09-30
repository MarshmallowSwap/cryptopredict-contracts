'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {validate} = require('./input.cjs');
async function createEngine() {
  const recovery = path.resolve(__dirname, '..');
  const repo = path.resolve(recovery, '..');
  const baseline = require('../validated-baseline.json');
  const verify = require('../tools/verified-baseline.cjs');
  verify.verifySources(repo, baseline);
  verify.validateLock(fs.readFileSync(path.join(recovery,'package-lock.json')), fs.readFileSync(path.join(recovery,'package.json')), baseline);
  if (process.env.HARDHAT_NETWORK && process.env.HARDHAT_NETWORK !== 'hardhat') throw Error('Solo Hardhat in memoria è consentito');
  process.env.HARDHAT_NETWORK = 'hardhat';
  process.env.HARDHAT_CONFIG = path.join(recovery,'hardhat.config.js');
  process.chdir(recovery);
  const hre = require('hardhat');
  if (hre.network.name !== 'hardhat' || Number(await hre.network.provider.send('eth_chainId')) !== 31337) throw Error('Rete locale non verificata');
  const artifact = path.join(recovery,'artifacts/contracts/PredictionMarket.sol/PredictionMarket.json');
  verify.verifyArtifact(fs.readFileSync(artifact), baseline);
  const {ethers} = hre;
  const signers = (await ethers.getSigners()).slice(0,3);
  const actors = ['Creatore','Alice','Bob'];
  const journal = [];
  const sessionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  let tail = Promise.resolve();
  let commands = 0;
  async function guard() {
    if (hre.network.name !== 'hardhat' || Number(await hre.network.provider.send('eth_chainId')) !== 31337) throw Error('Rete locale cambiata; operazione bloccata');
  }
  async function receipt(tx, label) {
    const r = await tx.wait();
    if (!r || r.status !== 1) throw Error('Transazione locale non riuscita');
    journal.push({sequence:journal.length+1, label, transactionHash:r.hash, blockNumber:r.blockNumber,
      status:r.status, from:r.from, to:r.to, contractAddress:r.contractAddress, gasUsed:r.gasUsed.toString()});
    return r;
  }
  async function deploy(name, args) {
    const c = await ethers.deployContract(name,args);
    await receipt(c.deploymentTransaction(),`deploy:${name}`);
    await c.waitForDeployment();
    if (await ethers.provider.getCode(c.target) === '0x') throw Error('Deployment locale senza codice');
    return c;
  }
  await guard();
  const cpred = await deploy('RecoveryTestToken',[18]);
  const usdc = await deploy('RecoveryTestToken',[6]);
  const usdt = await deploy('RecoveryTestToken',[6]);
  const market = await deploy('PredictionMarket',[cpred.target,usdc.target,usdt.target]);
  await receipt(await market.setMinCpredToCreate(0),'config:minCPRED=0');
  for (let i=0;i<signers.length;i++) {
    await receipt(await usdc.mint(signers[i].address,1000000000n),`mint-test-USDC:${actors[i]}`);
    await receipt(await usdc.connect(signers[i]).approve(market.target,1000000000n),`approve-test-USDC:${actors[i]}`);
  }
  if (await market.positionMarket() !== ethers.ZeroAddress || await market.presaleStaking() !== ethers.ZeroAddress) throw Error('Componente legacy collegato');
  const format = v => ethers.formatUnits(v,6);
  async function state() {
    await guard();
    const block = await ethers.provider.getBlock('latest');
    const count = Number(await market.marketCount());
    if (count > 20) throw Error('Limite mercati del laboratorio superato');
    const accounts = [];
    for (let i=0;i<signers.length;i++) accounts.push({id:i,name:actors[i],address:signers[i].address,balance:format(await usdc.balanceOf(signers[i].address))});
    const markets = [];
    for (let id=0;id<count;id++) {
      const m = await market.getMarket(id);
      const positions = [];
      for (const signer of signers) {
        const p = await market.getPosition(id,signer.address);
        const q = await market.previewPayout(id,signer.address);
        positions.push({side:p.side,amount:format(p.amount),claimed:p.claimed,net:format(q.net)});
      }
      markets.push({id,question:m.question,status:['open','closed','resolved','cancelled'][Number(m.status)],
        outcome:['unresolved','YES','NO'][Number(m.outcome)],expiresAt:Number(m.expiresAt),expired:block.timestamp>=Number(m.expiresAt),
        yes:format(m.yesPool),no:format(m.noPool),escrow:format(await market.marketEscrow(id)),positions});
    }
    const balance = await usdc.balanceOf(market.target);
    const book = await market.accountedBalance(1);
    if (balance < book) throw Error('Contabilità locale non coperta');
    return {mode:'hardhat-local',chainId:31337,sessionId,blockNumber:block.number,timestamp:block.timestamp,
      contract:market.target,token:usdc.target,asset:'USDC di prova',accounts,markets,
      accounting:{balance:format(balance),escrow:format(await market.totalEscrow(1)),creatorFees:format(await market.totalCreatorFees(1)),protocolFees:format(await market.protocolFees(1)),covered:balance>=book},
      journal:journal.slice(-80),initializedTransactions:11};
  }
  async function perform(raw) {
    const b = validate(raw);
    await guard();
    if (++commands > 500) throw Error('Limite sessione raggiunto; riavvia il laboratorio');
    const connected = market.connect(signers[b.actor]);
    if (b.action !== 'create' && b.marketId >= Number(await market.marketCount())) throw Error('Mercato inesistente');
    if (b.action === 'create') {
      if (Number(await market.marketCount()) >= 20) throw Error('Massimo 20 mercati locali');
      const block = await ethers.provider.getBlock('latest');
      await receipt(await connected.createMarket('Il valore di prova sarà almeno 100 alla scadenza?', 'crypto','TEST',10000000000n,true,block.timestamp+7200,1,100000000n),'create:seed-100-USDC-YES');
    } else if (b.action === 'bet') {
      await receipt(await connected.placeBetERC20(b.marketId,b.side,1,ethers.parseUnits(b.amount,6)),`bet:${actors[b.actor]}:${b.side?'YES':'NO'}`);
    } else if (b.action === 'expire') {
      const m = await market.getMarket(b.marketId);
      if (Number(m.status)!==0) throw Error('Mercato non aperto');
      const block = await ethers.provider.getBlock('latest');
      if (block.timestamp >= Number(m.expiresAt)) throw Error('Mercato già scaduto');
      await hre.network.provider.send('evm_setNextBlockTimestamp',[Number(m.expiresAt)]);
      await hre.network.provider.send('evm_mine');
      journal.push({sequence:journal.length+1,label:'clock:local-expiry',marketId:b.marketId,blockNumber:(await ethers.provider.getBlock('latest')).number});
    } else if (b.action === 'resolve') await receipt(await connected.resolveMarket(b.marketId,b.side),`resolve:${b.side?'YES':'NO'}`);
    else if (b.action === 'cancel') await receipt(await connected.cancelMarket(b.marketId),'cancel');
    else if (b.action === 'claim') await receipt(await connected.claimPayout(b.marketId),`claim:${actors[b.actor]}`);
    else if (b.action === 'refund') await receipt(await connected.claimRefund(b.marketId),`refund:${actors[b.actor]}`);
    return state();
  }
  function serialized(fn) {
    const job = tail.then(fn); tail = job.catch(()=>{}); return job;
  }
  return {state:()=>serialized(state), execute:b=>serialized(()=>perform(b)), report:()=>serialized(async()=>({
    schemaVersion:1,purpose:'local-browser-rehearsal',startedAt,generatedAt:new Date().toISOString(),
    validatedContractCommit:baseline.commit,lockSha256:baseline.lock.sha256,
    publicDeployment:false,supabaseConnected:false,realWalletConnected:false,
    state:await state(),receipts:journal.slice()}))};
}
module.exports = {createEngine};
