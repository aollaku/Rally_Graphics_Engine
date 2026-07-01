const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = Number(process.env.PORT || 3100);
const DEFAULT_GRAPHICS_URL = process.env.RGE_GRAPHICS_URL || 'http://app1:3000/output/live';
const DEFAULT_INCOMING_URL = process.env.RGE_INCOMING_URL || 'rtmp://mediamtx:1935/live';
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const processes = new Map();
const logs = new Map();

function log(key, line){
  const arr = logs.get(key) || [];
  arr.push(`[${new Date().toLocaleTimeString()}] ${String(line).replace(/\r?\n/g,' ').slice(0,600)}`);
  while(arr.length > 100) arr.shift();
  logs.set(key, arr);
}
function status(){
  const out = {};
  const keys = new Set([...processes.keys(), ...logs.keys()]);
  for(const key of keys){
    const p = processes.get(key);
    out[key] = { running: Boolean(p && !p.killed), pid: p?.pid || null, logs: (logs.get(key)||[]).slice(-12) };
  }
  return out;
}
function splitArgs(str=''){
  const out=[]; let cur=''; let quote=null;
  for(let i=0;i<str.length;i++){
    const ch=str[i];
    if(quote){ if(ch===quote) quote=null; else cur+=ch; }
    else if(ch==='"' || ch==="'") quote=ch;
    else if(/\s/.test(ch)){ if(cur){ out.push(cur); cur=''; } }
    else cur+=ch;
  }
  if(cur) out.push(cur);
  return out;
}
function normaliseEngine(config={}){
  const n = (v,d)=> Number.isFinite(Number(v)) ? Number(v) : d;
  return {
    inputUrl: String(config.inputUrl || DEFAULT_GRAPHICS_URL),
    incoming: { url: String(config.incoming?.url || DEFAULT_INCOMING_URL), ...(config.incoming || {}) },
    width: Math.max(320, Math.min(7680, n(config.width,1920))),
    height: Math.max(240, Math.min(4320, n(config.height,1080))),
    frameRate: Math.max(1, Math.min(120, n(config.frameRate,50))),
    videoBitrate: String(config.videoBitrate || '6000k'),
    audioBitrate: String(config.audioBitrate || '160k'),
    outputs: config.outputs || {}
  };
}
function buildBrowserCommand(engine, profile){
  const input = profile.inputUrl || engine.inputUrl || DEFAULT_GRAPHICS_URL;
  const dest = String(profile.destination || '').trim();
  if(!dest || /STREAM_KEY/i.test(dest)) throw new Error('Add the full YouTube/RTMP URL including the stream key');
  const script = path.join(__dirname, 'scripts', 'rge-stream-browser.sh');
  return { command:'/bin/bash', args:[script, input, dest, String(engine.width), String(engine.height), String(engine.frameRate), engine.videoBitrate, engine.audioBitrate, profile.extraArgs || ''] };
}
function buildOverlayCommand(engine, profile){
  const videoInput = profile.inputUrl || engine.incoming?.url || DEFAULT_INCOMING_URL;
  const graphicsUrl = engine.inputUrl || DEFAULT_GRAPHICS_URL;
  const dest = String(profile.destination || '').trim();
  if(!videoInput) throw new Error('No incoming stream URL configured');
  if(!dest || /STREAM_KEY/i.test(dest)) throw new Error('Add the full YouTube/RTMP URL including the stream key');
  const script = path.join(__dirname, 'scripts', 'rge-overlay-to-youtube.sh');
  return { command:'/bin/bash', args:[script, videoInput, graphicsUrl, dest, String(engine.width), String(engine.height), String(engine.frameRate), engine.videoBitrate, engine.audioBitrate, profile.extraArgs || ''] };
}
function buildSimpleCommand(engine, key, profile){
  const input = profile.inputUrl || engine.incoming?.url || engine.inputUrl;
  if(!input) throw new Error('No input URL configured');
  const common = ['-hide_banner','-loglevel','info','-re','-i',input,'-r',String(engine.frameRate),'-s',`${engine.width}x${engine.height}`,'-c:v','libx264','-preset','veryfast','-tune','zerolatency','-b:v',engine.videoBitrate,'-pix_fmt','yuv420p','-c:a','aac','-b:a',engine.audioBitrate];
  const extra = splitArgs(profile.extraArgs || '');
  if(key === 'srt') return { command: FFMPEG_PATH, args:[...common,...extra,'-f','mpegts',profile.destination] };
  if(key === 'recorder') return { command: FFMPEG_PATH, args:[...common,...extra,'-movflags','+faststart',profile.destination] };
  return { command: FFMPEG_PATH, args:[...common,...extra,'-f','flv',profile.destination] };
}
function commandFor(key, mode, config){
  const engine = normaliseEngine(config);
  const outputs = engine.outputs || {};
  if(key === 'youtube_graphics_pair') return ['youtube_graphics_primary','youtube_graphics_backup'].map(k => [k, buildBrowserCommand(engine, outputs[k] || {})]);
  if(key === 'youtube_overlay_pair') return ['youtube_overlay_primary','youtube_overlay_backup'].map(k => [k, buildOverlayCommand(engine, outputs[k] || {})]);
  const profile = outputs[key] || {};
  if(['youtube_overlay','youtube_overlay_primary','youtube_overlay_backup'].includes(key)) return [[key, buildOverlayCommand(engine, profile)]];
  if(['youtube','youtube_graphics_primary','youtube_graphics_backup','facebook','twitch','mediamtx_graphics'].includes(key)) return [[key, buildBrowserCommand(engine, profile)]];
  return [[key, buildSimpleCommand(engine, key, profile)]];
}
function startKey(key, cmd){
  if(processes.has(key)) return { key, alreadyRunning:true, pid:processes.get(key).pid };
  log(key, `Starting in ffmpeg-engine container: ${cmd.command} ${cmd.args.map((a,i)=> i===2 && String(a).startsWith('rtmp') ? '[destination hidden]' : a).join(' ')}`);
  const child = spawn(cmd.command, cmd.args, { cwd: __dirname, stdio:['ignore','pipe','pipe'], env:{...process.env, FFMPEG_PATH} });
  processes.set(key, child);
  child.stdout.on('data', d => log(key, d.toString()));
  child.stderr.on('data', d => log(key, d.toString()));
  child.on('error', err => { log(key, `ERROR: ${err.message}`); processes.delete(key); });
  child.on('exit', (code, signal) => { log(key, `Stopped with code ${code ?? ''} ${signal ?? ''}`); processes.delete(key); });
  return { key, pid: child.pid };
}
function send(res, code, data){ res.writeHead(code, {'Content-Type':'application/json'}); res.end(JSON.stringify(data)); }
function readBody(req){ return new Promise(resolve => { let b=''; req.on('data',d=>{ b+=d; if(b.length>2_000_000) req.destroy(); }); req.on('end',()=>{ try{ resolve(b?JSON.parse(b):{}); }catch{ resolve({}); } }); }); }

