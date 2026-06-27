const { Pool } = require('pg');
const crypto = require('crypto');

const DATABASE_URL = process.env.DATABASE_URL || '';
const DEFAULT_ADMIN_USER = process.env.DEFAULT_ADMIN_USER || 'superadmin';
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'superadmin123';
let pool = null;
let memoryUsers = [];

function dbEnabled(){ return Boolean(DATABASE_URL); }
function getPool(){
  if (!dbEnabled()) return null;
  if (!pool) pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
  return pool;
}

async function query(sql, params=[]){
  const p = getPool();
  if (!p) return { rows: [], rowCount: 0 };
  return p.query(sql, params);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')){
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored){
  if (!stored || !String(stored).includes(':')) return false;
  const [salt, hash] = String(stored).split(':');
  const test = hashPassword(password, salt).split(':')[1];
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}
function cleanUser(row){
  if (!row) return null;
  return { id: row.id, username: row.username, role: row.role, displayName: row.display_name || row.displayName || row.username, enabled: row.enabled !== false, createdAt: row.created_at || row.createdAt, updatedAt: row.updated_at || row.updatedAt };
}

async function init(){
  if (!dbEnabled()) {
    memoryUsers = [{ id: 1, username: DEFAULT_ADMIN_USER, password_hash: hashPassword(DEFAULT_ADMIN_PASSWORD), role: 'admin', display_name: 'Super Admin', enabled: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }];
    return false;
  }
  await query(`
    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      title TEXT,
      event_date TEXT,
      subtitle TEXT,
      source_url TEXT,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS result_snapshots (
      id BIGSERIAL PRIMARY KEY,
      event_id TEXT NOT NULL,
      result_type TEXT NOT NULL,
      stage_id INTEGER NOT NULL DEFAULT 0,
      data JSONB NOT NULL,
      source_url TEXT,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(event_id, result_type, stage_id)
    );
    CREATE TABLE IF NOT EXISTS graphics_history (
      id BIGSERIAL PRIMARY KEY,
      event_id TEXT NOT NULL,
      graphic JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS rundowns (
      event_id TEXT PRIMARY KEY,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operator',
      display_name TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (id = 1)
    );
  `);
  const existing = await query('SELECT id FROM users WHERE username=$1', [DEFAULT_ADMIN_USER]);
  if (!existing.rowCount) {
    await query(`INSERT INTO users(username,password_hash,role,display_name,enabled) VALUES($1,$2,'admin','Super Admin',true)`, [DEFAULT_ADMIN_USER, hashPassword(DEFAULT_ADMIN_PASSWORD)]);
    await audit('seed_default_superadmin', { username: DEFAULT_ADMIN_USER });
  }
  return true;
}

