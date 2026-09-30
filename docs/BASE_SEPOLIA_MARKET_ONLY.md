# Deployment market-only su Base Sepolia

Questa variante riusa esclusivamente i token testnet storici:
- CPRED `0xEc937bF3123874115EDcBBE1b3802C95f572e8E5`
- MockUSDC `0x8A54f0e841CFCA5fA654912AF33cCD121D182311`
- MockUSDT `0xaBB48e1693Df04fb894843e52B239D5C5d0ab871`

Prima del deploy lo script verifica live:
- chainId 84532;
- bytecode non vuoto;
- `decimals()` (18/6/6);
- `totalSupply() > 0`.

Se uno dei controlli fallisce, **non distribuisce PredictionMarket**.

Dopo il deploy verifica che collateral e token coincidano e che
`positionMarket` e `presaleStaking` restino zero. Imposta inoltre
`minCpredToCreate = 0` solo per il collaudo recovery.

Comando:

```powershell
$env:CP_RECOVERY_TESTNET_ONLY="YES"
$env:RECOVERY_TESTNET_PRIVATE_KEY="0x...WALLET_TESTNET..."
node deploy-market-only.cjs
Remove-Item Env:RECOVERY_TESTNET_PRIVATE_KEY
```

Non usare una chiave con fondi mainnet. Non committare manifest contenenti segreti
(non ne vengono scritti) e non usare gli script legacy.
