# Base Sepolia recovery deployment

Il deployment recovery è **nuovo e isolato**. Non usa indirizzi legacy.

## Prerequisiti
Dalla cartella `recovery/`:
1. ricostruire il lockfile verificato;
2. `npm ci --ignore-scripts --no-audit --no-fund`;
3. `npm run compile`.

Usare esclusivamente un **wallet burner di testnet** con poco ETH Base Sepolia per il gas. Non usare la chiave di un wallet con fondi reali e non inviare mai la chiave in chat o su GitHub.

PowerShell, nella sola finestra corrente:

```powershell
$env:CP_RECOVERY_TESTNET_ONLY="YES"
$env:RECOVERY_TESTNET_PRIVATE_KEY="0x...CHIAVE_DEL_WALLET_BURNER..."
node deploy-testnet.cjs
Remove-Item Env:RECOVERY_TESTNET_PRIVATE_KEY
```

Lo script:
- verifica chain ID 84532;
- distribuisce CPRED/USDC/USDT fixture;
- distribuisce il nuovo PredictionMarket;
- imposta min CPRED a zero per il collaudo;
- verifica bytecode e collateral;
- rifiuta PositionMarket e presaleStaking non-zero;
- scrive `recovery-deployment.base-sepolia.json` senza chiavi private.

Poi:

```powershell
node export-frontend-config.cjs recovery-deployment.base-sepolia.json recovery-config.generated.js
```

Il file generato va confrontato e copiato nella PR frontend solo dopo la verifica del manifest.

**Non eseguire gli script legacy `scripts/deploy*.js`.**
