'use strict';
// Windows laptop edition: the laptop, not an open browser tab, scans exchange
// candles and monitors all confirmed simulated trades. No external packages.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
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
delete config.paper; // Obsolete demo setting from earlier versions.
config.live=liveConfig(config.live);
const ctx={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(BASE,'unified-strategy.js'),'utf8'),ctx);
const strategy=ctx.window.UnifiedStrategy;
if(!strategy||typeof strategy.evaluate!=='function')throw Error('Missing unified-strategy.js');

const loaded=readFile(STATE_FILE,{});
// Keep old demo results in a local archive; no more paper orders run.
if(loaded.paper&&typeof loaded.paper==='object'){
  const archive=path.join(BASE,'binance-paper-archive.json');
  if(!fs.existsSync(archive))fs.writeFileSync(archive,JSON.stringify({
    archivedAt:new Date().toISOString(),label:'Previous Binance paper trading records',
    paper:loaded.paper
  },null,2),'utf8');
}
const state={
  version:1,
  createdAt:loaded.createdAt||Date.now(),
  results:loaded.results&&typeof loaded.results==='object'?loaded.results:{},
  live:loaded.live&&typeof loaded.live==='object'?loaded.live:null,
  markets:{},open:Array.isArray(loaded.open)?loaded.open:[],
  history:Array.isArray(loaded.history)?loaded.history:[],
  trackedKeys:loaded.trackedKeys&&typeof loaded.trackedKeys==='object'?loaded.trackedKeys:{},
  lastScanAt:loaded.lastScanAt||null,lastPriceAt:null,
  lastScanDurationSec:loaded.lastScanDurationSec||null,
  scanning:false,scanned:0,scanTotal:0,scanFailures:0,
  scanAnalyzed:0,scanInsufficient:0,scanStartedAt:null,
  scanPhase:'IDLE',scanMessage:'Starting laptop scanner',
  scanRecent:[],scanRateLimitedUntil:null,
  lastScanCount:loaded.lastScanCount||Object.keys(loaded.results||{}).length,
  lastScanAnalyzed:loaded.lastScanAnalyzed||0,
  errors:Array.isArray(loaded.errors)?loaded.errors.slice(-25):[],
  connection:'Starting laptop scanner',lastSyncAt:null,
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
const liveBroker=new BinanceLiveBroker({
  dir:BASE,config:config.live,state:state.live,persist:persistImmediate,log
});
state.live=liveBroker.state;
config.live=liveBroker.config;
function fault(message){
  state.errors.push({time:Date.now(),message:String(message).slice(0,220)});
  if(state.errors.length>40)state.errors.shift();
  state.connection=String(message);
  persist();log('WARN '+message);
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class ExchangeRateLimitError extends Error {
  constructor(message,until){super(message);this.name='ExchangeRateLimitError';
    this.cooldownUntil=until;}
}
let sendSlot=Promise.resolve(),nextSendAt=0,cooldownUntil=0;
let throttledTimes=0,lastThrottleAt=0;
const MIN_REQUEST_GAP_MS=360; // one shared exchange request slot across scanner & ticker polling
function rateLimitCooldown(message,headerMs=null,ipBan=false){
  const now=Date.now();
  if(now-lastThrottleAt>15*60_000)throttledTimes=0;
  throttledTimes++;lastThrottleAt=now;
  // Bybit 403 IP bans require >=10m; 10006 returns a reset header when
  // available, otherwise back off progressively to avoid a retry storm.
  const backoff=ipBan?11*60_000:
    Math.min(10*60_000,90_000*Math.pow(2,Math.min(3,throttledTimes-1)));
  const headerDelay=Number.isFinite(headerMs)&&headerMs>now&&headerMs<now+30*60_000?
    headerMs-now+2500:0;
  cooldownUntil=Math.max(cooldownUntil,now+Math.max(backoff,headerDelay));
  const waitSeconds=Math.ceil((cooldownUntil-now)/1000);
  state.scanRateLimitedUntil=cooldownUntil;
  state.scanMessage='Exchange rate limited (10006 / HTTP 429 / 403); preserving prior scan. '+
    'Next retry after '+new Date(cooldownUntil).toLocaleTimeString();
  state.scanPhase='RATE_LIMITED';
  return new ExchangeRateLimitError(message+'; retry after '+waitSeconds+' seconds',cooldownUntil);
}
async function waitSlot(){
  // Rate-limit errors must STOP new requests, rather than creating many
  // delayed requests which all resume simultaneously after the cooldown.
  const slot=sendSlot.then(async()=>{
    if(Date.now()<cooldownUntil)
      throw new ExchangeRateLimitError('Exchange in rate-limit cooldown',cooldownUntil);
    const pause=Math.max(0,nextSendAt-Date.now());
    if(pause>0)await sleep(pause);
    if(Date.now()<cooldownUntil)
      throw new ExchangeRateLimitError('Exchange rate limit cooldown activated',cooldownUntil);
    nextSendAt=Date.now()+MIN_REQUEST_GAP_MS;
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
      const headerTime=retry>0?Date.now()+Math.min(30*60_000,retry*1000):null;
      throw rateLimitCooldown('Exchange HTTP '+res.status+' limit',headerTime,res.status===403||res.status===418);
    }
    if(!res.ok){if(attempt===0&&res.status>=500){await sleep(1300);continue}
      throw Error('Exchange data HTTP '+res.status)}
    const obj=await res.json();
    if(obj?.retCode&&obj.retCode!==0){
      if(Number(obj.retCode)===10006){
        const reset=Number(res.headers.get('x-bapi-limit-reset-timestamp'));
        throw rateLimitCooldown('Bybit 10006 Too many visits',
          reset>1e12?reset:null,false);
      }
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
let lastTickers=[],tickerRefreshPromise=null,lastTickerFetchAt=0;
// Reuse the same in-flight ticker request. Previously, a concurrent scan
// received [] while the 10-second price loop was still loading, causing a
// false "No matching futures markets" error.
async function refreshTickers({allowCache=true}={}){
  if(tickerRefreshPromise)return tickerRefreshPromise;
  if(allowCache&&lastTickers.length&&Date.now()-lastTickerFetchAt<25000)
    return lastTickers;
  if(Date.now()<cooldownUntil)
    throw new ExchangeRateLimitError('Exchange ticker feed cooling down',cooldownUntil);
  tickerRefreshPromise=(async()=>{
    let tickers=[];
    if(config.exchange==='bybit'){
      const data=await getJson('https://api.bybit.com/v5/market/tickers?category=linear');
      if(!Array.isArray(data?.result?.list)||!data.result.list.length)
        throw Error('Bybit ticker data unavailable; last completed scan retained');
      tickers=data.result.list.map(k=>({symbol:k.symbol,
        price:+k.markPrice||+k.lastPrice,fundingPct:+k.fundingRate*100,
        vol:+k.turnover24h,change:+k.price24hPcnt*100}));
    }else{
      const [raw,marks]=await Promise.all([
        getJson('https://fapi.binance.com/fapi/v1/ticker/24hr'),
        getJson('https://fapi.binance.com/fapi/v1/premiumIndex')]);
      if(!Array.isArray(raw)||!Array.isArray(marks)||!raw.length||!marks.length)
        throw Error('Binance ticker data unavailable; last completed scan retained');
      const lookup=new Map(marks.map(x=>[x.symbol,x]));
      tickers=raw.map(x=>{const mark=lookup.get(x.symbol)||{};return{
        symbol:x.symbol,price:+mark.markPrice||+x.lastPrice,
        fundingPct:+mark.lastFundingRate*100,vol:+x.quoteVolume,change:+x.priceChangePercent}});
    }
    tickers=tickers.filter(x=>x.symbol&&Number.isFinite(x.price)&&x.price>0);
    if(!tickers.length)throw Error('Exchange ticker feed returned no valid markets');
    const at=Date.now();
    for(const item of tickers)
      state.markets[item.symbol]={p:item.price,fr:item.fundingPct,at};
    state.lastPriceAt=at;
    state.connection='Exchange feed connected';
    lastTickers=tickers;lastTickerFetchAt=at;
    return tickers;
  })();
  try{return await tickerRefreshPromise}finally{tickerRefreshPromise=null}
}
// Live orders now use the freshly updated Binance scanner mark price.
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
    signalCandle:p.ck,open:now,realizedR:null,targetMode:'fixed3r'};
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
    // No time stop: only structural SL, final TP, or explicit local manual close
    // can settle an open simulated trade. Never infer a fill from elapsed time.
  }
}
function closeTrackedManually(id){
  const trade=state.open.find(x=>String(x.id)===String(id));
  if(!trade)throw Error('Tracked trade not found or already closed');
  const mark=state.markets[trade.sym],now=Date.now();
  if(!mark||!Number.isFinite(mark.p)||!(mark.p>0)||now-mark.at>30000)
    throw Error('Fresh exchange price required to record manual simulated exit');
  const dir=trade.dir==='long'?1:-1,risk=Math.abs(trade.en-trade.stop0);
  if(!(risk>0))throw Error('Invalid stored stop-loss distance');
  const grossR=dir*(mark.p-trade.en)/risk;
  settle(trade,'Closed manually (simulated only)',mark.p,grossR);
  return {ok:true,id:trade.id,symbol:trade.sym,price:mark.p,
    note:'This closed only the simulated trade. It did not submit a real Binance order.'};
}
function compactResult(r){
  return {sym:r.sym,status:r.status,dir:r.dir,side:r.dir,
    price:r.price,analyzedAt:r.analyzedAt,
    score:r.score,chg:r.chg,vol:r.vol,G:r.G||r.checks||[],
    rsi:r.rsi,pattern:r.pattern,structure:r.structure,
    reason:r.reason,fundingPct:r.fundingPct,
    plan:r.plan,ok:r.ok};
}
let scanning=false;
async function scan(){
  if(scanning)return;
  scanning=true;
  state.scanning=true;
  state.scanPhase='RUNNING';
  state.scanMessage='Preparing exchange coin universe';
  state.scanStartedAt=Date.now();
  state.scanFailures=0;
  state.scanAnalyzed=0;
  state.scanInsufficient=0;
  state.scanned=0;
  state.scanRecent=[];
  state.scanTotal=0;
  state.scanRateLimitedUntil=null;
  state.nextScanAt=Date.now()+300_000;
  const started=Date.now();
  // Keep the last completed scan visible. In-progress results are published
  // separately through progress and recently scanned coin diagnostics.
  // Never erase a working scanner result set just because the next scan starts.
  const nextResults={};
  let scanUniverse=[];
  try{
    const tickers=await refreshTickers();
    scanUniverse=tickers.filter(x=>x.symbol?.endsWith('USDT')&&!/[_-]/.test(x.symbol)&&
      x.vol>=config.minTurnoverMillions*1e6&&x.price>0)
      .sort((a,b)=>b.vol-a.vol).slice(0,config.scanMax);
    state.scanTotal=scanUniverse.length;
    state.scanMessage=scanUniverse.length?
      'Analyzing '+scanUniverse.length+' '+config.exchange.toUpperCase()+' perpetual markets':
      'The exchange supplied no matching perpetual futures markets';
    if(!scanUniverse.length)throw Error('Ticker feed loaded but no symbols meet your exchange/minimum-volume settings');
    let index=0;
    async function worker(){
      while(index<scanUniverse.length){
        if(Date.now()<cooldownUntil)break;
        const item=scanUniverse[index++],sym=item.symbol;
        let record={sym,price:item.price,chg:item.change,vol:item.vol,dir:null,status:'none',
          score:0,reason:'No qualifying signal',fundingPct:item.fundingPct,
          analyzedAt:Date.now()};
        try{
          const [raw15,raw5]=await Promise.all([
            candles(sym,'15m',99),candles(sym,'5m',220)]);
          const bars15=closed(raw15,15),bars5=closed(raw5,5);
          if(bars15.length<64||bars5.length<40){
            record.status='insufficient';
            record.reason='Insufficient closed candles (15m '+bars15.length+
              ', 5m '+bars5.length+')';
            state.scanInsufficient++;
          }else{
            const mark=state.markets[sym]?.p||item.price;
            const decision=strategy.evaluate({
              bars15,bars5,mark,fundingPct:item.fundingPct,
              maxFunding:config.fundingLimitPct,account:config.account,risk:config.riskPct
            });
            const result={...decision,sym,price:mark,dir:decision.side,
              chg:item.change,vol:item.vol,G:decision.checks||[]};
            record=compactResult(result);
            record.analyzedAt=Date.now();
            state.scanAnalyzed++;
            if(result.status==='confirm'){
              register(result); // Existing simulated results are unchanged.
              // Real trading remains off until the user explicitly arms it.
              if(liveBroker.state.armed&&config.exchange==='binance'){
                const bmark=state.markets[sym];
                if(bmark&&Number.isFinite(bmark.p)&&Date.now()-bmark.at<30000)
                  liveBroker.onSignal(result,'binance',bmark);
              }
            }
          }
        }catch(e){
          if(e instanceof ExchangeRateLimitError){
            record.status='rate-limited';
            record.reason='Exchange cooldown: '+new Date(e.cooldownUntil).toLocaleTimeString();
          }else{
            state.scanFailures++;
            record.status='error';record.reason=String(e.message).slice(0,180);
            if(state.scanFailures<=4)fault(sym+': '+record.reason);
          }
        }finally{
          nextResults[sym]=record;
          state.scanned++;
          state.scanRecent.unshift({sym,status:record.status,
            dir:record.dir||null,reason:record.reason||null,at:Date.now()});
          if(state.scanRecent.length>40)state.scanRecent.length=40;
        }
      }
    }
    await Promise.all(Array.from({length:Math.min(8,scanUniverse.length)},()=>worker()));
    const interrupted=state.scanned<state.scanTotal;
    const completedRows=Object.values(nextResults);
    // Publish only complete successful scan results, or a useful partial
    // result when no prior scan exists. Preserve previous scan on rate limits.
    if((!interrupted&&state.scanAnalyzed>0)||
       (Object.keys(state.results).length===0&&state.scanAnalyzed>0)){
      state.results=nextResults;
      state.lastScanAt=Date.now();
      state.lastScanCount=completedRows.length;
      state.lastScanAnalyzed=state.scanAnalyzed;
      state.lastScanDurationSec=Math.round((Date.now()-started)/1000);
    }
    const rateLimited=Date.now()<cooldownUntil;
    state.scanRateLimitedUntil=rateLimited?cooldownUntil:null;
    state.scanPhase=rateLimited?'RATE_LIMITED':
      interrupted?'PARTIAL':state.scanAnalyzed===0?'NO_DATA':
      state.scanFailures?'COMPLETE_WITH_ERRORS':'COMPLETE';
    state.scanMessage=rateLimited?
      'Exchange rate limited the scanner; retaining last available coin results':
      interrupted?'Scan stopped before the entire universe completed; last results retained':
      state.scanAnalyzed===0?'No market could be fully evaluated; previous results retained':
      'Scan completed: '+state.scanAnalyzed+' evaluated, '+
        state.scanFailures+' errors, '+state.scanInsufficient+' insufficient histories';
    state.connection=state.scanMessage;
    persist();
    log('Scan '+state.scanPhase+': '+state.scanned+'/'+state.scanTotal+
      ' processed, '+state.scanAnalyzed+' evaluated, errors='+state.scanFailures+
      ', insufficient='+state.scanInsufficient+
      ', stored='+Object.keys(state.results).length);
  }catch(e){
    if(e instanceof ExchangeRateLimitError||Date.now()<cooldownUntil){
      state.scanPhase='RATE_LIMITED';
      state.scanRateLimitedUntil=cooldownUntil;
      state.scanMessage='Exchange rate limit (Bybit 10006 / HTTP protection). '+
        'Previous coin results retained; cooldown until '+
        new Date(cooldownUntil).toLocaleTimeString();
      log('Scan cooling down; previous analysis retained');
    }else{
      state.scanPhase='ERROR';
      state.scanMessage='Scan error: '+String(e.message).slice(0,160)+
        '. Previous coin data has been retained.';
      fault(state.scanMessage);
    }
  }finally{
    state.scanning=false;
    scanning=false;
    state.scanRateLimitedUntil=Date.now()<cooldownUntil?cooldownUntil:null;
    // No overlapping full scans and no additional requests inside a cooldown.
    state.nextScanAt=Math.max(Date.now()+20000,started+300000,cooldownUntil+3000);
    persist();
  }
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
    scanFailures:state.scanFailures,scanAnalyzed:state.scanAnalyzed,
    scanInsufficient:state.scanInsufficient,scanPhase:state.scanPhase,
    scanMessage:state.scanMessage,scanStartedAt:state.scanStartedAt,
    scanRecent:state.scanRecent,scanRateLimitedUntil:state.scanRateLimitedUntil,
    lastScanCount:state.lastScanCount,lastScanAnalyzed:state.lastScanAnalyzed,
    lastScanAt:state.lastScanAt,lastScanDurationSec:state.lastScanDurationSec,
    lastPriceAt:state.lastPriceAt,errors:state.errors.slice(-8),
    connection:state.connection,nextScanAt:state.nextScanAt,
    markets,results:Object.values(state.results),
    open:state.open,history,historyTotal:totalHistory,
    trackedKeys:state.trackedKeys};
  while(!fullHistory&&Buffer.byteLength(JSON.stringify(out))>1_900_000&&history.length>100){
    history=history.slice(Math.ceil(history.length/4));
    out.history=history;
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
let lastManualRefreshAt=0;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/api/state'&&req.method==='GET')
    return respond(res,200,{...snapshot(true),config:{exchange:config.exchange,
      scanMax:config.scanMax,account:config.account,riskPct:config.riskPct,
      fundingLimitPct:config.fundingLimitPct,feePct:config.feePct,
      minTurnoverMillions:config.minTurnoverMillions},
      lastSyncAt:state.lastSyncAt});
  if(url.pathname==='/api/refresh'){
    const remote=(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
    const host=req.headers.host,origin=req.headers.origin;
    const localHosts=['127.0.0.1:'+config.port,'localhost:'+config.port];
    if(req.method!=='POST')return respond(res,405,{error:'POST only'});
    if(!['127.0.0.1','::1'].includes(remote)||!localHosts.includes(host)||
       (origin&&!localHosts.some(x=>origin==='http://'+x)))
      return respond(res,403,{error:'Refresh can only be requested from the local desktop'});
    if(!String(req.headers['content-type']||'').startsWith('application/json'))
      return respond(res,415,{error:'JSON required'});
    const now=Date.now();
    if(state.scanning)return respond(res,200,{ok:true,scanning:true,
      message:'Scanner already running — current progress is refreshing'});
    if(now<cooldownUntil)return respond(res,429,{
      error:'Exchange rate-limit cooldown: next retry after '+new Date(cooldownUntil).toLocaleTimeString()});
    if(liveBroker.state.armed)return respond(res,423,{
      error:'Pause REAL automatic Binance trading before requesting an extra scan. Normal scheduled scans continue.'});
    if(now-lastManualRefreshAt<90000)return respond(res,429,{
      error:'Manual refresh limited to once every 90 seconds to protect API rate limits'});
    lastManualRefreshAt=now;
    scan().catch(e=>fault('Manual scan failed: '+e.message));
    return respond(res,202,{ok:true,scanning:true,
      message:'New scan requested. Existing coin results are retained until it completes.'});
  }
  if(url.pathname==='/api/trades/manual-close'){
    const remote=(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
    const host=req.headers.host;
    const origin=req.headers.origin;
    const localHosts=['127.0.0.1:'+config.port,'localhost:'+config.port];
    if(req.method!=='POST')return respond(res,405,{error:'POST only'});
    if(!['127.0.0.1','::1'].includes(remote)||!localHosts.includes(host)||
       (origin&&!localHosts.some(x=>origin==='http://'+x)))
      return respond(res,403,{error:'Manual close available from the local desktop only'});
    if(!String(req.headers['content-type']||'').startsWith('application/json'))
      return respond(res,415,{error:'JSON required'});
    let buffer='',bytes=0;
    req.on('data',chunk=>{bytes+=chunk.length;
      if(bytes<=2500)buffer+=chunk;else req.destroy()});
    req.on('end',()=>{
      try{
        const body=JSON.parse(buffer||'{}');
        if(typeof body.id!=='string'||body.confirm!==true)
          throw Error('Explicit simulated manual-close confirmation required');
        return respond(res,200,closeTrackedManually(body.id));
      }catch(e){return respond(res,400,{error:String(e.message).slice(0,180)})}
    });
    return;
  }
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
        // Real credentials are accepted only by the separate, local secure
        // Binance live-account connection, never scanner settings.
        const allowed=new Set(['exchange','scanMax','minTurnoverMillions',
          'account','riskPct','fundingLimitPct','feePct']);
        for(const key of Object.keys(data)){
          if(!allowed.has(key))throw Error('Unrecognized setting. Enter real Binance credentials through the local live-account panel');
        }
        const was=config.exchange;config=normalizedConfig({...config,...data});
        delete config.paper;
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
    '/unified-strategy.js':'unified-strategy.js',
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
  try{await refreshTickers();monitor()}
  catch(e){
    if(!(e instanceof ExchangeRateLimitError)&&Date.now()>=cooldownUntil)
      fault('TICKERS '+e.message);
  }
  // Positions are protected by Binance-side conditional SL and TP orders.
  // Reconciliation here updates the local record, never replaces protection.
  if(liveBroker.state.orders.some(x=>x.status==='ACTIVE')&&!liveBroker.busy){
    liveBroker.busy=true;
    liveBroker.reconcile().catch(e=>fault('BINANCE LIVE STATUS '+e.message))
      .finally(()=>{liveBroker.busy=false});
  }
  setTimeout(polling,25_000);
}
async function scheduleScan(){
  await scan();setTimeout(scheduleScan,Math.max(15_000,state.nextScanAt-Date.now()));
}
polling();scheduleScan();setInterval(syncRemote,20_000);
setTimeout(syncRemote,5_000);
process.on('SIGINT',()=>{log('Stopping');server.close(()=>process.exit(0))});
process.on('uncaughtException',e=>fault('Process exception '+e.message));
process.on('unhandledRejection',e=>fault('Unhandled async '+String(e)));
