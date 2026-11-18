'use strict';
/*
 ONE approved entry strategy: 1-MINUTE EMA20/EMA50 PULLBACK SCALP V2 (paper-only quality research).
 Based on the user's separate historical backtest research package.
 No prior PDL/PDH, FVG, neckline, 5m, 1h or V2 strategy is used.

 Every signal uses CLOSED contiguous 1m candles. Entry at confirmation
 close is only a provisional quote; research fills next candle OPEN.
 EMA20/50 slope, EMA20 pullback, breakout candle, RSI14, ATR14,
 >=1.15x volume of preceding 20 bars; structural stop +0.15 ATR,
 1.8R hypothetical TP; 45-minute research exit.
 This generates paper signals ONLY, never real orders. Actual
 profitability has not been established.
*/
(function(root){
 const VERSION='ONLY_1M_EMA20_50_PULLBACK_1P8R_V2';
 const N=x=>Number(x),finite=x=>Number.isFinite(N(x));
 const valid=b=>b&&[b.t,b.o,b.h,b.l,b.c,b.v].every(finite)&&
   N(b.t)>0&&N(b.l)>0&&N(b.v)>=0&&
   N(b.h)>=Math.max(N(b.o),N(b.c),N(b.l))&&
   N(b.l)<=Math.min(N(b.o),N(b.c),N(b.h));
 function indicators(b){
   const n=b.length,e20=Array(n).fill(null),e50=Array(n).fill(null),
     rsi=Array(n).fill(null),atr=Array(n).fill(null),vol=Array(n).fill(null);
   let sum20=0,sum50=0,rollingVol=0,gains=0,losses=0,trsum=0,
     smoothGain=0,smoothLoss=0,trAvg=0;
   for(let i=0;i<n;i++){
     const x=b[i],close=N(x.c);
     sum20+=close;sum50+=close;
     if(i>=20)sum20-=N(b[i-20].c);
     if(i>=50)sum50-=N(b[i-50].c);
     if(i===19)e20[i]=sum20/20;
     else if(i>19)e20[i]=e20[i-1]+2/21*(close-e20[i-1]);
     if(i===49)e50[i]=sum50/50;
     else if(i>49)e50[i]=e50[i-1]+2/51*(close-e50[i-1]);
     if(i>=20)vol[i]=rollingVol/20; // previous 20 bars ONLY
     rollingVol+=N(x.v);
     if(i>=20)rollingVol-=N(b[i-20].v);
     if(i===0)continue;
     const prev=N(b[i-1].c),change=close-prev,
       gain=Math.max(change,0),loss=Math.max(-change,0),
       tr=Math.max(N(x.h)-N(x.l),Math.abs(N(x.h)-prev),Math.abs(N(x.l)-prev));
     if(i<=14){
       gains+=gain;losses+=loss;trsum+=tr;
       if(i===14){smoothGain=gains/14;smoothLoss=losses/14;trAvg=trsum/14;}
     }else{
       smoothGain=(smoothGain*13+gain)/14;
       smoothLoss=(smoothLoss*13+loss)/14;
       trAvg=(trAvg*13+tr)/14;
     }
     if(i>=14){
       atr[i]=trAvg;
       rsi[i]=smoothLoss===0?(smoothGain===0?50:100):
         100-100/(1+smoothGain/smoothLoss);
     }
   }
   return {e20,e50,rsi,atr,vol};
 }
 function evaluate({bars1,mark,account=2000,risk=.5,now=Date.now()}={}){
   const base={strategyVersion:VERSION,status:'none',side:null,dir:null,
     ok:false,executionReady:false,score:0,checks:[],G:[],plan:null,
     confirmationMode:'Closed 1m EMA20/50 slope + EMA20 pullback + breakout / RSI / volume'};
   const empty=reason=>({...base,reason});
   if(!Array.isArray(bars1)||bars1.length<70)
     return empty('Need at least 70 completed 1-minute candles');
   if(!bars1.every(valid))return empty('Invalid OHLCV; only closed 1-minute candles allowed');
   const b=bars1,i=b.length-1,last=b[i],end=N(last.t)+60000;
   if(end>now-1000)return empty('Last 1-minute candle has not closed');
   // Gap guard: do not use a broken lookback series as a trigger.
   for(let j=Math.max(1,i-55);j<=i;j++)
     if(N(b[j].t)-N(b[j-1].t)!==60000)
       return empty('Missing 1-minute candles; signal rejected');
   const ind=indicators(b),c=N(last.c),atr=ind.atr[i],
     momentum=ind.rsi[i],meanVol=ind.vol[i],body=Math.abs(N(last.c)-N(last.o));
   if(!(atr>0&&c>0&&meanVol>0))return empty('ATR or volume unavailable');
   const vRatio=N(last.v)/meanVol,atrPct=atr/c;
   const fresh=now-end<=120000;
   const result=side=>{
     const long=side==='long',sg=long?1:-1;
     const emaGap=sg*(ind.e20[i]-ind.e50[i]);
     const fastSlope=sg*(ind.e20[i]-ind.e20[i-5]);
     const slowSlope=sg*(ind.e50[i]-ind.e50[i-5]);
     // Direction is NOT sufficient: reject flat EMA stacks and weak slopes.
     const trend=emaGap>=.25*atr&&fastSlope>=.25*atr&&
       slowSlope>=.08*atr&&sg*(c-ind.e20[i])>0;
     let pullback=-1;
     for(let j=i-4;j<i;j++){
       const p=b[j],basis=ind.e20[j];
       if(long?
          N(p.l)<=basis+.1*atr&&N(p.c)>=basis-.35*atr:
          N(p.h)>=basis-.1*atr&&N(p.c)<=basis+.35*atr)
         pullback=j;
     }
     const closeAtEdge=N(last.h)>N(last.l)&&
       (long?(N(last.h)-c)/(N(last.h)-N(last.l))<=.25:
               (c-N(last.l))/(N(last.h)-N(last.l))<=.25);
     const breakout=long?
       c>N(b[i-1].h)+.02*atr&&c>N(last.o):
       c<N(b[i-1].l)-.02*atr&&c<N(last.o);
     const confirm=fresh&&breakout&&closeAtEdge&&body>=.45*atr&&body<=1.6*atr;
     const rsiOk=long?momentum>=55&&momentum<=69:momentum>=31&&momentum<=45;
     const notChasing=sg*(c-ind.e20[i])>0&&sg*(c-ind.e20[i])<=1.35*atr;
     const volatility=atrPct>=.0006&&atrPct<=.013;
     const volume=vRatio>=1.30;
     const checks=[
       {ok:trend,t:'1m EMA20/EMA50 separation >=0.25 ATR, positive slope and directional close',weight:25},
       {ok:pullback>=0,t:'Controlled pullback into EMA20 within prior four candles',weight:20},
       {ok:confirm,t:'Fresh closed 1m breakout with strong body and close',weight:20},
       {ok:rsiOk&&notChasing,t:'RSI14 and EMA20 distance avoid overextended entries',weight:15},
       {ok:volume,t:'1m volume at least 1.30x preceding 20-candle average',weight:15},
       {ok:volatility,t:'ATR14 volatility between 0.06% and 1.3%',weight:5}
     ];
     const score=checks.reduce((sum,x)=>sum+(x.ok?x.weight:0),0);
     let plan=null;
     if(checks.every(x=>x.ok)){
       const seg=b.slice(i-4,i+1),
         structure=long?Math.min(...seg.map(x=>N(x.l))):
                        Math.max(...seg.map(x=>N(x.h))),
         stop=structure-sg*.15*atr,dist=sg*(c-stop),fraction=dist/c;
       if(dist>0&&fraction>=.0018&&fraction<=.02){
         const tp=c+sg*1.8*dist;
         if(tp>0)plan={en:c,stop,tp1:tp,tp2:tp,rr:1.8,
           sp:100*fraction,'r$':Math.max(0,N(account)*N(risk)/100),
           ck:N(last.t),timeframe:'1m',targetMode:'fixed1p8r',
           maxHoldMinutes:45,entryBasis:'Indicative trigger close; historical model fills at NEXT candle open',
           setupType:'1m-only EMA20/50 quality scalp, EMA strength, pullback, breakout, RSI, 1.30x volume',
           pullbackAt:N(b[pullback].t),ema20:ind.e20[i],ema50:ind.e50[i],
           rsi14:momentum,atr14:atr,volumeRatio:vRatio,researchOnly:true};
       }
     }
     const ok=!!plan;
     return {...base,status:ok?'confirm':score?'watch':'none',side,dir:side,
       ok,score,checks,G:checks,plan,
       reason:ok?'V2 1m EMA20/50 quality-confirmed scalp — PAPER ONLY':
         !fresh?'Waiting for a new completed 1-minute candle':
         checks.find(x=>!x.ok)?.t||'Stop distance not between 0.18% and 2%',
       regime:{trend:trend?(long?'up':'down'):'not aligned',
         ema20:ind.e20[i],ema50:ind.e50[i],emaGapATR:emaGap/atr,
         emaFastSlopeATR:fastSlope/atr},
       setup:{pullbackAt:pullback>=0?N(b[pullback].t):null,
         pullbackReady:pullback>=0,candleConfirmed:confirm,
         ema20:ind.e20[i],ema50:ind.e50[i],rsi14:momentum,atr14:atr,
         volumeRatio:vRatio,volatilityPct:atrPct*100,
         entryDistanceATR:sg*(c-ind.e20[i])/atr},
       pattern:ok?{name:long?'1m LONG EMA20 pullback':'1m SHORT EMA20 pullback',
         confirmTime:N(last.t),confirmClose:c}:null};
   };
   const L=result('long'),S=result('short');
   if(L.ok&&S.ok)return empty('Conflicting LONG and SHORT setups');
   if(L.ok)return L;
   if(S.ok)return S;
   return L.score>=S.score?L:S;
 }
 root.UnifiedStrategy=Object.freeze({evaluate,activeStrategy:VERSION});
})(typeof module!=='undefined'&&module.exports?module.exports:window);
