'use strict';
// Built-ins only. No network, private keys, deployment, npm install, or test execution.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function gitBlob(bytes) {
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
}
function fail(message) { throw new Error(message); }
function readRegular(file, maxBytes = 2_000_000) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) fail(`Not a bounded regular file: ${file}`);
  return fs.readFileSync(file);
}
function safePath(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) fail('Invalid baseline path');
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(path.resolve(root) + path.sep)) fail('Baseline path escapes repository');
  if (fs.existsSync(absolute) && !fs.realpathSync(absolute).startsWith(fs.realpathSync(root) + path.sep)) fail('Symlink escapes repository');
  return absolute;
}
function validateLock(bytes, packageBytes, baseline) {
  if (sha256(bytes) !== baseline.lock.sha256) fail('Lockfile SHA-256 differs from the successful run');
  const lock = JSON.parse(bytes.toString('utf8'));
  const pkg = JSON.parse(packageBytes.toString('utf8'));
  if (lock.lockfileVersion !== 3 || !lock.packages || !lock.packages['']) fail('Unexpected lockfile schema');
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies, 'Direct dependencies differ');
  if (lock.name !== pkg.name || lock.version !== pkg.version) fail('Wrong project identity');
  if (Object.keys(lock.packages).length - 1 !== baseline.lock.packageCount) fail('Wrong dependency count');
  for (const [name, spec] of Object.entries(lock.packages)) {
    if (!name) continue;
    if (!name.startsWith('node_modules/') || name.includes('..') || spec.link) fail(`Unexpected dependency entry: ${name}`);
    const url = new URL(spec.resolved);
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.port || url.username || url.password || url.search || url.hash) fail(`Non-registry dependency: ${name}`);
    if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(spec.integrity)) fail(`Missing SHA-512 integrity: ${name}`);
  }
  return lock;
}
function verifySources(repo, baseline) {
  for (const [relative, expected] of Object.entries(baseline.sourceGitBlobs)) {
    if (gitBlob(readRegular(safePath(repo, relative))) !== expected) fail(`Source differs from validated baseline: ${relative}`);
  }
  return Object.keys(baseline.sourceGitBlobs).length;
}
function importLock(repo, source, baseline) {
  verifySources(repo, baseline);
  const bytes = readRegular(source);
  validateLock(bytes, readRegular(path.join(repo, 'recovery/package.json')), baseline);
  const destination = path.join(repo, 'recovery/package-lock.json');
  // Exclusive create: never replace an existing lockfile, even on Windows.
  try { fs.writeFileSync(destination, bytes, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!readRegular(destination).equals(bytes)) fail('Existing lockfile differs; not overwritten');
    return 'already-identical';
  }
  if (sha256(readRegular(destination)) !== baseline.lock.sha256) fail('Lockfile read-back mismatch');
  return 'imported';
}
function verifyArtifact(bytes, baseline) {
  if (sha256(bytes) !== baseline.artifact.sha256) fail('Artifact differs from supplied successful-run evidence');
  const artifact = JSON.parse(bytes.toString('utf8'));
  if (artifact.contractName !== 'PredictionMarket' || !Array.isArray(artifact.abi) ||
      artifact.sourceName !== 'contracts/PredictionMarket.sol') fail('Unexpected contract artifact');
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(artifact.deployedBytecode)) fail('Invalid runtime template');
  const size = (artifact.deployedBytecode.length - 2) / 2;
  if (size !== baseline.artifact.runtimeBytes || size > 24576) fail('Unexpected runtime size');
  return artifact;
}
function exportInterface(repo, artifactFile, destination, baseline) {
  verifySources(repo, baseline);
  validateLock(readRegular(path.join(repo, 'recovery/package-lock.json')),
    readRegular(path.join(repo, 'recovery/package.json')), baseline);
  const artifact = verifyArtifact(readRegular(artifactFile), baseline);
  const output = {
    schemaVersion: 1, contractName: 'PredictionMarket', validatedSourceCommit: baseline.commit,
    purpose: 'local-integration-only', allowedChainId: 31337,
    deployment: null, // MUST be filled only from a freshly verified LOCAL deployment receipt.
    transactionSigningEnabled: false, abi: artifact.abi,
    artifactSha256: baseline.artifact.sha256,
    sourceGitBlob: baseline.sourceGitBlobs['contracts/PredictionMarket.sol'],
    lockSha256: baseline.lock.sha256,
    accounting: { amountEncoding: 'decimal-string-of-atomic-units', syntheticYieldEnabled: false,
      seedPolicy: 'creator-YES-position-provisional', legacyStakingEnabled: false, secondaryMarketEnabled: false },
    evidence: { origin: 'owner-supplied-Windows-run', expectedTests: 47, passing: 47,
      testsExecutedByThisTool: false, publicDeploymentVerified: false }
  };
  fs.writeFileSync(destination, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
  return output;
}
function main(argv = process.argv.slice(2)) {
  const repo = path.resolve(__dirname, '../..');
  const baseline = JSON.parse(readRegular(path.join(__dirname, '../validated-baseline.json')));
  if (argv[0] === 'import-lock' && argv.length === 2) {
    console.log(importLock(repo, path.resolve(argv[1]), baseline));
  } else if (argv[0] === 'check' && argv.length === 1) {
    const count = verifySources(repo, baseline);
    validateLock(readRegular(path.join(repo, 'recovery/package-lock.json')),
      readRegular(path.join(repo, 'recovery/package.json')), baseline);
    console.log(JSON.stringify({ sourceFilesVerified: count, lockSha256: baseline.lock.sha256,
      dependencies: baseline.lock.packageCount, evmTestsExecuted: false }, null, 2));
  } else if (argv[0] === 'export-interface' && argv.length === 3) {
    exportInterface(repo, path.resolve(argv[1]), path.resolve(argv[2]), baseline);
    console.log('Local-only interface written; no wallet, network or deployment contacted.');
  } else {
    fail('Usage: node recovery/tools/verified-baseline.cjs import-lock <package-lock.json> | check | export-interface <PredictionMarket.json> <new-output.json>');
  }
}
module.exports = { sha256, gitBlob, readRegular, safePath, validateLock, verifySources, importLock, verifyArtifact, exportInterface, main };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