async function findUserByUsername(username){
  const u = String(username || '').trim().toLowerCase();
  if (!u) return null;
  if (!dbEnabled()) return memoryUsers.find(x => x.username === u) || null;
  const r = await query('SELECT * FROM users WHERE lower(username)=lower($1) LIMIT 1', [u]);
  return r.rows[0] || null;
}
async function findUserById(id){
  if (!id) return null;
  if (!dbEnabled()) return cleanUser(memoryUsers.find(x => Number(x.id) === Number(id)));
  const r = await query('SELECT id,username,role,display_name,enabled,created_at,updated_at FROM users WHERE id=$1 LIMIT 1', [id]);
  return cleanUser(r.rows[0]);
}
async function authenticate(username, password){
  const user = await findUserByUsername(username);
  if (!user || user.enabled === false) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  return cleanUser(user);
}
async function listUsers(){
  if (!dbEnabled()) return memoryUsers.map(cleanUser);
  const r = await query('SELECT id,username,role,display_name,enabled,created_at,updated_at FROM users ORDER BY id ASC');
  return r.rows.map(cleanUser);
}
async function createUser({ username, password, role='operator', displayName='', enabled=true }){
  username = String(username || '').trim().toLowerCase();
  if (!username || !password) throw new Error('Username and password are required');
  role = ['admin','operator','tablet','viewer'].includes(role) ? role : 'operator';
  if (!dbEnabled()) {
    if (memoryUsers.some(u => u.username === username)) throw new Error('Username already exists');
    const user = { id: memoryUsers.length + 1, username, password_hash: hashPassword(password), role, display_name: displayName || username, enabled: Boolean(enabled), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    memoryUsers.push(user);
    return cleanUser(user);
  }
  const r = await query(`INSERT INTO users(username,password_hash,role,display_name,enabled) VALUES($1,$2,$3,$4,$5) RETURNING id,username,role,display_name,enabled,created_at,updated_at`, [username, hashPassword(password), role, displayName || username, Boolean(enabled)]);
  return cleanUser(r.rows[0]);
}
async function updateUser(id, { password, role, displayName, enabled }){
  const fields = [], params = [];
  function add(sql, value){ params.push(value); fields.push(sql.replace('?', '$'+params.length)); }
  if (password) add('password_hash=?', hashPassword(password));
  if (role) add('role=?', ['admin','operator','tablet','viewer'].includes(role) ? role : 'operator');
  if (displayName !== undefined) add('display_name=?', String(displayName || ''));
  if (enabled !== undefined) add('enabled=?', Boolean(enabled));
  if (!fields.length) return findUserById(id);
  if (!dbEnabled()) {
    const u = memoryUsers.find(x => Number(x.id) === Number(id));
    if (!u) throw new Error('User not found');
    for (const f of fields) { /* memory fallback handled below */ }
    if (password) u.password_hash = hashPassword(password);
    if (role) u.role = role;
    if (displayName !== undefined) u.display_name = displayName;
    if (enabled !== undefined) u.enabled = Boolean(enabled);
    u.updated_at = new Date().toISOString();
    return cleanUser(u);
  }
  params.push(id);
  const r = await query(`UPDATE users SET ${fields.join(',')}, updated_at=now() WHERE id=$${params.length} RETURNING id,username,role,display_name,enabled,created_at,updated_at`, params);
  if (!r.rowCount) throw new Error('User not found');
  return cleanUser(r.rows[0]);
}
async function deleteUser(id){
  if (!dbEnabled()) { const before = memoryUsers.length; memoryUsers = memoryUsers.filter(x => Number(x.id)!==Number(id)); return before !== memoryUsers.length; }
  const r = await query('DELETE FROM users WHERE id=$1 AND username<>$2', [id, DEFAULT_ADMIN_USER]);
  return r.rowCount > 0;
}

async function upsertEvent(eventId, info){
  if (!dbEnabled()) return;
  await query(`INSERT INTO events(event_id,title,event_date,subtitle,source_url,data,updated_at)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,now())
    ON CONFLICT(event_id) DO UPDATE SET title=EXCLUDED.title,event_date=EXCLUDED.event_date,subtitle=EXCLUDED.subtitle,source_url=EXCLUDED.source_url,data=EXCLUDED.data,updated_at=now()`,
    [String(eventId), info.eventTitle || info.title || '', info.eventDate || '', info.subtitle || '', info.sourceUrl || '', JSON.stringify(info)]);
}

async function upsertSnapshot(eventId, type, stageId, data){
  if (!dbEnabled()) return;
  await query(`INSERT INTO result_snapshots(event_id,result_type,stage_id,data,source_url,fetched_at)
    VALUES($1,$2,$3,$4::jsonb,$5,now())
    ON CONFLICT(event_id,result_type,stage_id) DO UPDATE SET data=EXCLUDED.data,source_url=EXCLUDED.source_url,fetched_at=now()`,
    [String(eventId), type, Number(stageId||0), JSON.stringify(data), data.sourceUrl || '']);
}

async function logGraphic(eventId, graphic){
  if (!dbEnabled()) return;
  await query('INSERT INTO graphics_history(event_id,graphic) VALUES($1,$2::jsonb)', [String(eventId), JSON.stringify(graphic)]);
}

async function audit(action, details={}){
  if (!dbEnabled()) return;
  await query('INSERT INTO audit_log(action,details) VALUES($1,$2::jsonb)', [action, JSON.stringify(details)]);
}

async function exportAll(){
  if (!dbEnabled()) return { exportedAt: new Date().toISOString(), database: false, events: [], result_snapshots: [], graphics_history: [], audit_log: [], rundowns: [], users: listUsers() };
  const [events, snaps, history, auditRows, rundownRows, userRows] = await Promise.all([
    query('SELECT * FROM events ORDER BY updated_at DESC'),
    query('SELECT * FROM result_snapshots ORDER BY event_id,result_type,stage_id'),
    query('SELECT * FROM graphics_history ORDER BY id DESC LIMIT 500'),
    query('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500'),
    query('SELECT * FROM rundowns ORDER BY updated_at DESC'),
    query('SELECT id,username,role,display_name,enabled,created_at,updated_at FROM users ORDER BY id ASC')
  ]);
  return { exportedAt: new Date().toISOString(), database: true, events: events.rows, result_snapshots: snaps.rows, graphics_history: history.rows, audit_log: auditRows.rows, rundowns: rundownRows.rows, users: userRows.rows.map(cleanUser) };
}

async function importAll(payload, mode='merge'){
  if (!dbEnabled()) return { imported: false, reason: 'Database disabled' };
  if (mode === 'replace') {
    await query('TRUNCATE TABLE rundowns, result_snapshots, events, graphics_history, audit_log RESTART IDENTITY CASCADE');
  }
  let events=0, snapshots=0, rundowns=0;
  for (const e of payload.events || []) { await upsertEvent(e.event_id, e.data || e); events++; }
  for (const s of payload.result_snapshots || []) { await upsertSnapshot(s.event_id, s.result_type, s.stage_id, s.data || {}); snapshots++; }
  for (const r of payload.rundowns || []) { await saveRundown(r.event_id, r.items || []); rundowns++; }
  await audit('import_db_json', { mode, events, snapshots, rundowns });
  return { imported: true, mode, events, snapshots, rundowns };
}

async function getRundown(eventId){
  if (!dbEnabled()) return { eventId:String(eventId), items: [] };
  const r = await query('SELECT event_id, items, updated_at FROM rundowns WHERE event_id=$1', [String(eventId)]);
  return r.rows[0] || { eventId:String(eventId), items: [] };
}

async function saveRundown(eventId, items){
  if (!dbEnabled()) return { eventId:String(eventId), items };
  await query(`INSERT INTO rundowns(event_id,items,updated_at) VALUES($1,$2::jsonb,now())
    ON CONFLICT(event_id) DO UPDATE SET items=EXCLUDED.items, updated_at=now()`, [String(eventId), JSON.stringify(items)]);
  return getRundown(eventId);
}


async function getAppState(defaultState){
  if (!dbEnabled()) return defaultState;
  const r = await query('SELECT state FROM app_state WHERE id=1 LIMIT 1');
  if (!r.rowCount) {
    await saveAppState(defaultState);
    return defaultState;
  }
  return r.rows[0].state || defaultState;
}

async function saveAppState(state){
  if (!dbEnabled()) return state;
  await query(`INSERT INTO app_state(id,state,updated_at) VALUES(1,$1::jsonb,now())
    ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state, updated_at=now()`, [JSON.stringify(state)]);
  return state;
}

async function status(){
  if (!dbEnabled()) return { enabled: false, ok: false, message: 'DATABASE_URL is not set' };
  try {
    const r = await query('SELECT now() as now');
    return { enabled: true, ok: true, now: r.rows[0].now };
  } catch (err) { return { enabled: true, ok: false, message: err.message }; }
}

module.exports = { enabled: dbEnabled, init, getAppState, saveAppState, upsertEvent, upsertSnapshot, logGraphic, audit, exportAll, importAll, status, getRundown, saveRundown, authenticate, findUserById, listUsers, createUser, updateUser, deleteUser };
