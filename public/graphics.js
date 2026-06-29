const socket = io({ transports: ['websocket', 'polling'] });
const OUTPUT_MODE = location.pathname.includes('/preview') ? 'preview' : 'program';
socket.emit('outputMode', OUTPUT_MODE);
let lastRenderKey = '';
const token = new URLSearchParams(location.search).get('token') || '';
const qs = s => document.querySelector(s);
let graphicsSettings = null;
let uiSettings = { safeGuides:false };
// Safe guides are allowed ONLY in the embedded controller monitor.
// External /preview and /output pages must always stay clean.
const IS_CONTROLLER_MONITOR = new URLSearchParams(location.search).get('controllerPreview') === '1';
let renderSeq = 0;
let activeLayerId = 'gfxA';
let lastDisplayedKey = '';
let pendingRenderKey = '';
let swapTimer = null;
function ensureLayers(){
  let a = document.getElementById('gfxA');
  let b = document.getElementById('gfxB');
  const old = document.getElementById('gfx');
  if (!a || !b) {
    if (old) old.remove();
    a = document.createElement('div'); a.id='gfxA'; a.className='gfx gfx-layer gfx-active hidden';
    b = document.createElement('div'); b.id='gfxB'; b.className='gfx gfx-layer gfx-inactive hidden';
    document.body.prepend(b); document.body.prepend(a);
  }
  return {a,b};
}
function activeLayer(){ ensureLayers(); return document.getElementById(activeLayerId); }
function inactiveLayer(){ ensureLayers(); return document.getElementById(activeLayerId === 'gfxA' ? 'gfxB' : 'gfxA'); }
function allLayers(){ const {a,b}=ensureLayers(); return [a,b]; }
function clearSwapTimer(){ if (swapTimer) { clearTimeout(swapTimer); swapTimer = null; } }

function resolveGraphicsSettings(settings={}, graphicType='global'){
  const base = settings || graphicsSettings || {};
  const scoped = base.perGraphic && graphicType && base.perGraphic[graphicType] ? base.perGraphic[graphicType] : {};
  return { ...base, ...scoped, perGraphic: base.perGraphic || {} };
}
function applyGraphicsSettings(settings={}, graphicType='global'){
  graphicsSettings = settings || graphicsSettings || {};
  const effectiveSettings = resolveGraphicsSettings(graphicsSettings, graphicType);
  const root = document.documentElement;
  const n = (v, def) => Number.isFinite(Number(v)) ? Number(v) : def;
  const pct = v => Math.max(0, Math.min(100, n(v,100))) / 100;
  root.style.setProperty('--gfx-scale', String(n(effectiveSettings.scale, 1)));
  root.style.setProperty('--gfx-x', n(effectiveSettings.x, 0) + 'px');
  root.style.setProperty('--gfx-y', n(effectiveSettings.y, 0) + 'px');
  root.style.setProperty('--gfx-width', n(effectiveSettings.width, 1920) + 'px');
  root.style.setProperty('--gfx-height', n(effectiveSettings.height, 1080) + 'px');
  root.style.setProperty('--gfx-opacity', String(pct(effectiveSettings.opacity)));
  root.style.setProperty('--gfx-bg-opacity', String(pct(effectiveSettings.backgroundOpacity)));
  root.style.setProperty('--gfx-border-opacity', String(pct(effectiveSettings.borderOpacity)));
  root.style.setProperty('--gfx-shadow-opacity', String(pct(effectiveSettings.shadowOpacity)));
  root.style.setProperty('--gfx-blur', n(effectiveSettings.blur, 0) + 'px');
  root.style.setProperty('--gfx-brightness', n(effectiveSettings.brightness, 100) + '%');
  root.style.setProperty('--gfx-contrast', n(effectiveSettings.contrast, 100) + '%');
  const speed = Math.max(0.1, n(effectiveSettings.animationSpeed, 1));
  const duration = Math.max(0, n(effectiveSettings.animationDuration, 280)) / speed;
  root.style.setProperty('--gfx-anim-duration', duration + 'ms');
  root.style.setProperty('--gfx-easing', effectiveSettings.easing || 'ease-out');
  root.style.setProperty('--gfx-radius', n(effectiveSettings.radius, 0) + 'px');
  const active = document.getElementById(activeLayerId);
  if (active && !active.classList.contains('gfx-taking')) active.style.opacity = 'var(--gfx-opacity)';
}


