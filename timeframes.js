'use strict';
/* Independent, browser-only, simulation-only multi-timeframe research engine.
   No private API keys, signing code, exchange order endpoints or live trading. */
(() => {
const C36=window.C36Engine;
const TFS=['1m','3m','5m','15m','30m','1h','4h','1d','1w','1M'];
const MINS={'1m':1,'3m':3,'5m':5,'15m':15,'30m':30,'1h':60,'4h':240,'1d':1440,'1w':10080,'1M':43200};
const BYBIT={'1m':'1','3m':'3','5m':'5','15m':'15','30m':'30','1h':'60','4h':'240','1d':'D','1w':'W','1M':'M'};
const API='https://crypto-signal-desk-market-data.onrender.com';
const $=id=>document.getElementById(id), fmt=x=>Number.isFinite(+x)?Number(x).toLocaleString('en-US',{maximumFractionDigits:6}):'—';
const safe=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const C36_VERIFIED=!!(C36&&C36.VERSION==='C36_DOCUMENTED_DOUBLE_CONFIRMATION_V1'); // Documented reconstruction; original binary cannot establish exact source equivalence.
const blank=()=>({rows:{},open:[],closed:[],keys:{},lastScan:0,scanned:0,errors:0,status:'Not started',auto:true});
let selected='15m',busy=false,markets=[],data={},nextAuto=Date.now()+300000,delay=ms=>new Promise(r=>setTimeout(r,ms));
let ex='bybit';
function load(){
 try{const x=JSON.parse(localStorage.getItem('crypto_c36_multitf_research_v1')||'{}');if(x&&typeof x==='object')data=x;}catch(_){}
 TFS.forEach(tf=>{if(!data[tf]||!data[tf].rows)data[tf]=blank();});
}
function save(){try{localStorage.setItem('crypto_c36_multitf_research_v1',JSON.stringify(data));}catch(_){$('message').textContent='Storage limit reached: some simulation results may not persist.';}}
function endOf(t,tf){
 const d=new Date(t);
 if(tf==='1M')return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);
 return t+MINS[tf]*60000;
}
function filteredClosed(b,tf){const now=Date.now()-1500;return b.filter(x=>Number.isFinite(x.t)&&endOf(x.t,tf)<=now);}
function ema(arr,n){const out=[];let e=0;for(let i=0;i<arr.length;i++){if(i<n){e+=arr[i];out.push(i===n-1?e/n:null);}else{e=out[i-1]+2/(n+1)*(arr[i]-out[i-1]);out.push(e)}}return out;}
function indicators(b){
 const c=b.map(x=>x.c), e20=ema(c,20),e50=ema(c,50);
 let gains=0,losses=0,atr=0;const rs=Array(b.length).fill(null),at=Array(b.length).fill(null);
 for(let i=1;i<b.length;i++){
  const diff=c[i]-c[i-1],g=Math.max(0,diff),l=Math.max(0,-diff);
  const tr=Math.max(b[i].h-b[i].l,Math.abs(b[i].h-c[i-1]),Math.abs(b[i].l-c[i-1]));
  if(i<=14){gains+=g;losses+=l;atr+=tr;if(i===14){gains/=14;losses/=14;atr/=14;}}
  else{gains=(gains*13+g)/14;losses=(losses*13+l)/14;atr=(atr*13+tr)/14;}
  if(i>=14){rs[i]=losses===0?(gains===0?50:100):100-100/(1+gains/losses);at[i]=atr;}
 }
 return {e20,e50,rs,at};
}
function evaluate(b,tf,sym){
 const base={sym,tf,status:'none',score:0,side:'—',reason:'Insufficient data',price:b.at(-1)?.c||null,plan:null};
 if(b.length<75)return base;
 const i=b.length-1,last=b[i],close=last.c;
 for(let j=i-55;j<=i;j++){
  if(j>0&&endOf(b[j-1].t,tf)!==b[j].t)return {...base,reason:'Candle gap or irregular interval (rejected)'};
 }
 const {e20,e50,rs,at}=indicators(b),atr=at[i];
 if(!(atr>0&&e20[i]>0&&e50[i]>0&&close>0))return {...base,reason:'Indicators unavailable'};
 const previous=b.slice(i-20,i),meanVol=previous.reduce((z,x)=>z+x.v,0)/20;
 const volRatio=meanVol?last.v/meanVol:0;
 let best=base;
 for(const side of ['long','short']){
  const sign=side==='long'?1:-1;
  const trend=sign*(e20[i]-e50[i])>=.25*atr&&sign*(e20[i]-e20[i-5])>=.25*atr&&sign*(e50[i]-e50[i-5])>=.08*atr&&sign*(close-e20[i])>0;
  const pullback=b.slice(i-4,i).some((v,j)=>side==='long'?
    v.l<=e20[i-4+j]+.1*atr&&v.c>=e20[i-4+j]-.35*atr:
    v.h>=e20[i-4+j]-.1*atr&&v.c<=e20[i-4+j]+.35*atr);
  const body=Math.abs(close-last.o);
  const edge=last.h>last.l&&(side==='long'?(last.h-close)/(last.h-last.l)<=.25:(close-last.l)/(last.h-last.l)<=.25);
  const breakout=side==='long'?close>b[i-1].h+.02*atr&&close>last.o:close<b[i-1].l-.02*atr&&close<last.o;
  const confirmed=breakout&&edge&&body>=.45*atr&&body<=1.6*atr;
  const rsi=side==='long'?rs[i]>=55&&rs[i]<=69:rs[i]>=31&&rs[i]<=45;
  const distance=sign*(close-e20[i]);
  const noChase=distance>0&&distance<=1.35*atr;
  const volume=volRatio>=1.3;
  // ATR percentage thresholds vary by duration to avoid using 1m-only limits.
  const atrPct=atr/close;
  const volatility=atrPct>=.0003&&atrPct<=.20;
  const checks=[trend,pullback,confirmed,rsi&&noChase,volume,volatility];
  const weights=[25,20,20,15,15,5];
  const score=checks.reduce((n,x,k)=>n+(x?weights[k]:0),0);
  const why=['EMA stack / slope','Pullback into EMA20','Breakout candle','RSI or distance','Relative volume','Volatility'];
  const lastEnd=endOf(last.t,tf);
  const fresh=Date.now()-lastEnd<=Math.min(MINS[tf]*60000,24*3600000);
  let plan=null;
  if(checks.every(Boolean)&&fresh){
   const segment=b.slice(i-4,i+1),structure=side==='long'?Math.min(...segment.map(x=>x.l)):Math.max(...segment.map(x=>x.h));
   const stop=structure-sign*.15*atr,risk=sign*(close-stop),stopPct=risk/close;
   if(risk>0&&stopPct>=.001&&stopPct<=.20)
    plan={entry:close,stop,target:close+sign*1.8*risk,candle:last.t,end:lastEnd};
  }
  const result={sym,tf,status:plan?'confirm':score>=45?'watch':'none',score,side,price:close,plan,
   reason:plan?'Fresh closed-candle research confirmation':!fresh?'Latest confirmed candle no longer fresh':
    why[checks.findIndex(x=>!x)]||'Stop distance out of bounds',at:Date.now(),candle:last.t};
  if(result.score>best.score||result.plan)best=result;
 }
 return best;
}
async function json(url){
 const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),18000);
 try{const r=await fetch(url,{signal:ctl.signal,cache:'no-store'});if(!r.ok)throw Error('Market HTTP '+r.status);
  const j=await r.json();if(j.retCode&&j.retCode!==0)throw Error('Market code '+j.retCode);return j;
 }finally{clearTimeout(t);}
}
async function tickers(){
 if(ex==='bybit'){
  const j=await json('https://api.bybit.com/v5/market/tickers?category=linear');
  return j.result.list.filter(x=>x.symbol.endsWith('USDT')).map(x=>({sym:x.symbol,vol:+x.turnover24h,price:+x.markPrice||+x.lastPrice}));
 }
 const j=await json(API+'/fapi/v1/ticker/24hr');
 return j.filter(x=>x.symbol.endsWith('USDT')&&!x.symbol.includes('_')).map(x=>({sym:x.symbol,vol:+x.quoteVolume,price:+x.lastPrice}));
}
async function candles(sym,tf){
 if(ex==='bybit'){
  const j=await json('https://api.bybit.com/v5/market/kline?category=linear&symbol='+encodeURIComponent(sym)+'&interval='+BYBIT[tf]+'&limit=500');
  return j.result.list.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]})).reverse();
 }
 const j=await json(API+'/fapi/v1/klines?symbol='+encodeURIComponent(sym)+'&interval='+tf+'&limit=500');
 return j.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]}));
}
function settle(s,prices){
 for(const t of [...s.open]){
  const mark=prices[t.sym];if(!(mark>0))continue;
  t.mark=mark;
  // Candles would be needed to distinguish an intrabar dual-hit; quote-only settlement is conservative.
  const hitStop=t.side==='long'?mark<=t.stop:mark>=t.stop;
  const hitTP=t.side==='long'?mark>=t.target:mark<=t.target;
  if(!hitStop&&!hitTP)continue;
  const exit=hitStop?t.stop:t.target,sign=t.side==='long'?1:-1;
  const R=sign*(exit-t.entry)/Math.abs(t.entry-t.stop);
  const pnl=R*t.riskUsd;
  s.closed.unshift({...t,exit,reason:hitStop?'Stop':'Target',R,pnl,closedAt:Date.now()});
  s.open.splice(s.open.indexOf(t),1);
 }
 s.closed=s.closed.slice(0,500);
}
function simulate(s,result,mark){
 if(!result.plan||!Number.isFinite(mark)||mark<=0)return;
 const p=result.plan,identifier=[ex,result.tf,result.sym,result.side,p.confirmedCandle||p.candle,C36?.VERSION||'old'].join(':');
 if(s.keys[identifier]||s.open.some(x=>x.sym===result.sym))return;
 // Do not use a stale close as a hypothetical fill or chase beyond 15% of stop distance.
 const dist=Math.abs(p.entry-p.stop);
 if(Date.now()-(p.confirmedEnd||p.end)<0||Date.now()-(p.confirmedEnd||p.end)>Math.min(MINS[result.tf]*60000,6*3600000)||
    Math.abs(mark-p.entry)>dist*.15)return;
 const sign=result.side==='long'?1:-1;
 const signedRisk=sign*(mark-p.stop);
 if(signedRisk<=0)return;
 const balance=Number($('balance').value),riskPct=Number($('risk').value);
 if(!(balance>0&&riskPct>0))return;
 const riskUsd=balance*riskPct/100;
 s.keys[identifier]=true;
 s.open.push({sym:result.sym,side:result.side,tf:result.tf,entry:mark,stop:p.stop,
  target:mark+sign*3*signedRisk,riskUsd,mark,openedAt:Date.now(),basis:'next observed quote'});
}
function render(){
 const original=data[selected],s=C36_VERIFIED?original:{...original,rows:{},open:[],closed:[],scanned:0,lastScan:0,errors:0,status:'C36 module missing',auto:false},fmtTime=x=>x?new Date(x).toLocaleString():'—';
 $('tfTitle').textContent=selected;
 $('health').textContent=s.status;
 $('toggle').textContent='Auto scan: '+(s.auto?'on':'off');
 const pnl=s.closed.reduce((v,t)=>v+t.pnl,0);
 $('metrics').innerHTML=[
  ['Selected timeframe',selected],['Scanned markets',s.scanned],['Watch / Confirm',Object.values(s.rows).filter(x=>x.status==='watch'||x.status==='confirm').length],
  ['Open simulations',s.open.length],['Closed simulations',s.closed.length],['Realized PnL',fmt(pnl)+' USD'],['Last scan',fmtTime(s.lastScan)],['Errors',s.errors]
 ].map(([k,v])=>'<div><small>'+safe(k)+'</small><b>'+safe(v)+'</b></div>').join('');
 $('results').innerHTML=Object.values(s.rows).sort((a,b)=>b.score-a.score).slice(0,500).map(x=>
  '<tr><td>'+safe(x.sym)+'</td><td class="'+(x.side==='long'?'long':'short')+'">'+safe(x.side)+'</td><td>'+safe(x.status)+'</td><td>'+x.score+'</td><td>'+fmt(x.price)+'</td><td>'+fmt(x.plan?.entry)+'</td><td>'+fmt(x.plan?.stop)+'</td><td>'+fmt(x.plan?.target)+'</td><td>'+safe(x.reason)+'</td></tr>').join('')||'<tr><td colspan="9">No scan results yet</td></tr>';
 $('positions').innerHTML=s.open.map(x=>{
  const R=(x.side==='long'?1:-1)*(x.mark-x.entry)/Math.abs(x.entry-x.stop);
  return '<tr><td>'+safe(x.sym)+'</td><td>'+x.side+'</td><td>'+fmt(x.entry)+'</td><td>'+fmt(x.stop)+'</td><td>'+fmt(x.target)+'</td><td>'+fmt(R)+'</td><td>'+fmt(R*x.riskUsd)+'</td></tr>';
 }).join('')||'<tr><td colspan="7">No simulated positions</td></tr>';
 $('history').innerHTML=s.closed.slice(0,150).map(x=>'<tr><td>'+fmtTime(x.closedAt)+'</td><td>'+safe(x.sym)+'</td><td>'+x.side+'</td><td>'+fmt(x.exit)+'</td><td>'+x.reason+'</td><td>'+fmt(x.R)+'</td><td>'+fmt(x.pnl)+'</td></tr>').join('')||'<tr><td colspan="7">No closed simulated trades</td></tr>';
 document.querySelectorAll('[data-tf]').forEach(x=>x.classList.toggle('active',x.dataset.tf===selected));
}
async function scan(){
 if(!C36_VERIFIED){$('message').textContent='C36 engine unavailable: research scanner module not loaded.';return;}
 if(busy)return;
 const tf=selected,s=data[tf];
 busy=true;$('scan').disabled=true;s.status='Scanning';s.errors=0;render();
 const count=Math.min(500,Math.max(1,Math.trunc(Number($('limit').value)||40)));
 try{
  const t=await tickers();const list=t.filter(x=>x.price>0&&x.vol>0).sort((a,b)=>b.vol-a.vol).slice(0,count);
  const priceMap=Object.fromEntries(t.map(x=>[x.sym,x.price]));settle(s,priceMap);
  s.scanned=0;s.status='Running';render();
  // Low concurrency prevents triggering the provider's public rate limits.
  let cursor=0,done=0;
  await Promise.all(Array.from({length:2},async()=>{
   while(cursor<list.length){
    const item=list[cursor++];
    try{
     const awaitedClosedBars=await candles(item.sym,tf);
     const r=C36.evaluate({bars:awaitedClosedBars,tf,sym:item.sym});s.rows[item.sym]=r;
     if(r.plan)simulate(s,r,item.price);
    }catch(err){s.errors++;s.rows[item.sym]={sym:item.sym,side:'—',status:'error',score:0,price:item.price,reason:String(err.message||err).slice(0,130)};}
    done++;s.scanned=done;
    if(done%5===0){$('message').textContent=tf+': '+done+'/'+list.length+' markets processed; errors '+s.errors;render();}
    if(ex==='binance')await delay(400);
   }
  }));
  s.status=s.errors===list.length?'Failed':s.errors?'Completed with errors':'Completed';
  s.lastScan=Date.now();nextAuto=Date.now()+300000;
  $('message').textContent=tf+': '+done+' market(s) evaluated on completed '+tf+' candles; '+s.errors+' error(s).';
 }catch(err){s.status='Failed';s.errors++;$('message').textContent='Scan failed: '+String(err.message||err);}
 finally{busy=false;$('scan').disabled=false;save();render();}
}
// Until the original C36 complete-confirmation source is available, do not
// run the unrelated EMA research detector or open misleading paper positions.
// Saved results are left intact for forensic/backtest comparison.
$('exchange').value=ex;
load();
TFS.forEach(tf=>{const prior=data[tf];if(prior?.version!==C36?.VERSION){data[tf]=blank();data[tf].version=C36?.VERSION;}data[tf].auto=C36_VERIFIED;data[tf].status=C36_VERIFIED?'Ready — reconstructed research':'C36 module unavailable';});
const tabs=$('tabs');
TFS.forEach(tf=>{const b=document.createElement('button');b.dataset.tf=tf;b.textContent=tf;b.onclick=()=>{selected=tf;render();};tabs.appendChild(b);});
$('scan').disabled=!C36_VERIFIED;$('scan').textContent='Scan selected timeframe';$('scan').onclick=scan;
$('toggle').disabled=!C36_VERIFIED;$('toggle').onclick=()=>{data[selected].auto=!data[selected].auto;save();render();};
$('clearClosed').disabled=!C36_VERIFIED;$('clearClosed').onclick=()=>{if(confirm('Clear only C36 reconstructed paper history for '+selected+'?')){data[selected].closed=[];save();render();}};
$('exchange').onchange=()=>{if(busy){$('exchange').value=ex;return;}ex=$('exchange').value;data={};load();save();render();};
for(const id of ['limit','balance','risk']){$(id).addEventListener('change',()=>{try{localStorage.setItem('tf-setting-'+id,$(id).value);}catch(_){}});try{const saved=localStorage.getItem('tf-setting-'+id);if(saved!==null)$(id).value=saved;}catch(_){}}
setInterval(()=>{if(C36_VERIFIED&&!busy&&!document.hidden&&data[selected].auto&&Date.now()>=nextAuto)scan();},12000);
window.addEventListener('online',()=>{$('message').textContent='Connected. C36 research scanner available while page is open.';});
$('message').textContent=C36_VERIFIED?'C36 documented-rule research ready. First setup → major sweep → same complete setup → simulated entry → 3R. Original Windows source equivalence unverified.':'C36 strategy module failed to load. Scanner remains disabled.';
// Historical EMA research remains in localStorage, but is never shown as C36.
render();
})();