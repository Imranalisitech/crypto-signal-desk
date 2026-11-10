'use strict';
/*
 CRYPTO FUTURES: GAUTAM JHA / STOCK LEARNERS "TWO-LINE" ONLY

 Published source concept (primarily a 1-minute gold scalping lesson):
 1. Draw yesterday's completed daily high (PDH) and low (PDL).
 2. Do not enter while price has not crossed either previous-day line.
 3. SHORT: trade above PDH, fresh bearish 1-minute signal candle,
    then next closed 1-minute candle breaks its low.
 4. LONG: mirror below PDL, fresh bullish signal candle,
    then next closed 1-minute candle breaks its high.
 5. Stop beyond signal/swept wick.
 Crypto-futures adaptation: 24h UTC day, next candle CLOSE through trigger,
 structural stop behind sweep, whole position at fixed 3R (user's existing
 TP choice), and no discretionary 80/20 swing-target runner.
 There are NO RSI, EMA, VWAP, funding, volume, FVG, whale, heatmap or
 generic pattern filters in this file. Binance order-level limits are
 independent real-money safeguards, not strategy indicators.
*/
(function(root){
 const DAY=86400000;
 const ok=Number.isFinite;
 const byTime=(a,b)=>a.t-b.t;
 function priorUTCDay(bars15){
   if(!Array.isArray(bars15)||bars15.length<97)return null;
   const last=bars15.at(-1);
   if(!last||!ok(last.t))return null;
   const today=Math.floor(last.t/DAY)*DAY,prev=today-DAY;
   const list=bars15.filter(x=>x.t>=prev&&x.t<today).sort(byTime);
   if(list.length!==96||list[0].t!==prev||
      list.at(-1).t!==prev+95*900000)return null;
   if(!list.every((k,i)=>[k.o,k.h,k.l,k.c,k.t].every(ok)&&
       k.t===prev+i*900000))return null;
   return {start:prev,end:today-1,high:Math.max(...list.map(x=>x.h)),
     low:Math.min(...list.map(x=>x.l)),count:96,timeZone:'UTC'};
 }
 function gautamTwoLine(bars15,bars1,dir){
   const day=priorUTCDay(bars15),sg=dir==='long'?1:dir==='short'?-1:0;
   const state={ok:false,dir,day,level:day?(sg===1?day.low:day.high):null,
     boundaryCrossed:false,signalCandle:false,confirmation:false,
     reason:day?'Waiting for previous-day liquidity breach':
       'A complete previous UTC day is unavailable',
     variant:'Gautam two-line · 1m crypto futures'};
   if(!sg||!day||!Array.isArray(bars1)||bars1.length<35)return state;
   const n=bars1.length,currentDay=day.end+1;
   // A 500-market scan needs several minutes. Inspect the last six completed
   // 1m candles and use the newest 2-candle trigger; a separate age guard
   // prevents opening late or chasing a completed move.
   let latestCross=false,latestSignal=false;
   for(let j=n-1;j>=Math.max(1,n-7);j--){
     const b=bars1[j-1],c=bars1[j];
     if(!b||!c||![b.o,b.h,b.l,b.c,c.o,c.h,c.l,c.c,b.t,c.t].every(ok)||
        c.t-b.t!==60000||b.t<currentDay)continue;
     const recent=bars1.slice(Math.max(0,j-61),j+1)
       .filter(k=>k.t>=currentDay);
     const crossed=recent.some(k=>sg===1?k.l<day.low:k.h>day.high);
     if(!crossed)continue;
     latestCross=true;
     // The fresh direction-changing candle must be AT the crossed line;
     // an unrelated reversal in yesterday's middle range does not count.
     const candleNear=sg===1?b.l<day.low:b.h>day.high;
     const direction=sg*(b.c-b.o)>0;
     if(!candleNear||!direction)continue;
     latestSignal=true;
     const confirmed=sg===1?c.c>b.h:c.c<b.l;
     if(!confirmed)continue;
     const first=recent.findIndex(k=>sg===1?k.l<day.low:k.h>day.high);
     const breached=recent.slice(Math.max(0,first));
     const extreme=sg===1?Math.min(...breached.map(k=>k.l)):
       Math.max(...breached.map(k=>k.h));
     return {...state,ok:true,boundaryCrossed:true,signalCandle:true,
       confirmation:true,breachTime:breached[0].t,signalTime:b.t,
       triggerTime:c.t,triggerPrice:c.c,extreme,
       name:sg===1?'PDL taken → bullish 1m candle → next high broken':
         'PDH taken → bearish 1m candle → next low broken',
       reason:'Previous-day liquidity breached, directional 1m reversal and next-candle close confirmed'};
   }
   return {...state,boundaryCrossed:latestCross,signalCandle:latestSignal,
     reason:!latestCross?'Waiting for prior-day high/low liquidity breach':
       latestSignal?'Fresh candle seen; waiting for the next 1m close to break its high/low':
       'Prior-day line taken; waiting for fresh red/green 1m candle at line'};
 }
 function evaluate({bars15,bars1,mark,account=2000,risk=0.5,now=Date.now()}){
   if(!Array.isArray(bars15)||!Array.isArray(bars1)||
      bars15.length<97||bars1.length<35||!ok(mark)||mark<=0)
     return {status:'none',side:null,dir:null,reason:'Waiting for previous UTC day and 1m closed candles',
       checks:[],G:[],score:0,executionReady:false,confirmationMode:'Gautam two-line only'};
   const each=['long','short'].map(side=>{
     const g=gautamTwoLine(bars15,bars1,side);
     const sg=side==='long'?1:-1;
     const level=g.day&&(sg===1?g.day.low:g.day.high);
     const stop=g.ok?g.extreme-sg*Math.max(mark*0.0001,Math.abs(mark-g.extreme)*0.02):null;
     const validStop=g.ok&&ok(stop)&&sg*(mark-stop)>0;
     const riskDistance=validStop?Math.abs(mark-stop):0;
     // Entry price validity is a market-price safety check, not an extra
     // indicator. The exchange's live broker also checks price deviation.
     const maxChase=g.ok?Math.max(Math.abs(g.triggerPrice-g.extreme)*0.35,
       g.triggerPrice*0.002):0;
     const priceSafe=g.ok&&Math.abs(mark-g.triggerPrice)<=maxChase;
     const age=g.ok?now-(g.triggerTime+60000):Infinity;
     const freshTrigger=g.ok&&age>=-30000&&age<=4*60000;
     const qualified=!!(g.ok&&validStop&&priceSafe&&freshTrigger);
     const cashRisk=Math.max(0,Number(account)*Number(risk)/100);
     const sp=validStop?100*riskDistance/mark:null;
     const notional=validStop&&sp>0?cashRisk/(sp/100):null;
     const plan=qualified?{
       en:mark,stop,tp1:mark+sg*3*riskDistance,
       tp2:mark+sg*3*riskDistance,sp,r$:cashRisk,nt:notional,
       lev:Number(account)>0&&notional!=null?notional/Number(account):null,
       ck:g.triggerTime,rr:3,tp1pct:sp*3,tp2pct:sp*3,
       targetMode:'fixed3r',timeframe:'1m',setupType:'Gautam two-line · 1m crypto futures',
       structureExtreme:g.extreme,previousDayLevel:g.day,
       researchOnly:false
     }:null;
     const checks=[
       {ok:!!g.day,t:'Previous completed UTC day high/low'},
       {ok:g.boundaryCrossed,t:'PDL swept for LONG / PDH swept for SHORT'},
       {ok:g.signalCandle,t:'Fresh directional 1m reversal candle at liquidity line'},
       {ok:g.confirmation,t:'Next closed 1m candle breaks signal-candle high/low'},
       {ok:!!validStop,t:'Stop beyond sweep wick is valid'},
       {ok:!!priceSafe,t:'Current price has not moved too far from trigger'},
       {ok:!!freshTrigger,t:'1m trigger still fresh enough for execution'}
     ];
     const reason=qualified?g.reason:g.ok?
       '1m reversal occurred, but entry is now stale or structural stop invalid':
       g.reason;
     return {side,status:qualified?'confirm':g.boundaryCrossed?'watch':'none',
       score:qualified?100:g.signalCandle?75:g.boundaryCrossed?50:0,
       pattern:g.ok?{name:g.name,confirmTime:g.triggerTime,
          confirmClose:g.triggerPrice,patternTime:g.signalTime,
          extreme:g.extreme}:null,
       gautam:g,confirmationMode:'Gautam two-line · 1m crypto futures',
       executionReady:qualified,checks,G:checks,plan,ok:qualified,reason};
   });
   each.sort((a,b)=>Number(b.ok)-Number(a.ok)||b.score-a.score);
   if(each[0].ok&&each[1].ok)return {...each[0],status:'watch',
     executionReady:false,ok:false,plan:null,reason:'Conflicting LONG and SHORT'};
   return each[0];
 }
 root.UnifiedStrategy=Object.freeze({
   priorUTCDay,gautamTwoLine,evaluate,activeStrategy:'GAUTAM_TWO_LINE_1M_CRYPTO'
 });
})(window);
