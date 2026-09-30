'use strict';
// Strict command schema: no arbitrary RPC, destination, private key or Solidity call.
const ACTIONS = new Set(['create','bet','expire','resolve','cancel','claim','refund']);
function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Comando non valido');
  const {action, actor, marketId, side, amount, requestId} = body;
  if (!ACTIONS.has(action) || !Number.isInteger(actor) || actor < 0 || actor > 2) throw Error('Azione o partecipante non valido');
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9-]{16,80}$/.test(requestId)) throw Error('ID richiesta non valido');
  const allowed = ['action','actor','requestId'];
  if (action !== 'create') {
    allowed.push('marketId');
    if (!Number.isInteger(marketId) || marketId < 0 || marketId >= 20) throw Error('Mercato non valido');
  }
  if (action === 'bet' || action === 'resolve') {
    allowed.push('side');
    if (typeof side !== 'boolean') throw Error('Scegli YES o NO');
  }
  if (action === 'bet') {
    allowed.push('amount');
    if (typeof amount !== 'string' || !/^(0|[1-9][0-9]{0,3})(\.[0-9]{1,6})?$/.test(amount)) throw Error('Importo: massimo sei decimali, senza virgole');
    const [whole, fraction=''] = amount.split('.');
    const units = BigInt(whole)*1000000n + BigInt(fraction.padEnd(6,'0'));
    if (units < 1n || units > 1000000000n) throw Error('Importo tra 0.000001 e 1000 USDC di prova');
  }
  if (Object.keys(body).some(k => !allowed.includes(k))) throw Error('Campo non previsto');
  if (['create','expire','resolve','cancel'].includes(action) && actor !== 0) throw Error('Comando riservato al creatore di prova');
  return Object.freeze({...body});
}
module.exports = {validate};
