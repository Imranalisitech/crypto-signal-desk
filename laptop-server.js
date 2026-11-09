'use strict';
// Windows laptop edition: the laptop, not an open browser tab, scans exchange
// candles and monitors all confirmed simulated trades. No external packages.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {BinancePaperBroker,normalizePaperConfig}=require('./binance-paper.js');
const {BinanceLiveBroker,liveConfig}=require('./binance-live.js');

if(typeof fetch!=='function')throw Error('Node.js 20 or newer required.');
const BASE=__dirname,STATE_FILE=path.join(BASE,'laptop-state.json'),
  CONFIG_FILE=path.join(BASE,'laptop-config.json');
const DEFAULTS={exchange:'bybit',scanMax:500,minTurnoverMillions:0,
  account:2000,riskPct:.5,fundingLimitPct:.05,feePct:.075,
  port:17654,remoteSyncUrl:'',syncToken:''};
const safeNumber=(v,def,min,max)=>Number.isFinite(+v)&&+v>=min&&+v<=max?+v:def;
function readFile(file,fallback){
  try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch(_){return fallback}
}
let config={...DEFAULTS,...readFile(CONFIG_FILE,{})};
function normalizedConfig(raw){
  return {...config,exchange:raw.exchange==='binance'?'binance':'bybit',
    scanMax:Math.trunc(safeNumber(raw.scanMax,500,1,800)),
    minTurnoverMillions:safeNumber(raw.minTurnoverMillions,0,0,10000),
    account:safeNumber(raw.account,2000,.01,1000000000),
    riskPct:safeNumber(raw.riskPct,.5,.001,10),
    fundingLimitPct:safeNumber(raw.fundingLimitPct,.05,0,10),
    feePct:safeNumber(raw.feePct,.075,0,5),
    port:Math.trunc(safeNumber(raw.port,17654,1024,65535))};
}
config=normalizedConfig(config);
config.paper=normalizePaperConfig(config.paper);
config.live=liveConfig(config.live);
const ctx={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(BASE,'unified-strategy.js'),'utf8'),ctx);
const strategy=ctx.window.UnifiedStrategy;
if(!strategy||typeof strategy.evaluate!=='function')throw Error('Missing unified-strategy.js');

