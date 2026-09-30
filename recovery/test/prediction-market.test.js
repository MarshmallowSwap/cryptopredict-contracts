'use strict';
const { expect } = require('chai');
const { ethers, network, artifacts } = require('hardhat');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const currencies = [{ id: 0, name: 'ETH', decimals: 18 }, { id: 1, name: 'USDC', decimals: 6 },
  { id: 2, name: 'USDT', decimals: 6 }, { id: 3, name: 'CPRED', decimals: 18 }];
const amount = (n, c) => ethers.parseUnits(String(n), c.decimals);

beforeEach(async () => { await network.provider.send('hardhat_reset'); });

async function fixture(c = currencies[0], noReturn = false) {
  const [owner, alice, bob, carol, sink, sink2] = await ethers.getSigners();
  async function deploy(name, args = []) {
    const result = await ethers.deployContract(name, args);
    await result.waitForDeployment();
    return result;
  }
  const cpred = await deploy('RecoveryTestToken', [18]);
  const usdc = await deploy(noReturn ? 'RecoveryNoReturnToken' : 'RecoveryTestToken', noReturn ? [] : [6]);
  const usdt = await deploy('RecoveryTestToken', [6]);
  const market = await deploy('PredictionMarket', [cpred.target, usdc.target, usdt.target]);
  await market.setMinCpredToCreate(0);
  const token = [null, usdc, usdt, cpred][c.id];
  if (token) for (const signer of [owner, alice, bob, carol]) {
    await token.mint(signer.address, amount(500, c));
    await token.connect(signer).approve(market.target, amount(500, c));
  }
  return { c, owner, alice, bob, carol, sink, sink2, cpred, usdc, usdt, token, market, deploy };
}
async function create(f, seed = 100) {
  const id = await f.market.marketCount();
  const expires = (await ethers.provider.getBlock('latest')).timestamp + 7200;
  await f.market.createMarket('Does the test value meet the target?', 'crypto', 'TEST', 100000000,
    true, expires, f.c.id, f.token ? amount(seed, f.c) : 0n,
    { value: f.token ? 0n : amount(seed, f.c) });
  return id;
}
async function bet(f, id, user, side, n) {
  if (f.token) await f.market.connect(user).placeBetERC20(id, side, f.c.id, amount(n, f.c));
  else await f.market.connect(user).placeBet(id, side, { value: amount(n, f.c) });
}
async function expire(f, id) {
  await network.provider.send('evm_setNextBlockTimestamp', [Number((await f.market.getMarket(id)).expiresAt)]);
  await network.provider.send('evm_mine');
}
async function balance(f, account) {
  return f.token ? f.token.balanceOf(account) : ethers.provider.getBalance(account);
}
async function covered(f) {
  const book = await f.market.accountedBalance(f.c.id);
  expect(await balance(f, f.market.target)).to.be.gte(book);
  expect(book).to.equal((await f.market.totalEscrow(f.c.id)) +
    (await f.market.totalCreatorFees(f.c.id)) + (await f.market.protocolFees(f.c.id)));
}
async function resolvedNo(f) {
  const id = await create(f);
  await bet(f, id, f.alice, false, 100);
  await expire(f, id);
  await f.market.resolveMarket(id, false);
  return id;
}

