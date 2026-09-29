# Verifica locale — senza GitHub Actions

Aggiornamento del 30 settembre 2026: il proprietario ha chiesto di non usare
GitHub Actions, per assenza di crediti. Il workflow introdotto per il recupero
è stato spostato da `.github/workflows/` a `docs/ci-disabled/` con estensione
`.yml.txt`: è solo documentazione e non va eseguito automaticamente.
Non sono stati modificati impostazioni dell'account, branch protection o main.

Questo documento sostituisce i riferimenti alla CI come prerequisito operativo
in `RECOVERY_PHASE_2.md` e nella descrizione iniziale della PR. Non occorre
ricaricare crediti o diagnosticare le vecchie esecuzioni Actions per proseguire.
Resta necessario compilare e provare il contratto, anche su macchina locale.

## Verifica rieseguita

- Python 3.13.5: **26 test del modello contabile superati**; uno contiene
  **5.000 scenari deterministici**.
- Eseguiti sui file estratti dal pacchetto della Fase 2, con la suite originale.
- Controllo sintattico del file di test JavaScript rieseguito con Node 22.16.0.
- Questi risultati NON sono una compilazione Solidity o un test del bytecode.
- Solc, Hardhat e le dipendenze EVM non sono installati nell'ambiente corrente;
  la risoluzione di registry.npmjs.org non è disponibile. Nessuno dei 47 casi EVM
  è stato eseguito. È un limite dell'ambiente locale, non dei crediti GitHub.

## Modello contabile, senza dipendenze esterne

Dalla radice del repository:

```sh
python -m unittest discover -s validation -v
node --check recovery/test/prediction-market.test.js
```

## Compilazione e prove EVM locali

Su un ambiente isolato con Node e accesso npm, dalla radice del repository:

```sh
npm --prefix recovery install --ignore-scripts --no-audit --no-fund
npm --prefix recovery test
```

Il secondo comando usa il progetto `recovery/`, copia i sorgenti esatti e avvia
la rete Hardhat locale 31337. Non carica `.env`, RPC o chiavi di deployment.
Non usare gli script `scripts/deploy*.js` del progetto legacy.

Il primo comando è solo installazione di dipendenze locali: non pubblica nulla
su GitHub o Vercel e non consuma minuti Actions. Non è stato eseguito con successo
in questa sessione. Dopo la prima installazione funzionante occorre revisionare
e versionare `recovery/package-lock.json`, poi utilizzare `npm ci` al suo posto.

## Evidenze richieste prima del rilascio

Conservare versione Node/solc, manifest dei sorgenti, lockfile, output completo di
compilazione e test, codice di uscita e commit verificato. Una verifica interrotta
o con dipendenze mancanti non va dichiarata superata.
Il costruttore limitato alla testnet non è una certificazione del contratto.

Restano aperti: bytecode/EVM, scelta economica sul seed YES del creatore, regole
oracolo/dispute, permessi e liveness, manifest deployment e collaudo completo
wallet/interfaccia/database. Le estensioni legacy non sono convalidate.
Nessun merge, deployment, migrazione o modifica ai contratti esistenti.
