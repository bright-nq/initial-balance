'use strict';

// REPLAY MODE
// ═══════════════════════════════════════════════
function toggleReplay(){
  replayMode=!replayMode;
  document.getElementById('btn-replay').classList.toggle('on',replayMode);
  document.getElementById('replay-bar').classList.toggle('hidden',!replayMode);
  if(replayMode) replayInit();
  else {
    replayLimit=undefined;
    drawChart();
  }
}
function replayInit(){
  if(!selectedRawCandles) return;
  const startInput=document.getElementById('replay-start').value.trim()||'09:30';
  const agg=aggregateCandles(selectedRawCandles,currentTF);
  replayIdx=Math.max(1,agg.findIndex(c=>c.time>=startInput));
  if(replayIdx<0) replayIdx=1;
  replayLimit=replayIdx;
  zoom=1; panOffset=0;
  updateReplayPos();
  drawChart();
}
function replayStep(dir){
  if(!selectedCandles) return;
  replayLimit=Math.max(1,Math.min(selectedCandles.length,replayLimit+dir));
  updateReplayPos();
  drawChart();
}
function replayPlayPause(){
  const btn=document.getElementById('rb-play');
  if(replayTimer){
    clearInterval(replayTimer); replayTimer=null;
    btn.textContent='▶ Play'; btn.classList.remove('play');
  }else{
    const speed=+document.getElementById('replay-speed').value||600;
    replayTimer=setInterval(()=>{
      if(!selectedCandles||replayLimit>=selectedCandles.length){ stopPlayback(); return; }
      replayLimit++; updateReplayPos(); drawChart();
    },speed);
    btn.textContent='⏸ Pause'; btn.classList.add('play');
  }
}
// stopPlayback only stops the timer, does not disable replay mode
function stopPlayback(){
  if(replayTimer){ clearInterval(replayTimer); replayTimer=null; }
  const btn=document.getElementById('rb-play');
  if(btn){ btn.textContent='▶ Play'; btn.classList.remove('play'); }
}
// FIX 1: full replay teardown (only used when user explicitly turns off replay)
function stopReplay(){
  stopPlayback();
  replayMode=false; replayLimit=undefined;
  document.getElementById('btn-replay').classList.remove('on');
  document.getElementById('replay-bar').classList.add('hidden');
  drawChart();
}
function replayReset(){ stopPlayback(); replayInit(); }
function updateReplayPos(){
  if(!selectedCandles) return;
  const cur=selectedCandles[Math.min(replayLimit-1,selectedCandles.length-1)];
  document.getElementById('replay-pos').textContent=`${cur?cur.time:'—'}  (${replayLimit}/${selectedCandles.length})`;
}

// ═══════════════════════════════════════════════
// STATS HELPERS
// ═══════════════════════════════════════════════
function updateHeaderStats(){
  const oy=new Set(Object.keys(ohlcvFiles).map(Number));
  const t=oy.size>0?allTrades.filter(x=>oy.has(x.year)):allTrades;
  const w=t.filter(x=>x.is_winner).length;
  document.getElementById('h-total').textContent=t.length.toLocaleString();
  document.getElementById('h-winrate').textContent=(w/t.length*100).toFixed(1)+'%';
  document.getElementById('h-winners').textContent=w.toLocaleString();
  document.getElementById('h-losers').textContent=(t.length-w).toLocaleString();
  document.getElementById('h-prenoon').textContent=t.filter(x=>x.broke_before_noon).length.toLocaleString();
  document.getElementById('h-both').textContent=t.filter(x=>x.broke_both_sides).length.toLocaleString();
}
function updateMiniStats(){
  const f=filteredTrades,w=f.filter(t=>t.is_winner).length;
  const hb=f.filter(t=>t.first_break==='High').length,lb=f.filter(t=>t.first_break==='Low').length;
  const both=f.filter(t=>t.broke_both_sides).length;
  const avgMin=f.length?(f.reduce((s,t)=>s+t.minutes_to_break,0)/f.length):0;
  document.getElementById('m-filtered').textContent=f.length.toLocaleString();
  document.getElementById('m-winrate').textContent=f.length?(w/f.length*100).toFixed(1)+'%':'—';
  document.getElementById('m-high').textContent=hb.toLocaleString();
  document.getElementById('m-low').textContent=lb.toLocaleString();
  document.getElementById('m-avgmin').textContent=avgMin.toFixed(0)+'m';
  document.getElementById('m-both').textContent=both.toLocaleString();
  document.getElementById('win-bar-fill').style.width=(f.length?w/f.length*100:0)+'%';
}
function renderDistBars(){
  const c=document.getElementById('dist-bars'); c.innerHTML='';
  const byM=Array.from({length:12},(_,m)=>{ const mt=filteredTrades.filter(t=>t.month===m); return{total:mt.length,wins:mt.filter(t=>t.is_winner).length}; });
  const maxT=Math.max(...byM.map(b=>b.total),1);
  byM.forEach((b,i)=>{
    const bar=document.createElement('div');
    if(!b.total){ bar.className='month-bar'; bar.style.cssText='height:2px;background:var(--border)'; }
    else{ const wr=b.wins/b.total; bar.className=`month-bar ${wr>=0.5?'w':'l'}`; bar.style.height=(b.total/maxT*24+4)+'px'; bar.style.opacity=0.3+wr*0.7; bar.title=`${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i]}: ${b.wins}W/${b.total-b.wins}L (${(wr*100).toFixed(0)}%)`; }
    c.appendChild(bar);
  });
  document.getElementById('dist-label').textContent=`Monthly · ${filteredTrades.length} trades`;
}

// ═══════════════════════════════════════════════