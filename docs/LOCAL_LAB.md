# CryptoPredict — laboratorio locale di integrazione

## Cosa è pronto

Interfaccia browser + API loopback + adattatore al contratto Hardhat in memoria.
Si usano tre account di prova (Creatore, Alice, Bob) e USDC fixture a sei decimali.
Non si collegano MetaMask, Supabase, Vercel, oracoli, staking o mercato secondario.
Non è l'aggiornamento del frontend pubblico e non è un nuovo deployment testnet.

Il contratto, fixture Solidity, configurazione Hardhat e 47 test già superati sul
PC Windows del proprietario sono INVARIATI. Il nuovo adattatore e il nuovo smoke
test devono essere eseguiti sul PC: qui non è stato possibile installare Hardhat.

## Lockfile completo conservato in repository

`recovery/locked-dependencies/part-00.b64` ... `part-23.b64` contengono il lockfile
originale COMPRESSO, non soltanto la sua impronta. Un piccolo script Node senza
dipendenze ricostruisce i 149.197 byte esatti in `recovery/package-lock.json`.
Non sono aggiornate né ricalcolate le versioni. Non sovrascrive file differenti.
SHA-256 originale:
`7ce81bdcdc07f2cc540602b3889baccc4d657f1b87c5f4999bbbf50c3d8d6e45`.
La serializzazione a blocchi serve per conservare il contenuto attraverso il
connettore; non è codice da eseguire. Gzip, lunghezza e SHA-256 sono verificati.

## Avvio manuale (Node già disponibile)

Dalla radice della copia SEPARATA del repository, branch recovery:

```sh
node recovery/tools/restore-lock.cjs
node recovery/tools/verified-baseline.cjs check
npm --prefix recovery ci --ignore-scripts --include=dev --no-audit --no-fund
node recovery/tools/verified-baseline.cjs check
npm --prefix recovery run compile
node recovery/lab/smoke.cjs
node recovery/lab/server.cjs
```

Aprire `http://127.0.0.1:8787`. Il server ascolta solo IPv4 loopback. Nessuna
porta RPC è esposta. Una porta già occupata causa un errore, non l'arresto di
processi altrui. Non esiste una modalità mock di ripiego nel launcher.

## Percorso guidato

1. Creatore: crea un mercato con 100 USDC, registrati come posizione YES.
2. Alice: punta 100 USDC su NO. Entrambi iniziano con 1.000 USDC fixture.
3. Creatore: porta alla scadenza; scegli Risolvi NO.
4. Alice: riscuoti. Il saldo atteso in questo scenario è 1.096 USDC; il contratto
   conserva 2 USDC di credito creatore e 2 USDC di commissioni protocollo.
5. Esporta il report JSON: conserva ricevute e stato di questa sessione.

Gli esiti sono manuali per collaudare i pagamenti, NON previsioni o fatti esterni.
Il seed YES è una scelta provvisoria del candidato e può perdere; non è LP neutro.
Il pulsante di scadenza modifica soltanto l'orologio della blockchain locale.
La blockchain in memoria si perde alla chiusura. Il report non permette di
ripristinarla e non sostituisce un database, un backup o un indexer di produzione.

## Verifiche di questa tranche

- 29 test Node passati su input, archivio lock e API HTTP: per l'API viene usato
  un test double esplicito, non una finta attestazione di esecuzione EVM.
- 12 controlli DOM in Chromium, desktop/mobile e transizioni dei pulsanti, con
  fixture OFFLINE marcata “TEST UI · DATI SIMULATI”. L'accesso HTTP del browser
  era bloccato dall'ambiente; HTTP è stato testato separatamente con Node.
- Controlli sintattici dei nuovi file JavaScript superati.
- `lab/smoke.cjs` prepara tre scenari EVM reali (pagamento, doppio claim negato,
  rimborso completo). Non sono stati eseguiti qui. Il launcher Windows li esegue
  prima di aprire la UI e si ferma in caso di errore.

Il launcher non ripete i 47 test della baseline, non usa Actions e non deposita
fondi su reti pubbliche. Mantiene Node e dipendenze in una nuova copia locale.

## Sicurezza e limiti

Richieste limitate a Host/Origin locali, token anti-CSRF per sessione, body massimo
4 KiB, schema dei comandi chiuso, idempotenza per requestId e operazioni seriali.
Nessuna chiamata RPC arbitraria, destinazione arbitraria o chiave privata accettata.
La soglia di 500 comandi e 20 mercati limita una sessione del laboratorio.
I controlli non sono un sistema di autenticazione di produzione e non sostituiscono
una revisione indipendente. Non esporre la porta con tunnel o reverse proxy.
Il controllo SHA-256 dell'artefatto è conservativo: differenze di build fermano
l'avvio e richiedono revisione, non un aggiornamento automatico dell'impronta.

Nessun merge su main, nessun deployment pubblico e nessuna modifica ai dati.
