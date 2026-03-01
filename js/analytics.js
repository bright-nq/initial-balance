'use strict';

// ANALYTICS ENGINE
// ═══════════════════════════════════════════════
function cfr(r){ return r>=0.6?'var(--green)':r>=0.5?'var(--gold)':'var(--red)'; }
function winRate(arr){ return arr.length?arr.filter(t=>t.is_winner).length/arr.length:0; }

function barRow(label,wins,total,maxWins,colorCls){
  const w=total>0?(wins/maxWins)*100:0,rate=total>0?(wins/total)*100:0;
  return`<div class="an-bar-row">
    <div class="an-bar-label">${label}</div>
    <div class="an-bar-track"><div class="an-bar-fill ${colorCls}" style="width:${w}%"></div></div>
    <div class="an-bar-pct" style="color:${cfr(wins/total)}">${rate.toFixed(1)}%</div>
    <div class="an-bar-count">${wins}/${total}</div>
  </div>`;
}

// ═══════════════════════════════════════════════
// OHLCV FLAGS
// VWAP: always computed cumulatively from session open (09:30).
// Touch is checked FROM vwapStart until the IB breaks.
// e.g. select "10:15" → VWAP builds from 09:30, we check if price
// touched it any time from 10:15 up until the breakout candle.
// ═══════════════════════════════════════════════
async function computeOhlcvFlags(trades,vwapThresh,vwapStart,ibEnd,retraceWindowStr){
  const [rtStart,rtEnd]=retraceWindowStr.includes('–')?retraceWindowStr.split('–'):['10:00','10:30'];
  const needUpdate=trades.filter(t=>t._vwap_touched===null||t._retrace_50===null);
  if(!needUpdate.length) return;
  const byYear={};
  needUpdate.forEach(t=>{ const y=t.year; if(!byYear[y])byYear[y]=[]; byYear[y].push(t); });
  for(const[yearStr,ts] of Object.entries(byYear)){
    const year=+yearStr;
    if(!ohlcvCache[year]) await ensureYearCached(year);
    if(!ohlcvCache[year]) continue;
    ts.forEach(t=>{
      const candles=ohlcvCache[year][t.date]; if(!candles||!candles.length){ t._vwap_touched=false; t._retrace_50=false; return; }

      // IB levels: 09:30 up to ibEnd
      const ibC=candles.filter(c=>c.time>='09:30'&&c.time<ibEnd);
      if(!ibC.length){ t._vwap_touched=false; t._retrace_50=false; return; }
      const ibH=Math.max(...ibC.map(c=>c.high)),ibL=Math.min(...ibC.map(c=>c.low)),ibMid=(ibH+ibL)/2;

      // VWAP calculated from 09:30 cumulatively.
      // Touch checked FROM vwapStart until the IB breaks (brkTime).
      const brkTime=addMinutes('10:30',Math.ceil(t.minutes_to_break));
      const sessionCandles=candles.filter(c=>c.time>='09:30'&&c.time<brkTime);
      let ctpv=0,cv=0,vwapTouched=false;
      sessionCandles.forEach(c=>{
        const tp=(c.high+c.low+c.close)/3; ctpv+=tp*c.volume; cv+=c.volume;
        const v=cv>0?ctpv/cv:tp;
        // only check for touch from vwapStart onward (VWAP still accumulates from 09:30)
        if(c.time<vwapStart) return;
        if(Math.abs(c.close-v)<=vwapThresh||Math.abs(c.low-v)<=vwapThresh||Math.abs(c.high-v)<=vwapThresh) vwapTouched=true;
      });
      t._vwap_touched=vwapTouched;

      // 50% retrace: was ibMid visited during retrace window?
      const retraceCandles=candles.filter(c=>c.time>=rtStart&&c.time<rtEnd);
      let retrace50=false;
      retraceCandles.forEach(c=>{ if(c.low<=ibMid&&c.high>=ibMid) retrace50=true; });
      t._retrace_50=retrace50;
    });
  }
}

