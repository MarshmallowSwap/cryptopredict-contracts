# CryptoPredict contracts — recovery e laboratorio locale

**DRAFT. Il contratto al commit `3a7fec3` ha superato compilazione e 47 test EVM
sul PC Windows del proprietario. Nessun audit o deployment pubblico è implicito.**

Il sorgente Solidity, la configurazione Hardhat e i 47 test rimangono invariati.
Le nuove aggiunte realizzano un laboratorio browser separato dal sito pubblico.
Lo smoke test di questo nuovo adattatore deve ancora essere eseguito sul PC.

## Laboratorio browser, senza Actions

Seguire [docs/LOCAL_LAB.md](docs/LOCAL_LAB.md). In sintesi:

```sh
node recovery/tools/restore-lock.cjs
node recovery/tools/verified-baseline.cjs check
npm --prefix recovery ci --ignore-scripts --include=dev --no-audit --no-fund
npm --prefix recovery run compile
node recovery/lab/smoke.cjs
node recovery/lab/server.cjs
```

Il lock COMPLETO della prova riuscita è archiviato in forma compressa in
`recovery/locked-dependencies/`; lo script lo ricostruisce byte per byte in
`recovery/package-lock.json`, senza aggiornare le versioni né sovrascrivere
un file differente. Non occorre più recuperarlo dal vecchio ZIP delle evidenze.

L'interfaccia usa solo `http://127.0.0.1:8787`, Hardhat in memoria (31337), tre
wallet temporanei e token fixture. Non collegare MetaMask o inviare fondi reali.
Supabase, il sito Vercel, staking, oracoli e secondario restano scollegati.
Il seed è una posizione YES del creatore, non liquidità AMM neutrale.

## Controlli separati

```sh
python -m unittest discover -s validation -v
node --test recovery/tools-test/verified-baseline.test.cjs
node --test recovery/lab-test/local-lab.test.cjs
```

Il modello Python e i controlli Node non sostituiscono i test EVM. Stato delle
verifiche in `docs/LOCAL_LAB.md`; evidenze storiche in `docs/VERIFIED_BASELINE.md`.
Non usare gli script legacy di deploy né effettuare un upgrade in-place.