function applySceneLayers(scene={}){
  const layers = scene?.layers || {};
  const main = layers.main || { enabled:true, opacity:100 };
  const root = document.documentElement;
  root.style.setProperty('--scene-main-opacity', main.enabled === false ? '0' : String(Math.max(0, Math.min(100, Number(main.opacity ?? 100))) / 100));
  let bug = document.getElementById('sceneBug');
  if (!bug) { bug = document.createElement('div'); bug.id='sceneBug'; bug.className='scene-bug'; document.body.appendChild(bug); }
  const bugLayer = layers.bug || {};
  bug.textContent = bugLayer.text || '';
  bug.style.display = bugLayer.enabled ? 'block' : 'none';
  bug.style.opacity = String(Math.max(0, Math.min(100, Number(bugLayer.opacity ?? 100))) / 100);
  let clock = document.getElementById('sceneClock');
  if (!clock) { clock = document.createElement('div'); clock.id='sceneClock'; clock.className='scene-clock'; document.body.appendChild(clock); }
  const clockLayer = layers.clock || {};
  clock.style.display = clockLayer.enabled ? 'block' : 'none';
  clock.style.opacity = String(Math.max(0, Math.min(100, Number(clockLayer.opacity ?? 100))) / 100);
  if (clockLayer.enabled) clock.textContent = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
setInterval(() => { try { window.__lastScene && applySceneLayers(window.__lastScene); } catch {} }, 1000);

function applySafeGuides(){
  let guides = document.getElementById('safeGuidesOverlay');
  if (!guides) {
    guides = document.createElement('div');
    guides.id = 'safeGuidesOverlay';
    guides.innerHTML = '<div class="safe action"></div><div class="safe title"></div><div class="safe v"></div><div class="safe h"></div>';
    document.body.appendChild(guides);
  }
  guides.style.display = (IS_CONTROLLER_MONITOR && uiSettings.safeGuides) ? 'block' : 'none';
}
async function refreshUiSettings(){ try { const r = await api('/api/ui-settings'); if(r.ok){ uiSettings = { ...uiSettings, ...r.settings }; applySafeGuides(); } } catch {} }


function animationMs(){
  const d = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gfx-anim-duration'));
  return Number.isFinite(d) ? Math.max(0, d) : 0;
}
function easing(){
  return getComputedStyle(document.documentElement).getPropertyValue('--gfx-easing').trim() || 'ease-out';
}
function hideAllGraphics(){
  clearSwapTimer();
  for (const layer of allLayers()) {
    layer.getAnimations?.().forEach(a => a.cancel());
    layer.className = 'gfx gfx-layer gfx-inactive hidden';
    layer.innerHTML = '';
    layer.style.opacity = '0';
    layer.style.visibility = 'hidden';
    layer.style.transition = 'none';
  }
  lastDisplayedKey = '';
  pendingRenderKey = '';
}
function takePreparedGraphic(nextLayer, renderKey){
  clearSwapTimer();
  const ms = animationMs();
  const ease = easing();
  const oldLayer = activeLayer();

  // Do not leave the old layer underneath the new one during the fade.
  // With opacity/transparent graphics, two layers overlap and when the old layer is removed
  // it looks exactly like a random flicker at the end of the in-animation.
  for (const layer of allLayers()) {
    layer.getAnimations?.().forEach(a => a.cancel());
    layer.style.transition = 'none';
    layer.classList.remove('gfx-taking','gfx-prep','gfx-hold','gfx-active','gfx-inactive','hidden');
    if (layer !== nextLayer) {
      layer.style.visibility = 'hidden';
      layer.style.opacity = '0';
      layer.className = 'gfx gfx-layer gfx-inactive';
    }
  }

  nextLayer.className = 'gfx gfx-layer gfx-taking';
  nextLayer.style.visibility = 'visible';
  nextLayer.style.opacity = '0';
  nextLayer.style.transition = 'none';

  // Force style commit before changing opacity, otherwise some browsers skip or replay the transition.
  void nextLayer.offsetHeight;

  requestAnimationFrame(() => {
    if (pendingRenderKey && pendingRenderKey !== renderKey) return;
    activeLayerId = nextLayer.id;
    lastDisplayedKey = renderKey;
    pendingRenderKey = '';
    nextLayer.style.transition = ms > 0 ? `opacity ${ms}ms ${ease}` : 'none';
    nextLayer.style.opacity = 'var(--gfx-opacity)';

    // Important: no end-of-animation class/transition cleanup on the visible layer.
    // That cleanup was causing the one-frame hide/show flicker on some graphics.
    if (oldLayer && oldLayer !== nextLayer) {
      oldLayer.innerHTML = '';
    }
  });
}
async function refreshGraphicsSettings(){
  try { const r = await api('/api/graphics-settings'); if (r.ok) applyGraphicsSettings(r.settings); } catch {}
}

function withToken(path){ if(!token) return path; return path + (path.includes('?') ? `&token=${encodeURIComponent(token)}` : `?token=${encodeURIComponent(token)}`); }
function api(path){ return fetch(withToken(path), {cache:'no-store'}).then(r=>r.json()); }
function esc(s){return String(s ?? '').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function padNum(v){ const s=String(v ?? '').trim(); if(!s) return ''; return /^\d+$/.test(s) ? String(parseInt(s,10)) : s.replace(/^0+(?=\d)/,''); }
function cleanTitle(s){ return String(s||'').replace(/\s+/g,' ').trim().toUpperCase(); }
function outputGraphic(state){
  const scene = state?.scene || {};
  if (OUTPUT_MODE === 'preview') return scene.preview || { type:'blank' };
  return scene.program || state?.graphic || { type:'blank' };
}
function stableRenderKey(state){
  const g = outputGraphic(state) || {};
  // Preview and Program are deliberately separate channels.
  return [
    OUTPUT_MODE,
    state?.eventId || '',
    g.type || '',
    g.stageId || '',
    g.page || 1,
    g.pageSize || 10,
    g.updatedAt || ''
  ].join('|');
}

async function render(state){
  const renderKey = stableRenderKey(state);
  if (renderKey === lastDisplayedKey || renderKey === pendingRenderKey) return;
  pendingRenderKey = renderKey;
  lastRenderKey = renderKey;
  const myRenderSeq = ++renderSeq;
  const g=outputGraphic(state)||{};
  applySceneLayers(state?.scene);
  if(g.type==='blank'){ hideAllGraphics(); applyGraphicsSettings(graphicsSettings || {}, g.type); return; }
  const page=g.page||1, size=g.pageSize||10, eventId=state.eventId;
  let data;
  if(g.type==='overall') data=await api(`/api/event/${eventId}/overall?limit=${page*size}`);
  if(g.type==='stage') data=await api(`/api/event/${eventId}/stage/${g.stageId}?limit=${page*size}`);
  if(g.type==='stageTimes') data=await api(`/api/event/${eventId}/stage/${g.stageId}?limit=${page*size}`);
  if(g.type==='entries') data=await api(`/api/event/${eventId}/entries?limit=${page*size}`);
  if (myRenderSeq !== renderSeq) return; // A newer graphic was selected while this data was loading.
  const el = inactiveLayer();
  if(!data?.ok){el.innerHTML='<div class="template-stage"><div class="template-board"><h1 class="template-title">DATA ERROR</h1></div></div>'; applyGraphicsSettings(graphicsSettings || {}, g.type); takePreparedGraphic(el, renderKey); return;}
  const rows=data.data.rows.slice((page-1)*size,page*size);
  const filled=[...rows]; while(filled.length<size) filled.push({});
  const subtitle = g.type==='entries' ? 'ENTRY LIST' : cleanTitle((data.data.subtitle||'FINAL OVERALL POSITIONS').replace(/^.*?(FINAL\s+OVERALL\s+POSITIONS)/i,'$1'));
  const title = g.type==='entries' ? 'ENTRY LIST' : `${subtitle}${page>1?' - PAGE '+page:''}`;
  el.className='gfx gfx-layer gfx-prep hidden';
  if(g.type==='entries') el.innerHTML = renderEntry(title, filled, page);
  else if(g.type==='stageTimes') el.innerHTML = renderStageTimes(data.data.subtitle || `Times for Stage ${g.stageId}`, filled, page);
  else el.innerHTML = renderResult(title, filled, page, g.type);
  applyGraphicsSettings(graphicsSettings || state.graphicsSettings || {}, g.type);
  takePreparedGraphic(el, renderKey);
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
function stageTitleParts(subtitle, fallbackStage){
  const raw = String(subtitle || '').replace(/\s+/g, ' ').trim();
  let stageNo = String(fallbackStage || '').trim();
  let stageName = '';

  // Common DJames examples:
  // "Final Overall Positions after stage 1 - Llangower 1"
  // "Times for Stage 1 : Llangower 1"
  let m = raw.match(/stage\s*(\d+)\s*[-:]\s*(.+)$/i);
  if (m) {
    stageNo = m[1];
    stageName = m[2];
  } else {
    m = raw.match(/stage\s*(\d+)/i);
    if (m) stageNo = m[1];
  }

  stageName = stageName
    .replace(/^[-:]+\s*/, '')
    .replace(/\s+-\s*page\s*\d+.*$/i, '')
    .trim();

  return {
    line1: cleanTitle(`TIMES FOR STAGE ${stageNo || ''} :`),
    line2: cleanTitle(stageName || '')
  };
}
function renderStageTimes(subtitle, rows){
  const title = stageTitleParts(subtitle, '');
  return `<div class="compact-wrap"><div class="compact-ss">
    <div class="compact-title"><div class="compact-title-main">${esc(title.line1)}</div><div class="compact-title-stage">${esc(title.line2)}</div></div>
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

socket.on('state', s => { window.__lastScene = s?.scene; if (s?.uiSettings) { uiSettings = { ...uiSettings, ...s.uiSettings }; applySafeGuides(); } if (s?.graphicsSettings) applyGraphicsSettings(s.graphicsSettings, outputGraphic(s)?.type); applySceneLayers(s?.scene); render(s); });
socket.on('graphicsSettings', s => applyGraphicsSettings(s));
socket.on('uiSettings', s => { uiSettings = { ...uiSettings, ...s }; applySafeGuides(); });
async function refreshSharedState(){ try { const r = await api('/api/state'); if (r.ok) await render(r.state); } catch {} }
refreshGraphicsSettings();
refreshUiSettings();
refreshSharedState();
// No continuous polling here: Socket.IO drives on-air changes. Polling was able to retrigger
// equivalent graphics with slightly different object shapes and create intermittent flicker.
