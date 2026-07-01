const socket = io();
let state = { eventId:'757', graphic:{type:'blank',stageId:1,page:1,pageSize:10} };
let selectedType = 'overall';
let selectedStage = 1;
let selectedPage = 1;
let pageSize = 10;
let totals = { overall:0, entries:0, stage:{} };
let rundown = [];
let rundownIndex = -1;
let autoTimer = null;
let rundownTimer = null;

const qs = s => document.querySelector(s);
const qsa = s => [...document.querySelectorAll(s)];
const token = new URLSearchParams(location.search).get('token') || '';
const tokenPart = token ? `?token=${encodeURIComponent(token)}` : '';
const auth = token ? { 'x-rally-token': token } : {};
const isTabletController = document.body.classList.contains('tablet-controller');

function withToken(path){ if (!token) return path; return path + (path.includes('?') ? `&token=${encodeURIComponent(token)}` : `?token=${encodeURIComponent(token)}`); }
function api(path, opts={}){ return fetch(withToken(path), {headers:{'content-type':'application/json',...auth},...opts}).then(r=>r.json()); }
function outputOrigin(){
  const host = location.hostname || 'localhost';
  return `http://${host}:8080`;
}
function outputUrl(){ return outputOrigin() + '/output/live' + tokenPart; }
function previewUrl(){ return location.origin + '/preview/live' + (tokenPart ? tokenPart + '&controllerPreview=1' : '?controllerPreview=1'); }
function previewHttpUrl(){ const host = location.hostname || 'localhost'; return `http://${host}:8080/preview/live${tokenPart}`; }
function labelFor(type, stageId=0, page=1){ return type === 'overall' ? `Overall Page ${page}` : type === 'stage' ? `Stage ${stageId} Page ${page}` : type === 'stageTimes' ? `Stage ${stageId} Times Page ${page}` : `Entry List Page ${page}`; }
function totalFor(type, stageId=0){ return type === 'overall' ? totals.overall : type === 'entries' ? totals.entries : (totals.stage[stageId] || 0); }
function totalPagesFor(type, stageId=0){ return Math.max(1, Math.ceil((totalFor(type, stageId) || 0) / pageSize)); }
function setLastUpdated(){ const el=qs('#lastUpdated'); if(el) el.textContent = new Date().toLocaleString(); }
function setOutputFields(){
  const out = qs('#outputUrl'); if(out) out.value = outputUrl();
  const frame = qs('#previewFrame'); if(frame && frame.src !== previewUrl()) frame.src = previewUrl();
  const tablet = qs('#tabletLink'); if(tablet) tablet.href = '/tablet' + tokenPart;
}

function initStages(){
  qsa('#stageButtons').forEach(box => {
    box.innerHTML='';
    for(let i=1;i<=20;i++){
      const b=document.createElement('button');
      b.textContent = String(i); b.title = 'Stage '+i;
      b.onclick = ()=>{ if(isTabletController) tabletStopAutoPages('ALL [AUTO] stopped. New stage loaded to preview.'); if(selectedType!=='stageTimes') selectedType='stage'; selectedStage=i; selectedPage=1; tabletSelectedKey=tabletSelectionKey(); updateActive(); loadTotalsForSelection(true); };
      box.appendChild(b);
    }
  });
  const sel = qs('#stageSelect');
  if(sel){ sel.innerHTML=''; for(let i=1;i<=20;i++){ const o=document.createElement('option'); o.value=i; o.textContent='Stage '+i; sel.appendChild(o); } sel.onchange=()=>{ if(isTabletController) tabletStopAutoPages('ALL [AUTO] stopped. New stage loaded to preview.'); selectedStage=Number(sel.value); if(selectedType!=='stageTimes') selectedType='stage'; selectedPage=1; tabletSelectedKey=tabletSelectionKey(); updateActive(); loadTotalsForSelection(true); }; }
}
function updateActive(){
  qsa('[data-type]').forEach(b=>b.classList.toggle('active', b.dataset.type===selectedType));
  const sel=qs('#stageSelect'); if(sel) sel.value=String(selectedStage);
  qsa('#stageButtons button').forEach((b,i)=>b.classList.toggle('active', (selectedType==='stage' || selectedType==='stageTimes') && i+1===selectedStage));
  const p=qs('#pageNo'); if(p) p.textContent='Page '+selectedPage;
  qsa('.totalRows').forEach(total => total.textContent = `${totalFor(selectedType, selectedStage) || '--'} rows`);
}

function renderPageButtons(){
  const boxes = qsa('.pageButtons');
  boxes.forEach(box => {
    box.innerHTML='';
    // Page selector is capped at 9 buttons on both tablet and main controller.
    // Rally pages contain 10 drivers per page, so there are no more than 9 pages needed.
    const pages = Math.min(9, totalPagesFor(selectedType, selectedStage));
    for(let p=1;p<=pages;p++){
      const b=document.createElement('button');
      const start=(p-1)*pageSize+1, end=Math.min(p*pageSize, totalFor(selectedType, selectedStage)||p*pageSize);
      b.textContent=String(p);
      b.title=`${labelFor(selectedType, selectedStage, p)}: ${start}-${end}`;
      b.className = p===selectedPage ? 'active' : '';
      b.onclick=()=>{ if(isTabletController) tabletStopAutoPages('ALL [AUTO] stopped. Manual page loaded to preview.'); tabletSelectedKey=tabletSelectionKey(); take(selectedType, selectedStage, p, isTabletController ? 'preview' : null); };
      box.appendChild(b);
    }
  });
  updateActive();
}

async function loadTotalsForSelection(autoTake=false){
  const eventId = (qs('#eventId')?.value || state.eventId || '757').replace(/\D/g,'') || '757';
  let res;
  if(selectedType==='overall') res = await api(`/api/event/${eventId}/overall?limit=999`);
  if(selectedType==='stage' || selectedType==='stageTimes') res = await api(`/api/event/${eventId}/stage/${selectedStage}?limit=999`);
  if(selectedType==='entries') res = await api(`/api/event/${eventId}/entries?limit=999`);
  if(res?.ok){
    const total = res.data.totalRows || res.data.rows?.length || 0;
    if(selectedType==='overall') totals.overall=total;
    else if(selectedType==='entries') totals.entries=total;
    else totals.stage[selectedStage]=total;
    updateTabletEventNameFromData(res.data);
  }
  if(!isTabletController) selectedPage = Math.min(selectedPage, totalPagesFor(selectedType, selectedStage));
  renderPageButtons();
  if(autoTake) await take(selectedType, selectedStage, selectedPage, isTabletController ? 'preview' : null);
}

function updateTabletEventNameFromData(data={}){
  const el = qs('#eventNameDisplay');
  if(!el) return;
  const name = displayEventName(data, qs('#eventId')?.value || state.eventId || '');
  if(name && !/^RESULTS ON THE WEB$/i.test(name)) el.textContent = name;
}

async function loadAllTotals(){
  const eventId = (qs('#eventId')?.value || '757').replace(/\D/g,'') || '757';
  const [overall, entries] = await Promise.allSettled([
    api(`/api/event/${eventId}/overall?limit=999`),
    api(`/api/event/${eventId}/entries?limit=999`)
  ]);
  if(overall.value?.ok) totals.overall = overall.value.data.totalRows || overall.value.data.rows.length;
  if(entries.value?.ok) totals.entries = entries.value.data.totalRows || entries.value.data.rows.length;
  renderPageButtons();
}

async function loadEvent(){
  const eventId = (qs('#eventId')?.value || '757').replace(/\D/g,'') || '757';
  await api('/api/event',{method:'POST',body:JSON.stringify({eventId})});
  const info = await api(`/api/event/${eventId}/info`);
  if(info.ok){
    const tabletName=qs('#eventNameDisplay'); if(tabletName) tabletName.textContent = displayEventName(info.data, eventId);
    const title=qs('#eventTitle'); if(title) title.textContent = info.data.eventTitle || `Event ${eventId}`;
    const date=qs('#eventDate'); if(date) date.textContent = info.data.eventDate || '';
    const text=qs('#eventInfo'); if(text) text.textContent = info.data.subtitle || 'Event loaded.';
  } else { const text=qs('#eventInfo'); if(text) text.textContent = info.error || 'Could not load event.'; }
  await loadAllTotals();
  await loadRundown();
  setLastUpdated();
}

function selectedTakeTarget(){
  const preview = !!qs('#targetPreview')?.checked;
  const output = !!qs('#targetOutput')?.checked;
  if (preview && output) return 'both';
  if (preview) return 'preview';
  return 'program';
}

// Two-step graphics workflow:
//   1st press on a graphic button = load to Preview only.
//   2nd press on the same graphic/page = TAKE that graphic to Program/output.
// This gives the operator a safe preview by default while still allowing fast double-press to air.
function graphicPressKey(type, stageId, page){
  const normalizedStage = (type === 'stage' || type === 'stageTimes') ? Number(stageId || selectedStage || 1) : 0;
  return [type || selectedType, normalizedStage, Number(page || selectedPage || 1), Number(qs('#pageSize')?.value || pageSize || 10)].join('|');
}
function previewGraphicKey(){
  const g = state?.scene?.preview || {};
  if(!g.type || g.type === 'blank') return '';
  const normalizedStage = (g.type === 'stage' || g.type === 'stageTimes') ? Number(g.stageId || 1) : 0;
  return [g.type, normalizedStage, Number(g.page || 1), Number(g.pageSize || pageSize || 10)].join('|');
}

function previewLayerKey(layer){
  return !!(state?.scene?.layerVisibility?.preview?.[layer]);
}
function layerLabel(layer){
  return layer === 'bug' ? 'Bug Text' : layer === 'logo' ? 'Logo' : 'Clock';
}
async function takeLayer(layer, forcedTarget=null){
  const target = forcedTarget || (previewLayerKey(layer) ? 'program' : 'preview');
  const r = await api('/api/scene/layer-trigger', { method:'POST', body:JSON.stringify({ layer, target }) });
  if (r.ok) { state.scene = r.scene; sceneState = r.scene; renderSceneManager(); }
  setTwoStepHint(target === 'preview' ? `${layerLabel(layer)} loaded to Preview. Press it again to send it to Live Output.` : `${layerLabel(layer)} sent to Live Output.`);
  setLastUpdated();
}
async function cutLayer(layer, forcedTarget='program'){
  const target = forcedTarget || 'program';
  const r = await api('/api/scene/layer-clear', { method:'POST', body:JSON.stringify({ layer, target }) });
  if (r.ok) { state.scene = r.scene; sceneState = r.scene; renderSceneManager(); }
  setTwoStepHint(`${layerLabel(layer)} cut off from ${target === 'both' ? 'Preview and Live Output' : target === 'preview' ? 'Preview' : 'Live Output'}.`);
  setLastUpdated();
}
async function cutLayerBoth(layer){ return cutLayer(layer, 'both'); }
async function clearMainGraphic(target='program'){
  const r = await api('/api/scene/main-clear',{method:'POST',body:JSON.stringify({target})});
  if (r.ok) { state = r.state || { ...state, scene: r.scene }; sceneState = state.scene || r.scene; renderSceneManager(); }
  setTwoStepHint(target === 'both' ? 'Main graphic cut off from Preview and Live Output. Overlay layers are unchanged.' : target === 'preview' ? 'Main graphic cut off from Preview. Overlay layers are unchanged.' : 'Main graphic cut off from Live Output. Overlay layers are unchanged.');
  setLastUpdated();
}
function typeLabel(type){
  return type === 'overall' ? 'Overall Leaderboard' : type === 'stage' ? 'Stage Results' : type === 'stageTimes' ? 'Stage Times' : type === 'entries' ? 'Entry List' : 'Graphic';
}
function displayEventName(infoData={}, eventId=''){
  const cleanName = v => String(v || '').replace(/\s+/g,' ').trim();
  const sub = cleanName(infoData?.subtitle || infoData?.title || infoData?.eventTitle || '');
  // For DJames/BTRDA pages the useful on-air event/stage name is usually in the
  // graphic title after the first dash, for example:
  // FINAL OVERALL POSITIONS AFTER STAGE 1 - LLANGOWER 1 - PAGE 6
  // The tablet top box must show LLANGOWER 1, not the generic web title.
  const fromGraphic = sub.match(/[-–—]\s*(.+?)(?:\s*[-–—]\s*PAGE\s*\d+)?$/i);
  if (fromGraphic && fromGraphic[1]) return fromGraphic[1].trim().toUpperCase();
  const candidates = [infoData?.eventName, infoData?.eventTitle, infoData?.name, infoData?.title]
    .map(cleanName).filter(Boolean);
  const generic = /^(results on the web|event|leader boards?|leaderboards?|overall results?)$/i;
  const nonGeneric = candidates.find(x => !generic.test(x));
  return (nonGeneric || candidates[0] || `Event ${eventId}`).toUpperCase();
}
async function clearMainGraphicType(type, target='program'){
  const r = await api('/api/scene/main-clear-type',{method:'POST',body:JSON.stringify({type,target})});
  if (r.ok) { state = r.state || { ...state, scene: r.scene }; sceneState = state.scene || r.scene; renderSceneManager(); }
  const where = target === 'both' ? 'Preview and Live Output' : target === 'preview' ? 'Preview' : 'Live Output';
  const count = r.cleared ? Object.values(r.cleared).filter(Boolean).length : 0;
  setTwoStepHint(count ? `${typeLabel(type)} cut off from ${where}. Logo, Clock and Bug are unchanged.` : `${typeLabel(type)} was not active on ${where}. Nothing else was changed.`);
  setLastUpdated();
}
function setTwoStepHint(message){
  const el = qs('#twoStepHint') || qs('#eventInfo');
  if(el) el.textContent = message;
}
async function take(type=selectedType, stageId=selectedStage, page=selectedPage, forcedTarget=null){
  if(isTabletController) tabletSetLogoPreview('');
  selectedType=type; selectedPage=Math.max(1, Number(page||1));
  if(type==='stage' || type==='stageTimes') selectedStage=Number(stageId||selectedStage||1);
  if(type!=='stage' && type!=='stageTimes') stageId=0;
  pageSize = Number(qs('#pageSize')?.value || 10);
  updateActive(); renderPageButtons();

  const key = graphicPressKey(type, selectedStage, selectedPage);
  let target = forcedTarget || (key === previewGraphicKey() ? 'program' : 'preview');
  const r = await api('/api/take',{method:'POST',body:JSON.stringify({type,stageId:selectedStage,page:selectedPage,pageSize,title:labelFor(type, selectedStage, selectedPage),target})});
  if(r?.state){ state = r.state; sceneState = r.state.scene; renderSceneManager(); }
  else if(r?.scene){ sceneState = r.scene; state.scene = r.scene; renderSceneManager(); }
  setTwoStepHint(target === 'preview' ? 'Loaded to Preview. Press the same button again to send it to Live Output.' : 'Sent to Live Output.');
  setLastUpdated();
}


