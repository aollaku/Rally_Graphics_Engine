const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const session = require('express-session');
const { Server } = require('socket.io');
const scraper = require('./scraper');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const INSTANCE_ID = process.env.INSTANCE_ID || require('os').hostname();
const DEFAULT_EVENT_ID = process.env.DEFAULT_EVENT_ID || '757';
const PUBLIC_TOKEN = process.env.PUBLIC_TOKEN || '';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 15000);
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-rally-graphics-session-secret';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const DEFAULT_GRAPHICS_SETTINGS = {
  scale: 1,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  opacity: 100,
  backgroundOpacity: 100,
  borderOpacity: 100,
  shadowOpacity: 0,
  blur: 0,
  brightness: 100,
  contrast: 100,
  animationSpeed: 1,
  animationDuration: 280,
  easing: 'ease-out',
  radius: 0,
  updatedAt: new Date().toISOString()
};


const DEFAULT_SCENE_STATE = {
  preview: { type: 'blank', stageId: 0, page: 1, pageSize: 10, title: '' },
  program: null,
  transition: 'fade',
  layers: {
    background: { enabled: true, opacity: 100 },
    main: { enabled: true, opacity: 100 },
    bug: { enabled: false, opacity: 100, text: '' },
    clock: { enabled: false, opacity: 100 }
  },
  macros: [
    { name: 'Clear Program', actions: [{ type: 'clear' }] },
    { name: 'Take Preview', actions: [{ type: 'takePreview' }] }
  ],
  updatedAt: new Date().toISOString()
};
function normaliseGraphic(g={}){
  return {
    type: g.type || 'blank',
    stageId: Number(g.stageId || 0),
    page: Math.max(1, Number(g.page || 1)),
    pageSize: Math.max(1, Math.min(20, Number(g.pageSize || 10))),
    title: g.title || '',
    updatedAt: g.updatedAt || new Date().toISOString()
  };
}
function normaliseScene(input={}){
  const s = { ...DEFAULT_SCENE_STATE, ...(input || {}) };
  return {
    preview: normaliseGraphic(s.preview || {}),
    program: s.program ? normaliseGraphic(s.program) : null,
    transition: ['cut','fade','slide','wipe'].includes(s.transition) ? s.transition : 'fade',
    layers: {
      ...DEFAULT_SCENE_STATE.layers,
      ...(s.layers || {})
    },
    macros: Array.isArray(s.macros) ? s.macros.slice(0, 50) : DEFAULT_SCENE_STATE.macros,
    updatedAt: new Date().toISOString()
  };
}

let state = {
  eventId: DEFAULT_EVENT_ID,
  scene: { ...DEFAULT_SCENE_STATE },
  graphic: { type: 'blank', stageId: 0, page: 1, pageSize: 10, title: '', updatedAt: new Date().toISOString() },
  graphicsSettings: { ...DEFAULT_GRAPHICS_SETTINGS },
};
function normaliseGraphicsSettings(input={}){
  const s = { ...DEFAULT_GRAPHICS_SETTINGS, ...(input || {}) };
  const num = (v,min,max,def) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def; };
  return {
    scale: num(s.scale, 0.1, 3, 1),
    x: num(s.x, -3000, 3000, 0),
    y: num(s.y, -3000, 3000, 0),
    width: num(s.width, 320, 7680, 1920),
    height: num(s.height, 240, 4320, 1080),
    opacity: num(s.opacity, 0, 100, 100),
    backgroundOpacity: num(s.backgroundOpacity, 0, 100, 100),
    borderOpacity: num(s.borderOpacity, 0, 100, 100),
    shadowOpacity: num(s.shadowOpacity, 0, 100, 0),
    blur: num(s.blur, 0, 30, 0),
    brightness: num(s.brightness, 0, 200, 100),
    contrast: num(s.contrast, 0, 200, 100),
    animationSpeed: num(s.animationSpeed, 0.1, 5, 1),
    animationDuration: num(s.animationDuration, 0, 5000, 280),
    easing: ['linear','ease','ease-in','ease-out','ease-in-out','cubic-bezier(.34,1.56,.64,1)'].includes(s.easing) ? s.easing : 'ease-out',
    radius: num(s.radius, 0, 80, 0),
    updatedAt: new Date().toISOString()
  };
}
async function loadSharedState(){
  try { state = await db.getAppState(state); } catch (err) { console.warn('Could not load shared state:', err.message); }
  state.graphicsSettings = normaliseGraphicsSettings(state.graphicsSettings);
  state.scene = normaliseScene(state.scene);
  return state;
}
async function saveSharedState(){
  try { await db.saveAppState(state); } catch (err) { console.warn('Could not save shared state:', err.message); }
  return state;
}

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(morgan('tiny'));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  name: 'rally.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 }
}));

