'use strict';
/*
 Crypto Signal Desk — Adaptive Trend Pullback Scalper V1.
 This is the ONLY trade-entry strategy. No PDL/PDH, FVG, liquidity-sweep,
 neckline, divergence or prior entry methods contribute to signal selection.

 1h: 21/55 EMA directional trend + upward/downward EMA21 slope.
 5m: 9/21 EMA alignment; pullback into 21 EMA; fresh directional
     breakout candle with RSI(14), ATR(14), and relative-volume checks.
 Entry on a fully CLOSED 5m confirmation candle, structure/ATR stop,
 fixed 3R target (existing simulation and profit-lock rules preserved).
 The engine is signals-only: no authenticated real-money Binance orders.
*/
(function(root){
 const VERSION='TREND_PULLBACK_SCALPER_5M_V1';
 const N=x=>Number(x);
 const valid=b=>b&&[b.t,b.o,b.h,b.l,b.c].every(x=>Number.isFinite(N(x)))&&
   N(b.l)>0&&N(b.h)>=Math.max(N(b.o),N(b.c),N(b.l))&&
   N(b.l)<=Math.min(N(b.o),N(b.c),N(b.h))&&
   (b.v==null||(Number.isFinite(N(b.v))&&N(b.v)>=0));
 const avg=a=>a.reduce((s,v)=>s+v,0)/a.length;
 function ema(bars,period){
   const values=bars.map(b=>N(b.c)),out=Array(values.length).fill(null);
   if(values.length<period)return out;
   let e=avg(values.slice(0,period));out[period-1]=e;
   const a=2/(period+1);
   for(let i=period;i<values.length;i++){e=a*values[i]+(1-a)*e;out[i]=e;}
   return out;
 }
 function atr(bars,period=14){
   if(bars.length<period+1)return null;
   let total=0;
   for(let i=1;i<=period;i++){
     const b=bars[i],prev=N(bars[i-1].c);
     total+=Math.max(N(b.h)-N(b.l),Math.abs(N(b.h)-prev),Math.abs(N(b.l)-prev));
   }
   let a=total/period;
   for(let i=period+1;i<bars.length;i++){
     const b=bars[i],prev=N(bars[i-1].c);
     const tr=Math.max(N(b.h)-N(b.l),Math.abs(N(b.h)-prev),Math.abs(N(b.l)-prev));
     a=(a*(period-1)+tr)/period;
   }
   return a;
 }
 function rsi(bars,period=14){
   if(bars.length<=period)return null;
   let gains=0,losses=0;
   for(let i=1;i<=period;i++){
     const change=N(bars[i].c)-N(bars[i-1].c);
     gains+=Math.max(0,change);losses+=Math.max(0,-change);
   }
   gains/=period;losses/=period;
   for(let i=period+1;i<bars.length;i++){
     const change=N(bars[i].c)-N(bars[i-1].c);
     gains=(gains*(period-1)+Math.max(0,change))/period;
     losses=(losses*(period-1)+Math.max(0,-change))/period;
   }
   if(losses===0)return gains===0?50:100;
   return 100-100/(1+gains/losses);
 }
 function evaluate({bars5,bars1h,mark,account=2000,risk=.5,now=Date.now()}={}){
   const base={status:'none',side:null,dir:null,ok:false,executionReady:false,
     score:0,checks:[],G:[],plan:null,strategyVersion:VERSION,
     confirmationMode:'1h EMA trend + 5m EMA21 pullback + 5m candle/volume/RSI confirmation'};
   const blank=reason=>({...base,reason});
   if(!Array.isArray(bars1h)||bars1h.length<65||
      !Array.isArray(bars5)||bars5.length<65)
     return blank('Waiting for at least 65 closed 1h and 65 closed 5m candles');
   if(!bars1h.every(valid)||!bars5.every(valid))
     return blank('Invalid or unfinished OHLCV candle data');
   const h=bars1h,f=bars5,i=f.length-1,nowBar=f[i];
   const h21=ema(h,21),h55=ema(h,55),f9=ema(f,9),f21=ema(f,21);
   const a5=atr(f),a1h=atr(h),momentum=rsi(f),price=N(nowBar.c);
   if(!a5||!a1h||!Number.isFinite(price)||price<=0)return blank('ATR unavailable');
   const end=N(nowBar.t)+300000;
   const candleClosed=end<=now-1000;
   const fresh=candleClosed&&now-end<=390000;
   // Volume uses only the preceding 20 candles, never the trigger candle.
   const volumes=f.slice(i-20,i).map(b=>Number(b.v));
   const volAvailable=volumes.every(Number.isFinite)&&volumes.some(v=>v>0)&&Number.isFinite(N(nowBar.v));
   const volumeRatio=volAvailable?N(nowBar.v)/Math.max(1e-12,avg(volumes)):null;
   const k1=h.length-1, hClose=N(h[k1].c),hSlope=N(h21[k1])-N(h21[k1-3]);
   const lastE9=f9[i],lastE21=f21[i],emaSlope=lastE21-f21[i-3];
   const result=side=>{
     const long=side==='long',sg=long?1:-1;
     const hTrend=long?
       h21[k1]>h55[k1]&&hClose>h55[k1]&&hSlope>a1h*.015:
       h21[k1]<h55[k1]&&hClose<h55[k1]&&hSlope<-a1h*.015;
     const mTrend=long?
       lastE9>lastE21&&emaSlope>-a5*.035&&price>lastE21:
       lastE9<lastE21&&emaSlope<a5*.035&&price<lastE21;
     const volatile=a5/price>=.0007&&a5/price<=.03;
     let retest=-1;
     for(let j=i-6;j<=i-1;j++){
       const b=f[j],basis=f21[j];
       if(long?
          N(b.l)<=basis+.2*a5&&N(b.c)>=basis-.75*a5:
          N(b.h)>=basis-.2*a5&&N(b.c)<=basis+.75*a5)
         retest=j;
     }
     const hadPullback=retest>=0;
     const candleBody=sg*(N(nowBar.c)-N(nowBar.o));
     const breakout=long?
       price>N(f[i-1].h)&&price>lastE9:
       price<N(f[i-1].l)&&price<lastE9;
     const candleConfirm=fresh&&breakout&&candleBody>=.25*a5;
     const goodRsi=long?momentum>=51&&momentum<=74:
                         momentum>=26&&momentum<=49;
     const goodVolume=volAvailable&&volumeRatio>=.9;
     const notExtended=long?(price-lastE21)/a5<=1.5:
                             (lastE21-price)/a5<=1.5;
     const checks=[
       {ok:hTrend,t:'1h EMA21/EMA55 trend and slope '+(long?'bullish':'bearish'),weight:25},
       {ok:mTrend,t:'5m EMA9/EMA21 alignment',weight:15},
       {ok:volatile,t:'5m ATR in tradable volatility range',weight:10},
       {ok:hadPullback,t:'Recent 5m pullback to EMA21',weight:20},
       {ok:candleConfirm,t:'Fresh closed 5m candle breaks prior candle high/low with strong body',weight:15},
       {ok:goodRsi&&notExtended,t:'RSI14 momentum and not overextended',weight:10},
       {ok:goodVolume,t:'Confirmation volume at least 90% of prior 20-candle mean',weight:5}
     ];
     const score=checks.reduce((sum,x)=>sum+(x.ok?x.weight:0),0);
     const all=checks.every(x=>x.ok);
     let plan=null;
     if(all){
       const lows=f.slice(retest,i+1).map(b=>N(b.l)),highs=f.slice(retest,i+1).map(b=>N(b.h));
       const stop=long?Math.min(...lows)-.18*a5:Math.max(...highs)+.18*a5;
       const stopDistance=sg*(price-stop),stopFraction=stopDistance/price;
       // Don't select orders whose stops are excessively tight (fees) or wide.
       if(stopDistance>0&&stopFraction>=.0025&&stopFraction<=.025){
         const tp=price+sg*3*stopDistance;
         plan={en:price,stop,tp1:tp,tp2:tp,rr:3,sp:stopFraction*100,
           'r$':Math.max(0,N(account)*N(risk)/100),
           ck:N(nowBar.t),timeframe:'5m',targetMode:'fixed3r',
           setupType:'1h EMA21/55 trend + 5m EMA21 pullback + 5m candle RSI/volume',
           pullbackAt:N(f[retest].t),ema9:lastE9,ema21:lastE21,
           emaHourly21:h21[k1],emaHourly55:h55[k1],
           rsi14:momentum,atr14:a5,volumeRatio,
           stopBasis:'Recent 5m pullback structure beyond wick plus ATR buffer',
           researchOnly:true};
       }
     }
     const ok=!!plan;
     let reason=ok?'Trend-aligned EMA21 pullback scalp confirmed on last CLOSED 5m candle':
       !fresh?'Waiting for a fresh CLOSED 5m candle':
       checks.find(x=>!x.ok)?.t||'Stop distance not within valid scalping range';
     return {...base,status:ok?'confirm':score?'watch':'none',side,dir:side,
       ok,score,checks,G:checks,reason,plan,
       regime:{trend:hTrend?(long?'up':'down'):'not aligned',
         hourly21:h21[k1],hourly55:h55[k1],slope:hSlope},
       setup:{pullbackAt:retest>=0?N(f[retest].t):null,
         pullbackReady:hadPullback,candleConfirmed:candleConfirm,
         ema9:lastE9,ema21:lastE21,rsi14:momentum,atr14:a5,
         volumeRatio,volatilityPct:a5/price*100},
       pattern:ok?{name:long?'Bullish EMA pullback scalp':'Bearish EMA pullback scalp',
         confirmTime:N(nowBar.t),confirmClose:price}:null};
   };
   const L=result('long'),S=result('short');
   if(L.ok&&S.ok)return blank('Opposing confirmations conflict');
   if(L.ok)return L;
   if(S.ok)return S;
   return L.score>=S.score?L:S;
 }
 root.UnifiedStrategy=Object.freeze({evaluate,activeStrategy:VERSION});
})(typeof module!=='undefined'&&module.exports?module.exports:window);