// Tablet v2 controller helpers: all selector buttons load Preview only; TAKE TO PGM airs the preview.
let tabletLogoSlot = 1;
let tabletAutoPageTimer = null;
let tabletAutoPageRunId = 0;
let tabletAutoPageRunning = false;
let tabletSelectedKey = '';

function repairPreviewLogoAlphaMatte(img){
  if (!img || img.dataset.alphaMatteFixed === '1') return;
  const src = img.currentSrc || img.src || '';
  if (!src || src.startsWith('data:image/png;base64,')) return;
  img.dataset.alphaMatteFixed = '1';
  const work = new Image();
  work.crossOrigin = 'anonymous';
  work.onload = () => {
    try {
      const w = work.naturalWidth || work.width, h = work.naturalHeight || work.height;
      if (!w || !h || w*h > 9000000) return;
      const canvas = document.createElement('canvas');
      canvas.width=w; canvas.height=h;
      const ctx = canvas.getContext('2d', { willReadFrequently:true });
      ctx.clearRect(0,0,w,h); ctx.drawImage(work,0,0);
      const image = ctx.getImageData(0,0,w,h), d = image.data;
      let changed=false;
      for(let i=0;i<d.length;i+=4){
        const a=d[i+3];
        if(a===0){ d[i]=0; d[i+1]=0; d[i+2]=0; continue; }
        if(a<6){ d[i+3]=0; changed=true; continue; }
        if(a>0 && a<252){
          const r=d[i], g=d[i+1], b=d[i+2], max=Math.max(r,g,b);
          if(max<245){ const f=255/a; d[i]=Math.min(255,Math.round(r*f)); d[i+1]=Math.min(255,Math.round(g*f)); d[i+2]=Math.min(255,Math.round(b*f)); changed=true; }
        }
      }
      if(changed){ ctx.putImageData(image,0,0); img.src=canvas.toDataURL('image/png'); }
    } catch(_) {}
  };
  work.src = src;
}

function tabletSetLogoPreview(url){
  const overlay = qs('#tabletLogoPreviewOverlay');
  const img = qs('#tabletLogoPreviewImg');
  if(!overlay || !img) return;
  if(url){
    img.dataset.alphaMatteFixed = '0';
    img.src = url + (String(url).includes('?') ? '&' : '?') + 'logoPreviewTs=' + Date.now();
    img.onload = () => repairPreviewLogoAlphaMatte(img);
    overlay.classList.add('active');
    const empty = qs('#tabletPreviewEmpty');
    if(empty) empty.style.display = 'none';
  } else {
    overlay.classList.remove('active');
    img.removeAttribute('src');
  }
}
function tabletSelectionKey(type=selectedType, stage=selectedStage){ return `${type}:${(type==='stage'||type==='stageTimes')?stage:0}`; }
function updateTabletUiFromState(){
  if(!isTabletController) return;
  const previewEmpty = qs('#tabletPreviewEmpty');
  const previewType = state?.scene?.preview?.type || 'blank';
  const logoOverlayActive = !!qs('#tabletLogoPreviewOverlay')?.classList.contains('active');
  if(previewEmpty) previewEmpty.style.display = (!logoOverlayActive && previewType === 'blank') ? 'flex' : 'none';
  const logoOnAir = !!state?.scene?.layerVisibility?.program?.logo;
  const logoInPreview = !!state?.scene?.layerVisibility?.preview?.logo;
  const onAirSlot = Number(state?.scene?.activeLogoSlotProgram || state?.scene?.activeLogoSlot || tabletLogoSlot || 1);
  const previewSlot = Number(state?.scene?.activeLogoSlotPreview || state?.scene?.activeLogoSlot || tabletLogoSlot || 1);
  const takeBugBtn = qs('#takeBug');
  if(takeBugBtn) takeBugBtn.classList.toggle('onair', logoOnAir);
  qsa('.logoSlot').forEach(btn => {
    const slot = Number(btn.dataset.logoSlot || 1);
    const isSelected = slot === tabletLogoSlot;
    btn.classList.toggle('selected', isSelected || (logoInPreview && slot === previewSlot));
    btn.classList.toggle('onair', logoOnAir && slot === onAirSlot);
  });
}
async function tabletTakePreviewToPgm(){
  const r = await api('/api/scene/take-preview', { method:'POST', body:JSON.stringify({}) });
  if(r?.state){ state = r.state; sceneState = r.state.scene; renderSceneManager(); }
  setTwoStepHint('Preview sent to Live Output.');
  updateTabletUiFromState();
  setLastUpdated();
}
async function tabletToggleBug(){
  // TAKE BUG now behaves like TAKE TO PGM for the logo preview:
  // Logo 1/2 press = preview only, TAKE BUG = send that selected logo to Program.
  const logoOnAir = !!state?.scene?.layerVisibility?.program?.logo;
  const onAirSlot = Number(state?.scene?.activeLogoSlotProgram || state?.scene?.activeLogoSlot || 0);
  const sameSlotOnAir = logoOnAir && onAirSlot === Number(tabletLogoSlot);

  const endpoint = sameSlotOnAir ? '/api/scene/layer-clear' : '/api/scene/layer-trigger';
  const body = sameSlotOnAir
    ? { layer:'logo', target:'program' }
    : { layer:'logo', target:'program', slot: tabletLogoSlot };

  const r = await api(endpoint, { method:'POST', body:JSON.stringify(body) });
  if(r.ok){
    state.scene = r.scene;
    sceneState = r.scene;
    renderSceneManager();
    setTwoStepHint(sameSlotOnAir ? `Logo ${tabletLogoSlot} cut from output.` : `Logo ${tabletLogoSlot} sent to output.`);
  } else {
    setTwoStepHint(r.error || `Logo ${tabletLogoSlot} could not be sent to output.`);
  }
  updateTabletUiFromState();
  setLastUpdated();
}
async function tabletSelectLogoSlot(slot){
  tabletStopAutoPages('', false);
  tabletLogoSlot = Number(slot || 1);
  // Load the chosen logo into Preview only. It does not go on air until TAKE BUG is pressed.
  const r = await api('/api/scene/layer-trigger', { method:'POST', body:JSON.stringify({ layer:'logo', target:'preview', slot: tabletLogoSlot }) });
  if(r.ok){
    state.scene = r.scene;
    sceneState = r.scene;
    renderSceneManager();
    tabletSetLogoPreview(state?.scene?.logoUrls?.preview || '');
    setTwoStepHint(`Logo ${tabletLogoSlot} loaded to Preview. Press TAKE BUG to put it on air.`);
  } else {
    setTwoStepHint(r.error || `Logo ${tabletLogoSlot} could not be loaded to Preview.`);
  }
  updateTabletUiFromState();
  setLastUpdated();
}
function tabletStopAutoPages(message='ALL [AUTO] stopped.'){
  tabletAutoPageRunId += 1;
  tabletAutoPageRunning = false;
  if(tabletAutoPageTimer){ clearTimeout(tabletAutoPageTimer); tabletAutoPageTimer=null; }
  const btn = qs('#allAutoPages');
  if(btn) btn.classList.remove('active');
  if(message) setTwoStepHint(message);
}
async function tabletAllAutoPages(){
  if(!isTabletController) return;
  const btn = qs('#allAutoPages');

  // Pressing ALL [AUTO] while it is green must always stop it.
  if(tabletAutoPageRunning){
    tabletStopAutoPages('ALL [AUTO] stopped.');
    return;
  }

  // Lock to the operator selection visible now, not to any previous auto run or socket/program state.
  const autoType = selectedType;
  const autoStage = (autoType === 'stage' || autoType === 'stageTimes') ? Number(selectedStage || 1) : 0;
  tabletSelectedKey = tabletSelectionKey(autoType, autoStage || selectedStage);

  // Refresh totals for the selected graphic before calculating pages.
  await loadTotalsForSelection(false);
  const pages = Math.min(9, totalPagesFor(autoType, autoStage || selectedStage));
  let p = 1;

  tabletAutoPageRunId += 1;
  const runId = tabletAutoPageRunId;
  tabletAutoPageRunning = true;
  if(btn) btn.classList.add('active');
  setTwoStepHint(`ALL [AUTO] started for ${typeLabel(autoType)}. It will play pages 1-${pages}, 8 seconds each.`);

  const run = async () => {
    if(runId !== tabletAutoPageRunId || !tabletAutoPageRunning) return;
    // If the operator has selected another GFX/stage, stop instead of jumping back.
    if(tabletSelectedKey !== tabletSelectionKey(autoType, autoStage || selectedStage)){
      tabletStopAutoPages('ALL [AUTO] stopped because a different GFX was selected.');
      return;
    }
    if(p > pages){
      tabletStopAutoPages('ALL [AUTO] complete.');
      return;
    }
    selectedType = autoType;
    if(autoType === 'stage' || autoType === 'stageTimes') selectedStage = autoStage;
    selectedPage = p;
    updateActive();
    renderPageButtons();

    // For ALL [AUTO], send directly to program. The preview monitor still follows state.
    const sendStage = (autoType === 'stage' || autoType === 'stageTimes') ? autoStage : 0;
    await take(autoType, sendStage, p, 'program');
    if(runId !== tabletAutoPageRunId || !tabletAutoPageRunning) return;
    p += 1;
    tabletAutoPageTimer = setTimeout(run, 8000);
  };
  run();
}

async function clearGraphic(){ await clearMainGraphic('program'); if(isTabletController) updateTabletUiFromState(); }
async function clearPreviewGraphic(){
  tabletSetLogoPreview('');
  await clearMainGraphic('preview');
  if(isTabletController){
    const r = await api('/api/scene/layer-clear', { method:'POST', body:JSON.stringify({ layer:'logo', target:'preview' }) });
    if(r.ok){ state.scene = r.scene; sceneState = r.scene; renderSceneManager(); }
    setTwoStepHint('Preview cleared. Live output is unchanged.');
    updateTabletUiFromState();
  }
}
function openOutput(){ window.open(outputUrl(), '_blank', 'noopener'); }
function openPreview(){ window.open(previewHttpUrl(), '_blank', 'noopener'); }
async function copyUrl(){ await navigator.clipboard.writeText(outputUrl()); const btn=qs('#copyUrl'); if(btn){ const old=btn.textContent; btn.textContent='Copied'; setTimeout(()=>btn.textContent=old,1000); } }
function startAutoRefresh(){ if(autoTimer) clearInterval(autoTimer); const chk=qs('#autoRefresh'); if(!chk || !chk.checked) return; const ms=Number(qs('#refreshEvery')?.value || 30000); autoTimer=setInterval(()=>loadTotalsForSelection(false), ms); }

