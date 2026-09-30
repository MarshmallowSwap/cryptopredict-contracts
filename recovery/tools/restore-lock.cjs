'use strict';
// The entire Windows-tested lock is archived, not regenerated from dependency ranges.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const EXPECTED = '7ce81bdcdc07f2cc540602b3889baccc4d657f1b87c5f4999bbbf50c3d8d6e45';
function regular(file, limit) {
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || s.size > limit) throw Error('Invalid lock archive file');
  return fs.readFileSync(file);
}
function restore(root = path.resolve(__dirname, '..')) {
  const dir = path.join(root, 'locked-dependencies');
  if (fs.lstatSync(root).isSymbolicLink() || fs.lstatSync(dir).isSymbolicLink()) throw Error('Symlink directory refused');
  const chunks = Array.from({length: 24}, (_, i) => regular(path.join(dir, `part-${String(i).padStart(2,'0')}.b64`), 2100).toString('ascii').trim());
  const text = chunks.join('');
  if (text.length !== 46544 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw Error('Invalid encoded lock archive');
  const bytes = zlib.gunzipSync(Buffer.from(text, 'base64'), {maxOutputLength: 150000});
  if (bytes.length !== 149197 || crypto.createHash('sha256').update(bytes).digest('hex') !== EXPECTED) throw Error('Lock archive checksum mismatch');
  const destination = path.join(root, 'package-lock.json');
  try { fs.writeFileSync(destination, bytes, {flag:'wx', mode:0o600}); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    if (!regular(destination, 150000).equals(bytes)) throw Error('Existing lock differs; not overwritten');
    return {status:'already-identical', sha256:EXPECTED};
  }
  if (!regular(destination, 150000).equals(bytes)) throw Error('Lock read-back mismatch');
  return {status:'restored', sha256:EXPECTED};
}
module.exports = {restore, EXPECTED};
if (require.main === module) {
  try { console.log(JSON.stringify(restore())); } catch (e) { console.error(e.message); process.exitCode=1; }
}
