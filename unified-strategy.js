'use strict';
/*
 Single approved 1-minute research signal strategy.
 Derived from the Jan-Aug 2025 BTCUSDT/ETHUSDT study in research/
 on the separate research-1m-1000-setup-study-2026 GitHub branch.

 Backtest full sample was UNPROFITABLE after estimated costs:
 3949 trades, 33.1% net wins, mean -0.646 R.
 Do NOT describe these as validated profitable signals.
 The 500 successful LONG and 500 successful SHORT examples were post-selected.

 Trend: fully closed 5m EMA21 / EMA55 alignment and EMA21 slope.
 Trigger: closed 1m EMA9/21 alignment, recent EMA21 pullback,
 RSI14, ATR14, volume >=1.03x prior 20 bars and break of prior high/low.
 Stop: pullback structure +/- 0.12 ATR. TP: 2x initial risk.
 Signal's close is provisional entry reference; historical study filled
 at next 1m OPEN. Market slippage/fees can change real outcomes.
 Signals for research and simulated tracking only. No real exchange orders.
*/
(function(root){
 const VERSION='HISTORICAL_5M_TREND_1M_PULLBACK_2R_V1';
 const N=x=>Number(x);
 const valid=b=>b&&[b.t,b.o,b.h,b.l,b.c,b.v].every(x=>Number.isFinite(N(x)))&&
   N(b.t)>0&&N(b.l)>0&&N(b.h)>=Math.max(N(b.o),N(b.c),N(b.l))&&
   N(b.l)<=Math.min(N(b.o),N(b.c),N(b.h))&&N(b.v)>=0;
 const ema=(bars,period)=>{
   const k=2/(period+1),res=[],prices=bars.map(b=>N(b.c));
   let e=null;
   for(const p of prices){e=e===null?p:e+k*(p-e);res.push(e);}
   return res;
 };
 function indicators(bars){
   const e9=ema(bars,9),e21=ema(bars,21),a=[],rs=[];
   let g=0,l=0,at=null,trs=0;
   for(let i=0;i<bars.length;i++){
     const b=bars[i];
     if(i===0){a.push(null);rs.push(null);continue;}
     const prev=N(bars[i-1].c),change=N(b.c)-prev,
       tr=Math.max(N(b.h)-N(b.l),Math.abs(N(b.h)-prev),Math.abs(N(b.l)-prev));
     if(i<=14){
       g+=Math.max(0,change);l+=Math.max(0,-change);trs+=tr;
       if(i===14){g/=14;l/=14;at=trs/14;}
     }else{
       g=(g*13+Math.max(0,change))/14;
       l=(l*13+Math.max(0,-change))/14;
       at=(at*13+tr)/14;
     }
     rs.push(i<14?null:l===0?(g===0?50:100):100-100/(1+g/l));
     a.push(at);
   }
   return {e9,e21,atr:a,rsi:rs};
 }
 function evaluate({bars1,bars5,mark,account=2000,risk=.5,now=Date.now()}={}){
   const base={strategyVersion:VERSION,status:'none',side:null,dir:null,ok:false,
     executionReady:false,score:0,checks:[],G:[],plan:null,
     confirmationMode:'CLOSED 5m EMA21/55 trend + CLOSED 1m EMA21 pullback/breakout + RSI/volume'};
   const blank=reason=>({...base,reason});
   if(!Array.isArray(bars1)||bars1.length<65||!Array.isArray(bars5)||bars5.length<75)
     return blank('Need at least 65 closed 1-minute and 75 closed 5-minute candles');
   if(!bars1.every(valid)||!bars5.every(valid))
     return blank('Invalid OHLCV data: use completely closed 1m/5m candles');
   const f=bars1,h=bars5,i=f.length-1,k=h.length-1,
     bar=f[i],price=N(bar.c),end=N(bar.t)+60000;
   // Never evaluate a 5m candle that is after the latest 1m trigger.
   if(N(h[k].t)+300000>end)return blank('Incomplete or future 5-minute trend candle');
   // Ensure the trigger and preceding candles are a contiguous minute series.
   for(let j=i-10;j<i;j++){
     if(N(f[j+1].t)-N(f[j].t)!==60000)
       return blank('Missing recent one-minute candles');
   }
   const I=indicators(f),a=I.atr[i],r=I.rsi[i],
     h21=ema(h,21),h55=ema(h,55);
   if(!a||r==null||!Number.isFinite(price)||price<=0)
     return blank('ATR / RSI unavailable');
   const volMean=f.slice(i-20,i).reduce((sum,x)=>sum+N(x.v),0)/20;
   const volumeRatio=volMean>0?N(bar.v)/volMean:0;
   const fresh=end<=now-1000&&now-end<=120000;
   const trendSlope=h21[k]-h21[k-3],sep=(h21[k]-h55[k])/price;
   const result=side=>{
     const long=side==='long',sg=long?1:-1;
     const hTrend=long?sep>.00022&&trendSlope>0&&price>h21[k]:
                              sep<-.00022&&trendSlope<0&&price<h21[k];
     const mTrend=long?I.e9[i]>I.e21[i]&&I.e21[i]>I.e21[i-3]:
                              I.e9[i]<I.e21[i]&&I.e21[i]<I.e21[i-3];
     let pullback=-1;
     for(let j=i-5;j<i;j++){
       const b=f[j],basis=I.e21[j];
       if(long?(N(b.l)<=basis+.2*a&&N(b.c)>=basis-.7*a):
               (N(b.h)>=basis-.2*a&&N(b.c)<=basis+.7*a))pullback=j;
     }
     const candleBody=sg*(N(bar.c)-N(bar.o)),range=N(bar.h)-N(bar.l);
     const breakout=long?price>N(f[i-1].h)+.015*a:
                               price<N(f[i-1].l)-.015*a;
     const strongClose=range>0&&(long?(N(bar.h)-price)/range<=.37:
                                      (price-N(bar.l))/range<=.37);
     const trigger=fresh&&breakout&&strongClose&&
       candleBody>=.27*a&&candleBody<=2.6*a;
     const goodRsi=long?r>=51&&r<=75:r>=25&&r<=49;
     const notExtended=long?(price-I.e21[i])/a<=1.6:
                            (I.e21[i]-price)/a<=1.6;
     const volatile=a/price>=.00012&&a/price<=.015;
     const checks=[
       {ok:hTrend,t:'5m EMA21/EMA55 trend alignment and slope',weight:20},
       {ok:mTrend,t:'1m EMA9/EMA21 trend and EMA21 slope',weight:15},
       {ok:volatile,t:'1m ATR14 in research volatility range',weight:10},
       {ok:pullback>=0,t:'EMA21 touch during preceding five 1m bars',weight:15},
       {ok:trigger,t:'Fresh closed 1m strong breakout candle',weight:20},
       {ok:goodRsi&&notExtended,t:'1m RSI14 directional momentum and no extension',weight:10},
       {ok:volumeRatio>=1.03,t:'1m volume >=1.03x preceding 20 bars',weight:10}
     ];
     const score=checks.reduce((sum,x)=>sum+(x.ok?x.weight:0),0);
     let plan=null;
     if(checks.every(x=>x.ok)){
       const segment=f.slice(pullback,i+1);
       const extreme=long?Math.min(...segment.map(x=>N(x.l))):
                           Math.max(...segment.map(x=>N(x.h)));
       const stop=extreme-sg*.12*a,dist=sg*(price-stop),fraction=dist/price;
       if(dist>0&&fraction>=.00045&&fraction<=.008){
         const target=price+sg*2*dist;
         plan={en:price,stop,tp1:target,tp2:target,rr:2,
           sp:fraction*100,'r$':Math.max(0,N(account)*N(risk)/100),
           ck:N(bar.t),timeframe:'1m',targetMode:'fixed2r',
           setupType:'5m EMA trend + 1m EMA21 pullback + 1m breakout',
           entryBasis:'Indicative 1m close. Historical research filled at NEXT minute open.',
           pullbackAt:N(f[pullback].t),ema9:I.e9[i],ema21:I.e21[i],
           ema5_21:h21[k],ema5_55:h55[k],
           rsi14:r,atr14:a,volumeRatio,researchOnly:true};
       }
     }
     const ok=!!plan;
     const reason=ok?'1m EMA pullback + breakout CONFIRMED (paper suggestion, 2R)':
        !fresh?'Awaiting a fresh completed 1-minute candle':
        checks.find(x=>!x.ok)?.t||'Stop distance outside 0.045%-0.8% study limits';
     return {...base,status:ok?'confirm':score?'watch':'none',
       side,dir:side,ok,score,checks,G:checks,plan,reason,
       regime:{trend:hTrend?(long?'up':'down'):'not aligned',
         fiveMinute21:h21[k],fiveMinute55:h55[k],slope:trendSlope},
       setup:{pullbackAt:pullback>=0?N(f[pullback].t):null,
         pullbackReady:pullback>=0,candleConfirmed:trigger,
         ema9:I.e9[i],ema21:I.e21[i],rsi14:r,atr14:a,
         volumeRatio,volatilityPct:100*a/price},
       pattern:ok?{name:long?'1m LONG EMA pullback breakout':'1m SHORT EMA pullback breakout',
         confirmTime:N(bar.t),confirmClose:price}:null};
   };
   const L=result('long'),S=result('short');
   if(L.ok&&S.ok)return blank('Conflicting LONG and SHORT confirmations');
   if(L.ok)return L;
   if(S.ok)return S;
   return L.score>=S.score?L:S;
 }
 root.UnifiedStrategy=Object.freeze({evaluate,activeStrategy:VERSION});
})(typeof module!=='undefined'&&module.exports?module.exports:window);
