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

function withToken(path){ if (!token) return path; return path + (path.includes('?') ? `&token=${encodeURIComponent(token)}` : `?token=${encodeURIComponent(token)}`); }
function api(path, opts={}){ return fetch(withToken(path), {headers:{'content-type':'application/json',...auth},...opts}).then(r=>r.json()); }
function outputOrigin(){
  const host = location.hostname || 'localhost';
  return `http://${host}:8080`;
}
function outputUrl(){ return outputOrigin() + '/output/live' + tokenPart; }
function previewUrl(){ return location.origin + '/preview/live' + tokenPart; }
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
      b.onclick = ()=>{ if(selectedType!=='stageTimes') selectedType='stage'; selectedStage=i; selectedPage=1; updateActive(); loadTotalsForSelection(true); };
      box.appendChild(b);
    }
  });
  const sel = qs('#stageSelect');
  if(sel){ sel.innerHTML=''; for(let i=1;i<=20;i++){ const o=document.createElement('option'); o.value=i; o.textContent='Stage '+i; sel.appendChild(o); } sel.onchange=()=>{ selectedStage=Number(sel.value); if(selectedType!=='stageTimes') selectedType='stage'; selectedPage=1; updateActive(); loadTotalsForSelection(true); }; }
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
    const pages = totalPagesFor(selectedType, selectedStage);
    for(let p=1;p<=pages;p++){
      const b=document.createElement('button');
      const start=(p-1)*pageSize+1, end=Math.min(p*pageSize, totalFor(selectedType, selectedStage)||p*pageSize);
      b.textContent=String(p);
      b.title=`${labelFor(selectedType, selectedStage, p)}: ${start}-${end}`;
      b.className = p===selectedPage ? 'active' : '';
      b.onclick=()=>take(selectedType, selectedStage, p);
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
  }
  selectedPage = Math.min(selectedPage, totalPagesFor(selectedType, selectedStage));
  renderPageButtons();
  if(autoTake) await take(selectedType, selectedStage, selectedPage);
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
async function take(type=selectedType, stageId=selectedStage, page=selectedPage){
  selectedType=type; selectedPage=Math.max(1, Number(page||1));
  if(type==='stage' || type==='stageTimes') selectedStage=Number(stageId||selectedStage||1);
  if(type!=='stage' && type!=='stageTimes') stageId=0;
  pageSize = Number(qs('#pageSize')?.value || 10);
  updateActive(); renderPageButtons();
  await api('/api/take',{method:'POST',body:JSON.stringify({type,stageId:selectedStage,page:selectedPage,pageSize,title:labelFor(type, selectedStage, selectedPage),target:selectedTakeTarget()})});
  setLastUpdated();
}
async function clearGraphic(){ await api('/api/take',{method:'POST',body:JSON.stringify({type:'blank',stageId:selectedStage,page:1,pageSize,target:selectedTakeTarget()})}); setLastUpdated(); }
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

socket.on('state', s=>{ state=s; const e=qs('#eventId'); if(e) e.value=s.eventId; if(s.graphic?.type && s.graphic.type!=='blank') selectedType=s.graphic.type; if(s.graphic?.stageId) selectedStage=Number(s.graphic.stageId); if(s.graphic?.page) selectedPage=Number(s.graphic.page); updateActive(); renderPageButtons(); });

qsa('[data-type]').forEach(b=>b.onclick=()=>{selectedType=b.dataset.type; selectedPage=1; loadTotalsForSelection(true);});
qsa('[data-target="stage"]').forEach(b=>b.onclick=()=>{selectedType='stage'; selectedPage=1; updateActive(); loadTotalsForSelection(true);});
qs('#saveEvent') && (qs('#saveEvent').onclick=loadEvent);
qs('#refreshData') && (qs('#refreshData').onclick=()=>loadTotalsForSelection(true));
qs('#clearGraphic') && (qs('#clearGraphic').onclick=clearGraphic);
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

setOutputFields(); initStages(); updateActive(); loadEvent(); startAutoRefresh();

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
    if(target === 'scenes') scrollToCard('#sceneManagerCard');
    if(target === 'outputs') scrollToCard('#graphicsCard');
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
  animationSpeed: 1, animationDuration: 280, easing: 'ease-out', radius: 0
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
  qsa('[data-gs]').forEach(input => {
    const handler = () => {
      const key = input.dataset.gs;
      graphicsSettings[key] = input.type === 'number' || input.type === 'range' ? Number(input.value) : input.value;
      const out = qs(`#gs_${key}_value`); if (out) out.textContent = graphicsValueText(key, graphicsSettings[key]);
      saveGraphicsSettings(false);
    };
    input.addEventListener('input', handler);
    input.addEventListener('change', () => saveGraphicsSettings(true));
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
let sceneState = null;
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
  const be = qs('#bugEnabled'); if(be) be.checked = !!bug.enabled;
  const bt = qs('#bugText'); if(bt) bt.value = bug.text || '';
  const ce = qs('#clockEnabled'); if(ce) ce.checked = !!(layers.clock && layers.clock.enabled);
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
  const layers = {
    main: { enabled:true, opacity:Number(qs('#mainLayerOpacity')?.value || 100) },
    bug: { enabled:!!qs('#bugEnabled')?.checked, opacity:100, text:qs('#bugText')?.value || '' },
    clock: { enabled:!!qs('#clockEnabled')?.checked, opacity:100 }
  };
  const r = await api('/api/scene/layers', { method:'POST', body:JSON.stringify({layers}) });
  if(r.ok){ sceneState = r.scene; renderSceneManager(); }
}
function setupSceneManager(){
  qs('#sceneManagerNav') && (qs('#sceneManagerNav').onclick = () => scrollToCard('#sceneManagerCard'));
  qs('#previewCurrent') && (qs('#previewCurrent').onclick = previewCurrent);
  qs('#takePreview') && (qs('#takePreview').onclick = takePreviewToProgram);
  qs('#clearProgram') && (qs('#clearProgram').onclick = clearProgramScene);
  qs('#sceneTransition') && (qs('#sceneTransition').onchange = async e => { const r=await api('/api/scene/transition',{method:'POST',body:JSON.stringify({transition:e.target.value})}); if(r.ok){sceneState=r.scene; renderSceneManager();} });
  ['#mainLayerOpacity','#bugEnabled','#bugText','#clockEnabled'].forEach(id => {
    const el=qs(id); if(!el) return;
    el.addEventListener('input', saveSceneLayers);
    el.addEventListener('change', saveSceneLayers);
  });
  qs('#runMacroClear') && (qs('#runMacroClear').onclick = async () => { await api('/api/macros/run',{method:'POST',body:JSON.stringify({index:0})}); });
  qs('#runMacroTake') && (qs('#runMacroTake').onclick = async () => { await api('/api/macros/run',{method:'POST',body:JSON.stringify({index:1})}); });
  loadScene();
}
socket.on('state', s=>{ if(s?.scene){ sceneState=s.scene; renderSceneManager(); } });
window.addEventListener('DOMContentLoaded', setupSceneManager);
