'use strict';
const http = require('node:http');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 10000);
const UPSTREAM = 'https://fapi.binance.com';
const ALLOWED_ORIGIN = 'https://crypto-signal-desk.onrender.com';
const cache = new Map();
let active = 0, lastStart = 0, queue = [], bannedUntil = 0, banMessage = '';

const sleep = ms => new Promise(r => setTimeout(r, ms));
function ttlFor(path, params) {
  if (path.endsWith('/exchangeInfo')) return 60 * 60 * 1000;
  if (path.endsWith('/ticker/24hr')) return 15 * 1000;
  if (path.endsWith('/premiumIndex')) return 20 * 1000;
  if (path.endsWith('/klines')) return params.get('interval') === '1h' ? 45 * 1000 : 15 * 1000;
  if (path.includes('/openInterestHist') || path.includes('/takerlongshortRatio')) return 60 * 1000;
  if (path.endsWith('/depth')) return 5 * 1000;
  return 10 * 1000;
}
function cacheKey(path, params) {
  const sorted = [...params.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  return path + '?' + new URLSearchParams(sorted).toString();
}
async function upstream(url) {
  if (Date.now() < bannedUntil) {
    const e = new Error(banMessage || 'Upstream cooldown active');
    e.status = 503; e.retryAfter = Math.ceil((bannedUntil-Date.now())/1000); throw e;
  }
  if (active >= 2) await new Promise(resolve => queue.push(resolve));
  const wait = Math.max(0, 350 - (Date.now() - lastStart));
  if (wait) await sleep(wait);
  active++; lastStart = Date.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'CryptoSignalDesk/1.0' }, signal: AbortSignal.timeout(15000) });
    if (res.status === 418 || res.status === 429) {
      const retry = Number(res.headers.get('retry-after') || 0);
      const cooldown = retry > 0 ? retry * 1000 : (res.status === 418 ? 15*60*1000 : 60*1000);
      bannedUntil = Date.now() + cooldown;
      banMessage = res.status === 418 ? 'Binance temporarily restricted this server IP. Cached data will be used until the cooldown ends.' : 'Binance rate limit reached. Cached data will be used until the cooldown ends.';
      const e = new Error(banMessage); e.status = 503; e.retryAfter = Math.ceil(cooldown/1000); throw e;
    }
    if (!res.ok) { const e = new Error('Binance upstream HTTP ' + res.status); e.status = 502; throw e; }
    return await res.json();
  } finally {
    active--;
    const next = queue.shift(); if (next) next();
  }
}
// Glassnode licensed API integration. The API key MUST stay in the Render
// backend environment; never send it in the browser or a GitHub file.
const GLASSNODE_KEY = process.env.GLASSNODE_API_KEY || '';
const GLASSNODE_ASSETS = new Set(['BTC','ETH','SOL','XRP','ADA','DOGE','BNB','LTC','LINK','AVAX','DOT','TRX']);
const glassnodeCache = new Map();
let glassnodeBudgetDate = '', glassnodeDailyCalls = 0;
const MAX_GLASSNODE_CALLS_PER_DAY = 36; // maximum *upstream* HTTP requests, not coins
function metricSamples(data){
  if (!Array.isArray(data)) return [];
  return data.map(x=>({t:Number(x.t),v:Number(x.v)}))
    .filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.v))
    .sort((a,b)=>a.t-b.t);
}
async function queryGlassnode(path,asset,since){
  const date = new Date().toISOString().slice(0,10);
  if(glassnodeBudgetDate!==date){glassnodeBudgetDate=date;glassnodeDailyCalls=0}
  if(glassnodeDailyCalls>=MAX_GLASSNODE_CALLS_PER_DAY)throw new Error('Glassnode daily request budget reached');
  glassnodeDailyCalls++;
  const query=new URLSearchParams({a:asset,i:'1h',s:String(since),f:'json'});
  const url='https://api.glassnode.com/v1/metrics/'+path+'?'+query.toString();
  const resp=await fetch(url,{
    headers:{'X-Api-Key':GLASSNODE_KEY,'Accept':'application/json'},
    redirect:'manual',
    signal:AbortSignal.timeout(14000)
  });
  if(!resp.ok)throw new Error(resp.status===401||resp.status===403?'Access or subscription does not include Glassnode metric':'Glassnode HTTP '+resp.status);
  return metricSamples(await resp.json());
}
async function glassnodeSnapshot(asset){
  if(!GLASSNODE_KEY)return {status:'unconfigured',source:'Glassnode',reason:'Glassnode API key not configured'};
  if(!GLASSNODE_ASSETS.has(asset))return {status:'unsupported',source:'Glassnode',reason:'Asset not in verified integration allowlist'};
  const now=Date.now(),old=glassnodeCache.get(asset);
  if(old&&now-old.time<60*60000)return old.data;
  const since=Math.floor((now-12*3600000)/1000);
  let result;
  try{
    const [net,oi]=await Promise.all([
      queryGlassnode('transactions/transfers_volume_exchanges_net',asset,since),
      queryGlassnode('derivatives/futures_open_interest_sum_all',asset,since)
    ]);
    const last=net.at(-1),earlier=net.slice(-7,-1);
    const baseline=earlier.length?
      earlier.reduce((sum,x)=>sum+Math.abs(x.v),0)/earlier.length:0;
    const newestOI=oi.at(-1),oldOI=oi.at(-5) || oi[0];
    const oiDelta=newestOI&&oldOI&&oldOI.v>0?(newestOI.v/oldOI.v-1)*100:null;
    const ageMinutes=last?(now-last.t*1000)/60000:null;
    if(!last||!Number.isFinite(ageMinutes)||ageMinutes< -10||ageMinutes>240||!(baseline>0)){
      result={status:'unavailable',source:'Glassnode',reason:'Metrics missing or stale'};
    }else{
      result={status:'available',source:'Glassnode',asset,netflow:last.v,
        netflowBaseline:baseline,oiChangePct:oiDelta,ageMinutes,
        metricTime:last.t*1000,updatedAt:now,
        metrics:['exchange netflow','futures open interest']};
    }
  }catch(e){
    result={status:'unavailable',source:'Glassnode',reason:String(e.message).slice(0,140)};
  }
  // A failing paid query is throttled too; do not retry on every browser refresh.
  glassnodeCache.set(asset,{time:now,data:result});
  return result;
}
const server = http.createServer(async (req,res) => {
  const origin = req.headers.origin || '';
  if (origin === ALLOWED_ORIGIN) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'GET') { res.writeHead(405); return res.end(JSON.stringify({error:'GET only'})); }
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/health') {
    res.writeHead(200); return res.end(JSON.stringify({ok:true,cacheEntries:cache.size,upstreamCooldownSeconds:Math.max(0,Math.ceil((bannedUntil-Date.now())/1000))}));
  }
  if (u.pathname === '/glassnode/status') {
    res.writeHead(200);return res.end(JSON.stringify({
      provider:'Glassnode',configured:!!GLASSNODE_KEY,
      note:GLASSNODE_KEY?'Licensed Glassnode API enabled':'No licensed API key configured; no Glassnode metric claims',
      supportedAssets:[...GLASSNODE_ASSETS]
    }));
  }
  if (u.pathname === '/glassnode/metrics') {
    const asset=String(u.searchParams.get('a')||'').toUpperCase();
    if(!/^[A-Z0-9]{2,10}$/.test(asset)){res.writeHead(400);return res.end(JSON.stringify({status:'invalid',reason:'Invalid asset symbol'}))}
    const data=await glassnodeSnapshot(asset);
    res.setHeader('Cache-Control','public, max-age=600');
    res.writeHead(200);return res.end(JSON.stringify(data));
  }
  if (!u.pathname.startsWith('/fapi/v1/') && !u.pathname.startsWith('/futures/data/')) {
    res.writeHead(404); return res.end(JSON.stringify({error:'Endpoint not allowed'}));
  }
  const key = cacheKey(u.pathname,u.searchParams), now = Date.now(), old = cache.get(key);
  if (old && now-old.time < ttlFor(u.pathname,u.searchParams)) {
    res.setHeader('X-Cache','HIT'); res.writeHead(200); return res.end(JSON.stringify(old.data));
  }
  try {
    const data = await upstream(UPSTREAM + key);
    cache.set(key,{data,time:Date.now()});
    res.setHeader('X-Cache','MISS'); res.writeHead(200); return res.end(JSON.stringify(data));
  } catch (e) {
    if (old) {
      res.setHeader('X-Cache','STALE'); res.writeHead(200); return res.end(JSON.stringify(old.data));
    }
    if (e.retryAfter) res.setHeader('Retry-After',String(e.retryAfter));
    res.writeHead(e.status || 502); return res.end(JSON.stringify({error:e.message,retryAfter:e.retryAfter || null}));
  }
});
server.listen(PORT,'0.0.0.0',()=>console.log('Crypto Signal Desk market-data cache listening on '+PORT));
