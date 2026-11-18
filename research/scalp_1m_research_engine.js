/*
Reproducible one-minute historical study.
No future bars are used for signals; fill at NEXT bar open.
OHLCV intra-bar order is unknowable: if both stop and TP touch in one bar, STOP wins.
At most one historical position per instrument at a time.
The analyzed CSV market provenance is limited to the upstream repository claims.
Uses 1m EMA9/EMA21, RSI14/ATR14/volume and CLOSED 5m EMA21/EMA55 trend.
2R gross target, maximum 35-minute holding time.
Hypothetical taker commission 0.04% EACH WAY and 0.01% slippage EACH WAY.
*/
function runBacktest(csv,symbol,sourceUrl){
 const rows=csv.trim().split(/\r?\n/);
 const bars=[];
 for(let j=0;j<rows.length;j++){
   const p=rows[j].split(',');
   const t=Number(p[0]),o=Number(p[1]),h=Number(p[2]),l=Number(p[3]),c=Number(p[4]),v=Number(p[5]);
   if(!(t>1e12&&t<2e12&&o>0&&h>=Math.max(o,c,l)&&l<=Math.min(o,c,h)&&v>=0))continue;
   if(bars.length&&t<=bars[bars.length-1].t)continue;
   bars.push({t,o,h,l,c,v});
 }
 if(bars.length<500)return {symbol,sourceUrl,bars:bars.length,trades:[],gaps:0};
 let ema9=null,ema21=null,ema5_21=null,ema5_55=null,prev5ema21=[];
 let rsi=null,avgGain=0,avgLoss=0,prevClose=null;
 let atr=null,atrSum=0,volSum=0;
 let initialVol=[],hf={o:null,h:-Infinity,l:Infinity,c:null,t:null};
 const er9=[],er21=[],atrA=[],rsiA=[],vRatioA=[],tfTrend=[],hlocs=[],tfEmas=[];
 const ma5=[];
 let fiveCount=0,gaps=0;
 for(let i=0;i<bars.length;i++){
   const b=bars[i];
   const gap=i>0&&b.t-bars[i-1].t!==60000;
   if(gap)gaps++;
   ema9=ema9===null?b.c:ema9+(2/10)*(b.c-ema9);
   ema21=ema21===null?b.c:ema21+(2/22)*(b.c-ema21);
   er9.push(ema9);er21.push(ema21);
   if(i>0){
    const ch=b.c-prevClose;
    if(i<=14){avgGain+=Math.max(0,ch);avgLoss+=Math.max(0,-ch);if(i===14){avgGain/=14;avgLoss/=14;}}
    else {avgGain=(avgGain*13+Math.max(0,ch))/14;avgLoss=(avgLoss*13+Math.max(0,-ch))/14;}
    if(i>=14)rsi=avgLoss===0?(avgGain===0?50:100):100-100/(1+avgGain/avgLoss);
    const tr=Math.max(b.h-b.l,Math.abs(b.h-prevClose),Math.abs(b.l-prevClose));
    if(i<=14){atrSum+=tr;if(i===14)atr=atrSum/14}
    else atr=(atr*13+tr)/14;
   }
   prevClose=b.c;
   atrA.push(atr);rsiA.push(rsi);
   const ratio=initialVol.length>=20?b.v/(volSum/20||1):null;
   vRatioA.push(ratio);
   initialVol.push(b.v);volSum+=b.v;
   if(initialVol.length>20)volSum-=initialVol.shift();
   // 5-minute candle is published to the filter only AFTER it fully closes.
   if(hf.t===null){hf={t:b.t,o:b.o,h:b.h,l:b.l,c:b.c};}
   else {hf.h=Math.max(hf.h,b.h);hf.l=Math.min(hf.l,b.l);hf.c=b.c;}
   const min=Math.floor(b.t/60000);
   if(min%5===4){
    fiveCount++;
    ema5_21=ema5_21===null?hf.c:ema5_21+(2/22)*(hf.c-ema5_21);
    ema5_55=ema5_55===null?hf.c:ema5_55+(2/56)*(hf.c-ema5_55);
    prev5ema21.push(ema5_21);if(prev5ema21.length>6)prev5ema21.shift();
    hf={t:null,o:null,h:-Infinity,l:Infinity,c:null};
   }
   let direction=0;
   if(fiveCount>=75&&prev5ema21.length>=4){
    const sl=prev5ema21[prev5ema21.length-1]-prev5ema21[prev5ema21.length-4];
    const sep=(ema5_21-ema5_55)/b.c;
    if(sep>.00022&&sl>0&&b.c>ema5_21)direction=1;
    if(sep<-.00022&&sl<0&&b.c<ema5_21)direction=-1;
   }
   tfTrend.push(direction);tfEmas.push([ema5_21,ema5_55]);
 }
 const trades=[];let lockedUntil=400;
 for(let i=450;i<bars.length-40;i++){
  if(i<lockedUntil)continue;
  const b=bars[i],prev=bars[i-1],a=atrA[i],r=rsiA[i],vr=vRatioA[i],trend=tfTrend[i];
  if(!a||!r||!vr||!trend||i<30)continue;
  if(b.t-bars[i-10].t!==600000)continue; // do not cross any missing minutes
  if(a/b.c<.00012||a/b.c>.015)continue;
  if(vr<1.03)continue;
  const dir=trend,body=dir*(b.c-b.o),rng=b.h-b.l;
  if(body<.27*a||rng<=0||body>2.6*a)continue;
  if(dir===1){
    if(!(er9[i]>er21[i]&&er21[i]>er21[i-3]&&b.c>prev.h+.015*a&&
        (b.h-b.c)/rng<=.37&&r>=51&&r<=75&&(b.c-er21[i])/a<=1.6))continue;
  }else{
    if(!(er9[i]<er21[i]&&er21[i]<er21[i-3]&&b.c<prev.l-.015*a&&
        (b.c-b.l)/rng<=.37&&r>=25&&r<=49&&(er21[i]-b.c)/a<=1.6))continue;
  }
  let pull=-1;
  for(let z=i-5;z<i;z++){
    const x=bars[z],e=er21[z];
    if(dir===1?(x.l<=e+.2*a&&x.c>=e-.7*a):(x.h>=e-.2*a&&x.c<=e+.7*a))pull=z;
  }
  if(pull<0)continue;
  const nx=bars[i+1];
  if(nx.t-b.t!==60000)continue;
  const entry=nx.o*(1+dir*.0001);
  const slice=bars.slice(pull,i+1);
  const extreme=dir===1?Math.min(...slice.map(x=>x.l)):Math.max(...slice.map(x=>x.h));
  const stop=extreme-dir*.12*a;
  const risk=dir*(entry-stop);
  if(!(risk>0)||risk/entry<.00045||risk/entry>.008)continue;
  const tp=entry+dir*2*risk;
  if(dir===1&&nx.o<=stop||dir===-1&&nx.o>=stop)continue;
  let exitIndex=Math.min(i+36,bars.length-1),exit=bars[exitIndex].c,why='TIME';
  for(let j=i+1;j<=Math.min(i+36,bars.length-1);j++){
    const k=bars[j];
    if(j>i+1&&k.t-bars[j-1].t!==60000){exitIndex=j-1;exit=bars[j-1].c;why='GAP';break;}
    const hitStop=dir===1?k.l<=stop:k.h>=stop;
    const hitTp=dir===1?k.h>=tp:k.l<=tp;
    if(hitStop){exitIndex=j;exit=stop;why=hitTp?'BOTH_STOP_FIRST':'SL';break;}
    if(hitTp){exitIndex=j;exit=tp;why='TP';break;}
  }
  const exitFill=exit*(1-dir*.0001);
  const netR=(dir*(exitFill-entry)-.0008*entry)/risk;
  const rawR=dir*(exit-entry)/risk;
  trades.push({
   symbol,signalUTC:new Date(b.t+60000).toISOString(),entryUTC:new Date(nx.t).toISOString(),
   exitUTC:new Date(bars[exitIndex].t).toISOString(),
   side:dir===1?'LONG':'SHORT',family:'5m trend + 1m EMA21 pullback + breakout',
   confirmation:'Closed 5m EMA21/55 trend; 1m EMA9/21; EMA21 touch in last 5m; breakout close; RSI; volume',
   entry:Number(entry.toPrecision(9)),stop:Number(stop.toPrecision(9)),tp:Number(tp.toPrecision(9)),
   exit:Number(exitFill.toPrecision(9)),outcome:why,netR:+netR.toFixed(4),rawR:+rawR.toFixed(4),
   holdMinutes:exitIndex-i,RSI14:+r.toFixed(2),volumeRatio:+vr.toFixed(2),
   ATRpct:+(100*a/b.c).toFixed(4),
   HTF_EMA21:tfEmas[i][0]&&+tfEmas[i][0].toPrecision(9),
   HTF_EMA55:tfEmas[i][1]&&+tfEmas[i][1].toPrecision(9),
   sourceUrl
  });
  lockedUntil=exitIndex+1;
  i=lockedUntil-1;
 }
 return {symbol,sourceUrl,bars:bars.length,trades,gaps};
}
