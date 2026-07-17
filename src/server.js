const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
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
const APP_VERSION = '3.0-workflow-tools';
const errorEvents = [];
const outputSockets = { preview: new Set(), program: new Set() };
function recordError(kind, message, severity='red') {
  const item = { time: new Date().toISOString(), kind, message: humanError(message), severity };
  errorEvents.unshift(item);
  if (errorEvents.length > 100) errorEvents.pop();
  return item;
}
function humanError(message='') {
  const m = String(message || 'Unknown problem');
  if (/ECONNREFUSED|database|postgres|pg/i.test(m)) return 'Postgres database not online or connection refused';
  if (/ENOTFOUND|EAI_AGAIN|network|getaddrinfo|fetch failed/i.test(m)) return 'No internet connection or rally results website cannot be reached';
  if (/timeout|ETIMEDOUT/i.test(m)) return 'Connection is slow or timed out';
  if (/Unauthorized|Login required/i.test(m)) return 'User session expired or login required';
  return m.replace(/[{}[\]\"]/g, '').slice(0, 180);
}

const app = express();
app.set('trust proxy', 1);
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
  animationType: 'fade',
  outAnimationType: 'fade',
  rowStagger: 0,
  easing: 'ease-out',
  radius: 0,
  perGraphic: {},
  updatedAt: new Date().toISOString()
};



const DEFAULT_OUTPUT_SETTINGS = {
  program: { enabled:true, label:'Program', resolution:'1920x1080', aspect:'16:9', transport:'http', url:'/output/live', notes:'Main live graphics output for encoder or mixer browser source.' },
  preview: { enabled:true, label:'Preview', resolution:'1920x1080', aspect:'16:9', transport:'http', url:'/preview/live', notes:'Safe preview output for checking before TAKE.' },
  ndi: { enabled:false, label:'NDI', resolution:'1920x1080', aspect:'16:9', transport:'ndi', url:'', notes:'Use the Program URL with an external browser-to-NDI tool.' },
  srt: { enabled:false, label:'SRT', resolution:'1920x1080', aspect:'16:9', transport:'srt', url:'', notes:'Reserved profile for SRT output workflow.' },
  youtube: { enabled:false, label:'YouTube', resolution:'1920x1080', aspect:'16:9', transport:'rtmp', url:'', notes:'Store the destination/encoder note here. Stream keys should be kept outside screenshots.' },
  facebook: { enabled:false, label:'Facebook', resolution:'1920x1080', aspect:'16:9', transport:'rtmp', url:'', notes:'Store the destination/encoder note here. Stream keys should be kept private.' },
  twitch: { enabled:false, label:'Twitch', resolution:'1920x1080', aspect:'16:9', transport:'rtmp', url:'', notes:'Store the destination/encoder note here. Stream keys should be kept private.' },
  social: { enabled:false, label:'Social Vertical', resolution:'1080x1920', aspect:'9:16', transport:'http', url:'/output/live?profile=social', notes:'Reference profile for future vertical/social output. Does not alter the stable 16:9 renderer yet.' },
  updatedAt: new Date().toISOString()
};

const DEFAULT_GRAPHICS_URL = process.env.RGE_GRAPHICS_URL || 'http://127.0.0.1:3000/output/live';
const DEFAULT_INCOMING_URL = process.env.RGE_INCOMING_URL || 'rtmp://mediamtx:1935/live';
const FFMPEG_ENGINE_URL = (process.env.FFMPEG_ENGINE_URL || '').replace(/\/$/, '');

const DEFAULT_BROADCAST_ENGINE = {
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  inputUrl: DEFAULT_GRAPHICS_URL,
  incoming: { protocol:'rtmp', url: DEFAULT_INCOMING_URL, mediamtxPath:'live', enabled:true, overlayEnabled:true, notes:'Publish your camera/program feed to MediaMTX, then use it as the FFmpeg overlay input.' },
  videoBitrate: '6000k',
  audioBitrate: '160k',
  frameRate: 50,
  width: 1920,
  height: 1080,
  outputs: {
    ndi: { enabled:false, label:'NDI Program', inputUrl:'', destination:'RGE PROGRAM', extraArgs:'' },
    srt: { enabled:false, label:'SRT Program', inputUrl:'', destination:'srt://127.0.0.1:9999?mode=caller&latency=120000', extraArgs:'' },
    youtube_graphics_primary: { enabled:false, label:'Graphics Only → YouTube PRIMARY', inputUrl: DEFAULT_GRAPHICS_URL, destination:'rtmp://a.rtmp.youtube.com/live2/PRIMARY_STREAM_KEY', extraArgs:'' },
    youtube_graphics_backup: { enabled:false, label:'Graphics Only → YouTube BACKUP', inputUrl: DEFAULT_GRAPHICS_URL, destination:'rtmp://b.rtmp.youtube.com/live2/BACKUP_STREAM_KEY', extraArgs:'' },
    youtube: { enabled:false, label:'Graphics only → YouTube RTMP (legacy)', inputUrl: DEFAULT_GRAPHICS_URL, destination:'rtmp://a.rtmp.youtube.com/live2/STREAM_KEY', extraArgs:'' },
    facebook: { enabled:false, label:'Facebook RTMP', inputUrl:'', destination:'rtmps://live-api-s.facebook.com:443/rtmp/STREAM_KEY', extraArgs:'' },
    twitch: { enabled:false, label:'Twitch RTMP', inputUrl:'', destination:'rtmp://live.twitch.tv/app/STREAM_KEY', extraArgs:'' },
    mediamtx_graphics: { enabled:false, label:'Publish graphics-only to MediaMTX', inputUrl: DEFAULT_GRAPHICS_URL, destination:'rtmp://mediamtx:1935/rge_graphics', extraArgs:'' },
    youtube_overlay_primary: { enabled:false, label:'MAIN: Incoming stream + RGE graphics → YouTube PRIMARY', inputUrl: DEFAULT_INCOMING_URL, destination:'rtmp://a.rtmp.youtube.com/live2/PRIMARY_STREAM_KEY', extraArgs:'' },
    youtube_overlay_backup: { enabled:false, label:'MAIN: Incoming stream + RGE graphics → YouTube BACKUP', inputUrl: DEFAULT_INCOMING_URL, destination:'rtmp://b.rtmp.youtube.com/live2/BACKUP_STREAM_KEY', extraArgs:'' },
    youtube_overlay: { enabled:false, label:'MAIN: Incoming stream + RGE graphics → YouTube (legacy)', inputUrl: DEFAULT_INCOMING_URL, destination:'rtmp://a.rtmp.youtube.com/live2/STREAM_KEY', extraArgs:'' },
    youtube_passthrough: { enabled:false, label:'Incoming stream only → YouTube', inputUrl: DEFAULT_INCOMING_URL, destination:'rtmp://a.rtmp.youtube.com/live2/STREAM_KEY', extraArgs:'' },
    recorder: { enabled:false, label:'Local MP4 Recorder', inputUrl:'', destination:'recordings/rge-program.mp4', extraArgs:'' }
  },
  updatedAt: new Date().toISOString()
};

function normaliseBroadcastEngine(input={}){
  const src = input || {};
  const out = { ...DEFAULT_BROADCAST_ENGINE, ...src };
  const num = (v,min,max,def) => { const n=Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max,n)) : def; };
  out.ffmpegPath = String(out.ffmpegPath || 'ffmpeg').slice(0, 300);
  out.inputUrl = String(out.inputUrl || DEFAULT_BROADCAST_ENGINE.inputUrl).slice(0, 800);
  const incoming = (src.incoming || DEFAULT_BROADCAST_ENGINE.incoming || {});
  out.incoming = {
    protocol: ['rtmp','srt','rtsp','hls','udp','mediamtx','custom'].includes(incoming.protocol) ? incoming.protocol : 'rtmp',
    url: String(incoming.url || DEFAULT_INCOMING_URL).slice(0, 800),
    mediamtxPath: String(incoming.mediamtxPath || 'live').replace(/[^a-zA-Z0-9_\-]/g,'').slice(0,80) || 'live',
    enabled: Boolean(incoming.enabled ?? true),
    overlayEnabled: Boolean(incoming.overlayEnabled ?? true),
    notes: String(incoming.notes || '').slice(0, 500)
  };
  out.videoBitrate = String(out.videoBitrate || '6000k').replace(/[^0-9kKmM]/g,'').slice(0,20) || '6000k';
  out.audioBitrate = String(out.audioBitrate || '160k').replace(/[^0-9kKmM]/g,'').slice(0,20) || '160k';
  out.frameRate = num(out.frameRate, 1, 120, 50);
  out.width = num(out.width, 320, 7680, 1920);
  out.height = num(out.height, 240, 4320, 1080);
  out.outputs = {};
  for (const key of Object.keys(DEFAULT_BROADCAST_ENGINE.outputs)) {
    const incoming = ((src.outputs || {})[key]) || {};
    out.outputs[key] = {
      ...DEFAULT_BROADCAST_ENGINE.outputs[key],
      ...incoming,
      enabled: Boolean(incoming.enabled ?? DEFAULT_BROADCAST_ENGINE.outputs[key].enabled),
      label: String(incoming.label || DEFAULT_BROADCAST_ENGINE.outputs[key].label).slice(0, 80),
      inputUrl: String(incoming.inputUrl || '').slice(0, 800),
      destination: String(incoming.destination || DEFAULT_BROADCAST_ENGINE.outputs[key].destination).slice(0, 1000),
      extraArgs: String(incoming.extraArgs || '').slice(0, 1000)
    };
  }
  out.updatedAt = new Date().toISOString();
  return out;
}

