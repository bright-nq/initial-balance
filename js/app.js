'use strict';

// ═══════════════════════════════════════════════
// SIDEBAR TABS
// ═══════════════════════════════════════════════
let currentSbTab='filters';
function switchSbTab(tab){
  currentSbTab=tab;
  document.getElementById('sb-tab-filters').classList.toggle('active',tab==='filters');
  document.getElementById('sb-tab-trades').classList.toggle('active',tab==='trades');
  document.getElementById('sb-panel-filters').classList.toggle('sb-panel-hidden',tab!=='filters');
  document.getElementById('sb-panel-trades').classList.toggle('sb-panel-hidden',tab!=='trades');
  if(tab==='trades') setTimeout(()=>document.getElementById('trade-search-input')&&document.getElementById('trade-search-input').focus(),50);
}

// VIEW SWITCHING
// ═══════════════════════════════════════════════
function switchView(v){
  if(currentView===v) return;
  currentView=v;
  document.getElementById('view-chart').style.display=v==='chart'?'flex':'none';
  document.getElementById('view-analytics').style.display=v==='analytics'?'flex':'none';
  document.getElementById('view-backtest').style.display=v==='backtest'?'flex':'none';
  document.getElementById('tab-chart').classList.toggle('active',v==='chart');
  document.getElementById('tab-analytics').classList.toggle('active',v==='analytics');
  document.getElementById('tab-backtest').classList.toggle('active',v==='backtest');
  if(v==='analytics') renderAnalytics();
  else if(v==='backtest'){ btMode=true; if(selectedTrade) btLoadTrade(selectedTrade); else btDrawEmpty(); }
  else { btMode=false; if(selectedTrade) drawChart(); }
}

// ═══════════════════════════════════════════════
// LAUNCH
// ═══════════════════════════════════════════════
function launchApp(){
  if(!resultsLoaded) return;
  allTrades=rawTrades.map(r=>{
    const ibRangePts=(+r.ib_range_pct/100)*(+r.price_930);
    const dow=new Date(r.date).getDay();
    return{
      date:r.date,year:+r.year,month:+r.date.slice(5,7)-1,dow,
      first_extreme:r.first_extreme,expected_break:r.expected_break,first_break:r.first_break,
      is_winner:r.expected_break===r.first_break,
      broke_before_noon:r.broke_before_noon==='True'||r.broke_before_noon==='true'||r.broke_before_noon===true,
      minutes_to_break:+r.minutes_to_break,breakout_move:+r.breakout_move,
      relative_move_pct:+r.relative_move_pct,ib_range_pct:+r.ib_range_pct,price_930:+r.price_930,
      broke_both_sides:r.broke_both_sides==='True'||r.broke_both_sides==='true'||r.broke_both_sides===true,
      double_break_first:r.double_break_first_side||'',
      _ib_range_pts:ibRangePts,_ib_high:null,_ib_low:null,_ib_mid:null,
      _vwap_touched:null,_retrace_50:null,
    };
  });
  document.getElementById('loader').style.display='none';
  document.getElementById('app').style.display='flex';
  buildYearFilters(); applyFilters(); updateHeaderStats();
  setupCrosshair(); setupPan();
  window.addEventListener('resize',()=>{ if(selectedTrade&&currentView==='chart') drawChart(); });
}