function safeFileName(name){ return String(name || '').replace(/[^a-zA-Z0-9_.-]/g, ''); }
function isLoggedIn(req){ return Boolean(req.session && req.session.user); }
function isAdmin(req){ return isLoggedIn(req) && req.session.user.role === 'admin'; }
function wantsHtml(req){ return String(req.headers.accept || '').includes('text/html'); }
function requireLogin(req, res, next){
  if (isLoggedIn(req)) return next();
  if (wantsHtml(req)) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl || '/controller'));
  return res.status(401).json({ ok:false, error:'Login required' });
}
function requireAdmin(req, res, next){
  if (isAdmin(req)) return next();
  return res.status(403).json({ ok:false, error:'Admin access required' });
}
function requireToken(req, res, next) {
  if (!PUBLIC_TOKEN) return next();
  const token = req.query.token || req.headers['x-rally-token'];
  if (token === PUBLIC_TOKEN) return next();
  return res.status(401).json({ ok: false, error: 'Unauthorized' });
}
function requireControl(req, res, next){
  if (isLoggedIn(req)) return next();
  return requireToken(req, res, next);
}
function loginHtml(error='', next='/controller'){
  const err = error ? `<div class="loginError">${String(error).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rally Graphics Login</title><link rel="stylesheet" href="/style.css"></head><body class="loginPage"><form class="loginCard" method="post" action="/login"><div class="loginLogo">RG</div><h1>Rally Graphics</h1><p>Sign in to continue</p>${err}<input type="hidden" name="next" value="${String(next).replace(/"/g,'&quot;')}"><label>Username</label><input name="username" autocomplete="username" required autofocus><label>Password</label><input name="password" type="password" autocomplete="current-password" required><button class="blue" type="submit">Login</button></form></body></html>`;
}

app.get('/controller.html', requireLogin, (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'controller.html')));
app.get('/tablet.html', requireLogin, (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'tablet.html')));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

app.get('/login', (req, res) => res.send(loginHtml('', req.query.next || '/controller')));
app.post('/login', async (req, res) => {
  try {
    const user = await db.authenticate(req.body.username, req.body.password);
    if (!user) return res.status(401).send(loginHtml('Invalid username or password', req.body.next || '/controller'));
    req.session.user = user;
    await db.audit('login', { username: user.username, role: user.role });
    res.redirect(req.body.next || '/controller');
  } catch (err) {
    res.status(500).send(loginHtml(err.message, req.body.next || '/controller'));
  }
});
app.post('/logout', requireLogin, async (req, res) => {
  const user = req.session.user;
  req.session.destroy(() => {});
  await db.audit('logout', { username: user?.username });
  res.json({ ok:true });
});
app.get('/logout', requireLogin, (req, res) => req.session.destroy(() => res.redirect('/login')));

app.get('/', requireLogin, (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'controller.html')));
app.get('/controller', requireLogin, (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'controller.html')));
app.get('/tablet', requireLogin, (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'tablet.html')));
app.get('/output', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'graphics', 'output.html')));
app.get('/output/live', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'graphics', 'output.html')));
app.get('/preview', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'graphics', 'output.html')));
app.get('/preview/live', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'graphics', 'output.html')));

app.get('/healthz', async (req, res) => {
  const database = await db.status();
  res.json({ ok: true, instance: INSTANCE_ID, database });
});
app.get('/api/me', requireLogin, (req, res) => res.json({ ok:true, user:req.session.user, instance: INSTANCE_ID }));
app.get('/api/state', async (req, res) => res.json({ ok: true, state: await loadSharedState(), instance: INSTANCE_ID }));
app.get('/api/graphics-settings', async (req, res) => {
  const shared = await loadSharedState();
  res.json({ ok:true, settings: shared.graphicsSettings || DEFAULT_GRAPHICS_SETTINGS });
});
app.post('/api/graphics-settings', requireControl, async (req, res) => {
  await loadSharedState();
  state.graphicsSettings = normaliseGraphicsSettings(req.body || {});
  await saveSharedState();
  await db.audit('graphics_settings_update', { user: req.session?.user?.username || 'token', settings: state.graphicsSettings });
  io.emit('graphicsSettings', state.graphicsSettings);
  io.emit('state', state);
  res.json({ ok:true, settings: state.graphicsSettings });
});
app.post('/api/graphics-settings/reset', requireControl, async (req, res) => {
  await loadSharedState();
  state.graphicsSettings = normaliseGraphicsSettings(DEFAULT_GRAPHICS_SETTINGS);
  await saveSharedState();
  await db.audit('graphics_settings_reset', { user: req.session?.user?.username || 'token' });
  io.emit('graphicsSettings', state.graphicsSettings);
  io.emit('state', state);
  res.json({ ok:true, settings: state.graphicsSettings });
});