const broadcastProcesses = new Map();
const broadcastLogs = new Map();
function logBroadcast(key, line){
  const arr = broadcastLogs.get(key) || [];
  arr.push(`[${new Date().toLocaleTimeString()}] ${String(line).replace(/\r?\n/g,' ').slice(0,500)}`);
  while (arr.length > 80) arr.shift();
  broadcastLogs.set(key, arr);
}
function splitArgs(str=''){
  const out=[]; let cur=''; let quote=null;
  for (let i=0;i<str.length;i++) { const ch=str[i];
    if (quote) { if (ch===quote) quote=null; else cur+=ch; }
    else if (ch==='"' || ch==="'") quote=ch;
    else if (/\s/.test(ch)) { if(cur){ out.push(cur); cur=''; } }
    else cur+=ch;
  }
  if(cur) out.push(cur); return out;
}
function buildFfmpegArgs(config, key){
  const engine = normaliseBroadcastEngine(config);
  const profile = engine.outputs[key];
  if (!profile) throw new Error('Unknown broadcast output');
  const input = profile.inputUrl || engine.inputUrl;
  if (!input) throw new Error('No input URL configured');
  const common = ['-hide_banner','-loglevel','info','-re','-i',input,'-r',String(engine.frameRate),'-s',`${engine.width}x${engine.height}`,'-c:v','libx264','-preset','veryfast','-tune','zerolatency','-b:v',engine.videoBitrate,'-pix_fmt','yuv420p','-c:a','aac','-b:a',engine.audioBitrate];
  const extra = splitArgs(profile.extraArgs);
  if (key === 'ndi') return [...common, ...extra, '-f','libndi_newtek', profile.destination || 'RGE PROGRAM'];
  if (key === 'srt') return [...common, ...extra, '-f','mpegts', profile.destination];
  if (key === 'recorder') return [...common, ...extra, '-movflags','+faststart', profile.destination];
  return [...common, ...extra, '-f','flv', profile.destination];
}

function buildBrowserStreamCommand(config, key){
  const engine = normaliseBroadcastEngine(config);
  const profile = engine.outputs[key];
  if (!profile) throw new Error('Unknown broadcast output');
  const input = profile.inputUrl || engine.inputUrl;
  const destination = String(profile.destination || '').trim();
  if (!input) throw new Error('No input URL configured');
  if (!destination || /STREAM_KEY/i.test(destination)) throw new Error('Add the full YouTube RTMP URL including your stream key before starting');
  const script = path.join(__dirname, '..', 'scripts', 'rge-stream-browser.sh');
  return {
    command: '/bin/bash',
    args: [script, input, destination, String(engine.width), String(engine.height), String(engine.frameRate), engine.videoBitrate, engine.audioBitrate, profile.extraArgs || ''],
    display: `/bin/bash ${script} ${input} [destination hidden] ${engine.width}x${engine.height}@${engine.frameRate}`
  };
}

function buildOverlayStreamCommand(config, key){
  const engine = normaliseBroadcastEngine(config);
  const profile = engine.outputs[key];
  if (!profile) throw new Error('Unknown broadcast output');
  const videoInput = String(profile.inputUrl || engine.incoming?.url || DEFAULT_INCOMING_URL).trim();
  const destination = String(profile.destination || '').trim();
  if (!videoInput) throw new Error('No MediaMTX/input stream URL configured');
  if (!destination || /STREAM_KEY/i.test(destination)) throw new Error('Add the full YouTube RTMP URL including your stream key before starting');
  const graphicsUrl = engine.inputUrl || DEFAULT_BROADCAST_ENGINE.inputUrl;
  const script = path.join(__dirname, '..', 'scripts', 'rge-overlay-to-youtube.sh');
  return {
    command: '/bin/bash',
    args: [script, videoInput, graphicsUrl, destination, String(engine.width), String(engine.height), String(engine.frameRate), engine.videoBitrate, engine.audioBitrate, profile.extraArgs || ''],
    display: `/bin/bash ${script} ${videoInput} ${graphicsUrl} [destination hidden] ${engine.width}x${engine.height}@${engine.frameRate}`
  };
}

function broadcastStatus(){
  const out = {};
  for (const key of Object.keys(DEFAULT_BROADCAST_ENGINE.outputs)) {
    const p = broadcastProcesses.get(key);
    out[key] = { running: Boolean(p && !p.killed), pid: p?.pid || null, logs: (broadcastLogs.get(key)||[]).slice(-12) };
  }
  return out;
}


