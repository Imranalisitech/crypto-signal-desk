'use strict';
const http = require('node:http');
const { URL } = require('node:url');
const { timingSafeEqual } = require('node:crypto');

const PORT = Number(process.env.PORT || 10000);
const UPSTREAM = 'https://fapi.binance.com';
const ALLOWED_ORIGIN = 'https://crypto-signal-desk.onrender.com';
const cache = new Map();
let active = 0, lastStart = 0, queue = [], bannedUntil = 0, banMessage = '';
// The authenticated Windows laptop is the only allowed writer for the
// remote dashboard snapshot. Data also persists on the laptop's disk; Render
// stores only a live memory mirror and may forget it after a restart.
const SYNC_TOKEN = process.env.LAPTOP_SYNC_TOKEN || '';
let laptopMirror = null;
let laptopLastSeen = 0;
function authLaptop(req){
  const provided=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!SYNC_TOKEN||!provided)return false;
  const a=Buffer.from(provided),b=Buffer.from(SYNC_TOKEN);
  return a.length===b.length&&timingSafeEqual(a,b);
}
function readJSON(req,maxBytes=2_500_000){
  return new Promise((resolve,reject)=>{
    let total=0,parts=[];
    req.on('data',chunk=>{
      total+=chunk.length;
      if(total>maxBytes){reject(new Error('Payload too large'));req.destroy();return;}
      parts.push(chunk);
    });
    req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')))}catch(e){reject(e)}});
    req.on('error',reject);
  });
}

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
const server = http.createServer(async (req,res) => {
  const origin = req.headers.origin || '';
  if (origin === ALLOWED_ORIGIN) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/laptop/sync') {
    if(req.method!=='POST') {res.writeHead(405);return res.end(JSON.stringify({error:'POST required'}));}
    if(!authLaptop(req)){res.writeHead(401);return res.end(JSON.stringify({error:'Laptop authentication required'}));}
    try{
      const snap=await readJSON(req);
      if(snap?.type!=='crypto-signal-desk-laptop'||snap?.version!==1||
         !Array.isArray(snap.results)||!Array.isArray(snap.open)||
         !Array.isArray(snap.history)||!snap.markets||typeof snap.markets!=='object')
        throw new Error('Invalid laptop snapshot');
      // A delayed POST from a previous scan must never bring back CLOSED
      // history that was already cleared in a newer laptop snapshot.
      const cleared=Math.max(Number(laptopMirror?.historyClearEpoch)||0,
        Number(snap.historyClearEpoch)||0,0);
      snap.historyClearEpoch=cleared;
      snap.history=snap.history.filter(t=>Number(t.close)>cleared);
      laptopMirror=snap;laptopLastSeen=Date.now();
      res.setHeader('Cache-Control','no-store');
      res.writeHead(200);return res.end(JSON.stringify({ok:true,receivedAt:laptopLastSeen}));
    }catch(e){
      if(!res.writableEnded){res.writeHead(400);return res.end(JSON.stringify({error:e.message}));}
      return;
    }
  }
  if (u.pathname === '/laptop/state') {
    if(req.method!=='GET'){res.writeHead(405);return res.end(JSON.stringify({error:'GET required'}));}
    const ageSeconds=laptopLastSeen?Math.floor((Date.now()-laptopLastSeen)/1000):null;
    const connected=!!laptopMirror&&ageSeconds<120;
    res.setHeader('Cache-Control','no-store');
    res.writeHead(200);
    return res.end(JSON.stringify({connected,lastSeen:laptopLastSeen||null,
      ageSeconds,snapshot:laptopMirror}));
  }
  if (req.method !== 'GET') { res.writeHead(405); return res.end(JSON.stringify({error:'GET only'})); }
  if (u.pathname === '/health') {
    res.writeHead(200); return res.end(JSON.stringify({ok:true,cacheEntries:cache.size,upstreamCooldownSeconds:Math.max(0,Math.ceil((bannedUntil-Date.now())/1000))}));
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
