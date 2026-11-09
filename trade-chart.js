'use strict';
// Trade chart uses TradingView Lightweight Charts and public exchange candles.
(function(){
  let chart=null,candles=null,anchorSeries=[],data=[],plan=null;
  let activeSession=0,refreshTimer=null,resizeObserver=null,libPromise=null;
  const byId=id=>document.getElementById(id);
  function precisionFor(price){
    return Math.max(2,Math.min(10,Math.ceil(-Math.log10(Math.max(Number(price),1e-12)))+4));
  }
  function fmtPrice(value){
    return Number(value).toLocaleString('en-US',{maximumFractionDigits:precisionFor(value)});
  }
  function library(){
    if(window.LightweightCharts&&window.LightweightCharts.createChart)return Promise.resolve(window.LightweightCharts);
    if(libPromise)return libPromise;
    libPromise=new Promise((resolve,reject)=>{
      const el=document.createElement('script');
      el.src='https://cdn.jsdelivr.net/npm/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js';
      el.async=true;
      let finished=false;
      const timeout=setTimeout(()=>done(new Error('Chart library loading timed out')),15000);
      function done(error){
        if(finished)return;
        finished=true;clearTimeout(timeout);
        if(error){el.remove();reject(error)}
        else if(window.LightweightCharts&&window.LightweightCharts.createChart)resolve(window.LightweightCharts);
        else reject(new Error('Chart library unavailable'));
      }
      el.onload=()=>done(null);
      el.onerror=()=>done(new Error('Chart library failed to load'));
      document.head.appendChild(el);
    }).catch(error=>{libPromise=null;throw error});
    return libPromise;
  }
  function close(){
    activeSession++;
    if(refreshTimer!==null){clearInterval(refreshTimer);refreshTimer=null}
    if(resizeObserver){resizeObserver.disconnect();resizeObserver=null}
    if(chart){chart.remove();chart=null}
    candles=null;anchorSeries=[];data=[];plan=null;
    byId('tradeChartModal').hidden=true;
    document.body.style.overflow='';
  }
  function showZone(id,priceA,priceB,left,width){
    const node=byId(id);
    const a=candles.priceToCoordinate(priceA),b=candles.priceToCoordinate(priceB);
    if(!Number.isFinite(a)||!Number.isFinite(b)){node.style.display='none';return}
    node.style.display='block';
    node.style.left=left+'px';node.style.width=width+'px';
    node.style.top=Math.min(a,b)+'px';node.style.height=Math.max(1,Math.abs(a-b))+'px';
  }
  function drawZones(){
    if(!chart||!candles||!plan||!data.length)return;
    const plot=byId('tradeChartCanvas'),scale=chart.timeScale();
    const x1=scale.logicalToCoordinate(Math.max(0,data.length-11));
    const x2=scale.logicalToCoordinate(data.length+22);
    const left=Math.max(5,Math.min(plot.clientWidth-120,Number.isFinite(x1)?x1:plot.clientWidth*.6));
    const right=Math.min(plot.clientWidth-78,Math.max(left+55,Number.isFinite(x2)?x2:plot.clientWidth*.88));
    showZone('tradeChartGain',plan.en,plan.tp2,left,Math.max(30,right-left));
    showZone('tradeChartLoss',plan.en,plan.stop,left,Math.max(30,right-left));
  }
  function cleanBars(rows){
    const unique=new Map();
    for(const k of rows){
      const time=Math.floor(k.t/1000);
      if(Number.isFinite(time)&&k.o>0&&k.h>0&&k.l>0&&k.c>0){
        unique.set(time,{time,open:k.o,high:k.h,low:k.l,close:k.c});
      }
    }
    return [...unique.values()].sort((a,b)=>a.time-b.time);
  }
  async function update(symbol,session){
    const rows=await K(symbol,'5m',180);
    if(session!==activeSession||!candles)return;
    const bars=cleanBars(rows);
    if(bars.length<20)throw new Error('Not enough 5-minute market candles');
    data=bars;candles.setData(bars);
    const fixed=[plan.stop,plan.tp2];
    for(let i=0;i<anchorSeries.length;i++){
      const value=fixed[i];
      anchorSeries[i].setData([{time:bars[0].time,value},{time:bars[bars.length-1].time,value}]);
    }
    byId('tradeChartStatus').textContent=EX().toUpperCase()+' 5m market candles · updated '+new Date().toLocaleTimeString()+' · refreshes every 30 seconds';
    requestAnimationFrame(drawZones);
  }
  window.openPositionChart=async function(symbol){
    if(!/^[A-Z0-9]{3,30}$/.test(symbol))return;
    const result=R[symbol];
    if(!result||result.status!=='confirm'||!result.plan)return;
    const setup={...result.plan};
    const liquidity=result.sweep&&Number.isFinite(result.sweep.level)&&Number.isFinite(result.sweep.extreme)
      ?{...result.sweep}:null;
    const breakout=!liquidity&&result.momentum&&Number.isFinite(result.momentum.level)&&Number.isFinite(result.momentum.extreme)
      ?{...result.momentum}:null;
    const institutional=!liquidity&&!breakout&&result.large&&Number.isFinite(result.large.level)&&Number.isFinite(result.large.extreme)
      ?{...result.large}:null;
    const rsiSetup=!liquidity&&!breakout&&!institutional&&result.rsiSetup&&Number.isFinite(result.rsiSetup.level)&&Number.isFinite(result.rsiSetup.extreme)
      ?{...result.rsiSetup}:null;
    const structure=breakout||institutional||rsiSetup;
    if(![setup.en,setup.stop,setup.tp1,setup.tp2].every(v=>Number.isFinite(v)&&v>0))return;
    close();
    const session=++activeSession;
    byId('tradeChartModal').hidden=false;
    document.body.style.overflow='hidden';
    byId('tradeChartTitle').textContent=symbol+' · '+result.dir.toUpperCase()+' · '+(result.setupType||'Confirmed')+' · 5-minute chart';
    byId('tradeChartTV').href='https://www.tradingview.com/chart/?symbol='+encodeURIComponent((EX()==='bybit'?'BYBIT':'BINANCE')+':'+symbol+'.P');
    byId('tradeChartLevels').replaceChildren();
    const rr=setup.sp>0?Math.abs(setup.tp2-setup.en)/Math.abs(setup.en-setup.stop):0;
    const levels=[['Entry ',setup.en,'entry'],['Stop ',setup.stop,'bad'],['TP1 ',setup.tp1,'good'],['Final TP ',setup.tp2,'good'],['R:R 1 : ',rr,'']];
    if(liquidity){
      levels.push(['Swept '+liquidity.windowHours+'h '+(result.dir==='long'?'LOW ':'HIGH '),liquidity.level,'entry']);
      levels.push(['Sweep wick ',liquidity.extreme,'bad']);
    }else if(structure){
      levels.push([rsiSetup?'RSI reversal level ':'Breakout level ',structure.level,'entry']);
      levels.push(['Structural stop base ',structure.extreme,'bad']);
      if(Number.isFinite(structure.breakoutVolRatio))levels.push(['Volume activity ',structure.breakoutVolRatio.toFixed(2)+'x','good']);
      if(institutional&&Number.isFinite(institutional.oiChangePct))levels.push(['OI change 1h ',institutional.oiChangePct.toFixed(2)+'%','good']);
      if(rsiSetup&&Number.isFinite(rsiSetup.rsi5))levels.push(['RSI 5m ',rsiSetup.rsi5.toFixed(1),'good']);
    }
    for(const item of levels){
      const element=document.createElement('span');
      element.className=item[2];
      element.textContent=item[0]+(item[0]==='R:R 1 : '?Number(item[1]).toFixed(2):fmtPrice(item[1]));
      byId('tradeChartLevels').appendChild(element);
    }
    byId('tradeChartStatus').textContent='Loading '+EX().toUpperCase()+' 5-minute market candles…';
    byId('tradeChartGain').style.display='none';byId('tradeChartLoss').style.display='none';
    byId('tradeChartCanvas').replaceChildren();
    byId('tradeChartDialog').focus();
    try{
      const L=await library();
      if(session!==activeSession)return;
      const container=byId('tradeChartCanvas'),precision=precisionFor(setup.en);
      chart=L.createChart(container,{
        width:container.clientWidth,height:container.clientHeight,
        layout:{background:{type:'solid',color:'#0b1423'},textColor:'#c6d6e7',attributionLogo:true},
        grid:{vertLines:{color:'#243343'},horzLines:{color:'#243343'}},
        rightPriceScale:{borderColor:'#344760',scaleMargins:{top:0.12,bottom:0.12}},
        timeScale:{borderColor:'#344760',timeVisible:true,secondsVisible:false,rightOffset:25,barSpacing:7}
      });
      candles=chart.addSeries(L.CandlestickSeries,{
        upColor:'#20c997',downColor:'#f05b68',borderVisible:false,wickUpColor:'#20c997',wickDownColor:'#f05b68',
        priceFormat:{type:'price',precision,minMove:Math.pow(10,-precision)}
      });
      plan=setup;
      const lines=[
        {price:setup.en,color:'#70adff',width:2,title:'ENTRY'},
        {price:setup.stop,color:'#fa687a',width:2,title:'STOP LOSS'},
        {price:setup.tp1,color:'#51dbaa',width:1,title:'TP1'},
        {price:setup.tp2,color:'#24d6a3',width:2,title:'FINAL TP'}
      ];
      if(liquidity){
        lines.push({price:liquidity.level,color:'#e1a5fc',width:1,title:'SWEPT '+(result.dir==='long'?'LOW':'HIGH')});
        lines.push({price:liquidity.extreme,color:'#f4ab64',width:1,title:'SWEEP WICK'});
      }else if(structure){
        lines.push({price:structure.level,color:'#e1a5fc',width:1,title:rsiSetup?'RSI REVERSAL':'BREAKOUT LEVEL'});
        lines.push({price:structure.extreme,color:'#f4ab64',width:1,title:'STRUCTURE BASE'});
      }
      for(const level of lines){
        candles.createPriceLine({price:level.price,color:level.color,lineWidth:level.width,lineStyle:0,axisLabelVisible:true,title:level.title});
      }
      for(const price of [setup.stop,setup.tp2]){
        const anchor=chart.addSeries(L.LineSeries,{
          color:'rgba(0,0,0,0)',lineWidth:1,lastValueVisible:false,priceLineVisible:false,crosshairMarkerVisible:false,
          priceFormat:{type:'price',precision,minMove:Math.pow(10,-precision)}
        });
        anchorSeries.push(anchor);
      }
      await update(symbol,session);
      if(session!==activeSession)return;
      chart.timeScale().setVisibleLogicalRange({from:Math.max(0,data.length-92),to:data.length+25});
      requestAnimationFrame(drawZones);
      chart.timeScale().subscribeVisibleLogicalRangeChange(()=>requestAnimationFrame(drawZones));
      if(window.ResizeObserver){
        resizeObserver=new ResizeObserver(()=>{
          if(chart){chart.applyOptions({width:container.clientWidth,height:container.clientHeight});requestAnimationFrame(drawZones)}
        });
        resizeObserver.observe(container);
      }
      refreshTimer=setInterval(async()=>{
        if(session!==activeSession)return;
        try{await update(symbol,session)}
        catch(e){if(session===activeSession)byId('tradeChartStatus').textContent='Refresh paused: '+e.message}
      },30000);
    }catch(e){
      if(session===activeSession)byId('tradeChartStatus').textContent='Could not load interactive chart: '+e.message+'. Use Open full TradingView chart above.';
    }
  };
  byId('closeTradeChart').addEventListener('click',close);
  byId('tradeChartModal').addEventListener('click',event=>{if(event.target===byId('tradeChartModal'))close()});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!byId('tradeChartModal').hidden)close();
    else if((event.key==='Enter'||event.key===' ')&&event.target.matches('.card[data-a="chart"]')){
      event.preventDefault();window.openPositionChart(event.target.dataset.s);
    }
  });
})();