'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {validate}=require('../lab/input.cjs');
const {restore,EXPECTED}=require('../tools/restore-lock.cjs');
const {makeServer}=require('../lab/server.cjs');
const ID='00000000-0000-4000-a000-000000000001';
function command(action='bet',extra={}){return {action,actor:1,requestId:ID,marketId:0,side:false,amount:'50',...extra};}
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cpred-lock-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.cpSync(path.join(__dirname,'../locked-dependencies'),path.join(dir,'locked-dependencies'),{recursive:true});return dir;}
for(const value of ['0.000001','1','10.25','1000.000000'])test(`amount accepted ${value}`,()=>assert.equal(validate(command('bet',{amount:value})).amount,value));
for(const value of ['0','-1','1e3','0.0000001','1,5','1000.000001',1,NaN])test(`amount rejected ${String(value)}`,()=>assert.throws(()=>validate(command('bet',{amount:value}))));
test('role and arbitrary call parameters rejected',()=>{assert.throws(()=>validate(command('bet',{actor:3})));assert.throws(()=>validate(command('bet',{rpc:'https://example.com'})));assert.throws(()=>validate(command('eth_sendTransaction')));});
test('administrative commands require actor zero',()=>assert.throws(()=>validate({action:'cancel',actor:1,marketId:0,requestId:ID})));
test('invalid market IDs and missing request IDs rejected',()=>{assert.throws(()=>validate(command('bet',{marketId:20})));assert.throws(()=>validate(command('bet',{requestId:'short'})));});
test('restore original and idempotently preserve it',t=>{const dir=temp(t);assert.equal(restore(dir).status,'restored');assert.equal(restore(dir).status,'already-identical');assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(dir,'package-lock.json'))).digest('hex'),EXPECTED);});
test('restore refuses a different existing lock',t=>{const dir=temp(t);fs.writeFileSync(path.join(dir,'package-lock.json'),'{}');assert.throws(()=>restore(dir),/not overwritten/);assert.equal(fs.readFileSync(path.join(dir,'package-lock.json'),'utf8'),'{}');});
test('corrupted archive rejected before file creation',t=>{const dir=temp(t);fs.writeFileSync(path.join(dir,'locked-dependencies/part-09.b64'),'x');assert.throws(()=>restore(dir));assert(!fs.existsSync(path.join(dir,'package-lock.json')));});
test('missing archive part rejected',t=>{const dir=temp(t);fs.unlinkSync(path.join(dir,'locked-dependencies/part-10.b64'));assert.throws(()=>restore(dir));});
test('symlink lock destination rejected',t=>{const dir=temp(t);const external=path.join(dir,'other');fs.writeFileSync(external,'{}');try{fs.symlinkSync(external,path.join(dir,'package-lock.json'));}catch(e){if(e.code==='EPERM'){t.skip('OS denies unprivileged symlink');return;}throw e;}assert.throws(()=>restore(dir));});
async function fixture(t){
 let calls=0;const engine={state:async()=>({mode:'http-test-double'}),report:async()=>({testDouble:true}),execute:async c=>{calls++;await new Promise(r=>setTimeout(r,5));return {action:c.action,calls};}};
 const server=makeServer(engine);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const origin=`http://127.0.0.1:${server.address().port}`;
 async function request(url,options={}){const response=await fetch(origin+url,options);const text=await response.text();return {status:response.status,headers:response.headers,data:response.headers.get('content-type').includes('application/json')?JSON.parse(text):text};}
 const token=(await request('/api/session')).data.token;
 function post(body=command(),headers={}){return request('/api/action',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Lab-Token':token,...headers},body:JSON.stringify(body)});}
 return {origin,request,post,calls:()=>calls,server};
}
test('HTTP serves assets with restrictive CSP',async t=>{const f=await fixture(t);const r=await f.request('/');assert.equal(r.status,200);assert.match(r.data,/Nessun fondo reale/);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(r.headers.get('cache-control'),'no-store');});
test('HTTP rejects cross-origin reads and writes',async t=>{const f=await fixture(t);assert.equal((await f.request('/api/session',{headers:{Origin:'https://evil.invalid'}})).status,403);assert.equal((await f.post(command(),{Origin:'https://evil.invalid'})).status,403);assert.equal(f.calls(),0);});
test('HTTP rejects missing/invalid local token and origin',async t=>{const f=await fixture(t);assert.equal((await f.post(command(),{'X-Lab-Token':'wrong'})).status,403);assert.equal((await f.post(command(),{Origin:''})).status,403);assert.equal(f.calls(),0);});
test('HTTP validates payload before engine dispatch',async t=>{const f=await fixture(t);assert.equal((await f.post(command('bet',{amount:'-100'}))).status,400);assert.equal(f.calls(),0);});
test('HTTP repeats request id without a second execution',async t=>{const f=await fixture(t);const [a,b]=await Promise.all([f.post(),f.post()]);assert.equal(a.status,200);assert.deepEqual(a.data,b.data);assert.equal(f.calls(),1);assert.equal((await f.post(command('bet',{amount:'60'}))).status,409);assert.equal(f.calls(),1);});
test('HTTP rejects oversized and incorrect-type bodies',async t=>{const f=await fixture(t);assert.equal((await f.post(command('bet',{amount:'1'.repeat(5000)}))).status,413);assert.equal((await f.post(command(),{'Content-Type':'text/plain'})).status,415);assert.equal(f.calls(),0);});
test('HTTP has no generic RPC or filesystem routes',async t=>{const f=await fixture(t);for(const url of ['/rpc','/.env','/engine.cjs','/api/eth_sendTransaction','/package-lock.json'])assert.equal((await f.request(url)).status,404);});
test('HTTP rejects rebinding Host headers',async t=>{const f=await fixture(t);const status=await new Promise((resolve,reject)=>{const req=http.get(f.origin+'/api/session',{headers:{Host:'evil.invalid'}},r=>{r.resume();resolve(r.statusCode);});req.on('error',reject);});assert.equal(status,403);});
test('HTTP exports only engine report',async t=>{const f=await fixture(t);const r=await f.request('/api/report');assert.equal(r.status,200);assert.equal(r.data.testDouble,true);assert.match(r.headers.get('content-disposition'),/attachment/);});