function renderRundown(){
  const list=qs('#rundownList'); if(!list) return;
  list.innerHTML='';
  rundown.forEach((item, idx)=>{
    const row=document.createElement('div'); row.className='rundownItem'+(idx===rundownIndex?' active':'');
    row.innerHTML=`<span>${idx+1}. ${labelFor(item.type,item.stageId,item.page)}</span><div><button data-act="take">Take</button><button data-act="up">▲</button><button data-act="down">▼</button><button data-act="del">×</button></div>`;
    row.querySelector('[data-act="take"]').onclick=()=>{rundownIndex=idx; renderRundown(); take(item.type,item.stageId,item.page);};
    row.querySelector('[data-act="up"]').onclick=()=>{ if(idx>0){ [rundown[idx-1],rundown[idx]]=[rundown[idx],rundown[idx-1]]; saveRundown(); } };
    row.querySelector('[data-act="down"]').onclick=()=>{ if(idx<rundown.length-1){ [rundown[idx+1],rundown[idx]]=[rundown[idx],rundown[idx+1]]; saveRundown(); } };
    row.querySelector('[data-act="del"]').onclick=()=>{ rundown.splice(idx,1); saveRundown(); };
    list.appendChild(row);
  });
}
async function loadRundown(){ const r=await api('/api/rundown'); rundown = r.ok ? (r.rundown.items || []) : []; renderRundown(); }
async function saveRundown(){ await api('/api/rundown',{method:'POST',body:JSON.stringify({items:rundown})}); renderRundown(); }
function addCurrentToRundown(){ rundown.push({type:selectedType, stageId:(selectedType==='stage'||selectedType==='stageTimes')?selectedStage:0, page:selectedPage, pageSize}); saveRundown(); }
function clearRundown(){ if(confirm('Clear rundown?')){ rundown=[]; rundownIndex=-1; saveRundown(); } }
async function takeNext(){ if(!rundown.length) return alert('Rundown is empty'); rundownIndex=(rundownIndex+1)%rundown.length; const i=rundown[rundownIndex]; renderRundown(); await take(i.type,i.stageId,i.page); }
function toggleAutoRundown(){
  const btn=qs('#autoRundown'); if(rundownTimer){ clearInterval(rundownTimer); rundownTimer=null; if(btn)btn.textContent='▶ Auto Rundown'; return; }
  const sec=Number(qs('#rundownSeconds')?.value||10); rundownTimer=setInterval(takeNext, sec*1000); if(btn)btn.textContent='⏸ Stop Auto'; takeNext();
}

socket.on('state', s=>{
  const oldEventId = state?.eventId;
  state=s;
  const e=qs('#eventId'); if(e) e.value=s.eventId;
  if(isTabletController){
    // Tablet selector is operator-owned. Live/program state must update LEDs only;
    // it must not change the chosen GFX/stage/page, otherwise ALL [AUTO] can jump
    // back to a previous graphic after a socket refresh.
    if(s.eventId && s.eventId !== oldEventId) loadEvent().then(updateTabletUiFromState);
    updateTabletUiFromState();
    return;
  }
  if(s.graphic?.type && s.graphic.type!=='blank') selectedType=s.graphic.type;
  if(s.graphic?.stageId) selectedStage=Number(s.graphic.stageId);
  if(s.graphic?.page) selectedPage=Number(s.graphic.page);
  updateActive(); renderPageButtons(); updateTabletUiFromState();
});

qsa('[data-type]').forEach(b=>b.onclick=()=>{ if(isTabletController) tabletStopAutoPages('ALL [AUTO] stopped. New GFX loaded to preview.'); selectedType=b.dataset.type; selectedPage=1; tabletSelectedKey=tabletSelectionKey(); loadTotalsForSelection(true);});
qsa('[data-layer]').forEach(b=>b.onclick=()=>takeLayer(b.dataset.layer));
qsa('[data-target="stage"]').forEach(b=>b.onclick=()=>{selectedType='stage'; selectedPage=1; updateActive(); loadTotalsForSelection(true);});
qs('#saveEvent') && (qs('#saveEvent').onclick=loadEvent);
qs('#refreshData') && (qs('#refreshData').onclick=()=>loadTotalsForSelection(true));
qs('#clearGraphic') && (qs('#clearGraphic').onclick=clearGraphic);
qs('#clearPreview') && (qs('#clearPreview').onclick=clearPreviewGraphic);
qs('#openOutput') && (qs('#openOutput').onclick=openOutput);
qs('#openPreview') && (qs('#openPreview').onclick=openPreview);
qs('#copyUrl') && (qs('#copyUrl').onclick=copyUrl);
qs('#clearCache') && (qs('#clearCache').onclick=()=>loadEvent());
qs('#autoRefresh') && (qs('#autoRefresh').onchange=startAutoRefresh);
qs('#refreshEvery') && (qs('#refreshEvery').onchange=startAutoRefresh);
qs('#addRundown') && (qs('#addRundown').onclick=addCurrentToRundown);
qs('#takeNext') && (qs('#takeNext').onclick=takeNext);
qs('#clearRundown') && (qs('#clearRundown').onclick=clearRundown);
qs('#autoRundown') && (qs('#autoRundown').onclick=toggleAutoRundown);
qs('#takeToPgm') && (qs('#takeToPgm').onclick=tabletTakePreviewToPgm);
qs('#takeBug') && (qs('#takeBug').onclick=tabletToggleBug);
qsa('.logoSlot').forEach(b=>b.onclick=()=>tabletSelectLogoSlot(b.dataset.logoSlot));
qs('#allAutoPages') && (qs('#allAutoPages').onclick=tabletAllAutoPages);

setOutputFields(); initStages(); updateActive(); loadEvent().then(updateTabletUiFromState); startAutoRefresh();

async function refreshAdmin(){
  const dbText = qs('#dbStatus'), dbDot = qs('#dbDot');
  try {
    const st = await api('/api/admin/status');
    if (st.ok) {
      const dbOk = !!st.database?.ok;
      if (dbText) dbText.textContent = dbOk ? 'Connected' : (st.database?.message || 'Not connected');
      if (dbDot) dbDot.className = 'dot ' + (dbOk ? 'ok' : 'bad');
    }
  } catch (err) { if (dbText) dbText.textContent = err.message; if (dbDot) dbDot.className = 'dot bad'; }
}
function exportJson(){ window.open(withToken('/api/export'), '_blank', 'noopener'); }
function importJson(){ qs('#importFile')?.click(); }
async function handleImportFile(ev){
  const file = ev.target.files?.[0]; if (!file) return;
  try {
    const mode = qs('#importMode')?.value || 'merge';
    const text = await file.text(); const payload = JSON.parse(text);
    const res = await api('/api/import?mode='+encodeURIComponent(mode), { method:'POST', body: JSON.stringify(payload) });
    alert(res.ok ? `DB import complete (${res.result.mode})` : ('Import failed: ' + res.error)); await refreshAdmin(); await loadEvent();
  } catch (err) { alert('Import failed: ' + err.message); }
  ev.target.value = '';
}
function exportConfig(){ window.open(withToken('/api/config/export'), '_blank', 'noopener'); }
function importConfig(){ qs('#configFile')?.click(); }
async function handleConfigFile(ev){
  const file = ev.target.files?.[0]; if (!file) return;
  try {
    const mode = qs('#configImportMode')?.value || 'merge';
    const text = await file.text(); const payload = JSON.parse(text);
    if (payload.kind && payload.kind !== 'rally-graphics-config') {
      if (!confirm('This does not look like a Rally Graphics config file. Import anyway?')) return;
    }
    const res = await api('/api/config/import?mode='+encodeURIComponent(mode), { method:'POST', body: JSON.stringify(payload) });
    alert(res.ok ? 'Full config imported successfully' : ('Config import failed: ' + res.error));
    await refreshAdmin(); await loadEvent(); await loadGraphicsSettings();
  } catch (err) { alert('Config import failed: ' + err.message); }
  ev.target.value = '';
}
window.addEventListener('DOMContentLoaded', () => {
  qs('#refreshAdmin')?.addEventListener('click', refreshAdmin);
  qs('#exportJson')?.addEventListener('click', exportJson);
  qs('#importJson')?.addEventListener('click', importJson);
  qs('#importFile')?.addEventListener('change', handleImportFile);
  qs('#exportConfig')?.addEventListener('click', exportConfig);
  qs('#importConfig')?.addEventListener('click', importConfig);
  qs('#configFile')?.addEventListener('change', handleConfigFile);
  refreshAdmin();
});

// Login / user management (desktop only)
let currentUser = null;
async function loadMe(){
  try {
    const r = await fetch('/api/me').then(x=>x.json());
    if (!r.ok) return;
    currentUser = r.user;
    const badge = qs('#userBadge'); if (badge) badge.textContent = `${currentUser.username} (${currentUser.role})`;
    const usersNav = qs('#usersNav'); if (usersNav) usersNav.style.display = currentUser.role === 'admin' ? '' : 'none';
    const userCard = qs('#userCard'); if (userCard) userCard.style.display = currentUser.role === 'admin' ? '' : 'none';
    if (currentUser.role === 'admin') await loadUsers();
  } catch {}
}
async function logout(){
  await fetch('/logout', { method:'POST', headers:{'content-type':'application/json'} }).catch(()=>{});
  location.href = '/login';
}
async function loadUsers(){
  const list = qs('#usersList'); if (!list) return;
  const res = await fetch('/api/users').then(r=>r.json()).catch(err=>({ok:false,error:err.message}));
  if (!res.ok) { list.innerHTML = `<p class="muted">${res.error || 'Could not load users'}</p>`; return; }
  list.innerHTML = (res.users || []).map(u => `
    <div class="userRow" data-id="${u.id}">
      <div><strong>${u.username}</strong><span>${u.displayName || ''}</span></div>
      <select class="roleSelect">
        <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
        <option value="operator" ${u.role==='operator'?'selected':''}>Operator</option>
        <option value="tablet" ${u.role==='tablet'?'selected':''}>Tablet</option>
        <option value="viewer" ${u.role==='viewer'?'selected':''}>Viewer</option>
      </select>
      <label class="miniCheck"><input class="enabledCheck" type="checkbox" ${u.enabled?'checked':''}> Enabled</label>
      <input class="resetPassword" type="password" placeholder="New password">
      <button class="outline saveUser">Save</button>
      <button class="red deleteUser" ${u.username==='superadmin'?'disabled':''}>Delete</button>
    </div>`).join('');
  qsa('.saveUser').forEach(btn => btn.onclick = async () => {
    const row = btn.closest('.userRow');
    const body = { role: row.querySelector('.roleSelect').value, enabled: row.querySelector('.enabledCheck').checked };
    const pw = row.querySelector('.resetPassword').value; if (pw) body.password = pw;
    const out = await fetch('/api/users/'+row.dataset.id, { method:'PUT', headers:{'content-type':'application/json'}, body:JSON.stringify(body) }).then(r=>r.json());
    alert(out.ok ? 'User saved' : out.error); await loadUsers();
  });
  qsa('.deleteUser').forEach(btn => btn.onclick = async () => {
    if (btn.disabled || !confirm('Delete this user?')) return;
    const row = btn.closest('.userRow');
    const out = await fetch('/api/users/'+row.dataset.id, { method:'DELETE' }).then(r=>r.json());
    alert(out.ok ? 'User deleted' : out.error); await loadUsers();
  });
}
async function createUser(){
  const username = qs('#newUsername')?.value.trim();
  const password = qs('#newPassword')?.value;
  const displayName = qs('#newDisplayName')?.value.trim();
  const role = qs('#newRole')?.value || 'operator';
  if (!username || !password) return alert('Username and password are required');
  const res = await fetch('/api/users', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ username, password, displayName, role }) }).then(r=>r.json());
  if (!res.ok) return alert(res.error || 'Could not create user');
  ['#newUsername','#newPassword','#newDisplayName'].forEach(id => { const el=qs(id); if(el) el.value=''; });
  await loadUsers();
}
qs('#logoutBtn') && (qs('#logoutBtn').onclick = logout);
qs('#createUser') && (qs('#createUser').onclick = createUser);
loadMe();