http.createServer(async (req,res)=>{
  try{
    if(req.method==='GET' && req.url==='/healthz') return send(res,200,{ok:true});
    if(req.method==='GET' && req.url==='/status') return send(res,200,{ok:true,status:status()});
    if(req.method==='POST' && req.url==='/start'){
      const body = await readBody(req);
      const started = commandFor(String(body.key||''), String(body.mode||'single'), body.config||{}).map(([key,cmd]) => startKey(key,cmd));
      return send(res,200,{ok:true,started,status:status()});
    }
    if(req.method==='POST' && req.url.startsWith('/stop/')){
      const key = decodeURIComponent(req.url.split('/').pop() || '');
      const p = processes.get(key);
      if(p){ log(key,'Stopping by controller request'); try{ p.kill('SIGTERM'); }catch{} processes.delete(key); }
      return send(res,200,{ok:true,status:status()});
    }
    if(req.method==='POST' && req.url==='/stop-all'){
      for(const [key,p] of processes.entries()){ log(key,'Stopping by controller request'); try{ p.kill('SIGTERM'); }catch{} }
      processes.clear();
      return send(res,200,{ok:true,status:status()});
    }
    send(res,404,{ok:false,error:'Not found'});
  }catch(e){ send(res,400,{ok:false,error:e.message}); }
}).listen(PORT,()=>console.log(`ffmpeg-engine listening on ${PORT}`));
