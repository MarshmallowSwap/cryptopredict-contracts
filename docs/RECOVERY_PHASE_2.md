# CryptoPredict — Fase 2: candidato contratti e verifiche

Data: 30 settembre 2026. Stato: DRAFT; nessun deploy, merge o migrazione.
Baseline contratti: `5d6b085388077cc68f3597ea465493be8e145258`.
La proposta di sorgente gia preparata e stata recuperata dal tree
`ec1e00aa20656e272827540d82a09d046b45ed7c` e completata con test e documentazione.
Il blob del candidato `contracts/PredictionMarket.sol` e
`da68fa9dc420d8fe9cb2c2973be88c4c36652a49`.

## Risultati effettivamente osservati

- **26 test Python passati** sull'oracolo contabile indipendente. Uno dei test
  esegue **5.000 scenari deterministici**, seed 20260930, con importi interi,
  valute, vincitori, arrotondamenti e sconti differenti.
- **47 casi EVM preparati**: 8 casi per ognuna delle 4 valute, piu 15 casi
  avversari/cross-market. Verificati sintassi JavaScript e registrazione dei casi
  con Node 22.16.0. I corpi dei test EVM NON sono stati eseguiti localmente.
- Python locale: 3.13.5. Nessuna richiesta a un database, nessuna firma su reti
  pubbliche e nessuna chiave reale nei test.
- L'ambiente locale non risolve api.github.com/registry.npmjs.org e non dispone
  di Solidity/Hardhat. **Compilazione, bytecode e test EVM non sono convalidati.**
  Il workflow CI e predisposto per queste verifiche: il suo esito deve essere
  letto separatamente e non puo essere dedotto dal risultato del modello Python.
- Le impronte Git dei tre nuovi file di modello/test coincidono con i file
  controllati localmente. Il sorgente Solidity non e stato dichiarato compilato.

## Correzioni proposte nel sorgente, da validare in EVM

1. Payout e rimborsi nella valuta del mercato; ERC20 tramite SafeERC20 e verifiche
   dell'importo effettivamente trasferito. Nessuna conversione implicita in ETH.
2. Saldi riservati separati per mercato e valuta; crediti del creatore e fee
   protocollo separati dal capitale degli utenti. `withdraw()` non preleva piu
   l'intero saldo: la proposta lo limita alle sole fee protocollo contabilizzate.
3. Fee ordinaria 2% complessivo, incluso l'1% creatore; non 2% piu 1%. Lo sconto
   CPRED mantiene l'1% complessivo, lasciando zero fee protocollo in quel caso.
   Sono formule su importi lordi con arrotondamento intero, non una garanzia di
   percentuale esatta su qualsiasi microimporto o aggregazione di posizioni.
4. Nessuno yield sintetico nel payout; nessun trasferimento al vecchio staking
   durante resolve/claim. Lo yield del tuple ABI resta zero.
5. Risoluzione autorizzata solo dopo la scadenza; nessun movimento di fondi nella
   risoluzione. Se il lato selezionato non ha puntate, annullamento rimborsabile.
6. Riscossione delle fee separata: un creatore che rifiuta ETH non deve bloccare
   un vincitore. Destinatario alternativo per claim e refund; controlli di
   rientranza e rollback quando un trasferimento fallisce.
7. Posizioni trasferite recuperabili senza flag `claimed` obsoleti; indici
   utente deduplicati. Asset collateral e autorizzazione secondaria bloccati
   dopo la creazione del primo mercato.

Queste sono proprieta del candidato letto, non garanzie gia verificate sul
bytecode o sui contratti in esercizio.

## Decisioni di prodotto che NON vanno nascoste nel rilascio

Il seed iniziale e qui modellato come **vera posizione YES del creatore**, quindi
puo perdere. Non e liquidita neutrale AMM. Prima di un deployment va confermato
questo modello economico oppure riprogettato il seed e aggiornati test e UI.

Lo sconto CPRED dipende dal saldo al momento del claim, come nel percorso legacy;
lo stesso saldo potrebbe essere riutilizzato per piu claim. Restano da definire
politica dello sconto, ruolo dei token stakati e comunicazione agli utenti.

I residui di arrotondamento restano riservati; non esiste un prelievo automatico
deI residui o delle donazioni. La politica sui residui richiede una scelta futura.

## Limiti e prerequisiti di sicurezza

- Non e un audit. Rimangono da verificare limiti gas, compilazione viaIR, dimensione
  bytecode, token reali ammessi, casi aggiuntivi di callback, permessi e liveness.
- Non sono supportati token con rebasing o commissioni di trasferimento. Il solo
  controllo di code.length non certifica l'affidabilita di un token.
- La risoluzione e ancora amministrativa: non dimostra un risultato esterno.
  Servono regole verificabili, evidenze del prezzo alla scadenza, dispute e una
  politica per resolver non disponibile/rinuncia dell'owner. Mai usare il prezzo
  di oggi per risolvere automaticamente un mercato scaduto mesi fa.
- Il vecchio PositionMarket non e convalidato. Nel primo deployment candidato
  l'indirizzo secondario e quello staking devono rimanere zero. L'attuale modello
  aggregato di custodia delle posizioni richiede revisione prima di collegarlo.
- Non usare gli script legacy `scripts/deploy*.js`: installano/collegano altri
  componenti e non producono ancora l'attestazione richiesta per questa versione.
- Nessuna migrazione automatica dei saldi legacy e nessun upgrade in-place.
  Conservare sempre rete + contratto + marketId nei dati indicizzati.

## Riproducibilita e test

Le dipendenze dirette del progetto `recovery/` sono fissate; manca ancora un
lockfile installato e revisionato per le dipendenze transitive. La CI esporta il
lockfile generato e il manifest sorgenti come artefatti; prima del merge occorre
commettere il lockfile revisionato e passare a `npm ci`.

```sh
python -m unittest discover -s validation -v
node --check recovery/test/prediction-market.test.js
npm --prefix recovery install --ignore-scripts --no-audit --no-fund
npm --prefix recovery test
```

Il test EVM include identita delle copie di sorgente e limite runtime EIP-170.
Un controllo sintattico JavaScript non verifica le API Hardhat ne il bytecode.
La suite usa fixture fittizie e chain locale 31337, mai wallet reali.

## Collegamento ambiente confermato

Frontend corretto: Vercel `vaultworlds-projects/cryptopredict`, progetto
`prj_rpJ5dOsk5B9vj9bkdXRUPvptDamW`. Deployment letto `dpl_G6rSWAFdUrtZ9T7FXXurVPdpBPVD`,
stato READY, commit frontend `2da50ae`, produzione del 7 aprile 2026.

GET del catalogo API sul dominio pubblico: osservato HTTP 308 verso upstream
HTTPS esterno. Il vecchio vercel.json configura l'upstream HTTP. La risposta finale
non e stata ottenuta; non e prova di backend spento o di TLS correttamente
configurato. Non sono stati inoltrati token al redirect esterno. Nessun cambio
arbitrario dell'upstream effettuato.

## Prossimi gate, nell'ordine

1. Leggere l'esito CI e ottenere una vera compilazione/test EVM; fissare il lockfile.
2. Revisionare modello del seed, fee e casi residui; bloccare automazioni live.
3. Verificare backup/ripristino, rotazione credenziali e backend HTTPS.
4. Preparare manifest deployment, ABI e script dedicato alla sola testnet, poi
   collaudare wallet/UI/database in ambiente separato senza fondi reali.
5. Audit indipendente e valutazione del prodotto prima di qualsiasi mainnet.