// Navigation actions for desktop sidebar
function flashCard(card){
  if(!card) return;
  card.classList.add('highlightCard');
  setTimeout(()=>card.classList.remove('highlightCard'), 1200);
}
function scrollToCard(selector){
  const card = qs(selector);
  if(card){ card.scrollIntoView({behavior:'smooth', block:'start'}); flashCard(card); }
}
qsa('.nav[data-target]').forEach(btn => {
  btn.addEventListener('click', async () => {
    qsa('.nav').forEach(n=>n.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.target;
    if(target === 'dashboard') scrollToCard('#dashboardCard');
    if(target === 'graphics') scrollToCard('#graphicsCard');
    if(target === 'broadcast') scrollToCard('#broadcastEngineCard');
    if(target === 'outputs') scrollToCard('#outputManagerCard');
    if(target === 'designer') scrollToCard('#graphicsSettingsCard');
    if(target === 'data') scrollToCard('#dataCard');
    if(target === 'settings') { await loadMe(); await loadUsers(); scrollToCard('#userCard'); }
  });
});


// Graphics Settings sub-tab
const graphicsDefaults = {
  scale: 1, x: 0, y: 0, width: 1920, height: 1080,
  opacity: 100, backgroundOpacity: 100, borderOpacity: 100, shadowOpacity: 0,
  blur: 0, brightness: 100, contrast: 100,
  animationSpeed: 1, animationDuration: 280, animationType: 'fade', outAnimationType: 'fade', rowStagger: 0, easing: 'ease-out', radius: 0
};
let graphicsSettings = { ...graphicsDefaults };
let graphicsSaveTimer = null;
function graphicsValueText(key, value){
  const n = Number(value);
  if (key === 'scale') return Math.round(n * 100) + '%';
  if (['x','y','width','height','blur','radius'].includes(key)) return Math.round(n) + 'px';
  if (['opacity','backgroundOpacity','borderOpacity','shadowOpacity','brightness','contrast'].includes(key)) return Math.round(n) + '%';
  if (key === 'animationSpeed') return n.toFixed(1) + 'x';
  if (key === 'animationDuration') return Math.round(n) + 'ms';
  if (key === 'rowStagger') return Math.round(n) + 'ms';
  if (key === 'animationType' || key === 'outAnimationType') return String(val || 'fade');
  return String(value);
}
function renderGraphicsSettings(){
  qsa('[data-gs]').forEach(input => {
    const key = input.dataset.gs;
    if (graphicsSettings[key] === undefined) return;
    input.value = graphicsSettings[key];
    const out = qs(`#gs_${key}_value`);
    if (out) out.textContent = graphicsValueText(key, graphicsSettings[key]);
  });
}
async function saveGraphicsSettings(immediate=false){
  if (graphicsSaveTimer) clearTimeout(graphicsSaveTimer);
  const run = async () => {
    try { await api('/api/graphics-settings', { method:'POST', body: JSON.stringify(graphicsSettings) }); setLastUpdated(); }
    catch (err) { console.warn('Could not save graphics settings', err); }
  };
  if (immediate) return run();
  graphicsSaveTimer = setTimeout(run, 120);
}
async function loadGraphicsSettings(){
  try {
    const r = await api('/api/graphics-settings');
    if (r.ok) graphicsSettings = { ...graphicsDefaults, ...r.settings };
    renderGraphicsSettings();
  } catch {}
}
function setupGraphicsSettings(){
  qsa('.designerTab').forEach(btn => btn.onclick = () => {
    qsa('.designerTab').forEach(b => b.classList.toggle('active', b === btn));
    qsa('.designerPanel').forEach(p => p.classList.toggle('active', p.dataset.designerPanel === btn.dataset.designerTab));
  });
  function applyGraphicsInput(input, immediate=false){
    const key = input.dataset.gs;
    if (!key) return;
    graphicsSettings[key] = input.type === 'number' || input.type === 'range' ? Number(input.value) : input.value;
    const out = qs(`#gs_${key}_value`); if (out) out.textContent = graphicsValueText(key, graphicsSettings[key]);
    saveGraphicsSettings(immediate);
  }
  qsa('[data-gs]').forEach(input => {
    input.addEventListener('input', () => applyGraphicsInput(input, false));
    input.addEventListener('change', () => saveGraphicsSettings(true));
  });
  qsa('[data-step-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = qs(`#${btn.dataset.stepTarget}`);
      if (!input) return;
      const dir = Number(btn.dataset.stepDir || 1);
      const step = Number(input.step || 1) || 1;
      const min = input.min === '' ? -Infinity : Number(input.min);
      const max = input.max === '' ? Infinity : Number(input.max);
      const current = Number(input.value || 0);
      const decimals = (String(input.step || '').split('.')[1] || '').length;
      let next = current + (dir * step);
      next = Math.max(min, Math.min(max, next));
      input.value = decimals ? next.toFixed(decimals) : String(Math.round(next));
      applyGraphicsInput(input, true);
    });
  });
  qs('#gsPreset1080') && (qs('#gsPreset1080').onclick = () => { graphicsSettings = { ...graphicsSettings, scale:1, x:0, y:0, width:1920, height:1080 }; renderGraphicsSettings(); saveGraphicsSettings(true); });
  qs('#gsPreset720') && (qs('#gsPreset720').onclick = () => { graphicsSettings = { ...graphicsSettings, scale:1, x:0, y:0, width:1280, height:720 }; renderGraphicsSettings(); saveGraphicsSettings(true); });
  qs('#gsReset') && (qs('#gsReset').onclick = async () => { if(!confirm('Reset all graphics settings?')) return; const r = await api('/api/graphics-settings/reset', { method:'POST', body:'{}' }); if(r.ok) graphicsSettings = { ...graphicsDefaults, ...r.settings }; renderGraphicsSettings(); });
  qs('#graphicsSettingsNav') && (qs('#graphicsSettingsNav').onclick = () => {
    const card = qs('#graphicsSettingsCard'); if (!card) return;
    card.scrollIntoView({ behavior:'smooth', block:'start' });
    card.classList.add('highlightCard'); setTimeout(()=>card.classList.remove('highlightCard'), 1300);
  });
}
socket.on('graphicsSettings', s => { graphicsSettings = { ...graphicsDefaults, ...s }; renderGraphicsSettings(); });
window.addEventListener('DOMContentLoaded', () => { setupGraphicsSettings(); loadGraphicsSettings(); });

// Scene Manager / Preview-Program workflow
function sceneGraphicLabel(g){
  if(!g || g.type === 'blank') return 'Blank';
  if(g.type === 'overall') return `Overall - Page ${g.page || 1}`;
  if(g.type === 'entries') return `Entry List - Page ${g.page || 1}`;
  if(g.type === 'stageTimes') return `Stage Times ${g.stageId || ''} - Page ${g.page || 1}`;
  if(g.type === 'stage') return `Stage ${g.stageId || ''} Results - Page ${g.page || 1}`;
  return g.title || g.type;
}

function updateLayerButtons(scene){
  const vis = scene?.layerVisibility || {};
  qsa('.layerBtn[data-layer]').forEach(btn => {
    const layer = btn.dataset.layer;
    const inPreview = !!vis.preview?.[layer];
    const inProgram = !!vis.program?.[layer];
    btn.classList.toggle('active', inPreview || inProgram);
    btn.title = inProgram ? 'On Live Output' : inPreview ? 'Loaded in Preview. Press again to send to Live Output.' : 'Press once for Preview, twice for Live Output.';
  });
}

function setBroadcastLed(id, active, previewOnly=false){
  const el = qs('#'+id);
  if(!el) return;
  el.className = 'led ' + (active ? (previewOnly ? 'orange' : 'green') : 'red');
}
function isGraphicType(g, type){ return !!g && g.type === type; }
function updateBroadcastStatuses(scene){
  const preview = scene?.preview || {type:'blank'};
  const program = scene?.program || state.graphic || {type:'blank'};
  ['overall','stageTimes','stage','entries'].forEach(type => {
    const inPreview = isGraphicType(preview, type);
    const inProgram = isGraphicType(program, type);
    setBroadcastLed(`status-${type}-preview`, inPreview, true);
    setBroadcastLed(`status-${type}-program`, inProgram, false);
  });
  const vis = scene?.layerVisibility || {};
  ['logo','clock','bug'].forEach(layer => {
    setBroadcastLed(`status-${layer}-preview`, !!vis.preview?.[layer], true);
    setBroadcastLed(`status-${layer}-program`, !!vis.program?.[layer], false);
  });
  const active = [];
  ['overall','stageTimes','stage','entries'].forEach(type => {
    if(isGraphicType(program, type)) active.push(`<span class="activePill livePill">🟢 ${typeLabel(type)}</span>`);
    else if(isGraphicType(preview, type)) active.push(`<span class="activePill previewPill">🟡 ${typeLabel(type)}</span>`);
  });
  ['logo','clock','bug'].forEach(layer => {
    const name = layerLabel(layer);
    if(vis.program?.[layer]) active.push(`<span class="activePill livePill">🟢 ${name}</span>`);
    else if(vis.preview?.[layer]) active.push(`<span class="activePill previewPill">🟡 ${name}</span>`);
  });
  const list = qs('#activeGraphicsList');
  if(list) list.innerHTML = active.length ? active.join('') : '<span class="muted small">Nothing active</span>';
}
let sceneState = null;
let logoLibrary = [];
let savingLayers = false;
let saveLayersTimer = null;
function currentGraphicPayload(){
  return { type:selectedType, stageId:(selectedType==='stage'||selectedType==='stageTimes')?selectedStage:0, page:selectedPage, pageSize, title:labelFor(selectedType, selectedStage, selectedPage) };
}
function renderSceneManager(){
  const scene = sceneState || state.scene || {};
  const preview = scene.preview || { type:'blank' };
  const program = scene.program || state.graphic || { type:'blank' };
  const p = qs('#previewLabel'); if(p) p.textContent = sceneGraphicLabel(preview);
  const pr = qs('#programLabel'); if(pr) pr.textContent = sceneGraphicLabel(program);
  const hp = qs('#homePreviewLabel'); if(hp) hp.textContent = sceneGraphicLabel(preview);
  const hpr = qs('#homeProgramLabel'); if(hpr) hpr.textContent = sceneGraphicLabel(program);
  const tr = qs('#sceneTransition'); if(tr && scene.transition) tr.value = scene.transition;
  const layers = scene.layers || {};
  const main = layers.main || {};
  const ml = qs('#mainLayerOpacity'); if(ml) ml.value = main.opacity ?? 100;
  const mlv = qs('#mainLayerOpacityValue'); if(mlv) mlv.textContent = `${main.opacity ?? 100}%`;
  const bug = layers.bug || {};
  const clock = layers.clock || {};
  const be = qs('#bugEnabled'); if(be) be.checked = !!bug.enabled;
  const bt = qs('#bugText'); if(bt) bt.value = bug.text || '';
  const gle = qs('#gsBugLogoEnabled'); if(gle) gle.checked = !!bug.logoEnabled;
  const ce = qs('#clockEnabled'); if(ce) ce.checked = !!clock.enabled;
  renderLayerDesignerControls(bug, clock);
  updateLayerButtons(scene);
  updateBroadcastStatuses(scene);
}


function setVal(id, value, suffix=''){
  const el = qs('#'+id); if (el) el.value = value ?? '';
  const out = qs('#'+id+'Value'); if (out) out.textContent = `${value ?? ''}${suffix}`;
}
function renderLayerDesignerControls(bug={}, clock={}){
  const map = [
    ['gsBugText', bug.text || '', 'value'],
    ['gsBugOpacity', bug.opacity ?? 100, '%'], ['gsBugX', bug.x ?? 0, 'px'], ['gsBugY', bug.y ?? 0, 'px'], ['gsBugFontSize', bug.fontSize ?? 28, 'px'],
    ['gsBugLogoWidth', bug.logoWidth ?? 120, 'px'], ['gsBugLogoOpacity', bug.logoOpacity ?? 100, '%'], ['gsBugLogoUrl', bug.logoUrl || '', 'value'],
    ['gsClockOpacity', clock.opacity ?? 100, '%'], ['gsClockX', clock.x ?? 0, 'px'], ['gsClockY', clock.y ?? 0, 'px'], ['gsClockFontSize', clock.fontSize ?? 28, 'px']
  ];
  map.forEach(([id,val,mode])=>{
    const el = qs('#'+id); if(!el) return;
    if(mode === 'checked') el.checked = !!val; else el.value = val;
    if(mode !== 'value' && mode !== 'checked') { const out=qs('#'+id+'Value'); if(out) out.textContent = `${val}${mode}`; }
  });
  renderLogoLibrary();
}
function readLayerDesignerControls(){
  const num = (id, def) => Number(qs('#'+id)?.value || def);
  return {
    bug: {
      enabled: false,
      logoEnabled: false,
      opacity: num('gsBugOpacity',100),
      text: qs('#gsBugText')?.value || '',
      x: num('gsBugX',0), y: num('gsBugY',0), fontSize: num('gsBugFontSize',28),
      backgroundOpacity: 72,
      logoUrl: qs('#gsBugLogoUrl')?.value || '',
      logoWidth: num('gsBugLogoWidth',120),
      logoOpacity: num('gsBugLogoOpacity',100)
    },
    clock: {
      enabled: false,
      opacity: num('gsClockOpacity',100),
      x: num('gsClockX',0), y: num('gsClockY',0), fontSize: num('gsClockFontSize',28),
      backgroundOpacity: 72
    }
  };
}