for (const c of currencies) describe(`${c.name}: accounting in ${c.decimals}-decimal atomic units`, function () {
  it('owns and indexes the creator seed as a YES position', async function () {
    const f = await fixture(c); const id = await create(f);
    const p = await f.market.getPosition(id, f.owner.address);
    expect(p.side).to.equal(true); expect(p.amount).to.equal(amount(100, c));
    await bet(f, id, f.alice, true, 20); await bet(f, id, f.alice, true, 10);
    expect(await f.market.getUserMarkets(f.alice.address)).to.deep.equal([id]);
    expect(await f.market.marketEscrow(id)).to.equal(amount(130, c));
    await covered(f);
  });
  it('completes creation, betting, resolution and same-asset payout with 2% total fees', async function () {
    const f = await fixture(c); const id = await resolvedNo(f);
    const quote = await f.market.previewPayout(id, f.alice.address);
    expect(quote.gross).to.equal(amount(200, c)); expect(quote.net).to.equal(amount(196, c));
    expect(await f.market.protocolFees(c.id)).to.equal(0);
    const before = await balance(f, f.sink.address);
    await f.market.connect(f.alice).claimPayoutTo(id, f.sink.address);
    expect((await balance(f, f.sink.address)) - before).to.equal(quote.net);
    expect(await f.market.creatorFees(c.id, f.owner.address)).to.equal(amount(2, c));
    expect(await f.market.protocolFees(c.id)).to.equal(amount(2, c));
    expect(await f.market.marketEscrow(id)).to.equal(0);
    await expect(f.market.connect(f.alice).claimPayout(id)).to.be.revertedWith('Already claimed');
    await expect(f.market.claimPayout(id)).to.be.revertedWith('Lost position');
    await covered(f);
  });
  it('settles multiple winners and keeps rounding dust reserved', async function () {
    const f = await fixture(c); const id = await create(f);
    await bet(f, id, f.alice, true, 50); await bet(f, id, f.bob, false, 50);
    await expire(f, id); const beforeResolve = await balance(f, f.market.target);
    await f.market.resolveMarket(id, true);
    expect(await balance(f, f.market.target)).to.equal(beforeResolve);
    let grossTotal = 0n;
    for (const user of [f.alice, f.owner]) {
      const q = await f.market.previewPayout(id, user.address); grossTotal += q.gross;
      const before = await balance(f, f.sink.address);
      await f.market.connect(user).claimPayoutTo(id, f.sink.address);
      expect((await balance(f, f.sink.address)) - before).to.equal(q.net);
      await covered(f);
    }
    const dust = amount(200, c) - grossTotal;
    expect(dust).to.be.lt(2n);
    await f.market.claimCreatorFees(c.id, f.sink.address);
    await f.market.withdrawProtocolFees(c.id, f.sink2.address);
    expect(await balance(f, f.market.target)).to.equal(dust);
    expect(await f.market.marketEscrow(id)).to.equal(dust);
    await covered(f);
  });
  it('refunds all collateral including seed, without fees or repeat refunds', async function () {
    const f = await fixture(c); const id = await create(f);
    await bet(f, id, f.alice, false, 30); await f.market.cancelMarket(id);
    for (const [user, n] of [[f.owner, 100], [f.alice, 30]]) {
      const before = await balance(f, f.sink.address);
      await f.market.connect(user).claimRefundTo(id, f.sink.address);
      expect((await balance(f, f.sink.address)) - before).to.equal(amount(n, c));
      await expect(f.market.connect(user).claimRefund(id)).to.be.revertedWith('Nothing to refund');
    }
    expect(await f.market.protocolFees(c.id)).to.equal(0);
    expect(await f.market.marketEscrow(id)).to.equal(0);
    await expect(f.market.resolveMarket(id, true)).to.be.revertedWith('Not open');
    await covered(f);
  });
  it('requires expiry and resolver authorization and rejects expired bets', async function () {
    const f = await fixture(c); const id = await create(f);
    await expect(f.market.resolveMarket(id, true)).to.be.revertedWith('Not expired yet');
    await expire(f, id);
    await expect(f.market.connect(f.alice).resolveMarket(id, true)).to.be.revertedWith('Not authorized to resolve');
    await expect(bet(f, id, f.alice, true, 1)).to.be.revertedWith('Market expired');
    await f.market.addResolver(f.bob.address); await f.market.connect(f.bob).resolveMarket(id, true);
    await expect(f.market.resolveMarket(id, false)).to.be.revertedWith('Not open');
  });
  it('cancels a result with no winning stake so the seed can be refunded', async function () {
    const f = await fixture(c); const id = await create(f);
    await expire(f, id); await f.market.resolveMarket(id, false);
    expect((await f.market.getMarket(id)).status).to.equal(3);
    await f.market.claimRefundTo(id, f.sink.address);
    expect(await balance(f, f.market.target)).to.equal(0);
  });
  it('transfers, merges and restores positions without stale claim flags', async function () {
    const f = await fixture(c); const id = await create(f);
    await bet(f, id, f.alice, true, 20); await bet(f, id, f.carol, true, 10);
    await expect(f.market.connect(f.alice).transferPosition(id, f.alice.address, f.carol.address))
      .to.emit(f.market, 'PositionTransferred').withArgs(id, f.alice.address, f.carol.address, amount(20, c));
    await f.market.connect(f.carol).transferPosition(id, f.carol.address, f.alice.address);
    expect((await f.market.getPosition(id, f.alice.address)).claimed).to.equal(false);
    await bet(f, id, f.alice, true, 10);
    expect((await f.market.getPosition(id, f.alice.address)).amount).to.equal(amount(40, c));
    expect(await f.market.getUserMarkets(f.alice.address)).to.deep.equal([id]);
    await expect(f.market.connect(f.alice).transferPosition(id, f.alice.address, f.alice.address))
      .to.be.revertedWith('Invalid recipient');
    await expect(f.market.transferPosition(id, f.alice.address, f.bob.address))
      .to.be.revertedWith('Not authorized to transfer');
    await covered(f);
  });
  it('has no synthetic yield and handles zero/new-stake quotes', async function () {
    const f = await fixture(c); const id = await create(f);
    await bet(f, id, f.alice, true, 25);
    expect((await f.market.getMarket(id)).yieldAccrued).to.equal(0);
    expect(await f.market.YIELD_APY_BPS()).to.equal(0);
    expect(await f.market.getPotentialPayout(id, false, 0)).to.deep.equal([0n, 0n]);
    const q = await f.market.getPotentialPayout(id, false, amount(25, c));
    expect(q.gross).to.equal(amount(150, c)); expect(q.net).to.equal(amount(147, c));
  });
});

