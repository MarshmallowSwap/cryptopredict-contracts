'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {ethers}=require('ethers');
const inPath=process.argv[2]||path.join(__dirname,'recovery-deployment.base-sepolia.json');
const outPath=process.argv[3]||path.join(__dirname,'recovery-config.generated.js');
const d=JSON.parse(fs.readFileSync(inPath,'utf8'));
if(Number(d.chainId)!==84532) throw Error('Manifest non Base Sepolia');
for(const k of ['market','cpred','usdc','usdt']) if(!ethers.isAddress(d.contracts?.[k])) throw Error('Indirizzo non valido: '+k);
if(d.legacy?.positionMarket!==ethers.ZeroAddress || d.legacy?.presaleStaking!==ethers.ZeroAddress) throw Error('Legacy component collegato');
const out=`// Generated from verified recovery deployment manifest.
window.CP_RECOVERY_CONFIG = Object.freeze({
  mode: "recovery-testnet",
  chainId: 84532,
  chainHex: "0x14a34",
  chainName: "Base Sepolia",
  rpcUrl: "https://sepolia.base.org",
  explorer: "https://sepolia.basescan.org",
  contracts: Object.freeze({
    market: "${d.contracts.market}",
    cpred: "${d.contracts.cpred}",
    usdc: "${d.contracts.usdc}",
    usdt: "${d.contracts.usdt}"
  }),
  expected: Object.freeze({
    positionMarket: "${ethers.ZeroAddress}",
    presaleStaking: "${ethers.ZeroAddress}"
  })
});
`;
fs.writeFileSync(outPath,out,{flag:'wx'});
console.log(outPath);