async function remoteEngineRequest(method, endpoint, body){
  if (!FFMPEG_ENGINE_URL) return null;
  const r = await fetch(`${FFMPEG_ENGINE_URL}${endpoint}`, {
    method,
    headers: { 'Content-Type':'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(()=>({ ok:false, error:'Bad response from ffmpeg-engine' }));
  if (!r.ok || data.ok === false) throw new Error(data.error || `ffmpeg-engine ${r.status}`);
  return data;
}
async function getBroadcastStatus(){
  if (FFMPEG_ENGINE_URL) {
    try { const data = await remoteEngineRequest('GET','/status'); if (data && data.status) return data.status; }
    catch (e) { const s = broadcastStatus(); s.ffmpeg_engine = { running:false, pid:null, logs:[`Remote ffmpeg-engine unavailable: ${e.message}`] }; return s; }
  }
  return broadcastStatus();
}
async function startRemoteBroadcast(key, mode='single'){
  const data = await remoteEngineRequest('POST','/start', { key, mode, config: state.broadcastEngine });
  return data.status || {};
}
async function stopRemoteBroadcast(key){
  const data = await remoteEngineRequest('POST', `/stop/${encodeURIComponent(key)}`, {});
  return data.status || {};
}
async function stopAllRemoteBroadcast(){
  const data = await remoteEngineRequest('POST', '/stop-all', {});
  return data.status || {};
}

function normaliseOutputSettings(input={}){
  const allowedRes = ['1920x1080','1280x720','3840x2160','1080x1920','custom'];
  const allowedAspect = ['16:9','4:3','9:16','1:1','custom'];
  const allowedTransport = ['http','ndi','srt','rtmp','webrtc','hls','other'];
  const out = { ...DEFAULT_OUTPUT_SETTINGS };
  for (const key of Object.keys(DEFAULT_OUTPUT_SETTINGS)) {
    if (key === 'updatedAt') continue;
    const incoming = (input && input[key]) || {};
    out[key] = {
      ...DEFAULT_OUTPUT_SETTINGS[key],
      ...incoming,
      enabled: Boolean(incoming.enabled ?? DEFAULT_OUTPUT_SETTINGS[key].enabled),
      label: String(incoming.label || DEFAULT_OUTPUT_SETTINGS[key].label).slice(0, 50),
      resolution: allowedRes.includes(incoming.resolution) ? incoming.resolution : DEFAULT_OUTPUT_SETTINGS[key].resolution,
      aspect: allowedAspect.includes(incoming.aspect) ? incoming.aspect : DEFAULT_OUTPUT_SETTINGS[key].aspect,
      transport: allowedTransport.includes(incoming.transport) ? incoming.transport : DEFAULT_OUTPUT_SETTINGS[key].transport,
      url: String(incoming.url ?? DEFAULT_OUTPUT_SETTINGS[key].url).slice(0, 500),
      notes: String(incoming.notes ?? DEFAULT_OUTPUT_SETTINGS[key].notes).slice(0, 500)
    };
  }
  out.updatedAt = new Date().toISOString();
  return out;
}

const DEFAULT_SCENE_STATE = {
  preview: { type: 'blank', stageId: 0, page: 1, pageSize: 10, title: '' },
  program: null,
  transition: 'fade',
  layers: {
    background: { enabled: true, opacity: 100 },
    main: { enabled: true, opacity: 100 },
    // These are style/content settings only. Visibility is controlled ONLY by the controller layer buttons.
    bug: { enabled: false, logoEnabled: false, opacity: 100, text: '', x: 0, y: 0, fontSize: 28, backgroundOpacity: 72, logoUrl: '', logoWidth: 120, logoOpacity: 100, logoMode: 'fullFrame' },
    clock: { enabled: false, opacity: 100, x: 0, y: 0, fontSize: 28, backgroundOpacity: 72 }
  },
  layerVisibility: {
    preview: { bug: false, logo: false, clock: false },
    program: { bug: false, logo: false, clock: false }
  },
  macros: [
    { name: 'Clear Program', actions: [{ type: 'clear' }] },
    { name: 'Take Preview', actions: [{ type: 'takePreview' }] }
  ],
  activeLogoSlot: 1,
  activeLogoSlotPreview: 1,
  activeLogoSlotProgram: 1,
  logoUrls: { preview: '', program: '' },
  updatedAt: new Date().toISOString()
};
function normaliseGraphic(g={}){
  const type = g.type || 'blank';
  const requestedPageSize = Math.max(1, Math.min(20, Number(g.pageSize || 10)));
  // v38: Entry List must always paginate exactly like the other graphics: 10 rows per page.
  const pageSize = type === 'entries' ? 10 : requestedPageSize;
  return {
    type,
    stageId: Number(g.stageId || 0),
    page: Math.max(1, Number(g.page || 1)),
    pageSize,
    title: g.title || '',
    updatedAt: g.updatedAt || new Date().toISOString()
  };
}
function normaliseScene(input={}){
  const s = { ...DEFAULT_SCENE_STATE, ...(input || {}) };
  const incomingLayers = s.layers || {};
  const mergedLayers = {
    background: { ...DEFAULT_SCENE_STATE.layers.background, ...(incomingLayers.background || {}) },
    main: { ...DEFAULT_SCENE_STATE.layers.main, ...(incomingLayers.main || {}) },
    // Bug text and logo are persistent independent layers. They must not be reset by TAKE/CLEAR.
    bug: { ...DEFAULT_SCENE_STATE.layers.bug, ...(incomingLayers.bug || {}) },
    clock: { ...DEFAULT_SCENE_STATE.layers.clock, ...(incomingLayers.clock || {}) }
  };
  mergedLayers.bug.logoMode = ['fit','fullFrame'].includes(mergedLayers.bug.logoMode) ? mergedLayers.bug.logoMode : 'fullFrame';
  mergedLayers.bug.logoWidth = Math.max(20, Math.min(1920, Number(mergedLayers.bug.logoWidth || 120)));
  mergedLayers.bug.logoOpacity = Math.max(0, Math.min(100, Number(mergedLayers.bug.logoOpacity ?? 100)));
  return {
    preview: normaliseGraphic(s.preview || {}),
    program: s.program ? normaliseGraphic(s.program) : null,
    transition: ['cut','fade','slide','wipe'].includes(s.transition) ? s.transition : 'fade',
    layers: mergedLayers,
    layerVisibility: {
      preview: { ...DEFAULT_SCENE_STATE.layerVisibility.preview, ...((s.layerVisibility || {}).preview || {}) },
      program: { ...DEFAULT_SCENE_STATE.layerVisibility.program, ...((s.layerVisibility || {}).program || {}) }
    },
    macros: Array.isArray(s.macros) ? s.macros.slice(0, 50) : DEFAULT_SCENE_STATE.macros,
    activeLogoSlot: Number(s.activeLogoSlot || 1),
    activeLogoSlotPreview: Number(s.activeLogoSlotPreview || s.activeLogoSlot || 1),
    activeLogoSlotProgram: Number(s.activeLogoSlotProgram || s.activeLogoSlot || 1),
    logoUrls: { ...DEFAULT_SCENE_STATE.logoUrls, ...((s.logoUrls || {})) },
    updatedAt: new Date().toISOString()
  };
}

let state = {
  eventId: DEFAULT_EVENT_ID,
  ralliesInfoUrl: '',
  scene: { ...DEFAULT_SCENE_STATE },
  graphic: { type: 'blank', stageId: 0, page: 1, pageSize: 10, title: '', updatedAt: new Date().toISOString() },
  graphicsSettings: { ...DEFAULT_GRAPHICS_SETTINGS },
  outputSettings: { ...DEFAULT_OUTPUT_SETTINGS },
  broadcastEngine: { ...DEFAULT_BROADCAST_ENGINE },
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
    animationType: ['none','fade','slide-left','slide-right','slide-up','slide-down','zoom','grow'].includes(s.animationType) ? s.animationType : 'fade',
    outAnimationType: ['none','fade','slide-left','slide-right','slide-up','slide-down','zoom','shrink'].includes(s.outAnimationType) ? s.outAnimationType : 'fade',
    rowStagger: num(s.rowStagger, 0, 250, 0),
    easing: ['linear','ease','ease-in','ease-out','ease-in-out','cubic-bezier(.34,1.56,.64,1)'].includes(s.easing) ? s.easing : 'ease-out',
    radius: num(s.radius, 0, 80, 0),
    perGraphic: typeof s.perGraphic === 'object' && s.perGraphic ? Object.fromEntries(Object.entries(s.perGraphic).slice(0,20).map(([k,v]) => [k, normaliseGraphicsSettings({ ...v, perGraphic: {} })])) : {},
    updatedAt: new Date().toISOString()
  };
}
async function loadSharedState(){
  try { state = await db.getAppState(state); } catch (err) { console.warn('Could not load shared state:', err.message); }
  state.graphicsSettings = normaliseGraphicsSettings(state.graphicsSettings);
  state.outputSettings = normaliseOutputSettings(state.outputSettings);
  state.broadcastEngine = normaliseBroadcastEngine(state.broadcastEngine);
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
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 1000 * 60 * 60 * 12 }
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
app.get('/api/runtime-config', requireLogin, (req, res) => res.json({
  ok:true,
  config:{
    outputHttpPort: Number(process.env.PUBLIC_HTTP_PORT || 8080),
    mediaHlsPort: Number(process.env.PUBLIC_HLS_PORT || 8888)
  }
}));
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



function listUploadedLogos(){
  const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'logos');
  fs.mkdirSync(uploadDir, { recursive:true });
  return fs.readdirSync(uploadDir)
    .filter(f => f.toLowerCase().endsWith('.png'))
    .map(f => {
      const st = fs.statSync(path.join(uploadDir, f));
      return { fileName: f, url: `/uploads/logos/${f}`, size: st.size, uploadedAt: st.mtime.toISOString() };
    })
    .sort((a,b) => String(a.uploadedAt).localeCompare(String(b.uploadedAt))); // slot 1/2 = first two uploaded logos
}
app.get('/api/assets/logos', requireControl, async (req, res) => {
  try { res.json({ ok:true, logos:listUploadedLogos() }); }
  catch (err) { recordError('asset_list', err.message, 'orange'); res.status(500).json({ ok:false, error:humanError(err.message) }); }
});

app.post('/api/assets/logo/select', requireControl, async (req, res) => {
  try {
    await loadSharedState();
    const url = String(req.body?.url || '');
    const logos = listUploadedLogos();
    if (url && !logos.some(l => l.url === url)) return res.status(400).json({ ok:false, error:'Selected logo was not found in the logo library.' });
    state.scene = normaliseScene(state.scene);
    state.scene.layers = { ...DEFAULT_SCENE_STATE.layers, ...(state.scene.layers || {}) };
    state.scene.layers.bug = { ...DEFAULT_SCENE_STATE.layers.bug, ...(state.scene.layers.bug || {}), logoUrl:url };
    state.scene.updatedAt = new Date().toISOString();
    await saveSharedState();
    await db.audit('logo_select', { user: req.session?.user?.username || 'token', url });
    io.emit('state', state);
    res.json({ ok:true, scene:state.scene, logos });
  } catch (err) { recordError('asset_select', err.message, 'orange'); res.status(500).json({ ok:false, error:humanError(err.message) }); }
});

app.post('/api/assets/logo/delete', requireControl, async (req, res) => {
  try {
    await loadSharedState();
    const rawUrl = String(req.body?.url || '');
    const logos = listUploadedLogos();
    const item = logos.find(l => l.url === rawUrl || l.fileName === rawUrl);
    if (!item) return res.status(404).json({ ok:false, error:'Logo not found in the uploaded logo library.' });
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'logos');
    const fullPath = path.join(uploadDir, path.basename(item.fileName));
    if (!fullPath.startsWith(uploadDir)) return res.status(400).json({ ok:false, error:'Invalid logo path.' });
    try { fs.unlinkSync(fullPath); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    state.scene = normaliseScene(state.scene);
    if (state.scene.layers?.bug?.logoUrl === item.url) state.scene.layers.bug.logoUrl = '';
    if (state.scene.logoUrls?.preview === item.url) state.scene.logoUrls.preview = '';
    if (state.scene.logoUrls?.program === item.url) state.scene.logoUrls.program = '';
    state.scene.updatedAt = new Date().toISOString();
    await saveSharedState();
    await db.audit('logo_delete', { user: req.session?.user?.username || 'token', fileName:item.fileName });
    io.emit('state', state);
    res.json({ ok:true, scene:state.scene, logos:listUploadedLogos() });
  } catch (err) {
    recordError('asset_delete', err.message, 'orange');
    res.status(500).json({ ok:false, error:humanError(err.message) });
  }
});

app.post('/api/assets/logo', requireControl, async (req, res) => {
  try {
    const dataUrl = String(req.body?.dataUrl || '');
    const originalName = safeFileName(req.body?.name || 'logo.png') || 'logo.png';
    const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return res.status(400).json({ ok:false, error:'Please upload a PNG logo file with transparency support.' });
    const buffer = Buffer.from(match[1], 'base64');
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) return res.status(400).json({ ok:false, error:'PNG logo must be smaller than 8 MB.' });
    if (buffer.slice(0,8).toString('hex') !== '89504e470d0a1a0a') return res.status(400).json({ ok:false, error:'Only real PNG files are allowed.' });
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'logos');
    fs.mkdirSync(uploadDir, { recursive:true });
    const fileName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${originalName.replace(/\.png$/i,'')}.png`;
    fs.writeFileSync(path.join(uploadDir, fileName), buffer);
    const url = `/uploads/logos/${fileName}`;
    await db.audit('logo_upload', { user: req.session?.user?.username || 'token', fileName });
    res.json({ ok:true, url, fileName, logos:listUploadedLogos() });
  } catch (err) {
    recordError('asset_upload', err.message, 'orange');
    res.status(500).json({ ok:false, error:humanError(err.message) });
  }
});

app.post('/api/event', requireControl, async (req, res) => {
  const eventId = String(req.body.eventId || '').replace(/\D/g, '');
  if (!eventId) return res.status(400).json({ ok: false, error: 'Valid EventID required' });
  const ralliesInfoUrl = String(req.body.ralliesInfoUrl || '').trim();
  if (ralliesInfoUrl && !scraper.isAllowedRalliesInfoUrl(ralliesInfoUrl)) {
    return res.status(400).json({ ok:false, error:'Rallies.info URL must be an https://rallies.info or https://www.rallies.info webentry URL.' });
  }
  state.eventId = eventId;
  state.ralliesInfoUrl = ralliesInfoUrl;
  await saveSharedState();
  await db.audit('set_event', { eventId, ralliesInfoUrl, user: req.session?.user?.username || 'token' });
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
    const stageId = Number(req.query.stageId || 0);
    const data = await scraper.getOverall(req.params.eventId, Number(req.query.limit || 999), CACHE_TTL_MS, stageId);
    await db.upsertSnapshot(req.params.eventId, 'overall', stageId, data);
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
    const requestedRalliesUrl = String(req.query.ralliesInfoUrl || state.ralliesInfoUrl || '').trim();
    const data = await scraper.getEntries(req.params.eventId, Number(req.query.limit || 999), CACHE_TTL_MS, requestedRalliesUrl);
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
  if (graphic.type === 'blank') {
    state.scene.layerVisibility = {
      preview: { ...DEFAULT_SCENE_STATE.layerVisibility.preview, ...((state.scene.layerVisibility || {}).preview || {}) },
      program: { ...DEFAULT_SCENE_STATE.layerVisibility.program, ...((state.scene.layerVisibility || {}).program || {}) }
    };
    if (target === 'preview' || target === 'both') state.scene.layerVisibility.preview = { bug:false, logo:false, clock:false };
    if (target === 'program' || target === 'both') state.scene.layerVisibility.program = { bug:false, logo:false, clock:false };
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



// Dedicated clear for the main graphic only. This does NOT touch Bug, Logo or Clock layers.
// It fixes preview clear by clearing the exact Preview/Program scene slot instead of using
// the general take route, which can be affected by layer logic and old render keys.
app.post('/api/scene/main-clear', requireControl, async (req, res) => {
  try {
    await loadSharedState();
    state.scene = normaliseScene(state.scene);
    const target = ['preview','program','both'].includes(req.body.target) ? req.body.target : 'program';
    const blank = { type:'blank', stageId:0, page:1, pageSize:10, updatedAt:new Date().toISOString() };
    if (target === 'preview' || target === 'both') state.scene.preview = { ...blank };
    if (target === 'program' || target === 'both') {
      state.scene.program = { ...blank };
      state.graphic = { ...blank };
      await db.logGraphic(state.eventId, state.graphic);
    }
    state.scene.updatedAt = new Date().toISOString();
    await saveSharedState();
    await db.audit('scene_main_clear', { user: req.session?.user?.username || 'token', target });
    io.emit('clearRender', { kind:'main', target, seq:Date.now() });
    io.emit('state', state);
    res.json({ ok:true, state, scene: state.scene });
  } catch (err) {
    recordError('scene_main_clear', err.message, 'orange');
    res.status(500).json({ ok:false, error: humanError(err.message) });
  }
});


// Clear only a specific main graphic type from Preview and/or Program.
// Overlay layers (Bug, Logo, Clock) are never touched here.
app.post('/api/scene/main-clear-type', requireControl, async (req, res) => {
  try {
    await loadSharedState();
    state.scene = normaliseScene(state.scene);
    const type = String(req.body.type || '');
    const allowedTypes = ['overall','stage','stageTimes','entries'];
    if (!allowedTypes.includes(type)) return res.status(400).json({ ok:false, error:'Unknown graphic type' });
    const target = ['preview','program','both'].includes(req.body.target) ? req.body.target : 'program';
    const blank = { type:'blank', stageId:0, page:1, pageSize:10, updatedAt:new Date().toISOString() };
    const cleared = { preview:false, program:false };

    if ((target === 'preview' || target === 'both') && state.scene.preview?.type === type) {
      state.scene.preview = { ...blank };
      cleared.preview = true;
    }
    if ((target === 'program' || target === 'both') && (state.scene.program?.type === type || state.graphic?.type === type)) {
      state.scene.program = { ...blank };
      state.graphic = { ...blank };
      cleared.program = true;
      await db.logGraphic(state.eventId, state.graphic);
    }

    state.scene.updatedAt = new Date().toISOString();
    await saveSharedState();
    await db.audit('scene_main_clear_type', { user: req.session?.user?.username || 'token', target, type, cleared });
    io.emit('clearRender', { kind:'mainType', target, type, seq:Date.now() });
    io.emit('state', state);
    res.json({ ok:true, state, scene: state.scene, cleared });
  } catch (err) {
    recordError('scene_main_clear_type', err.message, 'orange');
    res.status(500).json({ ok:false, error: humanError(err.message) });
  }
});

app.post('/api/scene/layers', requireControl, async (req, res) => {
  await loadSharedState();
  state.scene = normaliseScene(state.scene);
  const incoming = req.body.layers || req.body || {};
  state.scene.layers = {
    background: { ...DEFAULT_SCENE_STATE.layers.background, ...(state.scene.layers.background || {}), ...(incoming.background || {}) },
    main: { ...DEFAULT_SCENE_STATE.layers.main, ...(state.scene.layers.main || {}), ...(incoming.main || {}) },
    bug: { ...DEFAULT_SCENE_STATE.layers.bug, ...(state.scene.layers.bug || {}), ...(incoming.bug || {}) },
    clock: { ...DEFAULT_SCENE_STATE.layers.clock, ...(state.scene.layers.clock || {}), ...(incoming.clock || {}) }
  };
  state.scene.updatedAt = new Date().toISOString();
  await saveSharedState();
  await db.audit('scene_layers_update', { user: req.session?.user?.username || 'token', layers: state.scene.layers });
  io.emit('state', state);
  res.json({ ok:true, scene: state.scene });
});


app.post('/api/scene/layer-trigger', requireControl, async (req, res) => {
  try {
    await loadSharedState();
    state.scene = normaliseScene(state.scene);
    const layer = String(req.body.layer || '').trim();
    const target = ['preview','program','both'].includes(req.body.target) ? req.body.target : 'preview';
    if (!['bug','logo','clock'].includes(layer)) return res.status(400).json({ ok:false, error:'Unknown layer button.' });
    if (layer === 'logo') {
      const hasSlot = Object.prototype.hasOwnProperty.call(req.body || {}, 'slot');
      const slot = Math.max(1, Math.min(2, Number(req.body.slot || 1)));
      const logos = listUploadedLogos();
      state.scene.layers = { ...DEFAULT_SCENE_STATE.layers, ...(state.scene.layers || {}) };
      state.scene.layers.bug = { ...DEFAULT_SCENE_STATE.layers.bug, ...(state.scene.layers.bug || {}), logoEnabled: true };
      state.scene.logoUrls = { ...DEFAULT_SCENE_STATE.logoUrls, ...(state.scene.logoUrls || {}) };

      // Tablet buttons 1/2 use the first two uploaded PNGs as fixed slots.
      // Desktop Logo TAKE without a slot uses the logo selected in the main controller library.
      let chosenUrl = '';
      if (hasSlot) chosenUrl = logos[slot - 1]?.url || '';
      else chosenUrl = state.scene.layers.bug.logoUrl || logos[0]?.url || '';
      if (!chosenUrl) return res.status(400).json({ ok:false, error: hasSlot ? `Logo slot ${slot} is empty. Upload at least ${slot} PNG logo(s) on the main controller page.` : 'No logo is selected. Upload/select a PNG logo on the main controller page.' });

      if (target === 'preview' || target === 'both') {
        state.scene.logoUrls.preview = chosenUrl;
        state.scene.activeLogoSlotPreview = hasSlot ? slot : Number(state.scene.activeLogoSlotPreview || 1);
      }
      if (target === 'program' || target === 'both') {
        state.scene.logoUrls.program = chosenUrl;
        state.scene.activeLogoSlotProgram = hasSlot ? slot : Number(state.scene.activeLogoSlotProgram || 1);
      }
      state.scene.layers.bug.logoUrl = chosenUrl;
      if (hasSlot) state.scene.activeLogoSlot = slot;
    }
    state.scene.layerVisibility = {
      preview: { ...DEFAULT_SCENE_STATE.layerVisibility.preview, ...((state.scene.layerVisibility || {}).preview || {}) },
      program: { ...DEFAULT_SCENE_STATE.layerVisibility.program, ...((state.scene.layerVisibility || {}).program || {}) }
    };
    if (target === 'preview' || target === 'both') state.scene.layerVisibility.preview[layer] = true;
    if (target === 'program' || target === 'both') state.scene.layerVisibility.program[layer] = true;
    state.scene.updatedAt = new Date().toISOString();
    await saveSharedState();
    await db.audit('scene_layer_trigger', { user: req.session?.user?.username || 'token', layer, target });
    io.emit('state', state);
    res.json({ ok:true, scene: state.scene });
  } catch (err) {
    recordError('scene_layer_trigger', err.message, 'orange');
    res.status(500).json({ ok:false, error: humanError(err.message) });
  }
});

app.post('/api/scene/layer-clear', requireControl, async (req, res) => {
  try {
    await loadSharedState();
    state.scene = normaliseScene(state.scene);
    const target = ['preview','program','both'].includes(req.body.target) ? req.body.target : 'program';
    const layer = String(req.body.layer || '').trim();
    const validLayers = ['bug','logo','clock'];
    state.scene.layerVisibility = {
      preview: { ...DEFAULT_SCENE_STATE.layerVisibility.preview, ...((state.scene.layerVisibility || {}).preview || {}) },
      program: { ...DEFAULT_SCENE_STATE.layerVisibility.program, ...((state.scene.layerVisibility || {}).program || {}) }
    };

    // If a layer is supplied, cut only that layer. If no layer is supplied, keep the old behaviour
    // and clear all overlay layers for the requested target. This keeps Logo, Bug and Clock independent.
    if (layer && !validLayers.includes(layer)) return res.status(400).json({ ok:false, error:'Unknown layer.' });
    const clearTarget = (t) => {
      if (layer) {
        state.scene.layerVisibility[t][layer] = false;
        if (layer === 'logo') {
          state.scene.logoUrls = { ...DEFAULT_SCENE_STATE.logoUrls, ...(state.scene.logoUrls || {}) };
          state.scene.logoUrls[t] = '';
        }
      } else {
        state.scene.layerVisibility[t] = { bug:false, logo:false, clock:false };
        state.scene.logoUrls = { ...DEFAULT_SCENE_STATE.logoUrls, ...(state.scene.logoUrls || {}) };
        state.scene.logoUrls[t] = '';
      }
    };
    if (target === 'preview' || target === 'both') clearTarget('preview');
    if (target === 'program' || target === 'both') clearTarget('program');

    state.scene.updatedAt = new Date().toISOString();
    await saveSharedState();
    await db.audit('scene_layer_clear', { user: req.session?.user?.username || 'token', target, layer: layer || 'all' });
    io.emit('clearRender', { kind:'layer', target, layer: layer || 'all', seq:Date.now() });
    io.emit('state', state);
    res.json({ ok:true, scene: state.scene });
  } catch (err) {
    recordError('scene_layer_clear', err.message, 'orange');
    res.status(500).json({ ok:false, error: humanError(err.message) });
  }
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
    version: 3,
    appVersion: APP_VERSION,
    includesUsers: true,
    exportedAt: new Date().toISOString(),
    appState: sharedState,
    graphicsSettings: sharedState.graphicsSettings || DEFAULT_GRAPHICS_SETTINGS,
    outputSettings: sharedState.outputSettings || DEFAULT_OUTPUT_SETTINGS,
    uiSettings: sharedState.uiSettings || defaultUiSettings(),
    graphicsPresets: sharedState.graphicsPresets || [],
    database
  };
  await db.audit('export_config', { user: req.session.user.username, eventId: sharedState.eventId, includesUsers: true });
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
      outputSettings: normaliseOutputSettings(payload.outputSettings || incomingState.outputSettings || state.outputSettings),
      broadcastEngine: normaliseBroadcastEngine(payload.broadcastEngine || incomingState.broadcastEngine || state.broadcastEngine),
      scene: normaliseScene(incomingState.scene || payload.scene || state.scene),
      uiSettings: normaliseUiSettings(payload.uiSettings || incomingState.uiSettings || state.uiSettings || {}),
      graphicsPresets: Array.isArray(payload.graphicsPresets || incomingState.graphicsPresets) ? (payload.graphicsPresets || incomingState.graphicsPresets).slice(0,100) : (state.graphicsPresets || [])
    };
    if (!state.graphic) state.graphic = { type: 'blank', stageId: 0, page: 1, pageSize: 10, title: '', updatedAt: new Date().toISOString() };
    await saveSharedState();

    let databaseResult = null;
    if (payload.database) databaseResult = await db.importAll(payload.database, mode);

    await db.audit('import_config', { user: req.session.user.username, mode, importedDatabase: !!payload.database, usersRestored: databaseResult?.users || 0 });
    io.emit('graphicsSettings', state.graphicsSettings);
    io.emit('outputSettings', state.outputSettings);
    io.emit('broadcastEngine', { config: state.broadcastEngine, status: broadcastStatus() });
    io.emit('state', state);
    res.json({ ok: true, result: { mode, stateImported: true, database: databaseResult } });
  }
  catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});


app.get('/api/broadcast-engine', requireLogin, async (req, res) => {
  await loadSharedState();
  res.json({ ok:true, config: state.broadcastEngine, status: await getBroadcastStatus(), ffmpegPath: state.broadcastEngine.ffmpegPath, remoteEngine: Boolean(FFMPEG_ENGINE_URL) });
});

app.post('/api/broadcast-engine', requireControl, async (req, res) => {
  await loadSharedState();
  state.broadcastEngine = normaliseBroadcastEngine(req.body.config || req.body || state.broadcastEngine);
  await saveSharedState();
  io.emit('broadcastEngine', { config: state.broadcastEngine, status: broadcastStatus() });
  res.json({ ok:true, config: state.broadcastEngine, status: await getBroadcastStatus() });
});

app.post('/api/broadcast-engine/apply-incoming', requireControl, async (req, res) => {
  await loadSharedState();
  state.broadcastEngine = normaliseBroadcastEngine(req.body.config || state.broadcastEngine);
  const incomingUrl = String(state.broadcastEngine.incoming?.url || DEFAULT_INCOMING_URL).trim();
  for (const key of ['youtube_overlay_primary','youtube_overlay_backup','youtube_overlay','youtube_passthrough']) {
    if (state.broadcastEngine.outputs[key]) state.broadcastEngine.outputs[key].inputUrl = incomingUrl;
  }
  await saveSharedState();
  const status = await getBroadcastStatus();
  io.emit('broadcastEngine', { config: state.broadcastEngine, status });
  res.json({ ok:true, config: state.broadcastEngine, status });
});

app.post('/api/broadcast-engine/start/:key', requireControl, async (req, res) => {
  try {
    await loadSharedState();
    const key = String(req.params.key || '');
    if (FFMPEG_ENGINE_URL) {
      const status = await startRemoteBroadcast(key, 'single');
      io.emit('broadcastEngine', { config: state.broadcastEngine, status });
      return res.json({ ok:true, remote:true, status });
    }
    if (broadcastProcesses.has(key)) return res.json({ ok:true, message:'Already running', status: broadcastStatus() });
    let command = state.broadcastEngine.ffmpegPath;
    let args = buildFfmpegArgs(state.broadcastEngine, key);
    let displayCommand = `${command} ${args.join(' ')}`;
    if (['youtube_overlay','youtube_overlay_primary','youtube_overlay_backup'].includes(key)) {
      const overlayCmd = buildOverlayStreamCommand(state.broadcastEngine, key);
      command = overlayCmd.command;
      args = overlayCmd.args;
      displayCommand = overlayCmd.display;
    } else if (['youtube','youtube_graphics_primary','youtube_graphics_backup','facebook','twitch','mediamtx_graphics'].includes(key)) {
      const browserCmd = buildBrowserStreamCommand(state.broadcastEngine, key);
      command = browserCmd.command;
      args = browserCmd.args;
      displayCommand = browserCmd.display;
    }
    logBroadcast(key, `Starting: ${displayCommand}`);
    const child = spawn(command, args, { cwd: path.join(__dirname, '..'), stdio: ['ignore','pipe','pipe'], env: { ...process.env } });
    broadcastProcesses.set(key, child);
    child.stdout.on('data', d => logBroadcast(key, d.toString()));
    child.stderr.on('data', d => logBroadcast(key, d.toString()));
    child.on('error', err => { logBroadcast(key, `ERROR: ${err.message}`); recordError('broadcast', `${key}: ${err.message}`, 'red'); broadcastProcesses.delete(key); io.emit('broadcastEngine', { config: state.broadcastEngine, status: broadcastStatus() }); });
    child.on('exit', (code, signal) => { logBroadcast(key, `Stopped with code ${code ?? ''} ${signal ?? ''}`); broadcastProcesses.delete(key); io.emit('broadcastEngine', { config: state.broadcastEngine, status: broadcastStatus() }); });
    io.emit('broadcastEngine', { config: state.broadcastEngine, status: broadcastStatus() });
    res.json({ ok:true, pid: child.pid, args, status: broadcastStatus() });
  } catch (err) { recordError('broadcast', err.message, 'red'); res.status(400).json({ ok:false, error: humanError(err.message) }); }
});


app.post('/api/broadcast-engine/start-youtube/:mode', requireControl, async (req, res) => {
  try {
    const mode = String(req.params.mode || '').toLowerCase();
    const keys = mode === 'graphics'
      ? ['youtube_graphics_primary','youtube_graphics_backup']
      : ['youtube_overlay_primary','youtube_overlay_backup'];
    if (FFMPEG_ENGINE_URL) {
      const status = await startRemoteBroadcast(mode === 'graphics' ? 'youtube_graphics_pair' : 'youtube_overlay_pair', mode);
      io.emit('broadcastEngine', { config: state.broadcastEngine, status });
      return res.json({ ok:true, remote:true, status });
    }
    const started = [];
    for (const key of keys) {
      if (broadcastProcesses.has(key)) { started.push({ key, alreadyRunning:true }); continue; }
      let cmd;
      if (mode === 'graphics') cmd = buildBrowserStreamCommand(state.broadcastEngine, key);
      else cmd = buildOverlayStreamCommand(state.broadcastEngine, key);
      logBroadcast(key, `Starting YouTube ${mode} redundant output: ${cmd.display}`);
      const child = spawn(cmd.command, cmd.args, { cwd: path.join(__dirname, '..'), env: { ...process.env, FFMPEG_PATH: state.broadcastEngine.ffmpegPath || 'ffmpeg' } });
      broadcastProcesses.set(key, child);
      child.stdout.on('data', d => logBroadcast(key, d.toString()));
      child.stderr.on('data', d => logBroadcast(key, d.toString()));
      child.on('error', err => { logBroadcast(key, `ERROR: ${err.message}`); recordError('broadcast', `${key}: ${err.message}`, 'red'); broadcastProcesses.delete(key); io.emit('broadcastEngine', { config: state.broadcastEngine, status: broadcastStatus() }); });
      child.on('exit', (code, signal) => { logBroadcast(key, `Stopped with code ${code ?? ''} ${signal ?? ''}`); broadcastProcesses.delete(key); io.emit('broadcastEngine', { config: state.broadcastEngine, status: broadcastStatus() }); });
      started.push({ key, pid: child.pid });
    }
    io.emit('broadcastEngine', { config: state.broadcastEngine, status: broadcastStatus() });
    res.json({ ok:true, started, status:broadcastStatus() });
  } catch (e) { res.status(400).json({ ok:false, error:e.message }); }
});

app.post('/api/broadcast-engine/stop/:key', requireControl, async (req, res) => {
  const key = String(req.params.key || '');
  if (FFMPEG_ENGINE_URL) {
    const status = await stopRemoteBroadcast(key);
    io.emit('broadcastEngine', { config: state.broadcastEngine, status });
    return res.json({ ok:true, remote:true, status });
  }
  const child = broadcastProcesses.get(key);
  if (child) { logBroadcast(key, 'Stopping by controller request'); child.kill('SIGTERM'); setTimeout(()=>{ if (broadcastProcesses.has(key)) { try { child.kill('SIGKILL'); } catch(_){} } }, 3000); }
  broadcastProcesses.delete(key);
  io.emit('broadcastEngine', { config: state.broadcastEngine, status: broadcastStatus() });
  res.json({ ok:true, status: broadcastStatus() });
});

app.post('/api/broadcast-engine/stop-all', requireControl, async (req, res) => {
  if (FFMPEG_ENGINE_URL) {
    const status = await stopAllRemoteBroadcast();
    io.emit('broadcastEngine', { config: state.broadcastEngine, status });
    return res.json({ ok:true, remote:true, status });
  }
  for (const [key, child] of broadcastProcesses.entries()) { logBroadcast(key, 'Stopping by controller request'); try { child.kill('SIGTERM'); } catch(_){} broadcastProcesses.delete(key); }
  io.emit('broadcastEngine', { config: state.broadcastEngine, status: broadcastStatus() });
  res.json({ ok:true, status: broadcastStatus() });
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


function defaultUiSettings(){
  return {
    operatorLock: false,
    safeGuides: false,
    shortcuts: {
      take: 'Space',
      clear: 'Escape',
      preview: 'KeyP',
      takePreview: 'KeyT',
      openPreview: 'F8',
      openOutput: 'F9'
    }
  };
}
function normaliseUiSettings(input={}){
  const defaults = defaultUiSettings();
  return {
    operatorLock: Boolean(input.operatorLock ?? defaults.operatorLock),
    safeGuides: Boolean(input.safeGuides ?? defaults.safeGuides),
    shortcuts: { ...defaults.shortcuts, ...(input.shortcuts || {}) }
  };
}
app.get('/api/ui-settings', requireLogin, async (req, res) => {
  await loadSharedState();
  state.uiSettings = normaliseUiSettings(state.uiSettings || {});
  res.json({ ok:true, settings: state.uiSettings });
});
app.post('/api/ui-settings', requireLogin, async (req, res) => {
  await loadSharedState();
  state.uiSettings = normaliseUiSettings(req.body || {});
  await saveSharedState();
  io.emit('uiSettings', state.uiSettings);
  io.emit('state', state);
  res.json({ ok:true, settings: state.uiSettings });
});
app.get('/api/graphics-presets', requireLogin, async (req, res) => {
  await loadSharedState();
  state.graphicsPresets = Array.isArray(state.graphicsPresets) ? state.graphicsPresets : [];
  res.json({ ok:true, presets: state.graphicsPresets });
});
app.post('/api/graphics-presets', requireLogin, async (req, res) => {
  await loadSharedState();
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ ok:false, error:'Preset name required' });
  const preset = { name, scope:req.body.scope || 'global', settings: normaliseGraphicsSettings(req.body.settings || state.graphicsSettings), updatedAt:new Date().toISOString() };
  state.graphicsPresets = (Array.isArray(state.graphicsPresets) ? state.graphicsPresets : []).filter(p => p.name !== name);
  state.graphicsPresets.unshift(preset);
  state.graphicsPresets = state.graphicsPresets.slice(0,100);
  await saveSharedState();
  res.json({ ok:true, presets: state.graphicsPresets });
});
app.delete('/api/graphics-presets/:name', requireLogin, async (req, res) => {
  await loadSharedState();
  const name = String(req.params.name || '');
  state.graphicsPresets = (Array.isArray(state.graphicsPresets) ? state.graphicsPresets : []).filter(p => p.name !== name);
  await saveSharedState();
  res.json({ ok:true, presets: state.graphicsPresets });
});

async function httpJson(url, timeoutMs=1500){
  return new Promise(resolve => {
    const lib = url.startsWith('https:') ? require('https') : require('http');
    const req = lib.get(url, { timeout: timeoutMs }, res => {
      let data='';
      res.on('data', d => { data += d; if(data.length > 1024*1024) req.destroy(); });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, data: data ? JSON.parse(data) : {} }); }
        catch { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, data: data.slice(0,500) }); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', err => resolve({ ok:false, error:err.message }));
  });
}
function serviceLed(ok, configured=true){ return configured === false ? 'grey' : (ok ? 'green' : 'red'); }

function uniqueList(items){
  return [...new Set(items.filter(Boolean).map(x => String(x).replace(/\/$/, '')) )];
}
async function firstWorkingJson(baseUrls, path, timeoutMs=1500){
  let last = { ok:false, error:'not checked' };
  for (const base of uniqueList(baseUrls)) {
    const r = await httpJson(base + path, timeoutMs);
    if (r.ok) return { ...r, baseUrl:base, tried:baseUrls };
    last = { ...r, baseUrl:base, tried:baseUrls };
  }
  return last;
}
async function serviceHttpStatus(name, urls, path='/healthz', timeoutMs=1000){
  const r = await firstWorkingJson(urls, path, timeoutMs);
  return {
    status: r.ok ? 'green' : 'orange',
    message: r.ok ? `Reachable at ${r.baseUrl}` : `Not reachable via service DNS (${r.error || 'no response'})`,
    url: r.baseUrl || urls[0]
  };
}

function dockerStatusFromContainer(c){
  if (!c) return { status:'red', message:'Container not found' };
  const state = c.State || '';
  const health = c.Status || '';
  const running = state === 'running';
  if (!running) return { status:'red', message:health || state || 'Not running', container:c };
  if (/\(unhealthy\)/i.test(health)) return { status:'red', message:health, container:c };
  if (/\(health: starting\)/i.test(health)) return { status:'orange', message:health, container:c };
  return { status:'green', message:health || 'Running', container:c };
}
async function dockerRequest(path, timeoutMs=1200){
  const socketPath = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
  return new Promise(resolve => {
    const req = require('http').request({ socketPath, path, method:'GET', timeout: timeoutMs }, res => {
      let data='';
      res.on('data', d => { data += d; if(data.length > 5*1024*1024) req.destroy(); });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, data: data ? JSON.parse(data) : null }); }
        catch { resolve({ ok:false, statusCode:res.statusCode, error:'Invalid Docker API response' }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', err => resolve({ ok:false, error:err.message }));
    req.end();
  });
}
async function collectDockerManager(){
  const r = await dockerRequest('/containers/json?all=1');
  if(!r.ok) return { ok:false, status:'grey', message:`Docker socket not available (${r.error || 'not mounted'})`, containers:[], byService:{} };
  const containers = (r.data || []).map(c => ({
    id: c.Id,
    names: (c.Names || []).map(n => String(n).replace(/^\//,'')),
    image: c.Image,
    state: c.State,
    statusText: c.Status,
    service: c.Labels?.['com.docker.compose.service'] || '',
    project: c.Labels?.['com.docker.compose.project'] || '',
    created: c.Created,
    ports: c.Ports || []
  }));
  const byService = {};
  for(const c of containers){
    const keys = [c.service, ...c.names].filter(Boolean);
    for(const k of keys){ if(!byService[k]) byService[k] = c; }
  }
  return { ok:true, status:'green', message:`Docker Engine online · ${containers.filter(c=>c.state==='running').length}/${containers.length} containers running`, containers, byService };
}
function serviceFromDocker(docker, serviceName, aliases=[]){
  if(!docker?.ok) return { status:'grey', message:'Docker status unavailable' };
  const c = [serviceName, ...aliases].map(k => docker.byService?.[k]).find(Boolean);
  return dockerStatusFromContainer(c);
}
function optionalServiceFromDocker(docker, serviceName, aliases=[]){
  if(!docker?.ok) return { status:'grey', message:'Docker status unavailable' };
  const c = [serviceName, ...aliases].map(k => docker.byService?.[k]).find(Boolean);
  if(!c) return { status:'grey', message:'Optional service not enabled' };
  return dockerStatusFromContainer(c);
}
function shortContainerMessage(st){
  return st?.message || 'Unknown';
}

async function collectBroadcastHealth(docker){
  const ffmpegCandidates = uniqueList([
    process.env.FFMPEG_ENGINE_URL,
    'http://ffmpeg-engine:3100',
    'http://rally-graphics-ffmpeg-engine:3100',
    'http://localhost:3100'
  ]);
  const mediamtxCandidates = uniqueList([
    process.env.MEDIAMTX_API_URL,
    'http://mediamtx:9997',
    'http://rally-graphics-mediamtx:9997',
    'http://localhost:9997'
  ]);
  const ffDocker = serviceFromDocker(docker, 'ffmpeg-engine', ['rally-graphics-ffmpeg-engine']);
  const mtDocker = serviceFromDocker(docker, 'mediamtx', ['rally-graphics-mediamtx']);
  const ffHealth = await firstWorkingJson(ffmpegCandidates, '/status', 1800);
  let mtPaths = await firstWorkingJson(mediamtxCandidates, '/v3/paths/list', 1800);
  const mtApiProbe = mtPaths.ok ? mtPaths : await firstWorkingJson(mediamtxCandidates, '/v3/config/global/get', 1500);
  const mtBase = (mtPaths.ok ? mtPaths.baseUrl : mtApiProbe.baseUrl) || mediamtxCandidates[0];
  const mtRtmp = mtBase && mtApiProbe.ok ? await httpJson(mtBase + '/v3/rtmpconns/list', 1200) : { ok:false };
  const mtRtsp = mtBase && mtApiProbe.ok ? await httpJson(mtBase + '/v3/rtspconns/list', 1200) : { ok:false };
  const mtSrt = mtBase && mtApiProbe.ok ? await httpJson(mtBase + '/v3/srtconns/list', 1200) : { ok:false };
  const ffStatus = ffHealth.data?.status || {};
  const runningJobs = Object.values(ffStatus).filter(x => x && x.running).length;
  const pathItems = Array.isArray(mtPaths.data?.items) ? mtPaths.data.items : [];
  const publisherCount = pathItems.filter(p => p.ready || p.sourceReady).length;
  const subscriberCount = pathItems.reduce((acc,p) => acc + Number(p.readers?.length || p.readerCount || 0), 0);
  let ffState = ffHealth.ok ? (runningJobs > 0 ? 'green' : 'yellow') : (ffDocker.status === 'green' ? 'orange' : ffDocker.status);
  let ffMsg = ffHealth.ok ? (runningJobs > 0 ? `Running · ${runningJobs} active job${runningJobs===1?'':'s'}` : 'Idle · online · 0 active jobs') : (ffDocker.status === 'green' ? `Container running, API not reachable (${ffHealth.error || 'no response'})` : `Offline · ${ffHealth.error || shortContainerMessage(ffDocker)}`);
  let mtState = mtApiProbe.ok ? 'green' : (mtDocker.status === 'green' ? 'orange' : mtDocker.status);
  let mtMsg = mtApiProbe.ok ? `Online · ${publisherCount} publisher${publisherCount===1?'':'s'} · ${subscriberCount} subscriber${subscriberCount===1?'':'s'}` : (mtDocker.status === 'green' ? `Container running, API not reachable (${mtApiProbe.error || mtPaths.error || 'no response'})` : `Offline · ${mtApiProbe.error || mtPaths.error || shortContainerMessage(mtDocker)}`);
  return {
    ffmpeg: { ok: ffHealth.ok, containerStatus: ffDocker.status, status: ffState, message: ffMsg, url: ffHealth.baseUrl || ffmpegCandidates[0], activeJobs: runningJobs, jobs: ffStatus },
    mediamtx: { ok: mtApiProbe.ok, containerStatus: mtDocker.status, status: mtState, message: mtMsg, apiUrl: mtBase || mediamtxCandidates[0], triedUrls: mediamtxCandidates, paths: pathItems.map(p => ({ name:p.name, ready: !!(p.ready || p.sourceReady), readers:p.readers?.length || p.readerCount || 0 })).slice(0,50), connections: { rtmp: mtRtmp.ok ? (mtRtmp.data?.itemCount ?? mtRtmp.data?.items?.length ?? 0) : null, rtsp: mtRtsp.ok ? (mtRtsp.data?.itemCount ?? mtRtsp.data?.items?.length ?? 0) : null, srt: mtSrt.ok ? (mtSrt.data?.itemCount ?? mtSrt.data?.items?.length ?? 0) : null } }
  };
}

app.get('/api/system/status', requireLogin, async (req, res) => {
  const database = await db.status();
  let internet = { ok:true, warning:false, message:'Rally data connection looks OK' };
  try { await scraper.getEventInfo(state.eventId || DEFAULT_EVENT_ID, 1); }
  catch (err) { internet = { ok:false, warning:true, message: humanError(err.message) }; recordError('internet', err.message, 'orange'); }
  const shared = await loadSharedState();
  const socketCount = io.engine.clientsCount || 0;
  const previewOnline = outputSockets.preview.size > 0;
  const programOnline = outputSockets.program.size > 0;
  const cfg = { version: APP_VERSION, exportedConfigVersion: 3 };
  const docker = await collectDockerManager();
  const broadcast = await collectBroadcastHealth(docker);
  const app1Docker = serviceFromDocker(docker, 'app1');
  const app2Docker = optionalServiceFromDocker(docker, 'app2');
  const nginxDocker = optionalServiceFromDocker(docker, 'nginx', ['rally-graphics-nginx']);
  const postgresDocker = serviceFromDocker(docker, 'postgres', ['rally-graphics-postgres']);
  const containers = {
    app1: { status: app1Docker.status === 'red' ? 'orange' : 'green', message:`Current controller instance ${INSTANCE_ID} online${app1Docker.message ? ' · ' + app1Docker.message : ''}` },
    app2: { status: app2Docker.status, message: app2Docker.status === 'green' ? `Worker online · ${app2Docker.message}` : shortContainerMessage(app2Docker) },
    nginx: { status: nginxDocker.status, message: nginxDocker.status === 'green' ? `Reverse proxy running · ${nginxDocker.message}` : shortContainerMessage(nginxDocker) },
    postgres: { status: database.ok ? 'green' : (postgresDocker.status === 'green' ? 'orange' : postgresDocker.status), message: database.ok ? 'Online' : (database.message || shortContainerMessage(postgresDocker)) },
    ffmpegEngine: { status:broadcast.ffmpeg.status, message:broadcast.ffmpeg.message },
    mediamtx: { status:broadcast.mediamtx.status, message:broadcast.mediamtx.message }
  };
  broadcast.summary = {
    input: (broadcast.mediamtx.paths || []).some(p => p.ready) ? 'MediaMTX input active' : 'Idle / disconnected',
    graphics: 'Existing RGE graphics output ready',
    outputs: broadcast.ffmpeg.activeJobs > 0 ? `${broadcast.ffmpeg.activeJobs} FFmpeg job${broadcast.ffmpeg.activeJobs===1?'':'s'} running` : 'Idle'
  };
  res.json({ ok:true, version: APP_VERSION, app:{ok:true,message:'Application API online'}, database, internet, outputs:{ sockets: socketCount, previewOnline, programOnline, preview: previewOnline ? 'Preview output connected' : 'Preview page not open', program: programOnline ? 'Program output connected' : 'Program output page not open' }, broadcast, containers, config:cfg, state:shared });
});
app.get('/api/error-log', requireLogin, async (req, res) => {
  const database = await db.status();
  const items = [...errorEvents];
  if (!database.ok) items.unshift({ time:new Date().toISOString(), kind:'database', message:humanError(database.message || 'Postgres database not online'), severity:'red' });
  res.json({ ok:true, errors:items.slice(0,50) });
});
app.post('/api/error-log/clear', requireLogin, (req, res) => { errorEvents.length = 0; res.json({ ok:true }); });

app.use((err, req, res, next) => { recordError('server', err.message || err, 'red'); res.status(500).json({ ok:false, error:humanError(err.message || err) }); });

io.on('connection', async socket => {
  socket.emit('state', await loadSharedState());
  socket.on('outputMode', mode => {
    if (mode === 'preview' || mode === 'program') {
      outputSockets[mode].add(socket.id);
      socket.on('disconnect', () => outputSockets[mode].delete(socket.id));
    }
  });
});

(async () => {
  try { await db.init(); await loadSharedState(); await saveSharedState(); console.log(`Database initialised on ${INSTANCE_ID}:`, await db.status()); }
  catch (err) { console.error('Database init failed:', err.message); }
  if (process.argv.includes('--migrate-only')) process.exit(0);
  server.listen(PORT, () => console.log(`Rally Graphics ${INSTANCE_ID} running on http://0.0.0.0:${PORT}`));
})();