describe('Adversarial cases and deployment boundaries', function () {
  it('discounts the TOTAL fee, including creator credit, to 1%', async function () {
    const f = await fixture(); const id = await resolvedNo(f);
    await f.cpred.mint(f.alice.address, ethers.parseEther('1000'));
    const q = await f.market.previewPayout(id, f.alice.address);
    expect(q.net).to.equal(ethers.parseEther('198'));
    expect(q.creatorFee).to.equal(ethers.parseEther('2')); expect(q.protocolFee).to.equal(0);
    await f.market.connect(f.alice).claimPayoutTo(id, f.sink.address); await covered(f);
  });
  it('cannot withdraw principal, creator credits, donations or another market escrow', async function () {
    const f = await fixture(); const first = await create(f); const second = await create(f, 77);
    await f.owner.sendTransaction({ to: f.market.target, value: ethers.parseEther('3') });
    await expect(f.market.withdraw()).to.be.revertedWith('No protocol fees');
    expect(await f.market.accumulatedFees()).to.equal(0);
    await bet(f, first, f.alice, false, 100); await expire(f, first);
    await f.market.resolveMarket(first, false); await f.market.connect(f.alice).claimPayoutTo(first, f.sink.address);
    await expect(f.market.connect(f.alice).withdraw()).to.be.reverted;
    await f.market.withdraw();
    expect(await f.market.marketEscrow(second)).to.equal(ethers.parseEther('77'));
    expect(await f.market.creatorFees(0, f.owner.address)).to.equal(ethers.parseEther('2'));
    expect(await balance(f, f.market.target)).to.equal(ethers.parseEther('82'));
    await expect(f.market.withdraw()).to.be.revertedWith('No protocol fees');
    await expect(f.market.distributeAccumulatedFees()).to.be.revertedWith('Legacy staking distribution disabled');
    await covered(f);
  });
  it('rolls back a failed ETH payout and allows a safe recipient redirect', async function () {
    const f = await fixture(); const id = await create(f); const receiver = await f.deploy('RecoveryReceiver');
    await receiver.execute(f.market.target, f.market.interface.encodeFunctionData('placeBet', [id, false]),
      { value: ethers.parseEther('100') });
    await receiver.configure(true, ethers.ZeroAddress, '0x');
    await expire(f, id); await f.market.resolveMarket(id, false);
    await expect(receiver.execute(f.market.target, f.market.interface.encodeFunctionData('claimPayout', [id])))
      .to.be.revertedWith('ETH transfer failed');
    expect((await f.market.getPosition(id, receiver.target)).claimed).to.equal(false);
    expect(await f.market.marketEscrow(id)).to.equal(ethers.parseEther('200'));
    expect(await f.market.protocolFees(0)).to.equal(0);
    await receiver.execute(f.market.target, f.market.interface.encodeFunctionData('claimPayoutTo', [id, f.sink.address]));
    await covered(f);
  });
  it('rejects reentrant claims while paying a storage-writing receiver once', async function () {
    const f = await fixture(); const id = await create(f); const receiver = await f.deploy('RecoveryReceiver');
    await receiver.execute(f.market.target, f.market.interface.encodeFunctionData('placeBet', [id, false]),
      { value: ethers.parseEther('100') });
    const claim = f.market.interface.encodeFunctionData('claimPayout', [id]);
    await receiver.configure(false, f.market.target, claim);
    await expire(f, id); await f.market.resolveMarket(id, false);
    await receiver.execute(f.market.target, claim);
    expect(await receiver.reenteredSuccessfully()).to.equal(false);
    expect(await receiver.received()).to.equal(ethers.parseEther('196')); await covered(f);
  });
  it('does not let a rejecting creator block a winner or consume fee credits', async function () {
    const f = await fixture(); const receiver = await f.deploy('RecoveryReceiver');
    await receiver.configure(true, ethers.ZeroAddress, '0x');
    const expiry = (await ethers.provider.getBlock('latest')).timestamp + 7200;
    await receiver.execute(f.market.target, f.market.interface.encodeFunctionData('createMarket',
      ['Test', 'crypto', 'TEST', 1, true, expiry, 0, 0]), { value: ethers.parseEther('100') });
    await bet(f, 0, f.alice, false, 100); await expire(f, 0); await f.market.resolveMarket(0, false);
    await f.market.connect(f.alice).claimPayoutTo(0, f.sink.address);
    const claim = f.market.interface.encodeFunctionData('claimCreatorFees', [0, receiver.target]);
    await expect(receiver.execute(f.market.target, claim)).to.be.revertedWith('ETH transfer failed');
    expect(await f.market.creatorFees(0, receiver.target)).to.equal(ethers.parseEther('2'));
    await receiver.execute(f.market.target, f.market.interface.encodeFunctionData('claimCreatorFees', [0, f.sink.address]));
    expect(await f.market.creatorFees(0, receiver.target)).to.equal(0); await covered(f);
  });
  it('rejects invalid claim recipients without consuming a claim', async function () {
    const f = await fixture(); const id = await resolvedNo(f);
    for (const recipient of [ethers.ZeroAddress, f.market.target]) {
      await expect(f.market.connect(f.alice).claimPayoutTo(id, recipient)).to.be.revertedWith('Invalid recipient');
      expect((await f.market.getPosition(id, f.alice.address)).claimed).to.equal(false);
    }
  });
  it('freezes token identity, staking and secondary authorization after first creation', async function () {
    const f = await fixture(); await create(f);
    await expect(f.market.setTokenAddresses(f.usdt.target, f.usdc.target)).to.be.revertedWith('Configuration frozen');
    await expect(f.market.setPresaleStaking(f.usdt.target)).to.be.revertedWith('Configuration frozen');
    await expect(f.market.setPositionMarket(f.usdt.target)).to.be.revertedWith('Configuration frozen');
  });
  it('rejects duplicate and non-contract collateral identities', async function () {
    const f = await fixture();
    await expect(ethers.deployContract('PredictionMarket', [f.cpred.target, f.usdc.target, f.usdc.target]))
      .to.be.revertedWith('Duplicate currency token');
    await expect(ethers.deployContract('PredictionMarket', [f.cpred.target, f.alice.address, f.usdt.target]))
      .to.be.revertedWith('Invalid collateral token');
  });
  it('rejects taxed deposits atomically', async function () {
    const f = await fixture(currencies[1]); await f.token.configure(100, false, false);
    const before = await f.token.balanceOf(f.owner.address);
    await expect(create(f)).to.be.revertedWith('Unsupported token transfer');
    expect(await f.market.marketCount()).to.equal(0);
    expect(await f.token.balanceOf(f.owner.address)).to.equal(before);
  });
  it('rejects false-return incoming transfers', async function () {
    const f = await fixture(currencies[1]); await f.token.configure(0, false, true);
    await expect(create(f)).to.be.reverted; expect(await f.market.marketCount()).to.equal(0);
  });
  it('rolls back false-return and taxed token payouts without consuming claims', async function () {
    const f = await fixture(currencies[1]); const id = await resolvedNo(f);
    for (const [fee, falseReturn] of [[0, true], [100, false]]) {
      await f.token.configure(fee, falseReturn, false);
      const before = await f.token.balanceOf(f.alice.address);
      await expect(f.market.connect(f.alice).claimPayout(id)).to.be.reverted;
      expect((await f.market.getPosition(id, f.alice.address)).claimed).to.equal(false);
      expect(await f.token.balanceOf(f.alice.address)).to.equal(before);
      expect(await f.market.marketEscrow(id)).to.equal(amount(200, f.c));
      expect(await f.market.protocolFees(1)).to.equal(0);
    }
    await f.token.configure(0, false, false); await f.market.connect(f.alice).claimPayout(id); await covered(f);
  });
  it('preserves failed token refunds and allows retry', async function () {
    const f = await fixture(currencies[1]); const id = await create(f); await f.market.cancelMarket(id);
    await f.token.configure(0, true, false); await expect(f.market.claimRefund(id)).to.be.reverted;
    expect((await f.market.getPosition(id, f.owner.address)).claimed).to.equal(false);
    expect(await f.market.marketEscrow(id)).to.equal(amount(100, f.c));
    await f.token.configure(0, false, false); await f.market.claimRefund(id); await covered(f);
  });
  it('supports exact-value ERC20s which return no boolean', async function () {
    const f = await fixture(currencies[1], true); const id = await resolvedNo(f);
    const before = await f.token.balanceOf(f.alice.address);
    await f.market.connect(f.alice).claimPayout(id);
    expect((await f.token.balanceOf(f.alice.address)) - before).to.equal(amount(196, f.c)); await covered(f);
  });
  it('keeps a USDC settlement isolated from an ETH escrow in the SAME contract', async function () {
    const f = await fixture(currencies[1]); const id = await create(f);
    const expires = (await ethers.provider.getBlock('latest')).timestamp + 7200;
    await f.market.createMarket('ETH test', 'crypto', 'TEST', 1, true, expires, 0, 0,
      { value: ethers.parseEther('77') });
    await bet(f, id, f.alice, false, 100); await expire(f, id); await f.market.resolveMarket(id, false);
    await f.market.connect(f.alice).claimPayout(id);
    expect(await ethers.provider.getBalance(f.market.target)).to.equal(ethers.parseEther('77'));
    expect(await f.market.totalEscrow(0)).to.equal(ethers.parseEther('77')); await covered(f);
  });
  it('compiles the exact source bytes and stays below the EIP-170 runtime size limit', async function () {
    const original = fs.readFileSync(path.join(__dirname, '../../contracts/PredictionMarket.sol'));
    const copied = fs.readFileSync(path.join(__dirname, '../contracts/PredictionMarket.sol'));
    expect(copied.equals(original)).to.equal(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../source-manifest.json')));
    expect(manifest['PredictionMarket.sol']).to.equal(crypto.createHash('sha256').update(original).digest('hex'));
    const artifact = await artifacts.readArtifact('PredictionMarket');
    expect((artifact.deployedBytecode.length - 2) / 2).to.be.lessThanOrEqual(24576);
  });
});
