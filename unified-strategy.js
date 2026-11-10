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
   const n=bars1.length,b=bars1[n-2],c=bars1[n-1];
   if(!b||!c||![b.o,b.h,b.l,b.c,c.o,c.h,c.l,c.c,b.t,c.t].every(ok))return state;
   if(c.t-b.t!==60000)return {...state,reason:'Waiting for consecutive closed 1m candles'};
   const previous=bars1.slice(Math.max(0,n-62),n);
   const currentDay=Math.floor(c.t/DAY)*DAY;
   const eligible=previous.filter(k=>k.t>=currentDay&&k.t<=c.t);
   if(!eligible.length)return state;
   const breached=eligible.filter(k=>sg===1?k.l<day.low:k.h>day.high);
   if(!breached.length)return state;
   const breach=breached.at(-1);
   const crossed=true;
   // The new reversal signal candle must be formed AT the liquidity line;
   // an unrelated reversal far inside yesterday's range is not a setup.
   const candleNear=sg===1?b.l<day.low:b.h>day.high;
   if(!candleNear)return {...state,boundaryCrossed:crossed,breachTime:breach.t,
     reason:'Previous-day line crossed; waiting for fresh reversal candle at the line'};
   const direction=sg*(b.c-b.o)>0;
   if(!direction)return {...state,boundaryCrossed:true,breachTime:breach.t,
     reason:dir==='long'?'Waiting for a bullish signal candle below PDL':
       'Waiting for a bearish signal candle above PDH'};
   const confirmed=sg===1?c.c>b.h:c.c<b.l;
   if(!confirmed)return {...state,boundaryCrossed:true,signalCandle:true,
     breachTime:breach.t,signalTime:b.t,reason:'Waiting for next 1m candle to close beyond signal-candle high/low'};
   // Stop goes past the wick that took yesterday's liquidity, including
   // any deeper wick since it. Only closed 1m candles are used.
   let start=eligible.findIndex(k=>k.t===breach.t);
   // If the breach was earlier than the signal candle, preserve those wicks.
   // Iterate back to the first breach within the last 60m, not just the last.
   start=eligible.findIndex(k=>sg===1?k.l<day.low:k.h>day.high);
   const sample=eligible.slice(Math.max(0,start));
   const extreme=sg===1?Math.min(...sample.map(k=>k.l)):
     Math.max(...sample.map(k=>k.h));
   return {...state,ok:true,boundaryCrossed:true,signalCandle:true,
     confirmation:true,breachTime:eligible[start].t,signalTime:b.t,
     triggerTime:c.t,triggerPrice:c.c,extreme,
     name:sg===1?'PDL sweep → bullish 1m reversal → high broken':
       'PDH sweep → bearish 1m reversal → low broken',
     reason:'Previous-day liquidity taken; fresh opposite candle and next-candle break confirmed'};
 }
 function evaluate({bars15,bars1,mark,account=2000,risk=0.5}){
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
     const qualified=!!(g.ok&&validStop&&priceSafe);
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
       {ok:!!priceSafe,t:'Current price has not moved too far from trigger'}
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