function renderLogoLibrary(){
  const select = qs('#gsLogoLibrary');
  const current = qs('#gsBugLogoUrl')?.value || '';
  if (select) {
    const previous = current || select.value || '';
    select.innerHTML = '<option value="">No logo selected</option>' + logoLibrary.map(l => `<option value="${l.url}">${(l.fileName || l.url).replace(/^\d+_[a-f0-9]+_/,'')}</option>`).join('');
    select.value = previous;
  }
  const preview = qs('#gsLogoPreview');
  if (preview) {
    if (current) preview.innerHTML = `<img src="${current}" alt="Selected logo">`;
    else preview.textContent = 'No logo selected';
  }
}
async function loadLogoLibrary(){
  try {
    const r = await api('/api/assets/logos');
    if (r.ok) { logoLibrary = r.logos || []; renderLogoLibrary(); }
  } catch {}
}
async function selectLogoFromLibrary(url){
  const hidden = qs('#gsBugLogoUrl');
  if (hidden) hidden.value = url || '';
  renderLogoLibrary();
  await saveSceneLayers();
}
function saveSceneLayersDebounced(){
  clearTimeout(saveLayersTimer);
  saveLayersTimer = setTimeout(saveSceneLayers, 80);
}
async function loadScene(){
  try { const r = await api('/api/scene'); if(r.ok){ sceneState = r.scene; renderSceneManager(); } } catch {}
}
async function previewCurrent(){
  const r = await api('/api/scene/preview', { method:'POST', body:JSON.stringify(currentGraphicPayload()) });
  if(r.ok){ sceneState = r.scene; renderSceneManager(); setLastUpdated(); }
}
async function takePreviewToProgram(){
  const r = await api('/api/scene/take-preview', { method:'POST', body:'{}' });
  if(r.ok){ state = r.state; sceneState = r.state.scene; renderSceneManager(); setLastUpdated(); }
}
async function clearProgramScene(){ await api('/api/take',{method:'POST',body:JSON.stringify({type:'blank'})}); setLastUpdated(); }
async function saveSceneLayers(){
  const fromDesigner = readLayerDesignerControls();
  // Keep the compact Scene Manager controls in sync with the new Graphics Settings controls.
  // Layer visibility is controlled only by the Bug Text / Logo / Clock buttons.
  // Designer fields save content/style only and must not auto-show layers.
  const layers = {
    main: { enabled:true, opacity:Number(qs('#mainLayerOpacity')?.value || 100) },
    bug: fromDesigner.bug,
    clock: fromDesigner.clock
  };
  sceneState = { ...(sceneState || {}), layers };
  renderLayerDesignerControls(layers.bug, layers.clock);
  savingLayers = true;
  try {
    const r = await api('/api/scene/layers', { method:'POST', body:JSON.stringify({layers}) });
    if(r.ok){ sceneState = r.scene; renderLayerDesignerControls(r.scene.layers?.bug || layers.bug, r.scene.layers?.clock || layers.clock); }
  } finally {
    savingLayers = false;
  }
}

async function prepareLogoPngDataUrl(file){
  // Preserve real PNG alpha. If a downloaded logo has a checkerboard/white background baked in,
  // remove the bright low-saturation background pixels before upload so programme/preview output is transparent.
  const rawDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read logo file'));
    reader.readAsDataURL(file);
  });
  return await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img,0,0);
        const data = ctx.getImageData(0,0,canvas.width,canvas.height);
        let transparentPixels = 0;
        let brightNeutralPixels = 0;
        for (let i=0;i<data.data.length;i+=4) {
          const r=data.data[i], g=data.data[i+1], b=data.data[i+2], a=data.data[i+3];
          if (a < 250) transparentPixels++;
          const max=Math.max(r,g,b), min=Math.min(r,g,b);
          if (a > 245 && max > 185 && (max-min) < 28) brightNeutralPixels++;
        }
        const total = data.data.length / 4;
        // Only clean when the PNG appears to have no real alpha and a large bright/grey background.
        if (transparentPixels < total * 0.01 && brightNeutralPixels > total * 0.18) {
          for (let i=0;i<data.data.length;i+=4) {
            const r=data.data[i], g=data.data[i+1], b=data.data[i+2], a=data.data[i+3];
            const max=Math.max(r,g,b), min=Math.min(r,g,b);
            if (a > 245 && max > 185 && (max-min) < 28) data.data[i+3] = 0;
          }
          ctx.putImageData(data,0,0);
          resolve(canvas.toDataURL('image/png'));
        } else {
          resolve(rawDataUrl);
        }
      } catch (_) { resolve(rawDataUrl); }
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}

