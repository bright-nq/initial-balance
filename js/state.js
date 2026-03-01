'use strict';

// APP STATE
// ═══════════════════════════════════════════════
let allTrades=[],filteredTrades=[];
let selectedTrade=null,selectedCandles=null,selectedVWAP=null,selectedRawCandles=null;
let currentTF=1,currentView='chart';
let filters={year:'all',outcome:'all',dir:'all',ext:'all',timing:'all',search:''};
let zoom=1,panOffset=0;
let layers={vwap:true,ib:true,ibzone:true,markers:true,grid:false,volume:true};
let compactMode=false; // FIX 3: compact topbar state

// replay state
let replayMode=false,replayIdx=0,replayTimer=null;

// sidebar collapse state
const sbState={year:true,outcome:true,dir:true,ext:true,timing:true};
function toggleSb(key){
  sbState[key]=!sbState[key];
  const body=document.getElementById('sb-body-'+key);
  body.classList.toggle('closed',!sbState[key]);
  body.classList.toggle('open-pad',sbState[key]);
  document.getElementById('sb-toggle-'+key).classList.toggle('open',sbState[key]);
}
let searchOpen=true;
function toggleSearch(){
  // Search is now always visible in the Trades panel tab
  // This is a no-op kept for compatibility
}

// ═══════════════════════════════════════════════
// FIX 3: COMPACT MODE TOGGLE
// ═══════════════════════════════════════════════
function toggleCompactMode(){
  compactMode=!compactMode;
  const topbar=document.getElementById('chart-topbar');
  const btn=document.getElementById('btn-compact-toggle');
  topbar.classList.toggle('compact',compactMode);
  btn.classList.toggle('on',compactMode);
  // update icon: hamburger when expanded, X-like chevrons when compact
  btn.innerHTML=compactMode
    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>`
    : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
  btn.title=compactMode?'Show controls':'Hide controls';
  if(selectedTrade) setTimeout(drawChart,50); // redraw after layout shift
}

// ═══════════════════════════════════════════════
// TIMEFRAME / AGGREGATION
// ═══════════════════════════════════════════════
function aggregateCandles(candles,tf){
  if(tf<=1) return candles;
  const out=[];
  for(let i=0;i<candles.length;){
    const base=candles[i],[bh,bm]=base.time.split(':').map(Number),baseMin=bh*60+bm;
    const bs=Math.floor(baseMin/tf)*tf,be=bs+tf;
    const bKey=`${String(Math.floor(bs/60)).padStart(2,'0')}:${String(bs%60).padStart(2,'0')}`;
    let b={time:bKey,open:base.open,high:base.high,low:base.low,close:base.close,volume:base.volume};
    i++;
    while(i<candles.length){
      const c=candles[i],[ch,cm]=c.time.split(':').map(Number),cMin=ch*60+cm;
      if(cMin>=be) break;
      b.high=Math.max(b.high,c.high); b.low=Math.min(b.low,c.low); b.close=c.close; b.volume+=c.volume; i++;
    }
    out.push(b);
  }
  return out;
}
function setTimeframe(tf,el){
  currentTF=tf;
  document.querySelectorAll('.tf-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  if(selectedRawCandles){ zoom=1; panOffset=0; rebuildCandlesForTF(); drawChart(); }
}
function rebuildCandlesForTF(){ if(!selectedRawCandles) return; selectedCandles=aggregateCandles(selectedRawCandles,currentTF); selectedVWAP=computeVWAP(selectedCandles); }

// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
// BACKTEST STATE
// ═══════════════════════════════════════════════
let btMode=false; // are we in backtest view?
let btTF=1;
let btCandles=null,btRawCandles=null,btVWAP=null;
let btLimit=1;
let btTimer=null;
let btTrade=null; // the currently loaded trade (hidden from user)
let btDecision={dir:null,entry:null,target:null,stop:null,note:''};
let btJournal=[]; // array of decision records
let btSelectedEntry=null;