// ═══════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════
function setFilter(key,val,el){
  filters[key]=val;
  document.querySelectorAll(`[data-${key}]`).forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  applyFilters();
  if(currentView==='analytics') renderAnalytics();
}
function setSearch(val){ filters.search=val; applyFilters(); }
function applyFilters(){
  const oy=new Set(Object.keys(ohlcvFiles).map(Number));
  filteredTrades=allTrades.filter(t=>{
    if(oy.size>0&&!oy.has(t.year)) return false;
    if(filters.year!=='all'&&t.year!==+filters.year) return false;
    if(filters.outcome==='winner'&&!t.is_winner) return false;
    if(filters.outcome==='loser'&&t.is_winner) return false;
    if(filters.dir!=='all'&&t.expected_break!==filters.dir) return false;
    if(filters.ext!=='all'&&t.first_extreme!==filters.ext) return false;
    if(filters.timing==='prenoon'&&!t.broke_before_noon) return false;
    if(filters.timing==='both'&&!t.broke_both_sides) return false;
    if(filters.search&&!t.date.includes(filters.search)) return false;
    return true;
  });
  renderList(); updateMiniStats(); renderDistBars();
}
function buildYearFilters(){
  const oy=new Set(Object.keys(ohlcvFiles).map(Number));
  const years=[...new Set(allTrades.map(t=>t.year))].filter(y=>oy.size===0||oy.has(y)).sort();
  const c=document.getElementById('year-filters'); c.innerHTML='';
  const all=mkBtn('All','fpill active',()=>setFilter('year','all',all));
  all.dataset.year='all'; c.appendChild(all);
  years.forEach(y=>{ const b=mkBtn(y,'fpill',()=>setFilter('year',y,b)); b.dataset.year=y; c.appendChild(b); });
}
function mkBtn(label,cls,fn){ const b=document.createElement('button'); b.className=cls; b.textContent=label; b.onclick=fn; return b; }

// ═══════════════════════════════════════════════
// TRADE LIST
// ═══════════════════════════════════════════════
function renderList(){
  const list=document.getElementById('trade-list'); list.innerHTML='';
  // Update count badge
  const countEl=document.getElementById('sb-trade-count');
  if(countEl) countEl.textContent=filteredTrades.length.toLocaleString();
  filteredTrades.forEach((t,i)=>{
    const el=document.createElement('div');
    el.className=`trade-item${selectedTrade===t?' selected':''}`;
    el.onclick=()=>selectTrade(t,i);
    const tags=[];
    if(t.broke_both_sides) tags.push(`<span class="ti-tag both">⇅ both</span>`);
    if(t.broke_before_noon) tags.push(`<span class="ti-tag prenoon">🌅 pre-noon</span>`);
    el.innerHTML=`
      <div class="ti-bar ${t.is_winner?'win':'loss'}"></div>
      <div class="ti-body">
        <div class="ti-date">${t.date}</div>
        <div class="ti-meta">${t.expected_break==='High'?'↑':'↓'} exp · ${t.first_extreme} 1st ${tags.join('')}</div>
      </div>
      <div class="ti-right">
        <div class="ti-outcome ${t.is_winner?'win':'loss'}">${t.is_winner?'WIN':'LOSS'}</div>
        <div class="ti-pts">${t.minutes_to_break.toFixed(0)}m · ${t._ib_range_pts.toFixed(1)}pt</div>
      </div>`;
    list.appendChild(el);
  });
}
function selectRandom(){
  if(!filteredTrades.length) return;
  const idx=Math.floor(Math.random()*filteredTrades.length);
  selectTrade(filteredTrades[idx],idx);
  const items=document.getElementById('trade-list').querySelectorAll('.trade-item');
  if(items[idx]) items[idx].scrollIntoView({behavior:'smooth',block:'nearest'});
}

