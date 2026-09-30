'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const api = require('../tools/verified-baseline.cjs');
function fixture(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-baseline-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repo, 'recovery'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'contracts'));
  const pkg = Buffer.from(JSON.stringify({ name: 'test', version: '1', devDependencies: { test: '1.0.0' } }));
  const lockData = { name: 'test', version: '1', lockfileVersion: 3, packages: {
    '': { devDependencies: { test: '1.0.0' } },
    'node_modules/test': { version: '1.0.0', resolved: 'https://registry.npmjs.org/test/-/test-1.0.0.tgz',
      integrity: 'sha512-' + Buffer.alloc(64, 9).toString('base64') }
  }};
  const lock = Buffer.from(JSON.stringify(lockData));
  const source = Buffer.from('// local fixture, never an EVM test');
  const artifact = Buffer.from(JSON.stringify({ contractName: 'PredictionMarket',
    sourceName: 'contracts/PredictionMarket.sol', abi: [], deployedBytecode: '0x1234' }));
  const baseline = { commit: 'fixture', lock: { sha256: api.sha256(lock), packageCount: 1 },
    sourceGitBlobs: { 'contracts/PredictionMarket.sol': api.gitBlob(source), 'recovery/package.json': api.gitBlob(pkg) },
    artifact: { sha256: api.sha256(artifact), runtimeBytes: 2 } };
  fs.writeFileSync(path.join(repo, 'recovery/package.json'), pkg);
  fs.writeFileSync(path.join(repo, 'contracts/PredictionMarket.sol'), source);
  fs.writeFileSync(path.join(repo, 'evidence-lock.json'), lock);
  fs.writeFileSync(path.join(repo, 'evidence-artifact.json'), artifact);
  return { repo, pkg, lock, lockData, baseline, artifact };
}
test('accepts a matching bounded lock', t => {
  const f = fixture(t); assert.equal(api.validateLock(f.lock, f.pkg, f.baseline).lockfileVersion, 3);
});
test('refuses even whitespace changes in the pinned lock', t => {
  const f = fixture(t); assert.throws(() => api.validateLock(Buffer.concat([f.lock, Buffer.from(' ')]), f.pkg, f.baseline), /SHA-256/);
});
test('refuses mismatching direct dependencies', t => {
  const f = fixture(t); const pkg = JSON.parse(f.pkg); pkg.devDependencies.test = '2.0.0';
  assert.throws(() => api.validateLock(f.lock, Buffer.from(JSON.stringify(pkg)), f.baseline));
});
for (const change of ['foreign-registry', 'url-credentials', 'missing-integrity', 'file-link', 'wrong-count']) {
  test(`refuses ${change} even with a matching synthetic checksum`, t => {
    const f = fixture(t); const entry = f.lockData.packages['node_modules/test'];
    if (change === 'foreign-registry') entry.resolved = 'https://evil.example/test.tgz';
    if (change === 'url-credentials') entry.resolved = 'https://secret@registry.npmjs.org/test.tgz';
    if (change === 'missing-integrity') delete entry.integrity;
    if (change === 'file-link') entry.link = true;
    const bytes = Buffer.from(JSON.stringify(f.lockData)); f.baseline.lock.sha256 = api.sha256(bytes);
    if (change === 'wrong-count') f.baseline.lock.packageCount = 2;
    assert.throws(() => api.validateLock(bytes, f.pkg, f.baseline));
  });
}
test('verifies source file bytes against git blob hashes', t => {
  const f = fixture(t); assert.equal(api.verifySources(f.repo, f.baseline), 2);
  fs.appendFileSync(path.join(f.repo, 'contracts/PredictionMarket.sol'), '\n');
  assert.throws(() => api.verifySources(f.repo, f.baseline), /Source differs/);
});
test('imports a lock without overwriting a different file', t => {
  const f = fixture(t); const src = path.join(f.repo, 'evidence-lock.json');
  assert.equal(api.importLock(f.repo, src, f.baseline), 'imported');
  assert.equal(api.importLock(f.repo, src, f.baseline), 'already-identical');
  fs.writeFileSync(path.join(f.repo, 'recovery/package-lock.json'), 'existing');
  assert.throws(() => api.importLock(f.repo, src, f.baseline), /not overwritten/);
  assert.equal(fs.readFileSync(path.join(f.repo, 'recovery/package-lock.json'), 'utf8'), 'existing');
});
test('refuses lock import after source tampering and makes no destination', t => {
  const f = fixture(t); fs.appendFileSync(path.join(f.repo, 'contracts/PredictionMarket.sol'), 'changed');
  assert.throws(() => api.importLock(f.repo, path.join(f.repo, 'evidence-lock.json'), f.baseline));
  assert.equal(fs.existsSync(path.join(f.repo, 'recovery/package-lock.json')), false);
});
test('refuses altered contract artifacts', t => {
  const f = fixture(t); assert.equal(api.verifyArtifact(f.artifact, f.baseline).contractName, 'PredictionMarket');
  assert.throws(() => api.verifyArtifact(Buffer.from('{}'), f.baseline), /Artifact differs/);
});
test('exports only an unconnected local interface, without bytecode or signer', t => {
  const f = fixture(t); api.importLock(f.repo, path.join(f.repo, 'evidence-lock.json'), f.baseline);
  const output = path.join(f.repo, 'interface.json');
  const result = api.exportInterface(f.repo, path.join(f.repo, 'evidence-artifact.json'), output, f.baseline);
  assert.equal(result.allowedChainId, 31337); assert.equal(result.deployment, null);
  assert.equal(result.transactionSigningEnabled, false); assert.equal(result.evidence.testsExecutedByThisTool, false);
  assert.equal('bytecode' in result, false); assert.equal('privateKey' in result, false);
  assert.throws(() => api.exportInterface(f.repo, path.join(f.repo, 'evidence-artifact.json'), output, f.baseline), /EEXIST/);
});
test('rejects baseline paths that escape the repository', t => {
  const f = fixture(t);
  for (const p of ['../x', '/etc/passwd', '..\\x']) assert.throws(() => api.safePath(f.repo, p));
});
test('rejects oversized evidence files', t => {
  const f = fixture(t); const src = path.join(f.repo, 'evidence-lock.json');
  assert.throws(() => api.readRegular(src, 1), /bounded regular/);
});
test('rejects symlink evidence when the OS permits creating a symlink', t => {
  const f = fixture(t); const src = path.join(f.repo, 'evidence-lock.json');
  try { fs.symlinkSync(src, path.join(f.repo, 'linked.json'), 'file'); }
  catch (e) { if (e.code === 'EPERM') { t.skip('OS disallows unprivileged symlinks'); return; } throw e; }
  assert.throws(() => api.readRegular(path.join(f.repo, 'linked.json')), /bounded regular/);
});