app.post('/api/event', requireControl, async (req, res) => {
  const eventId = String(req.body.eventId || '').replace(/\D/g, '');
  if (!eventId) return res.status(400).json({ ok: false, error: 'Valid EventID required' });
  state.eventId = eventId;
  await saveSharedState();
  await db.audit('set_event', { eventId, user: req.session?.user?.username || 'token' });
  io.emit('state', state);
  res.json({ ok: true, state });
});

app.get('/api/event/:eventId/info', async (req, res) => {
  try {
    const data = await scraper.getEventInfo(req.params.eventId, CACHE_TTL_MS);
    await db.upsertEvent(req.params.eventId, data);
    res.json({ ok: true, data });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

app.get('/api/event/:eventId/overall', async (req, res) => {
  try {
    const data = await scraper.getOverall(req.params.eventId, Number(req.query.limit || 999), CACHE_TTL_MS);
    await db.upsertSnapshot(req.params.eventId, 'overall', 0, data);
    res.json({ ok: true, data });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

app.get('/api/event/:eventId/stage/:stageId', async (req, res) => {
  try {
    const data = await scraper.getStage(req.params.eventId, req.params.stageId, Number(req.query.limit || 999), CACHE_TTL_MS);
    await db.upsertSnapshot(req.params.eventId, 'stage', req.params.stageId, data);
    res.json({ ok: true, data });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

app.get('/api/event/:eventId/entries', async (req, res) => {
  try {
    const data = await scraper.getEntries(req.params.eventId, Number(req.query.limit || 999), CACHE_TTL_MS);
    await db.upsertSnapshot(req.params.eventId, 'entries', 0, data);
    res.json({ ok: true, data });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

app.post('/api/take', requireControl, async (req, res) => {
  await loadSharedState();
  const graphic = { ...normaliseGraphic(req.body || {}), updatedAt: new Date().toISOString() };
  const target = ['preview','program','both'].includes(req.body.target) ? req.body.target : 'program';
  state.scene = normaliseScene(state.scene);
  if (target === 'preview' || target === 'both') state.scene.preview = { ...graphic };
  if (target === 'program' || target === 'both') {
    state.graphic = { ...graphic };
    state.scene.program = { ...graphic };
    await db.logGraphic(state.eventId, state.graphic);
  }
  state.scene.updatedAt = new Date().toISOString();
  await saveSharedState();
  await db.audit('take_graphic', { eventId: state.eventId, target, graphic, user: req.session?.user?.username || 'token' });
  io.emit('state', state);
  res.json({ ok: true, state });
});

app.get('/api/scene', async (req, res) => {
  await loadSharedState();
  res.json({ ok:true, scene: state.scene, program: state.scene.program || state.graphic, preview: state.scene.preview });
});

app.post('/api/scene/preview', requireControl, async (req, res) => {
  await loadSharedState();
  state.scene.preview = normaliseGraphic(req.body || {});
  state.scene.updatedAt = new Date().toISOString();
  await saveSharedState();
  await db.audit('scene_preview', { user: req.session?.user?.username || 'token', preview: state.scene.preview });
  io.emit('state', state);
  res.json({ ok:true, scene: state.scene });
});

app.post('/api/scene/take-preview', requireControl, async (req, res) => {
  await loadSharedState();
  state.scene.preview = normaliseGraphic(state.scene.preview || {});
  state.scene.program = { ...state.scene.preview, updatedAt: new Date().toISOString() };
  state.graphic = { ...state.scene.program };
  state.scene.updatedAt = new Date().toISOString();
  await saveSharedState();
  await db.logGraphic(state.eventId, state.graphic);
  await db.audit('scene_take_preview', { user: req.session?.user?.username || 'token', program: state.scene.program });
  io.emit('state', state);
  res.json({ ok:true, state });
});

app.post('/api/scene/layers', requireControl, async (req, res) => {
  await loadSharedState();
  state.scene.layers = { ...DEFAULT_SCENE_STATE.layers, ...(state.scene.layers || {}), ...(req.body.layers || req.body || {}) };
  state.scene.updatedAt = new Date().toISOString();
  await saveSharedState();
  await db.audit('scene_layers_update', { user: req.session?.user?.username || 'token', layers: state.scene.layers });
  io.emit('state', state);
  res.json({ ok:true, scene: state.scene });
});

app.post('/api/scene/transition', requireControl, async (req, res) => {
  await loadSharedState();
  if (['cut','fade','slide','wipe'].includes(req.body.transition)) state.scene.transition = req.body.transition;
  state.scene.updatedAt = new Date().toISOString();
  await saveSharedState();
  io.emit('state', state);
  res.json({ ok:true, scene: state.scene });
});

app.post('/api/macros', requireControl, async (req, res) => {
  await loadSharedState();
  state.scene.macros = Array.isArray(req.body.macros) ? req.body.macros.slice(0,50) : state.scene.macros;
  await saveSharedState();
  io.emit('state', state);
  res.json({ ok:true, macros: state.scene.macros });
});

app.post('/api/macros/run', requireControl, async (req, res) => {
  await loadSharedState();
  const macro = (state.scene.macros || [])[Number(req.body.index || 0)];
  if (!macro) return res.status(404).json({ ok:false, error:'Macro not found' });
  for (const action of (macro.actions || [])) {
    if (action.type === 'clear') { state.graphic = normaliseGraphic({ type:'blank' }); state.scene.program = { ...state.graphic }; }
    if (action.type === 'takePreview') { state.scene.program = normaliseGraphic(state.scene.preview); state.graphic = { ...state.scene.program }; }
    if (action.type === 'take' && action.graphic) { state.graphic = normaliseGraphic(action.graphic); state.scene.program = { ...state.graphic }; }
  }
  state.scene.updatedAt = new Date().toISOString();
  await saveSharedState();
  io.emit('state', state);
  res.json({ ok:true, state });
});

app.post('/api/remote/trigger', requireControl, async (req, res) => {
  const action = req.body.action || 'take';
  if (action === 'preview') {
    await loadSharedState();
    state.scene.preview = normaliseGraphic(req.body.graphic || req.body);
  } else if (action === 'takePreview') {
    await loadSharedState();
    state.scene.program = normaliseGraphic(state.scene.preview); state.graphic = { ...state.scene.program, updatedAt:new Date().toISOString() };
  } else if (action === 'clear') {
    state.graphic = normaliseGraphic({ type:'blank' }); state.scene.program = { ...state.graphic };
  } else {
    const graphic = normaliseGraphic(req.body.graphic || req.body);
    const target = ['preview','program','both'].includes(req.body.target) ? req.body.target : 'program';
    if (target === 'preview' || target === 'both') state.scene.preview = { ...graphic };
    if (target === 'program' || target === 'both') { state.graphic = { ...graphic }; state.scene.program = { ...state.graphic }; }
  }
  await saveSharedState();
  io.emit('state', state);
  res.json({ ok:true, state });
});

app.get('/api/admin/status', requireLogin, async (req, res) => {
  const database = await db.status();
  res.json({ ok: true, app: true, database, state: await loadSharedState() });
});

app.get('/api/export', requireLogin, async (req, res) => {
  const data = await db.exportAll();
  await db.audit('export_json', { user: req.session.user.username, countEvents: data.events?.length || 0, countSnapshots: data.result_snapshots?.length || 0 });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="rally_graphics_export_${new Date().toISOString().slice(0,10)}.json"`);
  res.send(JSON.stringify(data, null, 2));
});

app.post('/api/import', requireLogin, async (req, res) => {
  try {
    const mode = req.query.mode || req.body?.mode || 'merge';
    const result = await db.importAll(req.body || {}, mode);
    await db.audit('import_json_request', { user: req.session.user.username, mode });
    res.json({ ok: true, result });
  }
  catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

app.get('/api/config/export', requireLogin, async (req, res) => {
  const sharedState = await loadSharedState();
  const database = await db.exportAll();
  const config = {
    kind: 'rally-graphics-config',
    version: 1,
    exportedAt: new Date().toISOString(),
    appState: sharedState,
    graphicsSettings: sharedState.graphicsSettings || DEFAULT_GRAPHICS_SETTINGS,
    database
  };
  await db.audit('export_config', { user: req.session.user.username, eventId: sharedState.eventId });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="rally_graphics_config_${new Date().toISOString().slice(0,10)}.json"`);
  res.send(JSON.stringify(config, null, 2));
});

app.post('/api/config/import', requireLogin, async (req, res) => {
  try {
    const payload = req.body || {};
    const mode = req.query.mode || payload.mode || 'merge';
    const incomingState = payload.appState || {};
    const incomingGraphics = payload.graphicsSettings || incomingState.graphicsSettings || {};

    await loadSharedState();
    state = {
      ...state,
      ...incomingState,
      graphicsSettings: normaliseGraphicsSettings(incomingGraphics),
      scene: normaliseScene(incomingState.scene || payload.scene || state.scene)
    };
    if (!state.graphic) state.graphic = { type: 'blank', stageId: 0, page: 1, pageSize: 10, title: '', updatedAt: new Date().toISOString() };
    await saveSharedState();

    let databaseResult = null;
    if (payload.database) databaseResult = await db.importAll(payload.database, mode);

    await db.audit('import_config', { user: req.session.user.username, mode, importedDatabase: !!payload.database });
    io.emit('graphicsSettings', state.graphicsSettings);
    io.emit('state', state);
    res.json({ ok: true, result: { mode, stateImported: true, database: databaseResult } });
  }
  catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

app.get('/api/rundown', requireLogin, async (req, res) => {
  res.json({ ok: true, rundown: await db.getRundown(state.eventId) });
});

app.post('/api/rundown', requireLogin, async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const saved = await db.saveRundown(state.eventId, items);
  await db.audit('save_rundown', { eventId: state.eventId, count: items.length, user: req.session.user.username });
  res.json({ ok: true, rundown: saved });
});

app.post('/api/rundown/take-next', requireControl, async (req, res) => {
  const rundown = await db.getRundown(state.eventId);
  const items = rundown.items || [];
  const currentIndex = Number(req.body.currentIndex || -1);
  const nextIndex = items.length ? (currentIndex + 1) % items.length : -1;
  if (nextIndex < 0) return res.status(400).json({ ok:false, error:'Rundown is empty' });
  const item = items[nextIndex];
  state.graphic = { type:item.type, stageId:Number(item.stageId||0), page:Number(item.page||1), pageSize:Number(item.pageSize||10), title:item.title||'', updatedAt:new Date().toISOString() };
  state.scene = normaliseScene(state.scene);
  state.scene.program = { ...state.graphic };
  await saveSharedState();
  await db.logGraphic(state.eventId, state.graphic);
  io.emit('state', state);
  res.json({ ok:true, index:nextIndex, item, state });
});

app.get('/api/users', requireAdmin, async (req, res) => res.json({ ok:true, users: await db.listUsers() }));
app.post('/api/users', requireAdmin, async (req, res) => {
  try {
    const user = await db.createUser(req.body || {});
    await db.audit('create_user', { by:req.session.user.username, username:user.username, role:user.role });
    res.json({ ok:true, user });
  } catch (err) { res.status(400).json({ ok:false, error:err.message }); }
});
app.put('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = await db.updateUser(req.params.id, req.body || {});
    await db.audit('update_user', { by:req.session.user.username, id:req.params.id, username:user.username, role:user.role });
    res.json({ ok:true, user });
  } catch (err) { res.status(400).json({ ok:false, error:err.message }); }
});
app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const deleted = await db.deleteUser(req.params.id);
    await db.audit('delete_user', { by:req.session.user.username, id:req.params.id, deleted });
    res.json({ ok:true, deleted });
  } catch (err) { res.status(400).json({ ok:false, error:err.message }); }
});

io.on('connection', async socket => socket.emit('state', await loadSharedState()));

(async () => {
  try { await db.init(); await loadSharedState(); await saveSharedState(); console.log(`Database initialised on ${INSTANCE_ID}:`, await db.status()); }
  catch (err) { console.error('Database init failed:', err.message); }
  if (process.argv.includes('--migrate-only')) process.exit(0);
  server.listen(PORT, () => console.log(`Rally Graphics ${INSTANCE_ID} running on http://0.0.0.0:${PORT}`));
})();
