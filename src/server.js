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
const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-rally-graphics-session-secret';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

let state = {
  eventId: DEFAULT_EVENT_ID,
  graphic: { type: 'blank', stageId: 0, page: 1, pageSize: 10, title: '', updatedAt: new Date().toISOString() },
};
async function loadSharedState(){
  try { state = await db.getAppState(state); } catch (err) { console.warn('Could not load shared state:', err.message); }
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
// HTTPS-safe internal preview for the controller. The public programme output remains HTTP-only via NGINX.
app.get('/preview/live', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'graphics', 'output.html')));

app.get('/healthz', async (req, res) => {
  const database = await db.status();
  res.json({ ok: true, instance: INSTANCE_ID, database });
});
app.get('/api/me', requireLogin, (req, res) => res.json({ ok:true, user:req.session.user, instance: INSTANCE_ID }));
app.get('/api/state', async (req, res) => res.json({ ok: true, state: await loadSharedState(), instance: INSTANCE_ID }));

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
  const type = req.body.type || 'blank';
  const stageId = Number(req.body.stageId || 0);
  const page = Math.max(1, Number(req.body.page || 1));
  const pageSize = Math.max(1, Math.min(20, Number(req.body.pageSize || 10)));
  state.graphic = { type, stageId, page, pageSize, title: req.body.title || '', updatedAt: new Date().toISOString() };
  await saveSharedState();
  await db.logGraphic(state.eventId, state.graphic);
  await db.audit('take_graphic', { eventId: state.eventId, graphic: state.graphic, user: req.session?.user?.username || 'token' });
  io.emit('state', state);
  res.json({ ok: true, state });
});

app.get('/api/admin/status', requireLogin, async (req, res) => {
  const database = await db.status();
  let backupCount = 0;
  try { backupCount = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.gz') || f.endsWith('.sql')).length : 0; } catch {}
  res.json({ ok: true, app: true, database, backupCount, backupDir: BACKUP_DIR, state });
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
  await saveSharedState();
  await db.logGraphic(state.eventId, state.graphic);
  io.emit('state', state);
  res.json({ ok:true, index:nextIndex, item, state });
});

app.get('/api/backups', requireLogin, (req, res) => {
  try {
    const files = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.gz') || f.endsWith('.sql')).sort().reverse() : [];
    res.json({ ok: true, files });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/backups/:file', requireLogin, (req, res) => {
  const file = safeFileName(req.params.file);
  const full = path.join(BACKUP_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).send('Backup not found');
  res.download(full);
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
