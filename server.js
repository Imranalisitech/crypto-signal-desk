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
