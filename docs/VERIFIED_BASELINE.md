# CryptoPredict — baseline verificata e preparazione integrazione

30 settembre 2026. Gli ultimi cambiamenti riguardano tooling e documentazione,
non Solidity, configurazione Hardhat o i 47 test EVM gia superati dal proprietario.

## Fonte delle evidenze

Baseline: `3a7fec33824c3f27e450076437db05b0ee4a268b`.
Archivio fornito dal proprietario: `CryptoPredict-risultati-20260930-020251-569aaf.zip`.
Il manifest `recovery/validated-baseline.json` contiene SHA-256 dell'archivio,
lockfile e artefatto, impronte Git dei sei file sorgente rilevanti, ambiente e
risultato 47/47. L'esecuzione EVM e avvenuta sul PC Windows del proprietario;
la lettura delle evidenze non e una nuova esecuzione dei test.

Il lockfile originale e disponibile nel pacchetto di consegna, invariato:
SHA-256 `7ce81bdcdc07f2cc540602b3889baccc4d657f1b87c5f4999bbbf50c3d8d6e45`.
**Il lockfile completo ora è conservato nell'archivio versionato
`recovery/locked-dependencies/`. `node recovery/tools/restore-lock.cjs` ricostruisce
il package-lock.json originale e verifica i byte. Non è soltanto un manifest.**
Vedere `docs/LOCAL_LAB.md` per l'avvio autonomo; il precedente import manuale
resta disponibile ma non è più necessario.

## Riproduzione locale senza Actions

Dalla radice del repository del branch recovery, ricostruire il lockfile
dall'archivio versionato. Il comando non sovrascrive un lock differente:

```sh
node recovery/tools/restore-lock.cjs
node recovery/tools/verified-baseline.cjs check
npm --prefix recovery ci --ignore-scripts --no-audit --no-fund
node recovery/tools/verified-baseline.cjs check
npm --prefix recovery test
```

Il controllo rifiuta sorgenti diversi, lockfile alterati, URL fuori dal registry
npm e dipendenze senza impronta di integrita. Questi sono controlli di coerenza,
non un audit delle vulnerabilita o una firma indipendente del contenuto.
`npm ci` ricrea node_modules: usarlo soltanto nella copia locale di validazione.
Non aggiornare le dipendenze per risolvere errori di installazione senza nuova
revisione. La versione Node dell'esecuzione riuscita e 22.23.3, npm 10.9.9.

Riferimento ufficiale npm: https://docs.npmjs.com/cli/v10/commands/npm-ci/

## Interfaccia per il prossimo ambiente locale

```sh
node recovery/tools/verified-baseline.cjs export-interface /percorso/PredictionMarket.json /percorso/nuova-interface.json
```

Il comando accetta l'artefatto della sessione verificata, controlla nuovamente
sorgenti e lock, ed esporta l'ABI con una descrizione dell'ambiente:
- solo chain 31337;
- deployment `null`, nessun indirizzo del contratto legacy;
- firma delle transazioni disabilitata;
- importi come stringhe di unita atomiche, non numeri JavaScript in virgola mobile;
- seed YES del creatore esplicitamente provvisorio;
- niente staking legacy, mercato secondario o yield sintetico.

**Non e una UI funzionante, un wallet collegato o un deployment.** Un successivo
adattatore dovra verificare una nuova ricevuta di deployment locale, ABI e rete,
prima di abilitare qualunque comando. Supabase e il backend pubblico restano fuori
da questo controllo; nessuna chiamata di rete viene effettuata dal tooling.

## Test del nuovo tooling

```sh
node --test recovery/tools-test/verified-baseline.test.cjs
```

16 test superati in questo ambiente Linux, Node 22.16.0: impronte, importazione
senza sovrascrittura, file alterati, registry, integrita, export senza indirizzo e
limiti dei file. Il caso symlink e saltato su Windows se il sistema ne vieta la
creazione non privilegiata. La suite e separata dai 47 test EVM: non sommarli
come se fossero nuovi scenari del contratto.

## Stato e confini

Nessun merge, deploy, migrazione o accesso a chiavi. GitHub Actions resta escluso.
Restano da completare: esecuzione del nuovo laboratorio sul PC, integrazione del frontend pubblico e dei dati,
regole oracle e risoluzione, verifica HTTPS del backend, backup e credenziali.
Il seed e ancora una scelta provvisoria; nessuna mainnet e autorizzata da questo
aggiornamento. I vecchi documenti che dicono EVM non compilato descrivono lo stato
storico precedente al report Windows, non il risultato attuale della baseline.
