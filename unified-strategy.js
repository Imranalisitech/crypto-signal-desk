'use strict';
/* Single composite LONG/SHORT strategy:
   RSI heatmap + closed-candle pattern + volume + funding + optional licensed
   Glassnode netflow/open-interest context. No legacy signal engines. */
(function(root){
 const ok=Number.isFinite;
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
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
   const d1h=ok(c.at(-2))&&ok(r1h)?r1h-c.at(-2):0;
   return {r5,r15,r1h,d5,d15,d1h,
     scoreLong:ok(r15)&&ok(r1h)?Math.round(clamp((53-r15)*2+Math.max(0,d15)*3+(60-r1h)*.7,0,100)):0,
     scoreShort:ok(r15)&&ok(r1h)?Math.round(clamp((r15-47)*2+Math.max(0,-d15)*3+(r1h-40)*.7,0,100)):0};
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
 // Glassnode Studio time-series metrics are licensed API data.
 // Positive exchange netflow may indicate distribution / potential sell pressure;
 // negative exchange netflow may indicate withdrawal / reduced sell pressure.
 // Neither implies causation or identifies the direction of any specific trade.
 function glassnodeBias(gn){
   if(!gn)return {status:'Exchange-only',direction:null,ageMinutes:null,source:'No licensed metric'};
   if(gn.status!=='available')return {status:'Glassnode unavailable',direction:null,ageMinutes:null,
     source:String(gn.reason||'No licensed reading').slice(0,110)};
   const net=Number(gn.netflow),base=Number(gn.netflowBaseline);
   const age=Number(gn.ageMinutes);
   if(!ok(net)||!ok(base)||base<=0||!ok(age)||age< -10||age>240)
     return {status:'Glassnode stale',direction:null,ageMinutes:ok(age)?age:null,source:'Metric too old for trading'};
   const ratio=net/base;
   const direction=ratio<=-1?'long':ratio>=1?'short':null;
   const oi=(gn.oiChangePct!=null&&ok(Number(gn.oiChangePct)))?Number(gn.oiChangePct):null;
   const participation=oi==null?'OI unavailable':oi>=1.5?'OI rising':oi<=-1.5?'OI falling':'OI stable';
   return {status:'Glassnode live',direction,ageMinutes:age,netflow:net,ratio,
     oiChangePct:oi,participation,source:'Glassnode API / Studio metrics'};
 }
 function evaluate({bars15,bars5,mark,fundingPct,maxFunding=0.05,
                    account=2000,risk=0.5,fee=0.075,glassnode=null}){
   const insufficient=!(bars15?.length>=64&&bars5?.length>=40&&ok(mark)&&mark>0);
   if(insufficient)return {status:'none',side:null,reason:'Insufficient closed candles',checks:[],score:0};
   const rsi=mapRSI(bars15,bars5),gn=glassnodeBias(glassnode);
   const evaluated=['long','short'].map(side=>{
     const sg=side==='long'?1:-1;
     const pattern=candlestick(bars5,side);
     const rsiOK=rsiAligned(rsi,side);
     const volOK=!!pattern&&pattern.volumeRatio>=1.30&&pattern.patternVolRatio>=1.30;
     const fundingOK=ok(fundingPct)&&Math.abs(fundingPct)<=Math.max(0,maxFunding)&&
       (side==='long'?fundingPct<=maxFunding:fundingPct>=-maxFunding);
     const candleOK=!!pattern;
     // Only a fresh, sizable *opposing* exchange netflow reading blocks a
     // trade. Open interest affects context/score but cannot prove whale buying.
     const opposite=gn.status==='Glassnode live'&&gn.direction&&gn.direction!==side;
     const glassnodeOK=!opposite;
     const participationOK=gn.status==='Glassnode live'&&gn.direction===side&&
        gn.oiChangePct!=null&&gn.oiChangePct>=1.5;
     // Structure defines SL; risk/reward is always 1:3, not a fixed percent.
     // Neither stop distance nor projected leverage may reject an otherwise
     // qualified confluence signal. Estimated exposure is INFORMATIONAL only.
     const stop=pattern?pattern.extreme-sg*Math.max(mark*.00035,pattern.atr*.12):null;
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
       {ok:glassnodeOK,t:'Glassnode netflow does not strongly contradict'},
       {ok:priceOK,t:'Price close enough to confirmed candle and stop on correct side'}
     ];
     const qualified=checkItems.every(x=>x.ok);
     const score=Math.min(100,Math.round(25*Number(rsiOK)+25*Number(candleOK)+
       25*Number(volOK)+15*Number(fundingOK)+5*Number(glassnodeOK)+
       5*Number(priceOK)+3*Number(participationOK)));
     const plan=pattern&&structureCorrect?{en:entry,stop,tp1,tp2,sp:stopPct,r$:cashRisk,nt,
       lev:leverage,ck:pattern.confirmTime,rr,tp1pct:targetPct,tp2pct:targetPct,
       targetMode:'fixed3r',setupType:'RSI + Candle + Volume + Funding',
       structureExtreme:pattern.extreme}:null;
     return {side,status:qualified?'confirm':rsiOK?'watch':'none',
       score:Math.min(100,score),rsi,pattern,glassnode:gn,fundingPct,volumeRatio:pattern?.volumeRatio??null,
       checks:checkItems,G:checkItems,plan,setupType:'Unified confluence',ok:qualified,
       reason:qualified?'Confluence confirmed':checkItems.filter(x=>!x.ok).map(x=>x.t).join('; ')};
   });
   evaluated.sort((a,b)=>
     (b.ok?1:0)-(a.ok?1:0)||b.score-a.score);
   const top=evaluated[0];
   if(evaluated.some(x=>x.ok)&&evaluated.filter(x=>x.ok).length===2)
     return {...top,status:'watch',ok:false,reason:'Conflicting LONG/SHORT confirmation'};
   return top;
 }
 root.UnifiedStrategy=Object.freeze({rsiSeries,mapRSI,candlestick,rsiAligned,glassnodeBias,evaluate});
})(window);