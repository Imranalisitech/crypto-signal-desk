'use strict';
/* Single active LONG/SHORT strategy:
   Exchange-calculated RSI (5m/15m/1h) + closed candlestick patterns +
   exchange volume + real futures funding rates. No inactive data sources. */
(function(root){
 const ok=Number.isFinite;
 function rsiSeries(bars,n=14){
   const rs=Array(bars.length).fill(null);
   if(bars.length<n+2)return rs;
   let ups=0,downs=0;
   for(let i=1;i<=n;i++){
     const d=bars[i].c-bars[i-1].c;
     ups+=Math.max(0,d);downs+=Math.max(0,-d);
   }
   let up=ups/n,down=downs/n;
   const value=()=>up===0&&down===0?50:down===0?100:up===0?0:100-100/(1+up/down);
   rs[n]=value();
   for(let i=n+1;i<bars.length;i++){
     const d=bars[i].c-bars[i-1].c;
     up=(up*(n-1)+Math.max(0,d))/n;
     down=(down*(n-1)+Math.max(0,-d))/n;
     rs[i]=value();
   }
   return rs;
 }
 function hourBars(bars15){
   const groups=new Map();
   for(const c of bars15){
     const hour=Math.floor(c.t/3600000)*3600000;
     if(!groups.has(hour))groups.set(hour,[]);
     groups.get(hour).push(c);
   }
   return [...groups.entries()].sort((a,b)=>a[0]-b[0])
    .filter(([,g])=>g.length===4 && g[0].t===Math.floor(g[0].t/3600000)*3600000 && g[3].t-g[0].t===45*60000)
    .map(([t,g])=>({t,o:g[0].o,c:g[3].c,h:Math.max(...g.map(x=>x.h)),l:Math.min(...g.map(x=>x.l)),v:g.reduce((a,c)=>a+c.v,0)}));
 }
 function mapRSI(bars15,bars5){
   const a=rsiSeries(bars5),b=rsiSeries(bars15),c=rsiSeries(hourBars(bars15));
   const r5=a.at(-1),r15=b.at(-1),r1h=c.at(-1);
   const d5=ok(a.at(-2))&&ok(r5)?r5-a.at(-2):0;
   const d15=ok(b.at(-2))&&ok(r15)?r15-b.at(-2):0;
   // The RSI values and their 5m/15m direction are used directly in
   // long/short confirmation. No unused heatmap display ranking is calculated.
   return {r5,r15,r1h,d5,d15};
 }
 function candlestick(bars,dir){
   if(bars.length<29)return null;
   const sg=dir==='long'?1:-1;
   const a=bars.at(-3),b=bars.at(-2),c=bars.at(-1);
   const range=b.h-b.l,body=Math.abs(b.c-b.o),oldBody=Math.abs(a.c-a.o);
   const edge=range>0?(dir==='long'?(b.c-b.l)/range:(b.h-b.c)/range):0;
   const engulf=sg*(b.c-b.o)>0&&sg*(a.c-a.o)<0&&body>=oldBody*.8&&
      (dir==='long'?b.c>a.o&&b.o<=a.c:b.c<a.o&&b.o>=a.c);
   const wick=dir==='long'?Math.min(b.o,b.c)-b.l:b.h-Math.max(b.o,b.c);
   const shadow=wick>=Math.max(body*1.8,range*.43)&&edge>=.68;
   const strong2=sg*(a.c-a.o)>0&&sg*(b.c-b.o)>0&&
     edge>.72&&body>=range*.55&&
     (dir==='long'?b.c>a.h-.15*(a.h-a.l):b.c<a.l+.15*(a.h-a.l));
   const type=engulf?'Engulfing':shadow?'Rejection wick':strong2?'Momentum candles':null;
   const confirmed=!!type&&sg*(c.c-c.o)>0&&
     sg*(c.c-b.c)>0&&
     (dir==='long'?c.c>b.h:c.c<b.l);
   if(!type||!confirmed)return null;
   const base=bars.slice(-23,-3);
   const mean=base.reduce((sum,k)=>sum+k.v,0)/base.length;
   const volRatio=mean>0?Math.min(b.v,c.v)/mean:0;
   const structure=bars.slice(-15,-1);
   const extreme=dir==='long'?Math.min(...structure.map(x=>x.l)):Math.max(...structure.map(x=>x.h));
   let trueRange=0;
   for(let i=bars.length-14;i<bars.length;i++){
     const bar=bars[i],prev=bars[i-1];
     trueRange+=Math.max(bar.h-bar.l,Math.abs(bar.h-prev.c),Math.abs(bar.l-prev.c));
   }
   const atr=trueRange/14;
   return {name:type,confirmTime:c.t,confirmClose:c.c,patternTime:b.t,
     patternVolRatio:mean>0?b.v/mean:0,confirmVolRatio:mean>0?c.v/mean:0,
     volumeRatio:volRatio,extreme,atr};
 }
 function rsiAligned(r,dir){
   if(!r||![r.r5,r.r15,r.r1h].every(ok))return false;
   return dir==='long'?
      r.r15>=23&&r.r15<=59&&r.d15>=.25&&r.r5>=30&&r.r5<=70&&r.d5>.4&&r.r1h<=67:
      r.r15>=41&&r.r15<=77&&r.d15<=-.25&&r.r5>=30&&r.r5<=70&&r.d5<-.4&&r.r1h>=33;
 }
 // 15m EMA structure: trade with the established direction; a strong,
 // confirmed liquidity reversal is required to trade against it.
 function emaSeries(bars,n){
   const result=Array(bars.length).fill(null);
   if(bars.length<n)return result;
   const mean=bars.slice(0,n).reduce((sum,b)=>sum+b.c,0)/n;
   result[n-1]=mean;
   const alpha=2/(n+1);
   for(let i=n;i<bars.length;i++)result[i]=alpha*bars[i].c+(1-alpha)*result[i-1];
   return result;
 }
 function marketTrend(bars15,dir){
   const sg=dir==='long'?1:-1,fast=emaSeries(bars15,20),slow=emaSeries(bars15,50);
   const a=fast.at(-1),b=slow.at(-1),previous=fast.at(-4);
   const last=bars15.at(-1),prior=bars15.at(-2);
   if(![a,b,previous].every(ok))return {aligned:false,direction:'unknown'};
   const avgRange=bars15.slice(-20).reduce((sum,k)=>sum+(k.h-k.l),0)/20;
   const band=Math.max(last.c*.0001,avgRange*.035);
   const up=a>b+band&&a>=previous&&last.c>=a-avgRange*.2;
   const down=a<b-band&&a<=previous&&last.c<=a+avgRange*.2;
   return {aligned:sg===1?up:down,
     direction:up?'long':down?'short':'neutral',
     ema20:a,ema50:b,
     recentSwing:dir==='long'?Math.max(...bars15.slice(-6,-1).map(k=>k.h)):
       Math.min(...bars15.slice(-6,-1).map(k=>k.l))};
 }
 function liquiditySweep(bars,dir,atr){
   const sg=dir==='long'?1:-1,n=bars.length,last=bars.at(-1);
   // The swept high/low must predate the sweep candle. Look back roughly
   // 90 minutes for a local liquidity pool and up to 60 minutes to reclaim.
   const sweepBuffer=Math.max(last.c*.00008,atr*.035);
   for(let i=n-2;i>=Math.max(22,n-13);i--){
     const prior=bars.slice(i-20,i);
     if(prior.length<14)continue;
     const level=sg===1?Math.min(...prior.map(k=>k.l)):Math.max(...prior.map(k=>k.h));
     const k=bars[i],extreme=sg===1?k.l:k.h;
     const broken=sg*(level-extreme)>sweepBuffer;
     if(!broken)continue;
     const next=bars.slice(i+1);
     const reclaim=next.findIndex(x=>sg*(x.c-level)>atr*.045);
     if(reclaim<0||reclaim>5)continue;
     // Do not buy/sell if the confirmation has failed back into the pool.
     if(!(sg*(last.c-level)>atr*.07))continue;
     const laterExtreme=sg===1?Math.min(...next.map(x=>x.l)):Math.max(...next.map(x=>x.h));
     if(sg*(extreme-laterExtreme)>atr*.13)continue;
     const localShift=sg===1?Math.max(...bars.slice(Math.max(0,i-5),i).map(x=>x.h)):
       Math.min(...bars.slice(Math.max(0,i-5),i).map(x=>x.l));
     return {ok:true,level,extreme,time:k.t,confirmedAt:next[reclaim]?.t,
       structureShift:sg*(last.c-localShift)>atr*.04,kind:'Sweep + reclaim'};
   }
   return {ok:false,kind:'No recent reclaimed liquidity sweep'};
 }
 function mitigatedImbalance(bars,dir,atr){
   const sg=dir==='long'?1:-1,n=bars.length,last=bars.at(-1);
   const minGap=Math.max(last.c*.00012,atr*.08);
   // Fair-value imbalance: candle 1 / candle 3 non-overlap, formed before
   // the mitigation candle. Only a CLOSED candle reclaim is a candidate.
   for(let i=n-5;i>=Math.max(3,n-52);i--){
     const first=bars[i-2],third=bars[i];
     const low=sg===1?first.h:third.h,high=sg===1?third.l:first.l;
     if(!(high-low>minGap))continue;
     const mid=(high+low)/2;
     const after=bars.slice(i+1,n-1);
     const touched=after.findIndex(k=>(sg===1?k.l<=mid:k.h>=mid));
     if(touched<0)continue;
     const touch=after[touched];
     const minClose=sg===1?
       Math.min(...bars.slice(i+1).map(k=>k.c)):
       Math.max(...bars.slice(i+1).map(k=>k.c));
     // Ignore an imbalance that decisively failed instead of reacting.
     if(sg*(minClose-low)<-atr*.28&&sg===1)continue;
     if(sg===-1&&minClose>high+atr*.28)continue;
     if(!(sg*(last.c-mid)>atr*.05))continue;
     const recent=bars.slice(Math.max(i+1,n-8),n-1);
     if(!recent.some(k=>(sg===1?k.l<=high:k.h>=low)))continue;
     // Require price to reject the imbalance from its direction of travel;
     // also require a local liquidity probe around that mitigation.
     const tidx=i+1+touched;
     const old=bars.slice(Math.max(i+1,tidx-5),tidx);
     const local=old.length>=2?
       (sg===1?Math.min(...old.map(k=>k.l)):Math.max(...old.map(k=>k.h))):null;
     const probe=local!==null&&sg*(local-(sg===1?touch.l:touch.h))>atr*.035;
     return {ok:true,kind:'Imbalance mitigated + reclaimed',low,high,mid,
       touchedAt:touch.t,extreme:sg===1?
         Math.min(...recent.map(k=>k.l)):Math.max(...recent.map(k=>k.h)),
       liquidityProbe:probe};
   }
   return {ok:false,kind:'No recent reclaimed 5m imbalance'};
 }
 function structureContext(bars15,bars5,dir,pattern){
   const trend=marketTrend(bars15,dir);
   if(!pattern)return {ok:false,trend,sweep:{ok:false},imbalance:{ok:false},kind:'Waiting for candle confirmation'};
   const sweep=liquiditySweep(bars5,dir,pattern.atr);
   const imbalance=mitigatedImbalance(bars5,dir,pattern.atr);
   // A wick that grabs liquidity at the imbalance can itself form the
   // local sweep; otherwise the standalone sweep/reclaim must exist.
   const liquidityOK=sweep.ok||(imbalance.ok&&imbalance.liquidityProbe);
   const gapOrSweep=sweep.ok||imbalance.ok;
   // Counter-trend trades need a stronger change of structure, not simply
   // RSI turning briefly against a larger move.
   const sg=dir==='long'?1:-1;
   const reversal=sweep.ok&&sweep.structureShift&&
     sg*(bars5.at(-1).c-trend.recentSwing)>pattern.atr*.06;
   const aligned=trend.aligned;
   const okContext=!!(liquidityOK&&gapOrSweep&&(aligned||reversal));
   return {ok:okContext,trend,sweep,imbalance,kind:
     okContext?(reversal&&!aligned?'Confirmed liquidity reversal':
       sweep.ok?'Sweep + reclaim with trend':'Imbalance fill + liquidity rejection'):
     !liquidityOK?'Waiting for liquidity grab/rejection':
     !gapOrSweep?'Waiting for imbalance mitigation or sweep':
     'Waiting for 15m trend alignment or structural reversal'};
 }
 // Supplemental Gautam Jha "two-line" lesson, adapted for 5-minute crypto.
 // Exact published gold tutorial: prior day's completed high/low on the daily
 // chart; 1m reversal candle followed by a break of its high/low; stop beyond
 // the signal/swing extreme. This app uses 5m closed candles, existing RSI,
 // funding, volume, and 3R instead of his discretionary 80/20 runner exits.
 // UTC boundaries are appropriate for perpetual crypto, unlike the session
 // boundaries of the gold CFD in the original example.
 const DAY=86400000;
 function priorUTCDay(bars15){
   if(!Array.isArray(bars15)||bars15.length<97)return null;
   const last=bars15.at(-1);
   if(!last||!ok(last.t))return null;
   const today=Math.floor(last.t/DAY)*DAY,prev=today-DAY;
   const day=bars15.filter(k=>k.t>=prev&&k.t<today);
   if(day.length!==96||day[0].t!==prev||
      day.at(-1).t!==prev+95*900000)return null;
   if(!day.every(k=>[k.o,k.h,k.l,k.c].every(ok)))return null;
   return {start:prev,end:today-1,high:Math.max(...day.map(k=>k.h)),
     low:Math.min(...day.map(k=>k.l)),count:96,timeZone:'UTC'};
 }
 function gautamTwoLine(bars15,bars5,dir){
   const day=priorUTCDay(bars15),sg=dir==='long'?1:-1;
   const empty={ok:false,dir,day,variant:'5m crypto adaptation',
     reason:day?'No confirmed previous-day liquidity reversal':
       'Previous completed UTC day unavailable — need 210 closed 15m candles'};
   if(!day||!Array.isArray(bars5)||bars5.length<30)return empty;
   const n=bars5.length,b=bars5[n-2],c=bars5[n-1];
   const boundary=sg===1?day.low:day.high;
   const base=bars5.slice(n-24,n-4);
   const avg=base.reduce((sum,k)=>sum+k.v,0)/base.length;
   if(!(avg>0))return empty;
   const barLength=c.h-c.l,body=Math.abs(b.c-b.o);
   const atr=Math.max(1e-12,base.reduce((sum,k)=>sum+k.h-k.l,0)/base.length);
   const fresh=sg*(b.c-b.o)>0&&body>0&&
     sg*(c.c-c.o)>0&&
     (sg===1?c.c>b.h:c.c<b.l);
   if(!fresh)return {...empty,reason:'Waiting for reversal candle + next closed candle break'};
   // A candle must have actually traded through yesterday's liquidity line;
   // a candle still trapped between the two lines does not qualify.
   let breach=-1;
   for(let i=n-2;i>=Math.max(2,n-25);i--){
     if(sg===1?bars5[i].l<boundary:bars5[i].h>boundary){
       breach=i;break;
     }
   }
   if(breach<0)return {...empty,reason:'Previous day high/low not taken'};
   // The signal candle must be reasonably near the traded liquidity zone:
   // prevents entering hours later after a large completed displacement.
   const closeEnough=Math.abs(b.c-boundary)<=Math.max(atr*4,b.c*.008);
   if(!closeEnough)return {...empty,reason:'Signal too far from prior-day liquidity'};
   const sample=bars5.slice(Math.max(0,breach),n);
   const extreme=sg===1?Math.min(...sample.map(k=>k.l)):
     Math.max(...sample.map(k=>k.h));
   const volRatio=Math.min(b.v,c.v)/avg;
   const referenceSwing=sg===1?
     Math.max(...bars5.slice(-25,-2).map(k=>k.h)):
     Math.min(...bars5.slice(-25,-2).map(k=>k.l));
   return {ok:true,dir,day,level:boundary,breachTime:bars5[breach].t,
     triggerTime:c.t,triggerPrice:c.c,signalTime:b.t,
     extreme,volRatio,patternVolRatio:b.v/avg,confirmVolRatio:c.v/avg,
     atr,referenceSwing,variant:'5m crypto adaptation',
     name:sg===1?'PDL taken → bullish candle high broken':
       'PDH taken → bearish candle low broken',
     reason:'Previous-day liquidity taken, fresh reversal candle and next-candle break'};
 }
 function evaluate({bars15,bars5,mark,fundingPct,maxFunding=0.05,
                    account=2000,risk=0.5}){
   const insufficient=!(bars15?.length>=64&&bars5?.length>=40&&ok(mark)&&mark>0);
   if(insufficient)return {status:'none',side:null,reason:'Insufficient closed candles',checks:[],score:0};
   const rsi=mapRSI(bars15,bars5);
   const evaluated=['long','short'].map(side=>{
     const sg=side==='long'?1:-1;
     const originalPattern=candlestick(bars5,side);
     const gautam=gautamTwoLine(bars15,bars5,side);
     const pattern=originalPattern||(gautam.ok?{
       name:gautam.name,confirmTime:gautam.triggerTime,
       confirmClose:gautam.triggerPrice,patternTime:gautam.signalTime,
       patternVolRatio:gautam.patternVolRatio,confirmVolRatio:gautam.confirmVolRatio,
       volumeRatio:gautam.volRatio,extreme:gautam.extreme,atr:gautam.atr
     }:null);
     const rsiOK=rsiAligned(rsi,side);
     const volOK=!!pattern&&pattern.volumeRatio>=1.30&&pattern.patternVolRatio>=1.30;
     const fundingOK=ok(fundingPct)&&Math.abs(fundingPct)<=Math.max(0,maxFunding)&&
       (side==='long'?fundingPct<=maxFunding:fundingPct>=-maxFunding);
     const candleOK=!!pattern;
     const structure=structureContext(bars15,bars5,side,pattern);
     const structureOK=structure.ok;
     // Structure defines SL; risk/reward is always 1:3, not a fixed percent.
     // Neither stop distance nor projected leverage may reject an otherwise
     // qualified confluence signal. Estimated exposure is INFORMATIONAL only.
     const extreme=pattern?
       (gautam.ok?(sg===1?Math.min(pattern.extreme,gautam.extreme):
         Math.max(pattern.extreme,gautam.extreme)):
         structure.sweep?.ok?
          (sg===1?Math.min(pattern.extreme,structure.sweep.extreme):
            Math.max(pattern.extreme,structure.sweep.extreme)):
          pattern.extreme):null;
     const stop=pattern?extreme-sg*Math.max(mark*.00035,pattern.atr*.12):null;
     const structureCorrect=pattern&&Number.isFinite(stop)&&sg*(mark-stop)>0;
     const riskDistance=structureCorrect?Math.abs(mark-stop):null;
     const stopPct=structureCorrect?riskDistance/mark*100:null;
     const priceOK=!!pattern&&!!structureCorrect&&
       sg*(mark-pattern.confirmClose)>=-pattern.atr*.4&&
       sg*(mark-pattern.confirmClose)<=Math.max(pattern.atr*.8,mark*.003);
     const rr=3;
     const targetPct=structureCorrect?stopPct*3:null;
     const entry=mark;
     // TP1 is retained only for compatibility with stored trade shapes.
     // A 3R trade now exits the full position at TP2 (final target).
     const tp2=structureCorrect?mark+sg*3*riskDistance:null;
     const tp1=tp2;
     const cashRisk=Math.max(0,Number(account)*Number(risk)/100);
     const nt=structureCorrect&&stopPct>0?cashRisk/(stopPct/100):null;
     const leverage=Number(account)>0&&nt!=null?nt/Number(account):null;
     const checkItems=[
       {ok:rsiOK,t:'RSI 5m/15m/1h alignment'},
       {ok:candleOK,t:'Closed candlestick pattern + confirmation'},
       {ok:volOK,t:'Volume at least 1.30x recent baseline'},
       {ok:fundingOK,t:'Funding rate within risk limits'},
       {ok:structureOK||gautam.ok,
        t:'Existing liquidity/15m structure OR previous-day high/low two-line confirmation'},
       {ok:priceOK,t:'Price close enough to confirmed candle and stop on correct side'}
     ];
     const qualified=checkItems.every(x=>x.ok);
     // Preserve the previously authorized live-trading model. A signal that
     // qualifies *only* through the newly researched Gautam path is enrolled
     // for SIMULATED tracking, but is not eligible to place real Binance orders.
     const executionReady=qualified&&structureOK;
     const confirmationMode=qualified?
       (structureOK?(gautam.ok?'Unified + previous-day confluence':'Unified liquidity'):
         'Gautam-inspired two-line (5m adaptation; simulated only)'):
       gautam.ok?'Previous-day reversal candidate':'Unconfirmed';
     const score=Math.min(100,Math.round(20*Number(rsiOK)+20*Number(candleOK)+
       20*Number(volOK)+10*Number(fundingOK)+20*Number(structureOK)+10*Number(priceOK)));
     const plan=pattern&&structureCorrect?{en:entry,stop,tp1,tp2,sp:stopPct,r$:cashRisk,nt,
       lev:leverage,ck:pattern.confirmTime,rr,tp1pct:targetPct,tp2pct:targetPct,
       targetMode:'fixed3r',setupType:confirmationMode,
       structureExtreme:extreme,structureContext:structure.kind,
       previousDayLevel:gautam.day||null,
       researchOnly:!executionReady}:null;
     return {side,status:qualified?'confirm':rsiOK||gautam.ok?'watch':'none',
       score,rsi,pattern,structure,gautam,confirmationMode,executionReady,
       fundingPct,volumeRatio:pattern?.volumeRatio??null,
       checks:checkItems,G:checkItems,plan,setupType:confirmationMode,ok:qualified,
       reason:qualified?'Confluence confirmed':checkItems.filter(x=>!x.ok).map(x=>x.t).join('; ')};
   });
   evaluated.sort((a,b)=>
     (b.ok?1:0)-(a.ok?1:0)||b.score-a.score);
   const top=evaluated[0];
   if(evaluated.some(x=>x.ok)&&evaluated.filter(x=>x.ok).length===2)
     return {...top,status:'watch',ok:false,reason:'Conflicting LONG/SHORT confirmation'};
   return top;
 }
 root.UnifiedStrategy=Object.freeze({
   rsiSeries,mapRSI,candlestick,rsiAligned,emaSeries,marketTrend,
   liquiditySweep,mitigatedImbalance,structureContext,
   priorUTCDay,gautamTwoLine,evaluate
 });
})(window);