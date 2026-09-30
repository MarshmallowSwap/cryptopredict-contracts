'use strict';
const $=id=>document.getElementById(id);
let state=null,token='',selected=null,busy=false;
const statusName={open:'Aperto',closed:'Chiuso',resolved:'Risolto',cancelled:'Annullato'};
function text(id,value){$(id).textContent=value;}
function chosen(){return state?.markets.find(m=>m.id===selected);}
function actor(){return Number($('actor').value);}
function message(value,error=false){$('error').hidden=!error; if(error)text('error',value);else text('status',value);}
async function request(url,options){const r=await fetch(url,options);const data=await r.json();if(!r.ok)throw Error(data.error||'Richiesta non riuscita');return data;}
function render(){
  if(!state)return;
  if(state.mode!=='hardhat-local'||state.chainId!==31337)throw Error('Ambiente diverso dalla rete locale: operazioni bloccate');
  if(state.uiTestFixture){document.querySelector('.pill').textContent='TEST UI · DATI SIMULATI';document.querySelector('.notice strong').textContent='Mock grafico: non è un test EVM';}
  text('balance',state.accounting.balance);text('escrow',state.accounting.escrow);text('fees',`${state.accounting.creatorFees} / ${state.accounting.protocolFees}`);text('covered',state.accounting.covered?'Coperta':'NON coperta');text('block',`Blocco locale ${state.blockNumber}`);
  text('wallet-balance',state.accounts[actor()].balance);text('wallet-address',state.accounts[actor()].address);
  text('contract',`Contratto locale: ${state.contract}`);
  const list=$('markets');list.replaceChildren();
  if(!state.markets.length){const p=document.createElement('p');p.className='empty';p.textContent='Nessun mercato ancora. Con il wallet Creatore premi “Crea mercato”.';list.append(p);}
  for(const m of state.markets){const card=document.createElement('button');card.type='button';card.className=`market-card ${m.id===selected?'selected':''}`;card.setAttribute('aria-pressed',String(m.id===selected));
    const tag=document.createElement('small');tag.textContent=`MERCATO #${m.id} · ${m.expired&&m.status==='open'?'Scaduto, da risolvere':statusName[m.status]}`;
    const title=document.createElement('strong');title.textContent=m.question;
    const pools=document.createElement('span');pools.textContent=`YES ${m.yes}   ·   NO ${m.no} USDC`;
    const extra=document.createElement('small');extra.textContent=m.status==='resolved'?`Esito ${m.outcome}`:`Capitale riservato: ${m.escrow} USDC`;
    card.append(tag,title,pools,extra);card.onclick=()=>{selected=m.id;render();};list.append(card);}
  const m=chosen(),p=m?.positions[actor()];const open=m?.status==='open'&&!m.expired;
  text('selection',m?`Operi sul mercato #${m.id}`:'Seleziona un mercato.');text('position',p&&p.amount!=='0.0'?`${p.side?'YES':'NO'} · ${p.amount} USDC`:'Nessuna posizione');text('payout',p?.claimed?'Posizione già riscossa o trasferita':`Vincita attualmente riscuotibile: ${p?.net||'0.0'} USDC`);
  for(const b of document.querySelectorAll('button'))b.disabled=busy;
  $('actor').disabled=busy;$('amount').disabled=busy;
  $('create').disabled=busy||actor()!==0||state.markets.length>=20;
  $('yes').disabled=busy||!open||(p?.amount!=='0.0'&&!p?.side);
  $('no').disabled=busy||!open||(p?.amount!=='0.0'&&p?.side);
  $('claim').disabled=busy||!m||m.status!=='resolved'||p.claimed||p.net==='0.0';
  $('refund').disabled=busy||!m||m.status!=='cancelled'||p.claimed||p.amount==='0.0';
  $('expire').disabled=busy||actor()!==0||!open;
  $('resolve-yes').disabled=$('resolve-no').disabled=busy||actor()!==0||!m||m.status!=='open'||!m.expired;
  $('cancel').disabled=busy||actor()!==0||!m||m.status!=='open';
  const rows=$('receipts');rows.replaceChildren();
  for(const r of [...state.journal].reverse()){const tr=document.createElement('tr');for(const value of [r.label,r.blockNumber,r.transactionHash||'Avanzamento orologio solo locale']){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}rows.append(tr);}
}
async function act(action,side){
  if(busy||!state)return;busy=true;render();message('Operazione in corso sulla blockchain locale…');
  const body={action,actor:actor(),requestId:crypto.randomUUID()};if(action!=='create')body.marketId=selected;
  if(action==='bet'||action==='resolve')body.side=side;if(action==='bet')body.amount=$('amount').value.trim();
  try{state=await request('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-Lab-Token':token},body:JSON.stringify(body)});if(action==='create')selected=state.markets.at(-1).id;message('Operazione locale confermata. Contabilità aggiornata.');}
  catch(e){message(e.message,true);try{state=await request('/api/state');}catch{} }
  finally{busy=false;render();}
}
$('actor').onchange=render;$('create').onclick=()=>act('create');
for(const button of document.querySelectorAll('[data-action]'))button.onclick=()=>act(button.dataset.action,button.dataset.side==='true');
(async()=>{try{const session=await request('/api/session');if(session.mode!=='hardhat-local'||session.origin!==location.origin)throw Error('Sessione non valida');token=session.token;state=await request('/api/state');render();message('Pronto. Inizia creando un mercato di prova.');}catch(e){message(e.message,true);for(const b of document.querySelectorAll('button'))b.disabled=true;}})();
