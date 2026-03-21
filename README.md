# CryptoPredict — Smart Contracts

Contratti Solidity per il prediction market su **Base Sepolia** (testnet).

## Contratti

| Contratto | Descrizione |
|---|---|
| `CryptoPredictToken.sol` | ERC-20 $CPRED — 100M supply, staking integrato |
| `PredictionMarket.sol` | Prediction market full on-chain — pool, bet, payout |
| `CPREDPresale.sol` | Presale 3-stage con auto-advance |

## Setup

```bash
# 1. Installa dipendenze
npm install

# 2. Configura env
cp .env.example .env
nano .env  # aggiungi DEPLOYER_PRIVATE_KEY

# 3. Ottieni ETH testnet su Base Sepolia
# → https://www.coinbase.com/faucets/base-ethereum-goerli-faucet
# → https://faucet.quicknode.com/base/sepolia

# 4. Compila
npm run compile

# 5. Deploy su Base Sepolia
npm run deploy:sepolia
```

## Faucets Base Sepolia

- https://faucet.quicknode.com/base/sepolia
- https://www.alchemy.com/faucets/base-sepolia
- https://coinbase.com/faucets

## ABI (dopo il deploy)

Gli ABI vengono generati automaticamente in `artifacts/contracts/`.
Copiare in `frontend/abi/` per usarli con ethers.js.

## Architettura on-chain

```
User → PredictionMarket.placeBet(marketId, side) + ETH
              ↓
         Pool YES/NO accumula ETH
         Yield simulato calcolato on-chain
              ↓
Admin → PredictionMarket.resolveMarket(marketId, yesWon)
              ↓
         1% protocol fee → CPREDToken.depositRewards()
         → distribuito agli staker CPRED
              ↓
User → PredictionMarket.claimPayout(marketId)
         → ETH trasferito al vincitore (meno fee)
         → fee dimezzata se hai ≥ 1000 CPRED
```

## Indirizzi su Base Sepolia

Aggiornati dopo il deploy in `deployments/base-sepolia.json`.
