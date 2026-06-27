const socket = io({ transports: ['websocket', 'polling'] });
let lastRenderKey = '';
const token = new URLSearchParams(location.search).get('token') || '';
const qs = s => document.querySelector(s);
function withToken(path){ if(!token) return path; return path + (path.includes('?') ? `&token=${encodeURIComponent(token)}` : `?token=${encodeURIComponent(token)}`); }
function api(path){ return fetch(withToken(path), {cache:'no-store'}).then(r=>r.json()); }
function esc(s){return String(s ?? '').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function padNum(v){ const s=String(v ?? '').trim(); if(!s) return ''; return /^\d+$/.test(s) ? String(parseInt(s,10)) : s.replace(/^0+(?=\d)/,''); }
function cleanTitle(s){ return String(s||'').replace(/\s+/g,' ').trim().toUpperCase(); }

async function render(state){
  const renderKey = JSON.stringify({ eventId: state?.eventId, graphic: state?.graphic });
  if (renderKey === lastRenderKey) return;
  lastRenderKey = renderKey;
  const g=state.graphic||{}; const el=qs('#gfx');
  if(g.type==='blank'){ el.className='gfx hidden'; el.innerHTML=''; return; }
  const page=g.page||1, size=g.pageSize||10, eventId=state.eventId;
  let data;
  if(g.type==='overall') data=await api(`/api/event/${eventId}/overall?limit=${page*size}`);
  if(g.type==='stage') data=await api(`/api/event/${eventId}/stage/${g.stageId}?limit=${page*size}`);
  if(g.type==='stageTimes') data=await api(`/api/event/${eventId}/stage/${g.stageId}?limit=${page*size}`);
  if(g.type==='entries') data=await api(`/api/event/${eventId}/entries?limit=${page*size}`);
  if(!data?.ok){el.className='gfx';el.innerHTML='<div class="template-stage"><div class="template-board"><h1 class="template-title">DATA ERROR</h1></div></div>';return;}
  const rows=data.data.rows.slice((page-1)*size,page*size);
  const filled=[...rows]; while(filled.length<size) filled.push({});
  const subtitle = g.type==='entries' ? 'ENTRY LIST' : cleanTitle((data.data.subtitle||'FINAL OVERALL POSITIONS').replace(/^.*?(FINAL\s+OVERALL\s+POSITIONS)/i,'$1'));
  const title = g.type==='entries' ? 'ENTRY LIST' : `${subtitle}${page>1?' - PAGE '+page:''}`;
  el.className='gfx';
  if(g.type==='entries') el.innerHTML = renderEntry(title, filled, page);
  else if(g.type==='stageTimes') el.innerHTML = renderStageTimes(data.data.subtitle || `Times for Stage ${g.stageId}`, filled, page);
  else el.innerHTML = renderResult(title, filled, page, g.type);
}

function renderEntry(title, rows){
  return `<div class="template-stage">
    <div class="template-board entry-board">
      <div class="title-line"></div>
      <h1 class="template-title entry">${esc(title)}</h1>
      <div class="template-table entry">
        <div class="template-header entryHead"><div></div><div>Driver</div><div>Co-Driver</div><div>Car</div><div>Class</div><div>Champs</div></div>
        ${rows.map(r=>`<div class="template-row entryGrid">
          <div class="cell posCell">${esc(padNum(r.number))}</div>
          <div class="cell">${esc(r.driver)}</div>
          <div class="cell">${esc(r.codriver)}</div>
          <div class="cell">${esc(r.car)}</div>
          <div class="cell center">${esc(r.class)}</div>
          <div class="cell champCell"><span class="champText">${esc(champText(r))}</span></div>
        </div>`).join('')}
      </div>
    </div>
  </div>`;
}
function champText(r){
  if(!r || Object.keys(r).length===0) return '';
  const raw = String(r.championshipText || r.championship || '').trim();
  if(!raw || raw === 'false') return '';
  if(raw === 'true' || /^B\/?b$|^B$|^b$/i.test(raw)) return 'BTRDA Rally Series, Winner Garage Skoda Championship, UK Pirelli Welsh National, Kingfisher';
  return raw
    .replace(/\s*,\s*/g, ', ')
    .replace(/\bUK Pirelli Welsh\b/gi, 'UK Pirelli Welsh National')
    .replace(/\bBTRDA\b(?! Rally Series)/gi, 'BTRDA Rally Series')
    .replace(/\bKingfisher\b(?!.*Championship)/gi, 'Kingfisher')
    .trim();
}
function stageTitle(subtitle, fallback){
  const s = String(subtitle||'').replace(/Final\s+Overall\s+Positions\s+after\s+/i,'Times for ').replace(/\s+-\s+/,' : ');
  return cleanTitle(s || fallback);
}
function renderStageTimes(subtitle, rows){
  const title = stageTitle(subtitle, 'Times for Stage');
  return `<div class="compact-wrap"><div class="compact-ss">
    <div class="compact-title">${esc(title)}</div>
    <div class="compact-head"><div>POS</div><div>CREW</div><div>TIME</div></div>
    ${rows.map(r=>`<div class="compact-row">
      <div class="compact-pos">${esc(padNum(r.position))}</div>
      <div class="compact-crew">
        <div class="crew-name">${esc(r.driver)}</div>
        <div class="crew-name">${esc(r.codriver)}</div>
        <div class="crew-car">${esc(r.car)}</div>
      </div>
      <div class="compact-time">
        <div class="stage-time">${esc(r.totalTime||'')}</div>
        <div class="stage-diff">${esc(r.diffPrev ? '+'+r.diffPrev.replace(/^\+/, '') : '')}</div>
      </div>
    </div>`).join('')}
  </div></div>`;
}

function renderResult(title, rows, type){
  const isStage = type === 'stage';
  return `<div class="template-stage">
    <div class="template-board result">
      <h1 class="template-title">${esc(title)}</h1>
      <div class="template-table result">
        <div class="template-header resultHead"><div>Pos</div><div>Driver</div><div>Co-Driver</div><div>Car</div><div>Class</div><div>Time</div><div>Diff</div></div>
        ${rows.map(r=>`<div class="template-row resultGrid ${isStage ? 'stageResult' : ''}">
          <div class="cell posCell">${esc(padNum(r.position))}</div>
          <div class="cell">${esc(r.driver)}</div>
          <div class="cell">${esc(r.codriver)}</div>
          <div class="cell">${esc(r.car)}</div>
          <div class="cell center">${esc(r.class)}</div>
          <div class="cell time">${esc(r.totalTime)}</div>
          <div class="cell diff">${esc(r.diffPrev||'')}</div>
        </div>`).join('')}
      </div>
    </div>
  </div>`;
}

socket.on('state', render);
async function refreshSharedState(){ try { const r = await api('/api/state'); if (r.ok) await render(r.state); } catch {} }
refreshSharedState();
setInterval(refreshSharedState, 1500);