function renderAnalytics(){
  const f=filteredTrades,n=f.length;
  if(!n){ document.getElementById('an-sub').textContent='No trades match current filters'; return; }
  const wins=f.filter(t=>t.is_winner).length,wr=wins/n;
  document.getElementById('an-sub').textContent=`${n.toLocaleString()} filtered trades`;

  // KPIs
  document.getElementById('an-winrate').textContent=(wr*100).toFixed(1)+'%';
  document.getElementById('an-winrate-sub').textContent=`${wins} wins / ${n-wins} losses`;
  const avgMin=(f.reduce((s,t)=>s+t.minutes_to_break,0)/n).toFixed(1);
  document.getElementById('an-avgtime').textContent=avgMin+'m';
  const medArr=[...f].map(t=>t.minutes_to_break).sort((a,b)=>a-b);
  document.getElementById('an-avgtime-sub').textContent=`median ${medArr[Math.floor(medArr.length/2)].toFixed(0)}m`;
  const prenoon=f.filter(t=>t.broke_before_noon).length;
  document.getElementById('an-prenoon').textContent=(prenoon/n*100).toFixed(1)+'%';
  document.getElementById('an-prenoon-sub').textContent=`${prenoon} of ${n} trades`;
  const both=f.filter(t=>t.broke_both_sides).length;
  document.getElementById('an-both').textContent=(both/n*100).toFixed(1)+'%';
  document.getElementById('an-both-sub').textContent=`${both} of ${n} trades`;

  // By direction
  const byDir={High:f.filter(t=>t.expected_break==='High'),Low:f.filter(t=>t.expected_break==='Low')};
  const maxDir=Math.max(...Object.values(byDir).map(a=>a.filter(t=>t.is_winner).length),1);
  document.getElementById('an-by-dir').innerHTML=
    [['↑ High','High'],['↓ Low','Low']].map(([lbl,k])=>{ const arr=byDir[k]||[],w=arr.filter(t=>t.is_winner).length; return barRow(lbl,w,arr.length,maxDir,w/arr.length>=0.5?'green':'red'); }).join('');

  // By first extreme
  const byExt={High:f.filter(t=>t.first_extreme==='High'),Low:f.filter(t=>t.first_extreme==='Low')};
  const maxExt=Math.max(...Object.values(byExt).map(a=>a.filter(t=>t.is_winner).length),1);
  document.getElementById('an-by-ext').innerHTML=
    [['High 1st','High'],['Low 1st','Low']].map(([lbl,k])=>{ const arr=byExt[k]||[],w=arr.filter(t=>t.is_winner).length; return barRow(lbl,w,arr.length,maxExt,w/arr.length>=0.5?'green':'red'); }).join('');

  // Monthly heatmap
  const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const hmGrid=document.getElementById('an-heatmap-grid');
  hmGrid.innerHTML='';
  const hdrRow=document.createElement('div');
  hdrRow.className='an-hm-row';
  hdrRow.innerHTML=`<div class="an-hm-yr"></div>`+monthNames.map(m=>`<div class="an-hm-ml">${m.slice(0,1)}</div>`).join('');
  hmGrid.appendChild(hdrRow);
  const years=[...new Set(f.map(t=>t.year))].sort();
  years.forEach(yr=>{
    const row=document.createElement('div'); row.className='an-hm-row';
    row.innerHTML=`<div class="an-hm-yr">${yr}</div>`;
    for(let m=0;m<12;m++){
      const mt=f.filter(t=>t.year===yr&&t.month===m);
      const cell=document.createElement('div'); cell.className='an-hm-cell';
      if(!mt.length){ cell.style.background='var(--surface2)'; cell.style.color='var(--text-dim)'; cell.textContent=''; cell.title=`${yr} ${monthNames[m]}: no data`; }
      else{
        const wr2=mt.filter(t=>t.is_winner).length/mt.length;
        const g=Math.round(wr2*190),r=Math.round((1-wr2)*190);
        cell.style.background=`rgba(${r},${g},40,0.38)`; cell.style.border=`1px solid rgba(${r},${g},40,0.55)`;
        cell.style.color=`rgb(${r+30},${g+30},60)`;
        cell.textContent=(wr2*100).toFixed(0)+'%';
        cell.title=`${yr} ${monthNames[m]}: ${mt.filter(t=>t.is_winner).length}W/${mt.length-mt.filter(t=>t.is_winner).length}L`;
      }
      row.appendChild(cell);
    }
    hmGrid.appendChild(row);
  });

  // Day of week
  const dowNames=['Mon','Tue','Wed','Thu','Fri'];
  const dowEl=document.getElementById('an-dow'); dowEl.innerHTML='';
  [1,2,3,4,5].forEach(d=>{
    const dt=f.filter(t=>t.dow===d);
    const wr2=dt.length?dt.filter(t=>t.is_winner).length/dt.length:null;
    const cell=document.createElement('div'); cell.className='an-dow-cell';
    const col=wr2===null?'var(--text-dim)':wr2>=0.6?'var(--green)':wr2>=0.5?'var(--gold)':'var(--red)';
    cell.innerHTML=`<div class="an-dow-day">${dowNames[d-1]}</div><div class="an-dow-pct" style="color:${col}">${wr2!==null?(wr2*100).toFixed(0)+'%':'—'}</div><div class="an-dow-count">${dt.length} trades</div>`;
    dowEl.appendChild(cell);
  });

  // Break time histogram
  const bins=Array.from({length:12},(_,i)=>({min:i*15,max:(i+1)*15,wins:0,losses:0}));
  f.forEach(t=>{ const bi=Math.min(Math.floor(t.minutes_to_break/15),11); t.is_winner?bins[bi].wins++:bins[bi].losses++; });
  const maxBin=Math.max(...bins.map(b=>b.wins+b.losses),1);
  const histEl=document.getElementById('an-time-hist'); histEl.innerHTML='';
  bins.forEach(b=>{
    const total=b.wins+b.losses,bin=document.createElement('div'); bin.className='dist-bin';
    bin.title=`${b.min}–${b.max}min: ${b.wins}W/${b.losses}L`;
    if(total>0){
      const wh=(b.wins/maxBin)*60,lh=(b.losses/maxBin)*60;
      bin.innerHTML=`<div style="height:${lh}px;background:rgba(239,68,68,0.55);border-radius:2px 2px 0 0;"></div><div style="height:${wh}px;background:rgba(34,197,94,0.65);border-radius:2px 2px 0 0;margin-top:1px;"></div>`;
    }else{
      bin.innerHTML=`<div style="height:2px;background:var(--border);border-radius:1px;"></div>`;
    }
    histEl.appendChild(bin);
  });

  // IB range buckets
  const ranges=f.map(t=>t._ib_range_pts).filter(Boolean);
  if(ranges.length){
    const sorted=[...ranges].sort((a,b)=>a-b);
    const q=idx=>sorted[Math.min(Math.floor(sorted.length*idx),sorted.length-1)];
    const bkts=[
      {lbl:`< ${q(.25).toFixed(0)} pt`,arr:f.filter(t=>t._ib_range_pts<q(.25))},
      {lbl:`${q(.25).toFixed(0)}–${q(.5).toFixed(0)}`,arr:f.filter(t=>t._ib_range_pts>=q(.25)&&t._ib_range_pts<q(.5))},
      {lbl:`${q(.5).toFixed(0)}–${q(.75).toFixed(0)}`,arr:f.filter(t=>t._ib_range_pts>=q(.5)&&t._ib_range_pts<q(.75))},
      {lbl:`> ${q(.75).toFixed(0)} pt`,arr:f.filter(t=>t._ib_range_pts>=q(.75))},
    ];
    const maxR=Math.max(...bkts.map(b=>b.arr.filter(t=>t.is_winner).length),1);
    document.getElementById('an-by-range').innerHTML=bkts.map(({lbl,arr})=>{ const w=arr.filter(t=>t.is_winner).length; return barRow(lbl,w,arr.length,maxR,w/arr.length>=0.5?'gold':'red'); }).join('');
  }

  // By year
  const maxYr=Math.max(...years.map(y=>f.filter(t=>t.year===y&&t.is_winner).length),1);
  document.getElementById('an-by-year').innerHTML=years.map(y=>{ const arr=f.filter(t=>t.year===y),w=arr.filter(t=>t.is_winner).length; return barRow(String(y),w,arr.length,maxYr,w/arr.length>=0.5?'cyan':'red'); }).join('');

  // Combo matrix
  const dirs=['High','Low'],exts=['High','Low'];
  let matHtml=`<table><tr><th style="text-align:left">Exp Break →<br><span style="color:var(--text-dim)">1st Extreme ↓</span></th>${dirs.map(d=>`<th>${d==='High'?'↑ High':'↓ Low'}</th>`).join('')}</tr>`;
  exts.forEach(ext=>{
    matHtml+=`<tr><td style="font-size:11px;color:var(--text-mid);padding:4px 6px;">${ext} 1st</td>`;
    dirs.forEach(dir=>{
      const arr=f.filter(t=>t.expected_break===dir&&t.first_extreme===ext);
      const w=arr.filter(t=>t.is_winner).length,r=arr.length?w/arr.length:null;
      const col=r===null?'var(--text-dim)':cfr(r);
      matHtml+=`<td><div class="cell-pct" style="color:${col}">${r!==null?(r*100).toFixed(0)+'%':'—'}</div><div class="cell-n">${arr.length} trades</div></td>`;
    });
    matHtml+=`</tr>`;
  });
  matHtml+=`</table>`;
  document.getElementById('an-combo-matrix').innerHTML=matHtml;

  // OHLCV-dependent sections
  const vwapThresh=+document.getElementById('an-vwap-thresh').value||3;
  const vwapStart=document.getElementById('an-vwap-window').value||'10:15';
  const ibEnd=document.getElementById('an-ib-end').value||'10:30';
  const retraceWindow=document.getElementById('an-retrace-window').value||'10:00–10:30';
  const hasOhlcv=Object.keys(ohlcvCache).length>0;
  if(!hasOhlcv){
    document.getElementById('an-vwap-content').innerHTML='<div class="an-note">Requires OHLCV data to be loaded.</div>';
    document.getElementById('an-retrace-content').innerHTML='<div class="an-note">Requires OHLCV data to be loaded.</div>';
    return;
  }
  document.getElementById('an-vwap-content').innerHTML=`<div class="an-note" style="color:var(--gold)">Computing… (checking from ${vwapStart})</div>`;
  document.getElementById('an-retrace-content').innerHTML='<div class="an-note" style="color:var(--gold)">Computing…</div>';
  f.forEach(t=>{ t._vwap_touched=null; t._retrace_50=null; });
  computeOhlcvFlags(f,vwapThresh,vwapStart,ibEnd,retraceWindow).then(()=>{
    const withData=f.filter(t=>t._vwap_touched!==null);
    if(!withData.length){
      document.getElementById('an-vwap-content').innerHTML='<div class="an-note">No candle data for filtered trades.</div>';
      document.getElementById('an-retrace-content').innerHTML='<div class="an-note">No candle data for filtered trades.</div>';
      return;
    }
    // VWAP touch section
    const touched=withData.filter(t=>t._vwap_touched);
    const notTouched=withData.filter(t=>!t._vwap_touched);
    const tWin=touched.filter(t=>t.is_winner).length;
    const ntWin=notTouched.filter(t=>t.is_winner).length;
    const touchRate=(touched.length/withData.length*100).toFixed(1);
    const maxV=Math.max(tWin,ntWin,1);
    document.getElementById('an-vwap-content').innerHTML=`
      <div style="margin-bottom:10px;font-size:11px;color:var(--text-mid)">
        ${touchRate}% of trades (${touched.length}/${withData.length}) touched VWAP ≤${vwapThresh}pts
        <span style="color:var(--text-dim)">from ${vwapStart} onward (VWAP from 09:30)</span>
      </div>
      <div class="an-bar-chart">
        ${barRow('Touched VWAP',tWin,touched.length,maxV,tWin/touched.length>=0.5?'cyan':'red')}
        ${barRow('No VWAP touch',ntWin,notTouched.length,maxV,ntWin/notTouched.length>=0.5?'green':'red')}
      </div>
      <div class="an-legend" style="margin-top:10px;">
        <div class="an-legend-item"><div class="an-legend-dot" style="background:var(--cyan)"></div>Touched VWAP → ${(tWin/touched.length*100).toFixed(1)}% WR</div>
        <div class="an-legend-item"><div class="an-legend-dot" style="background:var(--gold)"></div>No touch → ${(ntWin/notTouched.length*100).toFixed(1)}% WR</div>
      </div>`;

    // 50% retrace section
    const rtStart=retraceWindow.split('–')[0];
    const rtEnd=retraceWindow.split('–')[1];
    const retd=withData.filter(t=>t._retrace_50);
    const nretd=withData.filter(t=>!t._retrace_50);
    const rdWin=retd.filter(t=>t.is_winner).length;
    const nrdWin=nretd.filter(t=>t.is_winner).length;
    const retraceRate=(retd.length/withData.length*100).toFixed(1);
    const maxRt=Math.max(rdWin,nrdWin,1);
    document.getElementById('an-retrace-content').innerHTML=`
      <div style="margin-bottom:10px;font-size:11px;color:var(--text-mid)">
        ${retraceRate}% of trades (${retd.length}/${withData.length}) hit IB midpoint ${rtStart}–${rtEnd}
      </div>
      <div class="an-bar-chart">
        ${barRow('Hit 50% level',rdWin,retd.length,maxRt,rdWin/retd.length>=0.5?'gold':'red')}
        ${barRow('Didn\'t hit 50%',nrdWin,nretd.length,maxRt,nrdWin/nretd.length>=0.5?'green':'red')}
      </div>
      <div class="an-legend" style="margin-top:10px;">
        <div class="an-legend-item"><div class="an-legend-dot" style="background:var(--gold)"></div>50% retrace → ${(rdWin/retd.length*100).toFixed(1)}% WR</div>
        <div class="an-legend-item"><div class="an-legend-dot" style="background:var(--blue)"></div>No retrace → ${(nrdWin/nretd.length*100).toFixed(1)}% WR</div>
      </div>`;
  });
}