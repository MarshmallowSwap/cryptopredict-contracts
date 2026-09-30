# CryptoPredict contracts — recovery candidate

**DRAFT. The owner-supplied Windows run passed compilation and all 47 EVM tests
for commit `3a7fec3`. No public deployment or audit is implied.**

The current tooling additions do not change the validated Solidity source,
Hardhat configuration or EVM test cases. See `docs/VERIFIED_BASELINE.md` for the
current evidence, checksum checks and local-only integration preparation.
Historical recovery notes are preserved in `docs/RECOVERY_PHASE_2.md`.

## Local checks, without GitHub Actions

```sh
python -m unittest discover -s validation -v
node --test recovery/tools-test/verified-baseline.test.cjs
```

The Python suite is an independent accounting model. The Node tooling tests do
not run Solidity. For EVM replay, import the original owner-supplied lockfile and
use `npm ci` as described in the current runbook. The exact lockfile is in the
handoff package; the remote commit currently stores its manifest and importer,
not the lockfile itself. Do not mistake a manifest for a complete dependency lock.

The candidate permits only chain IDs 31337 and 84532. The generated integration
interface defaults to LOCAL chain 31337, no contract address and signing disabled.
Do not use the root legacy deployment scripts, connect legacy staking/secondary
contracts, or move funds based on these test results. No in-place upgrade or
automatic migration of existing contracts is supported.
