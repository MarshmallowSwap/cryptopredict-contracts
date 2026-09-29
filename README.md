# CryptoPredict contracts — recovery candidate

**DRAFT. Not compiled or EVM-validated in the recovery environment yet. Do not deploy this branch.**

This branch contains a candidate replacement for `PredictionMarket.sol` and an
isolated validation harness. It is not an upgrade or migration of existing
contracts, does not change existing deployments, and does not enable production
trading. The candidate constructor is restricted to chain IDs 31337 and 84532.

Start with `docs/RECOVERY_PHASE_2.md`. The original README and deployment scripts
remain available in the baseline history at `5d6b085`.

## Independent accounting checks (no external packages)

```sh
python -m unittest discover -s validation -v
```

These tests validate an integer accounting model, NOT Solidity execution.

## Candidate compilation and local EVM tests

```sh
npm --prefix recovery install --ignore-scripts --no-audit --no-fund
npm --prefix recovery test
```

The recovery configuration does not read `.env`, RPC URLs or deployment keys.
It compiles the actual candidate source with Solidity 0.8.24 and uses a local
Hardhat chain. It does NOT test the old presale, staking, AMM or secondary market.

A reviewed dependency lockfile, successful compiler output, all EVM tests,
bytecode review and explicit deployment gates are required before any release.
Do not use the root legacy deployment scripts for this recovery candidate.
