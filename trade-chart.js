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
  async function chartMarketBars(symbol,source,trade){
    // For completed trades fetch candles near the actual entry/exit instead
    // of showing only today's candles with stale price levels.
    const completed=trade?.tradeKind==='history';
    const ended=completed?Math.min(Date.now(),Math.max(Number(trade.closedAt)||0,Number(trade.openedAt)||0)+3600000):null;
    const activeSource=source==='binance'?'binance':'bybit';
    const interval=trade?.plan?.timeframe==='1m'?'1m':'5m';
    if(!ended&&activeSource===EX())return K(symbol,interval,180);
    if(activeSource==='bybit'){
      const query='https://api.bybit.com/v5/market/kline?category=linear&symbol='+encodeURIComponent(symbol)+
        '&interval='+(interval==='1m'?'1':'5')+'&limit=220'+(ended?'&end='+Math.floor(ended):'');
      const response=await J(query);
      if(!Array.isArray(response?.result?.list))throw new Error('Bybit '+interval+' candles unavailable');
      return response.result.list.map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]})).reverse();
    }
    const query='https://fapi.binance.com/fapi/v1/klines?symbol='+encodeURIComponent(symbol)+
      '&interval='+interval+'&limit=220'+(ended?'&endTime='+Math.floor(ended):'');
    const response=await J(query,2);
    if(!Array.isArray(response))throw new Error('Binance '+interval+' candles unavailable');
    return response.map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}));
  }
  async function update(symbol,session,source,result){
    const rows=await chartMarketBars(symbol,source,result);
    if(session!==activeSession||!candles)return;
    const bars=cleanBars(rows);
    if(bars.length<20)throw new Error('Not enough '+(result.plan?.timeframe||'5m')+' candles');
    data=bars;candles.setData(bars);
    const fixed=[plan.stop,plan.tp2];
    for(let i=0;i<anchorSeries.length;i++){
      const value=fixed[i];
      anchorSeries[i].setData([{time:bars[0].time,value},{time:bars[bars.length-1].time,value}]);
    }
    byId('tradeChartStatus').textContent=source.toUpperCase()+' '+(result.plan?.timeframe||'5m')+' market candles · '+(result.tradeKind==='history'?
      'historical chart around saved trade':'updated '+new Date().toLocaleTimeString()+' · refreshes every 30 seconds');
    requestAnimationFrame(drawZones);
  }
  // Charts opened from stored trades must use that exact trade's saved plan,
  // not whichever new signal happens to be displayed for the same coin.
  window.openTrackedTradeChart=function(kind,id){
    if(kind!=='open'&&kind!=='history')return;
    const records=kind==='open'?st.open:st.hist;
    if(!Array.isArray(records))return;
    const trade=records.find(x=>String(x.id)===String(id));
    if(!trade||!trade.sym||!['long','short'].includes(trade.dir))return;
    const en=Number(trade.en),stop=Number(trade.stop0??trade.stop);
    const tp=Number(trade.tp2??trade.tp);
    if(![en,stop,tp].every(x=>Number.isFinite(x)&&x>0))return;
    const risk=Math.abs(en-stop),rr=risk?Math.abs(tp-en)/risk:0;
    if(!(risk>0))return;
    const record={
      status:'confirm',dir:trade.dir,source:trade.source||EX(),
      tradeKind:kind,
      openedAt:trade.open,closedAt:trade.close,
      outcome:trade.why||null,exitPrice:Number(trade.ex),
      plan:{en,stop,tp2:tp,sp:risk/en*100,rr,structureExtreme:null,
        timeframe:trade.timeframe||'5m',
        previousDayLevel:trade.previousDayLevel||null},
      confirmationMode:trade.confirmationMode||null,
      researchOnly:trade.researchOnly===true,
      pattern:{name:trade.confirmationMode||'Saved trade'}
    };
    return window.openPositionChart(trade.sym,record);
  };
  window.openPositionChart=async function(symbol,selectedRecord=null){
    if(!/^[A-Z0-9]{3,30}$/.test(symbol))return;
    const result=selectedRecord||R[symbol];
    if(!result||result.status!=='confirm'||!result.plan)return;
    const source=result.source==='bybit'||result.source==='binance'?result.source:EX();
    const setup={...result.plan};
    const structure=Number.isFinite(setup.structureExtreme)?setup.structureExtreme:null;
    const previousDay=setup.previousDayLevel;
    const hasPreviousDay=previousDay&&
      Number.isFinite(previousDay.high)&&previousDay.high>0&&
      Number.isFinite(previousDay.low)&&previousDay.low>0;
    const pattern=result.pattern?.name||'Confirmed candle';
    if(![setup.en,setup.stop,setup.tp2].every(v=>Number.isFinite(v)&&v>0))return;
    close();
    const session=++activeSession;
    byId('tradeChartModal').hidden=false;
    document.body.style.overflow='hidden';
    const title=result.tradeKind==='history'?'Completed trade result':
       result.tradeKind==='open'?'Automatically tracked trade':'Confirmed trade';
    byId('tradeChartTitle').textContent=symbol+' · '+result.dir.toUpperCase()+' · '+title+' · '+(setup.timeframe||'5m')+' chart';
    byId('tradeChartTV').href='https://www.tradingview.com/chart/?symbol='+encodeURIComponent((source==='bybit'?'BYBIT':'BINANCE')+':'+symbol+'.P');
    byId('tradeChartLevels').replaceChildren();
    const rr=setup.sp>0?Math.abs(setup.tp2-setup.en)/Math.abs(setup.en-setup.stop):0;
    const levels=[
      ['Entry ',setup.en,'entry'],['Stop ',setup.stop,'bad'],
      ['Final TP (3R) ',setup.tp2,'good'],
      ['R:R 1 : ',rr,''],['Pattern ',pattern,'entry']
    ];
    if(result.tradeKind==='open')
      levels.push(['Status ','Automatically tracking','good']);
    if(result.tradeKind==='history'){
      if(result.outcome)levels.push(['Result ',result.outcome,'good']);
      if(Number.isFinite(result.exitPrice)&&result.exitPrice>0)
        levels.push(['Recorded exit ',result.exitPrice,'entry']);
    }
    if(structure!==null)levels.push(['Candle structure ',structure,'bad']);
    if(hasPreviousDay){
      levels.push(['Previous day high ',previousDay.high,'']);
      levels.push(['Previous day low ',previousDay.low,'']);
    }
    if(result.researchOnly===true||setup.researchOnly===true)
      levels.push(['Execution ','Research setup — simulated only','bad']);
    for(const item of levels){
      const element=document.createElement('span');
      element.className=item[2];
      element.textContent=item[0]+(typeof item[1]==='number'?
        (item[0]==='R:R 1 : '?item[1].toFixed(2):fmtPrice(item[1])):item[1]);
      byId('tradeChartLevels').appendChild(element);
    }
    byId('tradeChartStatus').textContent='Loading '+source.toUpperCase()+' '+(setup.timeframe||'5m')+' candles…';
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
        {price:setup.tp2,color:'#24d6a3',width:2,title:'FINAL TP (3R)'}
      ];
      if(structure!==null)lines.push({
        price:structure,color:'#f4ab64',width:1,title:'CANDLE STRUCTURE'
      });
      if(hasPreviousDay){
        lines.push({price:previousDay.high,color:'#ba91ed',width:1,title:'PREV DAY HIGH'});
        lines.push({price:previousDay.low,color:'#9d8dee',width:1,title:'PREV DAY LOW'});
      }
      if(result.tradeKind==='history'&&Number.isFinite(result.exitPrice)&&result.exitPrice>0){
        lines.push({price:result.exitPrice,color:'#efc36d',width:1,title:'RECORDED EXIT'});
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
      await update(symbol,session,source,result);
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
      if(result.tradeKind!=='history')refreshTimer=setInterval(async()=>{
        if(session!==activeSession)return;
        try{await update(symbol,session,source,result)}
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