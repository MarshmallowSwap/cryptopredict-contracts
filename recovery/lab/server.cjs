'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {validate} = require('./input.cjs');
const STATIC = {'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
function makeServer(engine) {
  const token = crypto.randomBytes(32).toString('hex');
  const requests = new Map();
  const server = http.createServer(async(req,res)=>{
    const origin = `http://127.0.0.1:${server.address().port}`;
    const send = (status,value,type='application/json; charset=utf-8') => {
      res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
        'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"});
      res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
    };
    const remote = req.socket.remoteAddress;
    if (remote!=='127.0.0.1' || req.headers.host!==`127.0.0.1:${server.address().port}` ||
        (req.headers.origin && req.headers.origin!==origin) || req.headers['sec-fetch-site']==='cross-site') return send(403,{error:'Solo accesso locale dalla pagina del laboratorio'});
    if (!['GET','POST'].includes(req.method)) return send(405,{error:'Metodo non consentito'});
    if (req.method==='GET' && req.url==='/favicon.ico') return send(204,'','image/x-icon');
    if (req.method==='GET' && STATIC[req.url]) {
      const [file,type] = STATIC[req.url];
      return send(200,fs.readFileSync(path.join(__dirname,file)),type);
    }
    try {
      if (req.method==='GET' && req.url==='/api/session') return send(200,{token,origin,mode:'hardhat-local'});
      if (req.method==='GET' && req.url==='/api/state') return send(200,await engine.state());
      if (req.method==='GET' && req.url==='/api/report') {
        res.setHeader('Content-Disposition','attachment; filename="CryptoPredict-lab-report.json"');
        return send(200,await engine.report());
      }
      if (req.method!=='POST' || req.url!=='/api/action') return send(404,{error:'Risorsa non trovata'});
      const supplied=req.headers['x-lab-token'];
      if (typeof supplied!=='string' || !/^[0-9a-f]{64}$/.test(supplied) || !crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(token)) || req.headers.origin!==origin) return send(403,{error:'Sessione locale non valida'});
      if (req.headers['content-type']!=='application/json') return send(415,{error:'Richiesto application/json'});
      let body='',size=0;
      for await(const chunk of req) {
        size+=chunk.length;
        if(size>4096) return send(413,{error:'Comando troppo grande'});
        body+=chunk.toString('utf8');
      }
      let command;
      try { command=validate(JSON.parse(body)); } catch(e) { return send(400,{error:e.message}); }
      const fingerprint=JSON.stringify(Object.fromEntries(Object.entries(command).sort()));
      const previous=requests.get(command.requestId);
      if(previous) {
        if(previous.fingerprint!==fingerprint) return send(409,{error:'ID richiesta già usato per un comando diverso'});
        const result=await previous.result;
        return send(result.status,result.value);
      }
      if(requests.size>=500) return send(429,{error:'Limite sessione raggiunto; riavvia il laboratorio'});
      const result=Promise.resolve().then(()=>engine.execute(command)).then(value=>({status:200,value}),e=>({status:409,value:{error:String(e.reason||e.shortMessage||e.message||'Comando non riuscito').slice(0,400)}}));
      requests.set(command.requestId,{fingerprint,result});
      const reply=await result;
      send(reply.status,reply.value);
    } catch(e) { send(500,{error:String(e.message||'Errore locale').slice(0,400)}); }
  });
  server.requestTimeout=15000;
  server.headersTimeout=10000;
  server.maxHeadersCount=40;
  return server;
}
async function start() {
  const {createEngine}=require('./engine.cjs');
  const engine=await createEngine();
  const server=makeServer(engine);
  server.listen(8787,'127.0.0.1',()=>console.log('\nCryptoPredict laboratorio pronto: http://127.0.0.1:8787\nSolo token di prova. Chiudere questa finestra elimina la blockchain locale.\n'));
  server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Porta 8787 occupata: chiudi il precedente laboratorio.':e.message);process.exitCode=1;});
  let closing=false;
  async function stop() {
    if(closing) return; closing=true;
    try { fs.writeFileSync(path.join(__dirname,'../lab-session-report.json'),JSON.stringify(await engine.report(),null,2)+'\n'); }
    catch(e) { console.error('Report finale non salvato:',e.message); }
    server.close(()=>process.exit(0));server.closeAllConnections();
  }
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
module.exports={makeServer};
if(require.main===module) start().catch(e=>{console.error('Laboratorio NON avviato:',e.message);process.exitCode=1;});
