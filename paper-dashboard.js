'use strict';
// Renders the laptop's BINANCE PAPER ONLY account without affecting the
// existing confirmed signals and automatic simulated-trade history.
(function(){
  let note='',showAll=false;
  const $=id=>document.getElementById(id);
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=x=>Number.isFinite(Number(x))?Number(x):null;
  const money=x=>number(x)===null?'—':'$'+number(x).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const price=x=>number(x)===null?'—':number(x).toLocaleString('en-US',{maximumFractionDigits:10});
  const stamp=x=>Number(x)>0?new Date(x).toLocaleString():'—';
  const table=(headers,rows,empty)=>rows.length?
    '<table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+
    '</tr></thead><tbody>'+rows.join('')+'</tbody></table>':
    '<div class="empty">'+empty+'</div>';
  const action=(t,kind)=>'<button class="trade-view-chart" type="button" data-a="tracked-chart" data-kind="'+kind+
    '" data-id="'+esc(t.id)+'">View Entry / SL / TP chart</button>';
  const coin=t=>'<a href="https://www.tradingview.com/chart/?symbol=BINANCE%3A'+encodeURIComponent(String(t.sym||'')+'.P')+
    '" rel="noopener" target="_blank">'+esc(t.sym)+'</a>';
  const badge=dir=>dir==='long'?'<span class="pill pl">LONG</span>':'<span class="pill ps">SHORT</span>';
  let current=null;
  window.drawBinancePaper=function(info){
    current=info;
    const p=info?.data||null,c=p?.config||{},s=p?.summary||{};
    const open=Array.isArray(p?.open)?p.open:[];
    const history=Array.isArray(p?.history)?p.history:[];
    const rejects=Array.isArray(p?.rejections)?p.rejections:[];
    const writable=!!info?.mode&&info?.source==='local'&&!!p;
    $('paperPause').disabled=!writable;
    $('paperSave').disabled=!writable;
    $('paperPause').textContent=c.paused?'Resume new paper entries':'Pause new paper entries';
    const feedFresh=Number(s.lastMarkAt)>0&&Date.now()-Number(s.lastMarkAt)<45_000;
    const status=!p?'Laptop paper broker not connected. Install or update the Windows app to activate local paper execution.':
      (c.paused?'Paper entries PAUSED':'Paper entries enabled')+
      ' · Binance public mark prices '+(feedFresh?'connected':'stale/unavailable')+
      (s.feedError?' · '+String(s.feedError):'')+
      (info.source==='cloud'?' · online view is read-only':'')+
      (note?' · '+note:'');
    $('paperStatus').textContent=status;
    const data=[
      ['Virtual balance',money(s.accountBalance)],
      ['Virtual equity',money(s.equity)],
      ['Open positions',open.length],
      ['Closed orders',p?.historyTotal??history.length],
      ['Paper win rate',number(s.winRate)===null?'—':number(s.winRate).toFixed(1)+'%'],
      ['Today P&L',money(s.dailyPnl)],
      ['Open exposure',money(s.exposure)],
      ['Rejected orders',p?.rejectionTotal??rejects.length]
    ];
    $('paperMetrics').innerHTML=data.map(item=>'<div><small>'+item[0]+'</small><b>'+item[1]+'</b></div>').join('');
    for(const input of document.querySelectorAll('[data-paper-setting]')){
      if(c[input.dataset.paperSetting]!==undefined&&document.activeElement!==input)
        input.value=c[input.dataset.paperSetting];
      input.disabled=!writable;
    }
    $('paperOpenCount').textContent=open.length+' positions';
    $('paperClosedCount').textContent=(p?.historyTotal??history.length)+' recorded'+(p?.historyTruncated?' (some only on laptop)':'');
    $('paperRejectCount').textContent=(p?.rejectionTotal??rejects.length)+' blocked';
    $('paperOpen').innerHTML=table(
      ['Coin','Side','Paper entry','Stop','TP (3R)','Quantity','Risk USDT','Notional','Open time','Chart'],
      open.map(t=>'<tr><td>'+coin(t)+'</td><td>'+badge(t.dir)+'</td><td>'+price(t.en)+
        '</td><td>'+price(t.stop)+'</td><td>'+price(t.tp2)+'</td><td>'+price(t.qty)+
        '</td><td>'+money(t.riskUsd)+'</td><td>'+money(t.notional)+'</td><td>'+stamp(t.open)+
        '</td><td>'+action(t,'paper-open')+'</td></tr>'),
      'No open Binance paper positions yet.'
    );
    const entries=showAll?[...history].reverse():[...history].reverse().slice(0,100);
    $('paperHistory').innerHTML=table(
      ['Closed','Coin','Side','Entry','Stop','TP','Exit','Net P&L','Result','Chart'],
      entries.map(t=>'<tr><td>'+stamp(t.close)+'</td><td>'+coin(t)+'</td><td>'+badge(t.dir)+
        '</td><td>'+price(t.en)+'</td><td>'+price(t.stop)+'</td><td>'+price(t.tp2)+
        '</td><td>'+price(t.ex)+'</td><td>'+money(t.pnl)+'</td><td>'+esc(t.why)+
        '</td><td>'+action(t,'paper-history')+'</td></tr>'),
      'No completed Binance paper orders yet.'
    );
    const allBtn=$('paperShowAll');
    if(allBtn){allBtn.hidden=history.length<=100;allBtn.textContent=showAll?'Show latest 100':'Show all '+history.length+' paper results';}
    $('paperRejects').innerHTML=table(
      ['Time','Coin','Side','Reason'],
      [...rejects].reverse().slice(0,150).map(x=>'<tr><td>'+stamp(x.at)+'</td><td>'+esc(x.sym)+
        '</td><td>'+esc(x.dir)+'</td><td>'+esc(x.reason)+'</td></tr>'),
      'No blocked paper entries.'
    );
  };
  async function save(data){
    if(!current||current.source!=='local'||!current.data)return;
    $('paperSave').disabled=true;$('paperPause').disabled=true;
    try{
      const r=await fetch('/api/config',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({paper:data}),cache:'no-store'
      });
      if(!r.ok)throw Error('Laptop did not accept the risk settings: HTTP '+r.status);
      note='Settings saved on this laptop';
      if(typeof remotePoll==='function')await remotePoll();
    }catch(e){note=String(e.message)}
    finally{
      if(typeof render==='function')render();
    }
  }
  $('paperPause').addEventListener('click',()=>{
    if(current?.data)save({paused:!current.data.config.paused});
  });
  $('paperSave').addEventListener('click',()=>{
    const values={};
    for(const el of document.querySelectorAll('[data-paper-setting]')){
      if(!el.checkValidity()){el.reportValidity();return}
      values[el.dataset.paperSetting]=Number(el.value);
    }
    save(values);
  });
  const button=document.createElement('button');
  button.id='paperShowAll';button.type='button';button.textContent='Show all paper results';button.hidden=true;
  button.style.margin='6px 0';
  $('paperHistory').before(button);
  button.addEventListener('click',()=>{
    showAll=!showAll;
    if(current)window.drawBinancePaper(current);
  });
  if(typeof render==='function')render();
})();