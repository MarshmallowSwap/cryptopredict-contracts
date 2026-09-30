'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// This is an ignored GENERATED directory, never the repository's source tree.
const generated = path.join(__dirname, 'contracts');
fs.rmSync(generated, { recursive: true, force: true });
const files = ['PredictionMarket.sol', 'test/RecoveryFixtures.sol'];
const manifest = {};
for (const file of files) {
  const bytes = fs.readFileSync(path.join(__dirname, '..', 'contracts', file));
  const destination = path.join(generated, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
  if (!fs.readFileSync(destination).equals(bytes)) throw new Error(`Copy mismatch: ${file}`);
  manifest[file] = crypto.createHash('sha256').update(bytes).digest('hex');
}
fs.writeFileSync(path.join(__dirname, 'source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Exact Solidity inputs SHA-256:', manifest);
