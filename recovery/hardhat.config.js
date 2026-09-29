require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');
const { subtask } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');
const solc = require('solc');
// A separate config deliberately never reads .env, an RPC URL or a signing key.
if (process.env.HARDHAT_NETWORK && process.env.HARDHAT_NETWORK !== 'hardhat') {
  throw new Error('Recovery validation may only use the local Hardhat network');
}
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }) => {
  if (solcVersion !== '0.8.24' || !solc.version().startsWith('0.8.24+commit.e11b9ed9')) {
    throw new Error('Unexpected Solidity compiler version');
  }
  return { compilerPath: require.resolve('solc/soljson.js'), isSolcJs: true,
    version: solcVersion, longVersion: solc.version() };
});
module.exports = {
  defaultNetwork: 'hardhat',
  solidity: { version: '0.8.24', settings: {
    optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'paris'
  } },
  networks: { hardhat: { chainId: 31337 } },
  mocha: { timeout: 60000 }
};