// ═══════════════════════════════════════════════
// FIX 1: REPLAY PERSISTS ACROSS TRADE SELECTIONS
// selectTrade no longer calls stopReplay().
// Instead, if replayMode is active, we re-init replay for the newly loaded trade.
// ═══════════════════════════════════════════════
async function selectTrade(trade,idx){
  selectedTrade=trade; selectedCandles=null; selectedVWAP=null;

  // FIX 1: pause playback timer but keep replayMode ON
  if(replayTimer){ clearInterval(replayTimer); replayTimer=null; }
  const playBtn=document.getElementById('rb-play');
  if(playBtn){ playBtn.textContent='▶ Play'; playBtn.classList.remove('play'); }

  if(currentView==='analytics') switchView('chart');
  document.querySelectorAll('.trade-item').forEach((el,i)=>el.classList.toggle('selected',i===idx));
  document.getElementById('ct-title').textContent=trade.date;
  document.getElementById('ct-badge').innerHTML=`<div class="ct-badge ${trade.is_winner?'win':'loss'}">${trade.is_winner?'✓ Winner':'✗ Loser'}</div>`;
  document.getElementById('ct-levels').innerHTML='';
  updateStatsPanel(trade);
  document.getElementById('empty-state').style.display='none';
  document.getElementById('chartCanvas').style.display='block';
  zoom=1; panOffset=0; drawChartLoading();
  const candles=await getCandlesForDate(trade.date);
  if(candles&&candles.length){
    const ibEnd=document.getElementById('an-ib-end')?.value||'10:30';
    const ibC=candles.filter(c=>c.time>='09:30'&&c.time<ibEnd);
    if(ibC.length){
      trade._ib_high=Math.max(...ibC.map(c=>c.high));
      trade._ib_low=Math.min(...ibC.map(c=>c.low));
      trade._ib_mid=(trade._ib_high+trade._ib_low)/2;
      document.getElementById('sp-ibh').textContent=trade._ib_high.toFixed(2);
      document.getElementById('sp-ibl').textContent=trade._ib_low.toFixed(2);
      document.getElementById('sp-ibr').textContent=(trade._ib_high-trade._ib_low).toFixed(2)+' pts';
      document.getElementById('ct-levels').innerHTML=`
        <div class="ct-level">H ${trade._ib_high.toFixed(1)}</div>
        <div class="ct-level">L ${trade._ib_low.toFixed(1)}</div>
        <div class="ct-level">M ${trade._ib_mid.toFixed(1)}</div>
        <div class="ct-level">R ${(trade._ib_high-trade._ib_low).toFixed(1)}</div>`;
    }
    const cutoff=addMinutes('10:30',Math.ceil(trade.minutes_to_break)+30);
    const sliced=candles.filter(c=>c.time>='09:30'&&c.time<=cutoff);
    selectedRawCandles=sliced.length>4?sliced:candles.filter(c=>c.time>='09:30');
    rebuildCandlesForTF();
  }else{
    const half=trade._ib_range_pts/2;
    trade._ib_high=trade.price_930+half; trade._ib_low=trade.price_930-half; trade._ib_mid=trade.price_930;
    selectedRawCandles=null; updateStatsPanel(trade);
  }

  // FIX 1: if replay mode is active, re-init for this new trade automatically
  if(currentView==='backtest'){
    btLoadTrade(trade);
  } else if(replayMode){
    replayInit();
  } else {
    drawChart();
  }
}

function updateStatsPanel(t){
  document.getElementById('sp-date').textContent=t.date;
  document.getElementById('sp-ibh').textContent=t._ib_high?t._ib_high.toFixed(2):'—';
  document.getElementById('sp-ibl').textContent=t._ib_low?t._ib_low.toFixed(2):'—';
  document.getElementById('sp-ibr').textContent=t._ib_range_pts.toFixed(1)+' pts';
  const de=document.getElementById('sp-dir');
  de.textContent=(t.expected_break==='High'?'↑ ':'↓ ')+t.expected_break;
  de.style.color=t.expected_break==='High'?'var(--green)':'var(--red)';
  const fe=document.getElementById('sp-first');
  fe.textContent=(t.first_break==='High'?'↑ ':'↓ ')+t.first_break;
  fe.style.color=t.first_break==='High'?'var(--green)':'var(--red)';
  document.getElementById('sp-mbreak').textContent=t.minutes_to_break.toFixed(0)+' min';
  const be=document.getElementById('sp-both');
  be.textContent=t.broke_both_sides?'Yes':'No';
  be.style.color=t.broke_both_sides?'var(--gold)':'var(--text-dim)';
  const oe=document.getElementById('sp-outcome');
  oe.textContent=t.is_winner?'✓ WINNER':'✗ LOSER';
  oe.style.color=t.is_winner?'var(--green)':'var(--red)';
}

// ═══════════════════════════════════════════════