function setupSceneManager(){
  qs('#sceneManagerNav') && (qs('#sceneManagerNav').onclick = () => scrollToCard('#sceneManagerCard'));
  qs('#previewCurrent') && (qs('#previewCurrent').onclick = previewCurrent);
  qs('#takePreview') && (qs('#takePreview').onclick = takePreviewToProgram);
  qs('#clearProgram') && (qs('#clearProgram').onclick = clearProgramScene);
  qs('#sceneTransition') && (qs('#sceneTransition').onchange = async e => { const r=await api('/api/scene/transition',{method:'POST',body:JSON.stringify({transition:e.target.value})}); if(r.ok){sceneState=r.scene; renderSceneManager();} });
  ['#mainLayerOpacity','#gsBugText','#gsBugOpacity','#gsBugX','#gsBugY','#gsBugFontSize','#gsBugLogoWidth','#gsBugLogoOpacity','#gsClockOpacity','#gsClockX','#gsClockY','#gsClockFontSize'].forEach(id => {
    const el=qs(id); if(!el) return;
    el.addEventListener('input', saveSceneLayersDebounced);
    el.addEventListener('change', saveSceneLayers);
  });
  qsa('.layerStep').forEach(btn => btn.addEventListener('click', () => {
    const input = qs('#' + btn.dataset.layerInput); if(!input) return;
    const dir = Number(btn.dataset.stepDir || 1), step = Number(input.step || 1) || 1;
    const min = input.min === '' ? -Infinity : Number(input.min), max = input.max === '' ? Infinity : Number(input.max);
    input.value = String(Math.max(min, Math.min(max, Number(input.value || 0) + dir * step)));
    saveSceneLayers();
  }));
  qs('#gsRefreshLogos') && (qs('#gsRefreshLogos').onclick = loadLogoLibrary);
  qs('#gsClearLogo') && (qs('#gsClearLogo').onclick = async () => { await selectLogoFromLibrary(''); });
  qs('#gsLogoLibrary') && (qs('#gsLogoLibrary').onchange = async e => { await selectLogoFromLibrary(e.target.value || ''); });
  const logoFile = qs('#gsBugLogoFile');
  if (logoFile) logoFile.addEventListener('change', async () => {
    const file = logoFile.files && logoFile.files[0]; if(!file) return;
    if (file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png')) { alert('Please select a PNG file so transparency is preserved.'); logoFile.value=''; return; }
    try {
      const dataUrl = await prepareLogoPngDataUrl(file);
      const r = await api('/api/assets/logo', { method:'POST', body:JSON.stringify({ name:file.name, dataUrl }) });
      if(!r.ok) throw new Error(r.error || 'Logo upload failed');
      logoLibrary = r.logos || logoLibrary;
      const url = qs('#gsBugLogoUrl'); if(url) url.value = r.url;
      renderLogoLibrary();
      const select = qs('#gsLogoLibrary'); if(select) select.value = r.url;
      await selectLogoFromLibrary(r.url);
      await saveSceneLayers();
      setLastUpdated();
      logoFile.value = '';
    } catch (err) { alert(err.message || 'Logo upload failed'); logoFile.value = ''; }
  });
  loadLogoLibrary();
  qs('#runMacroClear') && (qs('#runMacroClear').onclick = async () => { await api('/api/macros/run',{method:'POST',body:JSON.stringify({index:0})}); });
  qs('#runMacroTake') && (qs('#runMacroTake').onclick = async () => { await api('/api/macros/run',{method:'POST',body:JSON.stringify({index:1})}); });
  loadScene();
}
socket.on('state', s=>{ if(s?.scene){ sceneState=s.scene; if(!savingLayers) renderSceneManager(); } });
window.addEventListener('DOMContentLoaded', setupSceneManager);

// ===== Workflow optimisation pack: undo/redo, presets, per-graphic settings, lock mode, health LEDs, errors, shortcuts =====
const WORKFLOW_DEFAULT_SHORTCUTS = {
  take: 'Space',
  clear: 'Escape',
  preview: 'KeyP',
  takePreview: 'KeyT',
  openPreview: 'F8',
  openOutput: 'F9'
};
const SHORTCUT_LABELS = {
  take: 'Take current graphic to selected target',
  clear: 'Clear selected target',
  preview: 'Send current graphic to Preview',
  takePreview: 'TAKE Preview → Program',
  openPreview: 'Open Preview page',
  openOutput: 'Open Program Output page'
};
let uiSettings = { operatorLock:false, safeGuides:false, shortcuts:{...WORKFLOW_DEFAULT_SHORTCUTS} };
let allGraphicsSettings = { ...graphicsDefaults, perGraphic:{} };
let currentGsScope = 'global';
let gsUndoStack = [];
let gsRedoStack = [];
let gsPresets = [];
let recordingShortcut = null;
function cloneObj(v){ return JSON.parse(JSON.stringify(v || {})); }
function stripPerGraphic(s){ const { perGraphic, updatedAt, ...rest } = s || {}; return { ...graphicsDefaults, ...rest }; }
function settingsForScope(scope=currentGsScope){
  allGraphicsSettings = { ...graphicsDefaults, ...(allGraphicsSettings || {}), perGraphic: (allGraphicsSettings && allGraphicsSettings.perGraphic) || {} };
  if (scope && scope !== 'global') return { ...stripPerGraphic(allGraphicsSettings), ...(allGraphicsSettings.perGraphic?.[scope] || {}) };
  return stripPerGraphic(allGraphicsSettings);
}
function pushGsUndo(){ gsUndoStack.push(cloneObj(graphicsSettings)); if(gsUndoStack.length>50) gsUndoStack.shift(); gsRedoStack.length=0; }
function setDesignerDisabled(disabled){
  qsa('#graphicsSettingsCard input, #graphicsSettingsCard select, #graphicsSettingsCard button').forEach(el => {
    if (['operatorLock','safeGuides','gsScope','gsUndo','gsRedo','gsPresetSelect','gsLoadPreset'].includes(el.id)) return;
    el.disabled = !!disabled;
  });
  const card=qs('#graphicsSettingsCard'); if(card) card.classList.toggle('locked', !!disabled);
}
renderGraphicsSettings = function(){
  qsa('[data-gs]').forEach(input => {
    const key = input.dataset.gs;
    if (graphicsSettings[key] === undefined) return;
    input.value = graphicsSettings[key];
    const out = qs(`#gs_${key}_value`);
    if (out) out.textContent = graphicsValueText(key, graphicsSettings[key]);
  });
  const scopeSel = qs('#gsScope'); if(scopeSel) scopeSel.value = currentGsScope;
  const hint = qs('#gsScopeHint');
  if (hint) {
    const names = { global:'Global Default', overall:'Overall', stage:'Stage Results', stageTimes:'Stage Times', entries:'Entry List', bug:'Bug / Sponsor layer', clock:'Clock layer' };
    hint.textContent = `Selected scope: ${names[currentGsScope] || currentGsScope}. Resize, position, opacity, blur and animation controls apply only to this scope.`;
  }
  setDesignerDisabled(uiSettings.operatorLock);
};
loadGraphicsSettings = async function(){
  try {
    const r = await api('/api/graphics-settings');
    if (r.ok) allGraphicsSettings = { ...graphicsDefaults, ...r.settings, perGraphic: r.settings?.perGraphic || {} };
    graphicsSettings = settingsForScope(currentGsScope);
    renderGraphicsSettings();
  } catch {}
};
saveGraphicsSettings = async function(immediate=false){
  if (graphicsSaveTimer) clearTimeout(graphicsSaveTimer);
  const run = async () => {
    try {
      allGraphicsSettings = { ...graphicsDefaults, ...(allGraphicsSettings || {}), perGraphic: allGraphicsSettings?.perGraphic || {} };
      if (currentGsScope === 'global') {
        allGraphicsSettings = { ...allGraphicsSettings, ...stripPerGraphic(graphicsSettings) };
      } else {
        allGraphicsSettings.perGraphic[currentGsScope] = stripPerGraphic(graphicsSettings);
      }
      const r = await api('/api/graphics-settings', { method:'POST', body: JSON.stringify(allGraphicsSettings) });
      if (r.ok) allGraphicsSettings = { ...graphicsDefaults, ...r.settings, perGraphic:r.settings?.perGraphic || {} };
      setLastUpdated();
    } catch (err) { console.warn('Could not save graphics settings', err); }
  };
  if (immediate) return run();
  graphicsSaveTimer = setTimeout(run, 120);
};
async function loadUiSettings(){
  try { const r = await api('/api/ui-settings'); if(r.ok) uiSettings = { ...uiSettings, ...r.settings, shortcuts:{...WORKFLOW_DEFAULT_SHORTCUTS, ...(r.settings.shortcuts||{})} }; } catch {}
  qs('#operatorLock') && (qs('#operatorLock').checked = !!uiSettings.operatorLock);
  qs('#safeGuides') && (qs('#safeGuides').checked = !!uiSettings.safeGuides);
  setDesignerDisabled(uiSettings.operatorLock);
  renderShortcuts();
}
async function saveUiSettings(){
  try { await api('/api/ui-settings', { method:'POST', body:JSON.stringify(uiSettings) }); } catch(err){ console.warn('Could not save UI settings', err); }
}
function keyDisplay(code){ return String(code||'').replace(/^Key/,'').replace(/^Digit/,'').replace('Space','Space Bar').replace('Escape','Esc'); }
function renderShortcuts(){
  const list=qs('#shortcutList'); if(!list) return;
  list.innerHTML = Object.entries(SHORTCUT_LABELS).map(([action,label]) => `<div class="shortcutRow"><strong>${label}</strong><button class="shortcutKey" data-shortcut-action="${action}">${keyDisplay(uiSettings.shortcuts[action])}</button></div>`).join('');
  qsa('[data-shortcut-action]').forEach(btn => btn.onclick = () => { recordingShortcut = btn.dataset.shortcutAction; btn.textContent = 'Press keys...'; btn.classList.add('recording'); });
}
function shortcutAction(action){
  if (document.activeElement && ['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
  if(action==='take') take();
  if(action==='clear') clearGraphic();
  if(action==='preview') previewCurrent();
  if(action==='takePreview') takePreviewToProgram();
  if(action==='openPreview') openPreview();
  if(action==='openOutput') openOutput();
}
function setupShortcutKeys(){
  document.addEventListener('keydown', ev => {
    if (recordingShortcut) {
      ev.preventDefault();
      uiSettings.shortcuts[recordingShortcut] = ev.code;
      recordingShortcut = null;
      renderShortcuts();
      saveUiSettings();
      return;
    }
    const hit = Object.entries(uiSettings.shortcuts || {}).find(([_, code]) => code === ev.code);
    if (hit) { ev.preventDefault(); shortcutAction(hit[0]); }
  });
}
async function loadGraphicsPresets(){
  try { const r=await api('/api/graphics-presets'); if(r.ok) gsPresets = r.presets || []; } catch {}
  const sel=qs('#gsPresetSelect'); if(sel) sel.innerHTML = gsPresets.map(p=>`<option value="${String(p.name).replace(/"/g,'&quot;')}">${p.name} (${p.scope || 'global'})</option>`).join('') || '<option value="">No presets saved</option>';
}
async function saveNamedPreset(){
  const name=qs('#gsPresetName')?.value.trim(); if(!name) return alert('Enter a preset name first');
  const r=await api('/api/graphics-presets',{method:'POST',body:JSON.stringify({name, scope:currentGsScope, settings:graphicsSettings})});
  if(!r.ok) return alert(r.error || 'Could not save preset');
  gsPresets=r.presets||[]; await loadGraphicsPresets(); alert('Preset saved');
}
async function loadNamedPreset(){
  const name=qs('#gsPresetSelect')?.value; const p=gsPresets.find(x=>x.name===name); if(!p) return;
  pushGsUndo(); graphicsSettings = { ...graphicsSettings, ...stripPerGraphic(p.settings) }; renderGraphicsSettings(); await saveGraphicsSettings(true);
}
async function deleteNamedPreset(){
  const name=qs('#gsPresetSelect')?.value; if(!name || !confirm('Delete this preset?')) return;
  const r=await fetch(withToken('/api/graphics-presets/'+encodeURIComponent(name)), { method:'DELETE' }).then(x=>x.json());
  if(r.ok){ gsPresets=r.presets||[]; await loadGraphicsPresets(); }
}
function setupWorkflowDesigner(){
  qsa('[data-gs]').forEach(input => {
    input.addEventListener('pointerdown', pushGsUndo, { once:false });
    input.addEventListener('focus', () => { input.dataset.beforeValue = input.value; });
    input.addEventListener('change', () => { if(input.dataset.beforeValue !== input.value) pushGsUndo(); });
  });
  qs('#gsScope') && (qs('#gsScope').onchange = async e => { await saveGraphicsSettings(true); currentGsScope=e.target.value; graphicsSettings=settingsForScope(currentGsScope); renderGraphicsSettings(); });
  qs('#gsUndo') && (qs('#gsUndo').onclick = async () => { if(!gsUndoStack.length) return; gsRedoStack.push(cloneObj(graphicsSettings)); graphicsSettings=gsUndoStack.pop(); renderGraphicsSettings(); await saveGraphicsSettings(true); });
  qs('#gsRedo') && (qs('#gsRedo').onclick = async () => { if(!gsRedoStack.length) return; gsUndoStack.push(cloneObj(graphicsSettings)); graphicsSettings=gsRedoStack.pop(); renderGraphicsSettings(); await saveGraphicsSettings(true); });
  qs('#operatorLock') && (qs('#operatorLock').onchange = async e => { uiSettings.operatorLock=e.target.checked; setDesignerDisabled(uiSettings.operatorLock); await saveUiSettings(); });
  qs('#safeGuides') && (qs('#safeGuides').onchange = async e => { uiSettings.safeGuides=e.target.checked; await saveUiSettings(); });
  qs('#gsSavePreset') && (qs('#gsSavePreset').onclick = saveNamedPreset);
  qs('#gsLoadPreset') && (qs('#gsLoadPreset').onclick = loadNamedPreset);
  qs('#gsDeletePreset') && (qs('#gsDeletePreset').onclick = deleteNamedPreset);
}
function ledClass(status){ if(status==='green' || status===true) return 'green'; if(status==='yellow' || status==='orange') return status; if(status==='grey' || status==='gray') return 'grey'; return 'red'; }
function setLed(id, status, text){ const led=qs('#'+id+'Led'); const tx=qs('#'+id+'Text'); if(led) led.className='led '+ledClass(status); if(tx) tx.textContent=text; }
async function refreshHealth(){
  try {
    const r=await api('/api/system/status');
    setLed('healthApi', r.ok?'green':'red', r.app?.message || 'Application API online');
    setLed('dashApi', r.ok?'green':'red', r.app?.message || 'Online');
    const dbOk=!!r.database?.ok; const dbWarn=r.database?.enabled===false;
    setLed('healthDb', dbOk?'green':(dbWarn?'orange':'red'), dbOk?'Online':(r.database?.message || 'Postgres database not online'));
    setLed('dashDb', dbOk?'green':(dbWarn?'orange':'red'), dbOk?'Online':(r.database?.message || 'Warning'));
    setLed('healthInternet', r.internet?.ok?'green':(r.internet?.warning?'orange':'red'), r.internet?.message || 'Checking');
    setLed('healthPreview', r.outputs?.previewOnline?'green':'orange', r.outputs?.preview || 'Open /preview page');
    setLed('healthProgram', r.outputs?.programOnline?'green':'orange', r.outputs?.program || 'Open /output page');
    setLed('healthFfmpeg', r.broadcast?.ffmpeg?.status || (r.broadcast?.ffmpeg?.ok?'green':'red'), r.broadcast?.ffmpeg?.message || 'FFmpeg Engine not configured');
    setLed('healthMediamtx', r.broadcast?.mediamtx?.status || (r.broadcast?.mediamtx?.ok?'green':'red'), r.broadcast?.mediamtx?.message || 'MediaMTX not configured');
    const containerVals = Object.values(r.containers || {});
    const activeContainers = containerVals.filter(c=>c.status !== 'grey');
    const runningCount = activeContainers.filter(c=>c.status==='green' || c.status==='yellow').length;
    const redCount = activeContainers.filter(c=>c.status==='red').length;
    const warnCount = activeContainers.filter(c=>c.status==='orange').length;
    const disabledCount = containerVals.length - activeContainers.length;
    const containerText = `${runningCount}/${activeContainers.length || 0} active services running${disabledCount ? ` · ${disabledCount} optional` : ''}`;
    setLed('healthContainers', redCount ? 'red' : (warnCount ? 'orange' : 'green'), containerText);
    setLed('healthConfig', 'green', `${r.version || 'unknown'} / config v${r.config?.exportedConfigVersion || 3}`);
    renderHealthDetails(r);
  } catch(err){ setLed('healthApi','red','Application API offline'); setLed('healthFfmpeg','red','No status'); setLed('healthMediamtx','red','No status'); }
}
function renderHealthDetails(r){
  const box = qs('#healthDetails'); if(!box) return;
  const serviceLabel = {
    app1:'RGE Controller', app2:'RGE Worker', nginx:'Nginx Reverse Proxy', postgres:'Postgres Database',
    ffmpegEngine:'FFmpeg Engine', mediamtx:'MediaMTX'
  };
  const containers = Object.entries(r.containers || {})
    .filter(([name]) => ['app1','app2','nginx','postgres','ffmpegEngine','mediamtx'].includes(name))
    .map(([name,c]) => `<tr><td><span class="led mini ${ledClass(c.status)}"></span>${serviceLabel[name] || name}</td><td>${c.status || 'unknown'}</td><td>${c.message || ''}</td></tr>`).join('')
    || '<tr><td colspan="3">No RGE services reported</td></tr>';
  const paths = (r.broadcast?.mediamtx?.paths || []).map(p => `<tr><td>${p.name || ''}</td><td>${p.ready ? 'Ready' : 'Idle'}</td><td>${p.readers || 0}</td></tr>`).join('') || '<tr><td colspan="3">No active MediaMTX paths</td></tr>';
  const jobsObj = r.broadcast?.ffmpeg?.jobs || {};
  const jobs = Object.entries(jobsObj).map(([name,j]) => `<tr><td>${name}</td><td>${j.running ? 'Running' : 'Stopped'}</td><td>${j.pid || ''}</td></tr>`).join('') || '<tr><td colspan="3">No FFmpeg jobs running</td></tr>';
  const broadcastSummary = r.broadcast?.summary || {};
  box.innerHTML = `<div class="healthTables">
    <div><h4>RGE Service Health</h4><table><thead><tr><th>Service</th><th>Status</th><th>Details</th></tr></thead><tbody>${containers}</tbody></table></div>
    <div><h4>Broadcast Status</h4><table><tbody>
      <tr><td>Input</td><td>${broadcastSummary.input || 'Idle / disconnected'}</td></tr>
      <tr><td>Graphics</td><td>${broadcastSummary.graphics || 'RGE output ready'}</td></tr>
      <tr><td>Outputs</td><td>${broadcastSummary.outputs || 'Idle'}</td></tr>
    </tbody></table></div>
    <div><h4>FFmpeg Jobs</h4><table><thead><tr><th>Job</th><th>Status</th><th>PID</th></tr></thead><tbody>${jobs}</tbody></table></div>
    <div><h4>MediaMTX Paths</h4><table><thead><tr><th>Path</th><th>Status</th><th>Readers</th></tr></thead><tbody>${paths}</tbody></table></div>
  </div>`;
}
async function refreshErrors(){
  const list=qs('#errorList'); if(!list) return;
  try {
    const r=await api('/api/error-log'); const items=r.errors||[];
    list.innerHTML = items.length ? items.map(e=>`<div class="errorItem ${e.severity||'orange'}"><span class="led ${e.severity||'orange'}"></span><div><strong>${e.kind||'system'}</strong><p>${e.message||'Unknown issue'}</p><small>${new Date(e.time).toLocaleString()}</small></div></div>`).join('') : '<div class="errorEmpty">No errors reported.</div>';
  } catch(err){ list.innerHTML='<div class="errorItem red"><span class="led red"></span><div><strong>Application API</strong><p>Cannot read error list.</p></div></div>'; }
}


// Phase 8 - Broadcast Output Manager
const DEFAULT_OUTPUT_PROFILES = {
  program: { enabled:true, label:'Program', resolution:'1920x1080', aspect:'16:9', transport:'http', url:'/output/live', notes:'Main live graphics output for encoder or mixer browser source.' },
  preview: { enabled:true, label:'Preview', resolution:'1920x1080', aspect:'16:9', transport:'http', url:'/preview/live', notes:'Safe preview output for checking before TAKE.' },
  ndi: { enabled:false, label:'NDI', resolution:'1920x1080', aspect:'16:9', transport:'ndi', url:'', notes:'Use the Program URL with an external browser-to-NDI tool.' },
  srt: { enabled:false, label:'SRT', resolution:'1920x1080', aspect:'16:9', transport:'srt', url:'', notes:'Reserved profile for SRT output workflow.' },
  youtube: { enabled:false, label:'YouTube', resolution:'1920x1080', aspect:'16:9', transport:'rtmp', url:'', notes:'Store destination/encoder notes here. Keep stream keys private.' },
  facebook: { enabled:false, label:'Facebook', resolution:'1920x1080', aspect:'16:9', transport:'rtmp', url:'', notes:'Store destination/encoder notes here. Keep stream keys private.' },
  twitch: { enabled:false, label:'Twitch', resolution:'1920x1080', aspect:'16:9', transport:'rtmp', url:'', notes:'Store destination/encoder notes here. Keep stream keys private.' },
  social: { enabled:false, label:'Social Vertical', resolution:'1080x1920', aspect:'9:16', transport:'http', url:'/output/live?profile=social', notes:'Reference profile for future social/vertical workflow.' }
};
let outputSettings = { ...DEFAULT_OUTPUT_PROFILES };
const OUTPUT_ORDER = ['program','preview','ndi','srt','youtube','facebook','twitch','social'];
function absoluteOutputUrl(value){
  const v = String(value || '').trim();
  if(!v) return '';
  if(/^https?:\/\//i.test(v) || /^srt:|^rtmp:|^ndi:/i.test(v)) return v;
  const host = location.hostname || 'localhost';
  if(v.startsWith('/output') || v.startsWith('/preview')) return `http://${host}:8080${v}`;
  if(v.startsWith('/')) return location.origin + v;
  return v;
}
function renderOutputProfiles(){
  const grid = qs('#outputProfileGrid'); if(!grid) return;
  grid.innerHTML = '';
  OUTPUT_ORDER.forEach(key => {
    const p = { ...(DEFAULT_OUTPUT_PROFILES[key] || {}), ...((outputSettings || {})[key] || {}) };
    const card = document.createElement('div');
    card.className = 'outputProfileCard';
    card.dataset.outputKey = key;
    card.innerHTML = `
      <div class="outputProfileHead">
        <strong>${p.label || key}</strong>
        <label class="outputProfileStatus"><span class="led ${p.enabled ? 'green':'orange'}"></span><input data-output-field="enabled" type="checkbox" ${p.enabled ? 'checked':''}> Enabled</label>
      </div>
      <label>Name <input data-output-field="label" value="${String(p.label||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"></label>
      <div class="designerGrid twoCol">
        <label>Resolution <select data-output-field="resolution">
          ${['1920x1080','1280x720','3840x2160','1080x1920','custom'].map(x=>`<option value="${x}" ${p.resolution===x?'selected':''}>${x}</option>`).join('')}
        </select></label>
        <label>Aspect <select data-output-field="aspect">
          ${['16:9','4:3','9:16','1:1','custom'].map(x=>`<option value="${x}" ${p.aspect===x?'selected':''}>${x}</option>`).join('')}
        </select></label>
      </div>
      <label>Transport <select data-output-field="transport">
        ${['http','ndi','srt','rtmp','webrtc','hls','other'].map(x=>`<option value="${x}" ${p.transport===x?'selected':''}>${x.toUpperCase()}</option>`).join('')}
      </select></label>
      <label>URL / destination <input data-output-field="url" value="${String(p.url||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;')}" placeholder="/output/live, srt://, rtmp://, NDI name..."></label>
      <div class="outputProfileUrl" title="${absoluteOutputUrl(p.url)}">${absoluteOutputUrl(p.url) || 'No URL configured'}</div>
      <label>Notes <textarea data-output-field="notes">${String(p.notes||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</textarea></label>
      <div class="outputProfileActions">
        <button class="outline" data-output-action="open" type="button">Open</button>
        <button class="outline" data-output-action="copy" type="button">Copy URL</button>
      </div>`;
    card.querySelectorAll('[data-output-field]').forEach(input => input.addEventListener('input', readOutputProfilesFromDom));
    card.querySelectorAll('select,[type="checkbox"]').forEach(input => input.addEventListener('change', readOutputProfilesFromDom));
    const openBtn = card.querySelector('[data-output-action="open"]');
    const copyBtn = card.querySelector('[data-output-action="copy"]');
    openBtn.onclick = () => { const url = absoluteOutputUrl((outputSettings[key]||{}).url); if(url && /^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener'); else alert('This profile is not a browser URL. Copy it to your encoder/tool.'); };
    copyBtn.onclick = async () => { const url = absoluteOutputUrl((outputSettings[key]||{}).url); await navigator.clipboard.writeText(url); const old=copyBtn.textContent; copyBtn.textContent='Copied'; setTimeout(()=>copyBtn.textContent=old,1000); };
    grid.appendChild(card);
  });
}
function readOutputProfilesFromDom(){
  const next = { ...(outputSettings || {}) };
  qsa('.outputProfileCard').forEach(card => {
    const key = card.dataset.outputKey;
    next[key] = next[key] || {};
    card.querySelectorAll('[data-output-field]').forEach(input => {
      const field = input.dataset.outputField;
      next[key][field] = input.type === 'checkbox' ? input.checked : input.value;
    });
  });
  outputSettings = next;
  qsa('.outputProfileCard').forEach(card => {
    const key=card.dataset.outputKey; const p=outputSettings[key]||{};
    const led=card.querySelector('.led'); if(led) led.className='led '+(p.enabled?'green':'orange');
    const urlBox=card.querySelector('.outputProfileUrl'); if(urlBox){ urlBox.textContent=absoluteOutputUrl(p.url)||'No URL configured'; urlBox.title=absoluteOutputUrl(p.url); }
  });
}
async function loadOutputSettings(){
  const r = await api('/api/output-settings');
  if(r.ok) outputSettings = { ...DEFAULT_OUTPUT_PROFILES, ...(r.settings || {}) };
  renderOutputProfiles();
}
async function saveOutputSettings(){
  readOutputProfilesFromDom();
  const r = await api('/api/output-settings', { method:'POST', body:JSON.stringify({ settings:outputSettings }) });
  if(r.ok){ outputSettings = { ...DEFAULT_OUTPUT_PROFILES, ...(r.settings || {}) }; renderOutputProfiles(); setTwoStepHint('Output profiles saved. Renderer layout was not changed.'); }
}
async function resetOutputSettings(){
  if(!confirm('Restore default output profiles?')) return;
  const r = await api('/api/output-settings/reset', { method:'POST', body:'{}' });
  if(r.ok){ outputSettings = { ...DEFAULT_OUTPUT_PROFILES, ...(r.settings || {}) }; renderOutputProfiles(); }
}
function setupOutputManager(){
  qs('#outputSave') && (qs('#outputSave').onclick = saveOutputSettings);
  qs('#outputReset') && (qs('#outputReset').onclick = resetOutputSettings);
  qs('#outputRefresh') && (qs('#outputRefresh').onclick = loadOutputSettings);
  loadOutputSettings();
}

async function clearErrorList(){ await api('/api/error-log/clear',{method:'POST',body:'{}'}); refreshErrors(); }
window.addEventListener('DOMContentLoaded', () => {
  setupWorkflowDesigner();
  setupOutputManager();
  loadUiSettings();
  loadGraphicsPresets();
  setupShortcutKeys();
  refreshHealth();
  refreshErrors();
  qs('#refreshHealth') && (qs('#refreshHealth').onclick=refreshHealth);
  qs('#refreshErrors') && (qs('#refreshErrors').onclick=refreshErrors);
  qs('#clearErrors') && (qs('#clearErrors').onclick=clearErrorList);
  qs('#saveShortcuts') && (qs('#saveShortcuts').onclick=saveUiSettings);
  qs('#resetShortcuts') && (qs('#resetShortcuts').onclick=async()=>{ uiSettings.shortcuts={...WORKFLOW_DEFAULT_SHORTCUTS}; renderShortcuts(); await saveUiSettings(); });
  setInterval(refreshHealth, 5000);
});
window.addEventListener('DOMContentLoaded', () => {
  qsa('.nav[data-target]').forEach(btn => btn.addEventListener('click', () => {
    if(btn.dataset.target === 'health') scrollToCard('#healthCard');
    if(btn.dataset.target === 'logs') scrollToCard('#errorCard');
  }));
});

qsa('.layerBtn').forEach(btn => btn.onclick = () => takeLayer(btn.dataset.layer));
qsa('.layerCutBtn').forEach(btn => btn.onclick = () => cutLayer(btn.dataset.layer, btn.dataset.target || 'program'));
qsa('.layerCutBothBtn').forEach(btn => btn.onclick = () => cutLayerBoth(btn.dataset.layer));
qs('#cutMainPreview') && (qs('#cutMainPreview').onclick = () => clearMainGraphic('preview'));
qs('#cutMainProgram') && (qs('#cutMainProgram').onclick = () => clearMainGraphic('program'));
qs('#cutMainBoth') && (qs('#cutMainBoth').onclick = () => clearMainGraphic('both'));
qsa('.mainTypeCutBtn').forEach(btn => btn.onclick = () => clearMainGraphicType(btn.dataset.cutType, btn.dataset.cutTarget || 'program'));

// Phase 9 - Broadcast Engine
const DEFAULT_BROADCAST_ENGINE_CONFIG = {
  ffmpegPath: 'ffmpeg', inputUrl: 'http://app1:3000/output/live', incoming:{ protocol:'rtmp', url:'rtmp://mediamtx:1935/live', mediamtxPath:'live', enabled:true, overlayEnabled:true, notes:'' }, width: 1920, height: 1080, frameRate: 50, videoBitrate: '6000k', audioBitrate: '160k',
  outputs: {
    ndi: { enabled:false, label:'NDI Program', inputUrl:'', destination:'RGE PROGRAM', extraArgs:'' },
    srt: { enabled:false, label:'SRT Program', inputUrl:'', destination:'srt://127.0.0.1:9999?mode=caller&latency=120000', extraArgs:'' },
    youtube_graphics_primary: { enabled:false, label:'Graphics Only → YouTube PRIMARY', inputUrl:'http://app1:3000/output/live', destination:'rtmp://a.rtmp.youtube.com/live2/PRIMARY_STREAM_KEY', extraArgs:'' },
    youtube_graphics_backup: { enabled:false, label:'Graphics Only → YouTube BACKUP', inputUrl:'http://app1:3000/output/live', destination:'rtmp://b.rtmp.youtube.com/live2/BACKUP_STREAM_KEY', extraArgs:'' },
    youtube: { enabled:false, label:'Graphics only → YouTube RTMP (legacy)', inputUrl:'http://app1:3000/output/live', destination:'rtmp://a.rtmp.youtube.com/live2/STREAM_KEY', extraArgs:'' },
    facebook: { enabled:false, label:'Facebook RTMP', inputUrl:'', destination:'rtmps://live-api-s.facebook.com:443/rtmp/STREAM_KEY', extraArgs:'' },
    twitch: { enabled:false, label:'Twitch RTMP', inputUrl:'', destination:'rtmp://live.twitch.tv/app/STREAM_KEY', extraArgs:'' },
    mediamtx_graphics: { enabled:false, label:'Publish graphics-only to MediaMTX', inputUrl:'http://app1:3000/output/live', destination:'rtmp://mediamtx:1935/rge_graphics', extraArgs:'' },
    youtube_overlay_primary: { enabled:false, label:'MAIN: Incoming stream + RGE graphics → YouTube PRIMARY', inputUrl:'rtmp://mediamtx:1935/live', destination:'rtmp://a.rtmp.youtube.com/live2/PRIMARY_STREAM_KEY', extraArgs:'' },
    youtube_overlay_backup: { enabled:false, label:'MAIN: Incoming stream + RGE graphics → YouTube BACKUP', inputUrl:'rtmp://mediamtx:1935/live', destination:'rtmp://b.rtmp.youtube.com/live2/BACKUP_STREAM_KEY', extraArgs:'' },
    youtube_overlay: { enabled:false, label:'MAIN: MediaMTX input + RGE graphics → YouTube (legacy)', inputUrl:'rtmp://mediamtx:1935/live', destination:'rtmp://a.rtmp.youtube.com/live2/STREAM_KEY', extraArgs:'' },
    youtube_passthrough: { enabled:false, label:'MediaMTX input only → YouTube', inputUrl:'rtmp://mediamtx:1935/live', destination:'rtmp://a.rtmp.youtube.com/live2/STREAM_KEY', extraArgs:'' },
    recorder: { enabled:false, label:'Local MP4 Recorder', inputUrl:'', destination:'recordings/rge-program.mp4', extraArgs:'' }
  }
};
const BROADCAST_OUTPUT_ORDER = ['youtube_overlay_primary','youtube_overlay_backup','youtube_graphics_primary','youtube_graphics_backup','youtube_overlay','youtube_passthrough','mediamtx_graphics','ndi','srt','youtube','facebook','twitch','recorder'];
let broadcastEngine = JSON.parse(JSON.stringify(DEFAULT_BROADCAST_ENGINE_CONFIG));
let broadcastStatus = {};
function mergeBroadcastEngine(config){
  const base = JSON.parse(JSON.stringify(DEFAULT_BROADCAST_ENGINE_CONFIG));
  const next = { ...base, ...(config || {}) };
  next.incoming = { ...base.incoming, ...(((config || {}).incoming) || {}) };
  next.outputs = { ...base.outputs, ...((config || {}).outputs || {}) };
  BROADCAST_OUTPUT_ORDER.forEach(k => { next.outputs[k] = { ...base.outputs[k], ...(((config || {}).outputs || {})[k] || {}) }; });
  return next;
}
function readBroadcastEngineFromDom(){
  const get = id => qs('#'+id)?.value;
  broadcastEngine.ffmpegPath = get('be_ffmpegPath') || 'ffmpeg';
  broadcastEngine.inputUrl = get('be_inputUrl') || '';
  broadcastEngine.width = Number(get('be_width') || 1920);
  broadcastEngine.height = Number(get('be_height') || 1080);
  broadcastEngine.frameRate = Number(get('be_frameRate') || 50);
  broadcastEngine.videoBitrate = get('be_videoBitrate') || '6000k';
  broadcastEngine.audioBitrate = get('be_audioBitrate') || '160k';
  broadcastEngine.incoming = broadcastEngine.incoming || {};
  broadcastEngine.incoming.protocol = get('be_incomingProtocol') || 'rtmp';
  broadcastEngine.incoming.url = get('be_incomingUrl') || 'rtmp://mediamtx:1935/live';
  broadcastEngine.incoming.mediamtxPath = get('be_mediamtxPath') || 'live';
  broadcastEngine.incoming.enabled = !!qs('#be_incomingEnabled')?.checked;
  broadcastEngine.incoming.overlayEnabled = !!qs('#be_overlayEnabled')?.checked;
  broadcastEngine.incoming.notes = get('be_incomingNotes') || '';
  qsa('.broadcastOutputCard').forEach(card => {
    const key = card.dataset.broadcastKey;
    broadcastEngine.outputs[key] = broadcastEngine.outputs[key] || {};
    card.querySelectorAll('[data-be-field]').forEach(input => {
      const field = input.dataset.beField;
      broadcastEngine.outputs[key][field] = input.type === 'checkbox' ? input.checked : input.value;
    });
  });
}
function paintBroadcastEngine(){
  const set = (id,val)=>{ const el=qs('#'+id); if(el) el.value = val ?? ''; };
  set('be_ffmpegPath', broadcastEngine.ffmpegPath || 'ffmpeg');
  set('be_inputUrl', broadcastEngine.inputUrl || '');
  set('be_width', broadcastEngine.width || 1920);
  set('be_height', broadcastEngine.height || 1080);
  set('be_frameRate', broadcastEngine.frameRate || 50);
  set('be_videoBitrate', broadcastEngine.videoBitrate || '6000k');
  set('be_audioBitrate', broadcastEngine.audioBitrate || '160k');
  set('be_incomingProtocol', broadcastEngine.incoming?.protocol || 'rtmp');
  set('be_incomingUrl', broadcastEngine.incoming?.url || 'rtmp://mediamtx:1935/live');
  set('be_mediamtxPath', broadcastEngine.incoming?.mediamtxPath || 'live');
  set('be_incomingNotes', broadcastEngine.incoming?.notes || '');
  const ie = qs('#be_incomingEnabled'); if(ie) ie.checked = !!broadcastEngine.incoming?.enabled;
  const oe = qs('#be_overlayEnabled'); if(oe) oe.checked = broadcastEngine.incoming?.overlayEnabled !== false;
  const grid = qs('#broadcastEngineGrid'); if(!grid) return;
  grid.innerHTML = '';
  BROADCAST_OUTPUT_ORDER.forEach(key => {
    const p = broadcastEngine.outputs[key] || {};
    const st = broadcastStatus[key] || {};
    const running = !!st.running;
    const card = document.createElement('div');
    card.className = 'broadcastOutputCard';
    card.dataset.broadcastKey = key;
    card.innerHTML = `
      <div class="broadcastOutputHead">
        <strong>${escapeHtml(p.label || key)}</strong>
        <span class="broadcastStatusPill"><span class="led ${running?'green':'orange'}"></span>${running ? 'Running PID '+(st.pid||'') : 'Stopped'}</span>
      </div>
      <label class="outputProfileStatus"><input data-be-field="enabled" type="checkbox" ${p.enabled?'checked':''}> Enabled in profile</label>
      <label>Name <input data-be-field="label" value="${escapeAttr(p.label || '')}"></label>
      <label>Input override <input data-be-field="inputUrl" value="${escapeAttr(p.inputUrl || '')}" placeholder="Leave empty to use global input"></label>
      <label>Destination <input data-be-field="destination" value="${escapeAttr(p.destination || '')}" placeholder="NDI name, srt://, rtmp://, file path"></label>
      <label>Extra FFmpeg Args <input data-be-field="extraArgs" value="${escapeAttr(p.extraArgs || '')}" placeholder="optional"></label>
      <div class="broadcastOutputActions">
        <button class="green" data-be-action="start" type="button" ${running?'disabled':''}>Start</button>
        <button class="red" data-be-action="stop" type="button" ${running?'':'disabled'}>Stop</button>
        <button class="outline" data-be-action="copy" type="button">Copy Destination</button>
      </div>
      <div class="broadcastLog">${escapeHtml((st.logs || []).join('\n') || 'No engine log yet.')}</div>`;
    card.querySelectorAll('[data-be-field]').forEach(el => el.addEventListener('input', readBroadcastEngineFromDom));
    card.querySelectorAll('select,[type="checkbox"]').forEach(el => el.addEventListener('change', readBroadcastEngineFromDom));
    card.querySelector('[data-be-action="start"]').onclick = () => startBroadcastOutput(key);
    card.querySelector('[data-be-action="stop"]').onclick = () => stopBroadcastOutput(key);
    card.querySelector('[data-be-action="copy"]').onclick = async () => { readBroadcastEngineFromDom(); await navigator.clipboard.writeText((broadcastEngine.outputs[key]||{}).destination || ''); };
    grid.appendChild(card);
  });
}
function escapeHtml(s){ return String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,'&quot;'); }
async function loadBroadcastEngine(){
  const r = await api('/api/broadcast-engine');
  if(r.ok){ broadcastEngine = mergeBroadcastEngine(r.config); broadcastStatus = r.status || {}; paintBroadcastEngine(); }
}
async function saveBroadcastEngine(){
  readBroadcastEngineFromDom();
  const r = await api('/api/broadcast-engine', { method:'POST', body: JSON.stringify({ config: broadcastEngine }) });
  if(r.ok){ broadcastEngine = mergeBroadcastEngine(r.config); broadcastStatus = r.status || {}; paintBroadcastEngine(); setTwoStepHint('Broadcast Engine config saved.'); }
}
async function startBroadcastOutput(key){
  readBroadcastEngineFromDom();
  await api('/api/broadcast-engine', { method:'POST', body: JSON.stringify({ config: broadcastEngine }) });
  const r = await api('/api/broadcast-engine/start/'+encodeURIComponent(key), { method:'POST', body:'{}' });
  if(!r.ok) alert(r.error || 'Could not start output');
  broadcastStatus = r.status || broadcastStatus; paintBroadcastEngine(); setTimeout(loadBroadcastEngine, 900);
}
async function stopBroadcastOutput(key){
  const r = await api('/api/broadcast-engine/stop/'+encodeURIComponent(key), { method:'POST', body:'{}' });
  broadcastStatus = r.status || broadcastStatus; paintBroadcastEngine(); setTimeout(loadBroadcastEngine, 400);
}
async function stopAllBroadcastOutputs(){
  const r = await api('/api/broadcast-engine/stop-all', { method:'POST', body:'{}' });
  broadcastStatus = r.status || broadcastStatus; paintBroadcastEngine();
}
async function startYouTubePair(mode){
  readBroadcastEngineFromDom();
  await api('/api/broadcast-engine', { method:'POST', body: JSON.stringify({ config: broadcastEngine }) });
  const r = await api('/api/broadcast-engine/start-youtube/'+encodeURIComponent(mode), { method:'POST', body:'{}' });
  if(!r.ok) alert(r.error || 'Failed to start YouTube pair');
  broadcastStatus = r.status || broadcastStatus; paintBroadcastEngine(); setTimeout(loadBroadcastEngine, 900);
}

function setIncomingUrl(url, protocol='rtmp') {
  broadcastEngine.incoming = broadcastEngine.incoming || {};
  broadcastEngine.incoming.url = url;
  broadcastEngine.incoming.protocol = protocol;
  if (qs('#be_incomingUrl')) qs('#be_incomingUrl').value = url;
  if (qs('#be_incomingProtocol')) qs('#be_incomingProtocol').value = protocol;
  readBroadcastEngineFromDom();
}
async function applyIncomingToOverlayOutputs(){
  readBroadcastEngineFromDom();
  const incoming = broadcastEngine.incoming?.url || 'rtmp://mediamtx:1935/live';
  ['youtube_overlay_primary','youtube_overlay_backup','youtube_overlay','youtube_passthrough'].forEach(k => {
    broadcastEngine.outputs[k] = broadcastEngine.outputs[k] || {};
    broadcastEngine.outputs[k].inputUrl = incoming;
  });
  const r = await api('/api/broadcast-engine/apply-incoming', { method:'POST', body: JSON.stringify({ config: broadcastEngine }) });
  if(r.ok){ broadcastEngine = mergeBroadcastEngine(r.config); broadcastStatus = r.status || {}; paintBroadcastEngine(); setTwoStepHint('Incoming stream applied to overlay outputs.'); }
  else alert(r.error || 'Could not apply incoming stream');
}
function openIncomingPreview(){
  readBroadcastEngineFromDom();
  const path = (broadcastEngine.incoming?.mediamtxPath || 'live').replace(/[^a-zA-Z0-9_-]/g,'') || 'live';
  window.open(`http://${location.hostname}:8888/${path}/`, '_blank');
}

function setupBroadcastEngine(){
  if(!qs('#broadcastEngineCard')) return;
  qs('#beSave') && (qs('#beSave').onclick = saveBroadcastEngine);
  qs('#beRefresh') && (qs('#beRefresh').onclick = loadBroadcastEngine);
  qs('#beStopAll') && (qs('#beStopAll').onclick = stopAllBroadcastOutputs);
  qs('#beStartYoutubeMainPair') && (qs('#beStartYoutubeMainPair').onclick = () => startYouTubePair('main'));
  qs('#beStartYoutubeGraphicsPair') && (qs('#beStartYoutubeGraphicsPair').onclick = () => startYouTubePair('graphics'));
  qs('#beUseIncomingForOverlay') && (qs('#beUseIncomingForOverlay').onclick = applyIncomingToOverlayOutputs);
  qs('#beSetRtmpLive') && (qs('#beSetRtmpLive').onclick = () => setIncomingUrl('rtmp://mediamtx:1935/live','rtmp'));
  qs('#beSetRtspLive') && (qs('#beSetRtspLive').onclick = () => setIncomingUrl('rtsp://mediamtx:8554/live','rtsp'));
  qs('#beSetSrtLive') && (qs('#beSetSrtLive').onclick = () => setIncomingUrl('srt://mediamtx:8890?streamid=read:live','srt'));
  qs('#bePreviewIncoming') && (qs('#bePreviewIncoming').onclick = openIncomingPreview);
  if (typeof socket !== 'undefined' && socket) socket.on('broadcastEngine', data => { if(data.config) broadcastEngine = mergeBroadcastEngine(data.config); if(data.status) broadcastStatus = data.status; paintBroadcastEngine(); });
  loadBroadcastEngine();
}
window.addEventListener('DOMContentLoaded', setupBroadcastEngine);
