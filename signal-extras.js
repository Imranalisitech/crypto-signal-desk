'use strict';
/* Exchange-derived RSI heatmap and large-position activity proxies.
   No public data identifies a particular whale or institutional wallet. */
(function(root){
  const finite=x=>Number.isFinite(x);
  const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
  function rsiSeries(candles,period=14){
    const n=candles.length,out=Array(n).fill(null);
    if(n<=period)return out;
    let up=0,down=0;
    for(let i=1;i<=period;i++){
      const change=candles[i].c-candles[i-1].c;
      up+=Math.max(0,change);down+=Math.max(0,-change);
    }
    up/=period;down/=period;
    function value(g,l){return g===0&&l===0?50:l===0?100:g===0?0:100-100/(1+g/l)}
    out[period]=value(up,down);
    for(let i=period+1;i<n;i++){
      const change=candles[i].c-candles[i-1].c;
      up=(up*(period-1)+Math.max(0,change))/period;
      down=(down*(period-1)+Math.max(0,-change))/period;
      out[i]=value(up,down);
    }
    return out;
  }
  function sampleRSI(bars){
    const a=rsiSeries(bars);
    const last=a.at(-1),prev=a.at(-2);
    return{value:finite(last)?last:null,prev:finite(prev)?prev:null,delta:finite(last)&&finite(prev)?last-prev:0,series:a};
  }
  function hourlyFrom15m(bars){
    const groups=new Map();
    for(const b of bars){
      const t=Math.floor(b.t/3600000)*3600000;
      if(!groups.has(t))groups.set(t,[]);
      groups.get(t).push(b);
    }
    return [...groups.entries()].sort((a,b)=>a[0]-b[0])
      .filter(([,g])=>g.length===4&&g[0].t%3600000===0&&g[3].t%3600000===2700000)
      .map(([t,g])=>({t,o:g[0].o,h:Math.max(...g.map(x=>x.h)),l:Math.min(...g.map(x=>x.l)),c:g[3].c,v:g.reduce((sum,x)=>sum+x.v,0)}));
  }
  function heatmap(closed15m,closed5m=null){
    const m15=sampleRSI(closed15m),hours=hourlyFrom15m(closed15m),h1=sampleRSI(hours);
    const m5=closed5m&&closed5m.length>20?sampleRSI(closed5m):{value:null,prev:null,delta:0,series:[]};
    const fifteen=m15.value,hour=h1.value;
    const longScore=finite(fifteen)&&finite(hour)?clamp((48-fifteen)*2+(57-hour)*.55+Math.max(0,m15.delta)*2.2,0,100):0;
    const shortScore=finite(fifteen)&&finite(hour)?clamp((fifteen-52)*2+(hour-43)*.55+Math.max(0,-m15.delta)*2.2,0,100):0;
    const direction=longScore>=22&&fifteen<=43&&hour<=57&&m15.delta>0?'long':
      shortScore>=22&&fifteen>=57&&hour>=43&&m15.delta<0?'short':null;
    return {r5:m5.value,r15:fifteen,r1h:hour,d5:m5.delta,d15:m15.delta,d1h:h1.delta,
      scoreLong:Math.round(longScore),scoreShort:Math.round(shortScore),hotDir:direction,
      status:direction?'RSI '+direction.toUpperCase()+' candidate':'Neutral',r5series:m5.series};
  }
  function atr5m(bars,period=14){
    if(bars.length<period+1)return 0;
    let sum=0;
    for(let i=bars.length-period;i<bars.length;i++){
      const c=bars[i],p=bars[i-1];
      sum+=Math.max(c.h-c.l,Math.abs(c.h-p.c),Math.abs(c.l-p.c));
    }
    return sum/period;
  }
  function directionalCandle(k,sg,minEdge=.57){
    const range=k.h-k.l;
    if(range<=0)return false;
    const edge=sg===1?(k.c-k.l)/range:(k.h-k.c)/range;
    return sg*(k.c-k.o)>0&&edge>=minEdge;
  }
  function rsiReversal(bars,dir,heat,flow){
    if(!heat||!flow||bars.length<72)return null;
    const sg=dir==='long'?1:-1,prev=bars.at(-2),last=bars.at(-1);
    if(![prev,last].every(Boolean))return null;
    const r=heat.r5series;
    if(r.length<20||!finite(r.at(-1))||!finite(r.at(-2)))return null;
    const recent=r.slice(-12).filter(finite),extreme=dir==='long'?Math.min(...recent):Math.max(...recent);
    const rsiRecovered=dir==='long'?extreme<=36&&r.at(-1)>=38&&r.at(-1)<=64&&r.at(-1)-r.at(-2)>=2:
      extreme>=64&&r.at(-1)<=62&&r.at(-1)>=36&&r.at(-2)-r.at(-1)>=2;
    const multi=dir==='long'?heat.r15<=48&&heat.r15>=27&&heat.d15>0&&heat.r1h<=61:
      heat.r15>=52&&heat.r15<=73&&heat.d15<0&&heat.r1h>=39;
    if(!rsiRecovered||!multi)return null;
    if(sg*flow.oneHour<.065||sg*flow.threeHour<.025||flow.volumeRatio<1.0)return null;
    if((dir==='long'&&flow.weakRally)||(dir==='short'&&flow.weakSelloff))return null;
    const atr=atr5m(bars);
    if(!(atr>0))return null;
    const old=bars.slice(-21,-1),avg=old.reduce((sum,k)=>sum+k.v,0)/old.length;
    const level=dir==='long'?Math.max(...bars.slice(-5,-1).map(x=>x.h)):
      Math.min(...bars.slice(-5,-1).map(x=>x.l));
    if(sg*(last.c-level)<Math.max(.02*atr,.00006*level))return null;
    if(!directionalCandle(last,sg,.64)||last.v<avg*1.2)return null;
    const prior=bars.slice(-13,-1);
    const stopBase=dir==='long'?Math.min(...prior.map(x=>x.l)):Math.max(...prior.map(x=>x.h));
    return {level,extreme:stopBase,confirmTime:last.t,confirmClose:last.c,atr,
      breakoutTime:prev.t,breakoutVolRatio:avg>0?last.v/avg:0,rsi5:heat.r5,rsi15:heat.r15,
      windowHours:1,method:'RSI reversal'};
  }
  function largePositionPrecheck(bars,dir,flow){
    if(!flow||bars.length<42)return false;
    const sg=dir==='long'?1:-1,last=bars.at(-1),prev=bars.at(-2);
    if(!(sg*flow.oneHour>=.15&&sg*flow.threeHour>=.065&&flow.volumeRatio>=1.45))return false;
    if((dir==='long'&&flow.weakRally)||(dir==='short'&&flow.weakSelloff))return false;
    const base=bars.slice(-22,-2),av=base.reduce((n,k)=>n+k.v,0)/base.length;
    if(!(av>0&&Math.max(last.v,prev.v)>=av*1.65))return false;
    return directionalCandle(last,sg,.58)&&sg*(last.c-bars.at(-7).c)>0;
  }
  function openInterestChange(entries){
    if(!Array.isArray(entries)||entries.length<5)return null;
    const list=entries.map(x=>({t:Number(x.t),oi:Number(x.oi)})).filter(x=>finite(x.t)&&finite(x.oi)&&x.oi>0).sort((a,b)=>a.t-b.t);
    if(list.length<5)return null;
    const end=list.at(-1),earlier=list.filter(x=>x.t<=end.t-45*60000).at(-1);
    if(!earlier||end.t-earlier.t>120*60000)return null;
    return{percent:(end.oi/earlier.oi-1)*100,from:earlier.oi,to:end.oi,start:earlier.t,end:end.t};
  }
  function largePositionSetup(bars,dir,flow,oi){
    if(!oi||!largePositionPrecheck(bars,dir,flow))return null;
    if(!(oi.percent>=1.2||oi.percent<=-1.8))return null;
    const last=bars.at(-1),prev=bars.at(-2),sg=dir==='long'?1:-1;
    const base=bars.slice(-22,-2),avg=base.reduce((sum,x)=>sum+x.v,0)/base.length;
    const atr=atr5m(bars);
    if(!(atr>0))return null;
    const level=dir==='long'?Math.max(...base.map(x=>x.h)):Math.min(...base.map(x=>x.l));
    const broke=sg*(prev.c-level)>=.10*atr&&directionalCandle(prev,sg,.64)&&prev.v>=avg*1.65;
    const hold=sg*(last.c-level)>.08*atr&&directionalCandle(last,sg,.60)&&last.v>=avg*.90;
    if(!broke||!hold)return null;
    const stopBars=bars.slice(-15,-2);
    const stopBase=dir==='long'?Math.min(...stopBars.map(x=>x.l),prev.l):
      Math.max(...stopBars.map(x=>x.h),prev.h);
    if(!(sg*(last.c-stopBase)>0))return null;
    return{level,extreme:stopBase,atr,breakoutTime:prev.t,confirmTime:last.t,
      confirmClose:last.c,breakoutVolRatio:prev.v/avg,
      oiChangePct:oi.percent,oiKind:oi.percent>=1.2?'OI expansion':'OI reduction / unwind',
      windowHours:1,method:'Large-position activity proxy'};
  }
  root.SignalExtras=Object.freeze({
    heatmap,rsiSeries,rsiReversal,largePositionPrecheck,openInterestChange,largePositionSetup
  });
})(window);