const loaded=readFile(STATE_FILE,{});
const state={
  version:1,
  createdAt:loaded.createdAt||Date.now(),
  results:loaded.results&&typeof loaded.results==='object'?loaded.results:{},
  paper:loaded.paper&&typeof loaded.paper==='object'?loaded.paper:null,
  live:loaded.live&&typeof loaded.live==='object'?loaded.live:null,
  markets:{},open:Array.isArray(loaded.open)?loaded.open:[],
  history:Array.isArray(loaded.history)?loaded.history:[],
  trackedKeys:loaded.trackedKeys&&typeof loaded.trackedKeys==='object'?loaded.trackedKeys:{},
  lastScanAt:loaded.lastScanAt||null,lastPriceAt:null,
  lastScanDurationSec:loaded.lastScanDurationSec||null,
  scanning:false,scanned:0,scanTotal:0,scanFailures:0,
  errors:[],connection:'Starting laptop scanner',lastSyncAt:null,
  nextScanAt:0
};
// Backfill keys from previous tracked trades so historical signals remain deduplicated.
for(const trade of [...state.open,...state.history]){
  if(trade.signalKey)state.trackedKeys[trade.signalKey]=state.trackedKeys[trade.signalKey]||trade.open||Date.now();
}
let persistTimer=null;
function persist(){
  if(persistTimer)return;
  persistTimer=setTimeout(()=>{
    persistTimer=null;
    try{
      const tmp=STATE_FILE+'.tmp';
      const disk={...state,markets:{},scanning:false,errors:state.errors.slice(-30)};
      fs.writeFileSync(tmp,JSON.stringify(disk),'utf8');
      fs.renameSync(tmp,STATE_FILE);
    }catch(e){log('SAVE ERROR '+e.message)}
  },250);
}
// Real-money order identities must reach disk synchronously BEFORE an entry
// is submitted, so a sudden crash cannot create an unremembered duplicate.
function persistImmediate(){
  const tmp=STATE_FILE+'.live-tmp';
  const disk={...state,markets:{},scanning:false,errors:state.errors.slice(-30)};
  fs.writeFileSync(tmp,JSON.stringify(disk),{encoding:'utf8',flush:true});
  fs.renameSync(tmp,STATE_FILE);
}
function log(message){
  const line=new Date().toISOString()+' '+message;
  console.log(line);
  try{fs.appendFileSync(path.join(BASE,'laptop-server.log'),line+'\n')}catch(_){}
}
const paperBroker=new BinancePaperBroker({config:config.paper,state:state.paper,persist,log});
state.paper=paperBroker.state;
const liveBroker=new BinanceLiveBroker({
  dir:BASE,config:config.live,state:state.live,persist:persistImmediate,log
});
state.live=liveBroker.state;
config.live=liveBroker.config;
config.paper=paperBroker.config;
function fault(message){
  state.errors.push({time:Date.now(),message:String(message).slice(0,220)});
  if(state.errors.length>40)state.errors.shift();
  state.connection=String(message);
  persist();log('WARN '+message);
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let sendSlot=Promise.resolve(),nextSendAt=0,cooldownUntil=0;
async function waitSlot(){
  const slot=sendSlot.then(async()=>{
    const pause=Math.max(0,nextSendAt-Date.now(),cooldownUntil-Date.now());
    if(pause>0)await sleep(pause);
    nextSendAt=Date.now()+180;
  });
  sendSlot=slot.catch(()=>{});
  await slot;
}
async function getJson(url){
  for(let attempt=0;attempt<2;attempt++){
    await waitSlot();
    let res;
    try{res=await fetch(url,{signal:AbortSignal.timeout(18_000),
      headers:{'Accept':'application/json','User-Agent':'CryptoSignalDeskLaptop/1.0'}})}
    catch(e){if(attempt===0){await sleep(1200);continue;}throw e}
    if(res.status===429||res.status===418||res.status===403){
      const retry=Number(res.headers.get('retry-after'))||0;
      cooldownUntil=Date.now()+Math.min(15*60_000,Math.max(90_000,retry*1000));
      throw Error('Exchange rate limit HTTP '+res.status+'; scanner cooling down');
    }
    if(!res.ok){if(attempt===0&&res.status>=500){await sleep(1300);continue}
      throw Error('Exchange data HTTP '+res.status)}
    const obj=await res.json();
    if(obj?.retCode&&obj.retCode!==0){
      if(obj.retCode===10006)cooldownUntil=Date.now()+90_000;
      throw Error('Bybit '+obj.retCode+': '+String(obj.retMsg||'data unavailable'));
    }
    return obj;
  }
  throw Error('Market request failed');
}
const EXCHANGE_INTERVALS={'5m':'5','15m':'15'};
async function candles(symbol,interval,count){
  if(config.exchange==='bybit'){
    const data=await getJson('https://api.bybit.com/v5/market/kline?category=linear&symbol='+
      encodeURIComponent(symbol)+'&interval='+EXCHANGE_INTERVALS[interval]+'&limit='+count);
    const list=data?.result?.list;
    if(!Array.isArray(list))throw Error('Bybit candle list unavailable');
    return list.map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]})).reverse();
  }
  const data=await getJson('https://fapi.binance.com/fapi/v1/klines?symbol='+
    encodeURIComponent(symbol)+'&interval='+interval+'&limit='+count);
  if(!Array.isArray(data))throw Error('Binance candle list unavailable');
  return data.map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}));
}
function closed(bars,minutes){
  const now=Date.now()-1500,span=minutes*60_000;
  return bars.filter(k=>Number.isFinite(k.t)&&Number.isFinite(k.c)&&k.t+span<=now);
}
let tickersBusy=false,lastTickers=[];
async function refreshTickers(){
  if(tickersBusy)return lastTickers;
  tickersBusy=true;
  try{
    let tickers=[];
    if(config.exchange==='bybit'){
      const data=await getJson('https://api.bybit.com/v5/market/tickers?category=linear');
      if(!Array.isArray(data?.result?.list))throw Error('Bybit ticker data unavailable');
      tickers=data.result.list.map(k=>({symbol:k.symbol,
        price:+k.markPrice||+k.lastPrice,fundingPct:+k.fundingRate*100,
        vol:+k.turnover24h,change:+k.price24hPcnt*100}));
    }else{
      const [raw,marks]=await Promise.all([
        getJson('https://fapi.binance.com/fapi/v1/ticker/24hr'),
        getJson('https://fapi.binance.com/fapi/v1/premiumIndex')]);
      const lookup=new Map(marks.map(x=>[x.symbol,x]));
      tickers=raw.map(x=>{const mark=lookup.get(x.symbol)||{};return{
        symbol:x.symbol,price:+mark.markPrice||+x.lastPrice,
        fundingPct:+mark.lastFundingRate*100,vol:+x.quoteVolume,change:+x.priceChangePercent}});
    }
    for(const item of tickers){
      if(item.symbol&&Number.isFinite(item.price)&&item.price>0)
        state.markets[item.symbol]={p:item.price,fr:item.fundingPct,at:Date.now()};
    }
    state.lastPriceAt=Date.now();
    state.connection='Exchange feed connected';
    lastTickers=tickers;
    return tickers;
  }finally{tickersBusy=false}
}
// Binance Futures public mark-price feed is used exclusively by the local
// paper execution simulator. The scanner may still use Bybit or Binance data.
let paperPricesBusy=false,paperLastErrorAt=0;
async function refreshPaperMarks(){
  if(paperPricesBusy||!paperBroker.config.enabled)return;
  paperPricesBusy=true;
  try{
    const marks=await getJson('https://fapi.binance.com/fapi/v1/premiumIndex');
    if(!Array.isArray(marks))throw Error('Binance public mark-price feed unavailable');
    const count=paperBroker.setMarks(marks);
    if(count<10)throw Error('Binance mark-price feed contains too few symbols');
    paperBroker.monitor();
  }catch(e){
    paperBroker.state.feedError=String(e.message).slice(0,160);
    if(Date.now()-paperLastErrorAt>120000){
      paperLastErrorAt=Date.now();fault('PAPER BINANCE FEED '+e.message);
    }
  }finally{paperPricesBusy=false}
}
function signalKey(r){
  const time=Number(r.plan?.ck);
  if(!r.sym||!['long','short'].includes(r.dir)||!(time>0))return null;
  return [config.exchange,r.sym,r.dir,time].join(':');
}
function register(r){
  if(r.status!=='confirm'||!r.plan)return false;
  const p=r.plan,key=signalKey(r);
  if(!key||state.trackedKeys[key])return false;
  const timestamp=Number(p.ck),now=Date.now();
  // Never open a simulated position on stale confirmation candles after
  // an offline period or several minutes of scanning backlog.
  if(now-timestamp<0||now-(timestamp+300_000)>12*60_000)return false;
  if(![p.en,p.stop,p.tp2,p.sp].every(x=>Number.isFinite(x)&&x>0))return false;
  const dir=r.dir==='long'?1:-1;
  if(dir*(p.en-p.stop)<=0||dir*(p.tp2-p.en)<=0)return false;
  const rr=Math.abs(p.tp2-p.en)/Math.abs(p.en-p.stop);
  if(Math.abs(rr-3)>.01)return false;
  const trade={id:now+'-'+Math.random().toString(36).slice(2,8),signalKey:key,
    sym:r.sym,dir:r.dir,en:p.en,stop:p.stop,stop0:p.stop,
    tp1:p.tp2,tp2:p.tp2,sp:p.sp,r$:p.r$,source:config.exchange,
    signalCandle:p.ck,open:now,realizedR:null,targetMode:'fixed3r',
    horizonMs:4*3600000};
  state.open.push(trade);
  state.trackedKeys[key]=now;persist();
  log('CONFIRMED '+r.dir.toUpperCase()+' '+r.sym+' entry='+p.en+' SL='+p.stop+' TP='+p.tp2);
  return true;
}
function settle(t,reason,price,grossR){
  const fee=safeNumber(config.feePct,.075,0,5),r=grossR-fee/t.sp;
  state.history.push({id:t.id,signalKey:t.signalKey,sym:t.sym,dir:t.dir,
    signalCandle:t.signalCandle,source:t.source,
    open:t.open,close:Date.now(),en:t.en,stop:t.stop0,tp:t.tp2,
    ex:price,r,pnl:r*t.r$,why:reason});
  state.open=state.open.filter(x=>x.id!==t.id);
  persist();
  log('RESULT '+t.sym+' '+reason+' '+r.toFixed(3)+'R');
}
function monitor(){
  const now=Date.now(),fresh=state.lastPriceAt&&now-state.lastPriceAt<30_000;
  if(!fresh)return;
  for(const trade of [...state.open]){
    const mark=state.markets[trade.sym];
    if(!mark||now-mark.at>30_000)continue;
    const price=mark.p,dir=trade.dir==='long'?1:-1,unit=Math.abs(trade.en-trade.stop0);
    if(!(unit>0))continue;
    const currentR=dir*(price-trade.en)/unit;
    if(dir*(price-trade.stop)<=0)settle(trade,'Stop loss (1R)',price,-1);
    else if(dir*(price-trade.tp2)>=0)settle(trade,'Final target reached (3R)',price,3);
    else if(now-trade.open>(trade.horizonMs||4*3600000))
      settle(trade,'Time stop (4 hours)',price,currentR);
  }
}
function compactResult(r){
  return {sym:r.sym,status:r.status,dir:r.dir,side:r.dir,
    score:r.score,chg:r.chg,vol:r.vol,G:r.G||r.checks||[],
    rsi:r.rsi,pattern:r.pattern,reason:r.reason,fundingPct:r.fundingPct,
    plan:r.plan,ok:r.ok};
}
let scanning=false;
async function scan(){
  if(scanning)return;
  scanning=true;state.scanning=true;state.scanFailures=0;state.scanned=0;
  state.nextScanAt=Date.now()+300_000;
  const start=Date.now();
  try{
    const tickers=await refreshTickers();
    const list=tickers.filter(x=>x.symbol?.endsWith('USDT')&&!/[_-]/.test(x.symbol)&&
      x.vol>=config.minTurnoverMillions*1e6&&x.price>0)
      .sort((a,b)=>b.vol-a.vol).slice(0,config.scanMax);
    state.scanTotal=list.length;state.results={};
    let index=0;
    async function worker(){
      while(index<list.length){
        if(Date.now()<cooldownUntil)break;
        const item=list[index++];
        try{
          const [raw15,raw5]=await Promise.all([
            candles(item.symbol,'15m',99),candles(item.symbol,'5m',220)]);
          const bars15=closed(raw15,15),bars5=closed(raw5,5);
          if(bars15.length<64||bars5.length<40)continue;
          const px=state.markets[item.symbol]?.p||item.price;
          const decision=strategy.evaluate({
            bars15,bars5,mark:px,fundingPct:item.fundingPct,
            maxFunding:config.fundingLimitPct,account:config.account,risk:config.riskPct
          });
          const result={...decision,sym:item.symbol,dir:decision.side,
            chg:item.change,vol:item.vol,G:decision.checks||[]};
          state.results[item.symbol]=compactResult(result);
          if(result.status==='confirm'){
            register(result); // Existing simulated trade results are unchanged.
            paperBroker.onSignal(result,config.exchange); // Separate, risk-capped paper ledger.
            // This can send REAL orders only after local credential verification
            // and explicit user activation. Disabled by default on every boot.
            if(liveBroker.state.armed&&config.exchange==='binance'){
              const bmark=paperBroker.marks[item.symbol];
              liveBroker.onSignal(result,'binance',bmark);
            }
          }
        }catch(e){state.scanFailures++;
          if(state.scanFailures<=4)fault(item.symbol+': '+e.message)}
        finally{state.scanned++}
      }
    }
    await Promise.all(Array.from({length:Math.min(8,list.length)},worker));
    state.lastScanAt=Date.now();state.lastScanDurationSec=Math.round((Date.now()-start)/1000);
    state.connection=state.scanFailures?'Scan complete with '+state.scanFailures+' data errors':
      'Scan complete';
    persist();
    log('Scan: '+state.scanned+'/'+state.scanTotal+', confirmed='+
      Object.values(state.results).filter(x=>x.status==='confirm').length+
      ', errors='+state.scanFailures);
  }catch(e){fault('SCAN '+e.message)}
  finally{state.scanning=false;scanning=false;state.nextScanAt=
    Math.max(Date.now()+20_000,start+300_000,cooldownUntil);persist()}
}
function snapshot(fullHistory=false){
  const active=new Set([...Object.keys(state.results),...state.open.map(x=>x.sym)]);
  const markets={};
  for(const sym of active)if(state.markets[sym])markets[sym]=state.markets[sym];
  let history=state.history;
  const totalHistory=history.length;
  // Always keep the COMPLETE history on the laptop. Trim only the remote
  // mirror if its JSON would exceed the secured Render relay size limit.
  let out={type:'crypto-signal-desk-laptop',version:1,
    generatedAt:Date.now(),exchange:config.exchange,
    createdAt:state.createdAt,scanning:state.scanning,
    scanned:state.scanned,scanTotal:state.scanTotal,
    scanFailures:state.scanFailures,lastScanAt:state.lastScanAt,
    lastPriceAt:state.lastPriceAt,errors:state.errors.slice(-5),
    connection:state.connection,nextScanAt:state.nextScanAt,
    markets,results:Object.values(state.results),
    open:state.open,history,historyTotal:totalHistory,
    trackedKeys:state.trackedKeys,paper:paperBroker.snapshot(fullHistory)};
  while(!fullHistory&&Buffer.byteLength(JSON.stringify(out))>1_900_000&&history.length>100){
    history=history.slice(Math.ceil(history.length/4));
    out.history=history;
  }
  // Bound the public read-only Render snapshot without ever trimming local
  // full histories stored in laptop-state.json.
  while(!fullHistory&&Buffer.byteLength(JSON.stringify(out))>1_900_000&&out.paper.history.length>40){
    out.paper.history=out.paper.history.slice(Math.ceil(out.paper.history.length/4));
    out.paper.historyTruncated=true;
  }
  while(!fullHistory&&Buffer.byteLength(JSON.stringify(out))>1_900_000&&out.paper.rejections.length>20){
    out.paper.rejections=out.paper.rejections.slice(Math.ceil(out.paper.rejections.length/4));
  }
  out.historyTruncated=history.length<totalHistory;
  return out;
}
let syncing=false;
async function syncRemote(){
  if(syncing||!config.syncToken||!config.remoteSyncUrl)return;
  syncing=true;
  try{
    const r=await fetch(config.remoteSyncUrl,{method:'POST',headers:{
      Authorization:'Bearer '+config.syncToken,'Content-Type':'application/json'},
      body:JSON.stringify(snapshot()),signal:AbortSignal.timeout(15_000)});
    if(!r.ok)throw Error('Render sync HTTP '+r.status);
    state.lastSyncAt=Date.now();
  }catch(e){if(Date.now()-(state.lastSyncAt||0)>120_000)fault('Render sync: '+e.message)}
  finally{syncing=false}
}
function respond(res,code,data){
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/api/state'&&req.method==='GET')
    return respond(res,200,{...snapshot(true),config:{exchange:config.exchange,
      scanMax:config.scanMax,account:config.account,riskPct:config.riskPct,
      fundingLimitPct:config.fundingLimitPct,feePct:config.feePct,
      minTurnoverMillions:config.minTurnoverMillions,paper:paperBroker.config},
      lastSyncAt:state.lastSyncAt,paper:paperBroker.summary()});
  if(url.pathname==='/api/config'&&req.method==='POST'){
    // Reject cross-site browser requests that try to alter laptop settings.
    const allowedOrigins=new Set(['http://127.0.0.1:'+config.port,'http://localhost:'+config.port]);
    const origin=req.headers.origin;
    if(origin&&!allowedOrigins.has(origin))return respond(res,403,{error:'Local dashboard only'});
    if(!String(req.headers['content-type']||'').startsWith('application/json'))
      return respond(res,415,{error:'JSON request required'});
    let buf='',size=0;
    req.on('data',chunk=>{size+=chunk.length;if(size<5000)buf+=chunk;else req.destroy()});
    req.on('end',()=>{
      try{
        const data=JSON.parse(buf);
        if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid config');
        // This app has no authenticated Binance trading route. Reject unknown
        // fields and secrets rather than ever writing exchange keys to disk.
        const allowed=new Set(['exchange','scanMax','minTurnoverMillions',
          'account','riskPct','fundingLimitPct','feePct','paper']);
        for(const key of Object.keys(data)){
          if(!allowed.has(key))throw Error('Unrecognized setting; Binance trading credentials are not accepted in paper mode');
        }
        if(data.paper&&(!data.paper||typeof data.paper!=='object'||Array.isArray(data.paper)))
          throw Error('Paper controls must be an object');
        const was=config.exchange;config=normalizedConfig({...config,...data});
        if(data.paper&&typeof data.paper==='object'){
          paperBroker.setConfig(data.paper);
        }
        config.paper=paperBroker.config;
        if(was!==config.exchange&&liveBroker.state.armed)
          liveBroker.disarm('Market exchange changed');
        fs.writeFileSync(CONFIG_FILE,JSON.stringify(config,null,2));
        if(was!==config.exchange){state.results={};state.markets={};lastTickers=[]}
        respond(res,200,{ok:true});
      }catch(e){respond(res,400,{error:e.message})}
    });
    return;
  }
  if(url.pathname.startsWith('/api/binance-live/')){
    // All real-account operations are strictly localhost. These routes are
    // NOT part of Render relay snapshots and accept NO cross-origin access.
    const remote=(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
    const origin=req.headers.origin;
    const expectedPort=config.port;
    const safeOrigin=!origin||origin==='http://127.0.0.1:'+expectedPort||
      origin==='http://localhost:'+expectedPort;
    const safeHost=['127.0.0.1:'+expectedPort,'localhost:'+expectedPort].includes(req.headers.host);
    if(!['127.0.0.1','::1'].includes(remote)||!safeOrigin||!safeHost)
      return respond(res,403,{error:'Real Binance account controls are available only on the local desktop'});
    const action=url.pathname.slice('/api/binance-live/'.length);
    if(action==='status'&&req.method==='GET')
      return respond(res,200,liveBroker.status());
    if(req.method!=='POST')return respond(res,405,{error:'POST required'});
    if(!String(req.headers['content-type']||'').startsWith('application/json'))
      return respond(res,415,{error:'JSON only'});
    let input='',bytes=0;
    req.on('data',chunk=>{bytes+=chunk.length;
      if(bytes<=6000)input+=chunk;else req.destroy()});
    req.on('end',async()=>{
      try{
        const data=JSON.parse(input||'{}');
        let answer;
        if(action==='connect'){
          if(typeof data.apiKey!=='string'||typeof data.apiSecret!=='string')
            throw Error('Enter the Binance API key and secret on this laptop');
          answer=await liveBroker.connect(data.apiKey,data.apiSecret);
        }else if(action==='verify'){
          await liveBroker.verify();answer=liveBroker.status();
        }else if(action==='arm'){
          if(config.exchange!=='binance')
            throw Error('Select Binance in the scanner settings before activating live trading');
          answer=await liveBroker.arm(data.phrase);
        }else if(action==='disarm'){
          liveBroker.disarm('Paused from local desktop');answer=liveBroker.status();
        }else if(action==='settings'){
          config.live=liveBroker.changeConfig(data);
          fs.writeFileSync(CONFIG_FILE,JSON.stringify(config,null,2));
          answer=liveBroker.status();
        }else if(action==='disconnect'){
          if(liveBroker.state.orders.some(x=>['ACTIVE','PENDING','UNKNOWN','UNPROTECTED'].includes(x.status)))
            throw Error('Resolve existing real Binance orders and positions before removing the API connection');
          liveBroker.removeCredentials();answer=liveBroker.status();
        }else return respond(res,404,{error:'Unknown live-account action'});
        respond(res,200,answer);
      }catch(e){respond(res,400,{error:String(e.message).slice(0,210)})}
    });
    return;
  }
  if(url.pathname==='/api/health'||url.pathname==='/health')
    return respond(res,200,{ok:true,scanning:state.scanning,lastScanAt:state.lastScanAt,
      open:state.open.length,closed:state.history.length,lastPriceAt:state.lastPriceAt,
      lastSyncAt:state.lastSyncAt});
  const name=url.pathname==='/'?'/index.html':url.pathname;
  const fileAllowed={'/index.html':'index.html','/trade-chart.js':'trade-chart.js',
    '/unified-strategy.js':'unified-strategy.js','/paper-dashboard.js':'paper-dashboard.js',
    '/binance-live-ui.js':'binance-live-ui.js'};
  if(req.method!=='GET'||!fileAllowed[name])return respond(res,404,{error:'Not found'});
  try{
    let contents=fs.readFileSync(path.join(BASE,fileAllowed[name]),'utf8');
    if(name==='/index.html')contents=contents.replace('<head>',
      '<head><script>window.CRYPTO_LOCAL_SERVER=true;</script>');
    res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':'text/html; charset=utf-8',
      'Cache-Control':'no-cache'});
    res.end(contents);
  }catch(e){respond(res,500,{error:e.message})}
});
server.listen(config.port,'127.0.0.1',()=>log('Laptop server ready at http://127.0.0.1:'+config.port));
async function polling(){
  try{await refreshTickers();monitor()}catch(e){fault('TICKERS '+e.message)}
  try{await refreshPaperMarks()}catch(e){fault('BINANCE PAPER '+e.message)}
  // Positions are protected by Binance-side conditional SL and TP orders.
  // Reconciliation here updates the local record, never replaces protection.
  if(liveBroker.state.orders.some(x=>x.status==='ACTIVE')&&!liveBroker.busy){
    liveBroker.busy=true;
    liveBroker.reconcile().catch(e=>fault('BINANCE LIVE STATUS '+e.message))
      .finally(()=>{liveBroker.busy=false});
  }
  setTimeout(polling,10_000);
}
async function scheduleScan(){
  await scan();setTimeout(scheduleScan,Math.max(15_000,state.nextScanAt-Date.now()));
}
polling();scheduleScan();setInterval(syncRemote,20_000);
setTimeout(syncRemote,5_000);
process.on('SIGINT',()=>{log('Stopping');server.close(()=>process.exit(0))});
process.on('uncaughtException',e=>fault('Process exception '+e.message));
process.on('unhandledRejection',e=>fault('Unhandled async '+String(e)));
