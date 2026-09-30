'use strict';
require('dotenv').config();
const express = require('express'), helmet = require('helmet'), rate = require('express-rate-limit');
const cookie = require('cookie-parser'), jwt = require('jsonwebtoken'), bcrypt = require('bcryptjs');
const crypto = require('crypto'), path = require('path'), { Pool } = require('pg');

const { DATABASE_URL, JWT_SECRET, ENC_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, NODE_ENV } = process.env;
if (!DATABASE_URL || !JWT_SECRET || JWT_SECRET.length < 32 || !/^[0-9a-f]{64}$/i.test(ENC_KEY || '')) {
  console.error('Faltan variables: DATABASE_URL, JWT_SECRET (32+ caracteres) y ENC_KEY (64 hex). Ver .env.example');
  process.exit(1);
}
const prod = NODE_ENV === 'production';
const pool = new Pool({ connectionString: DATABASE_URL, ssl: prod ? { rejectUnauthorized: false } : false });
const K = Buffer.from(ENC_KEY, 'hex');
const ROLES = ['admin', 'soporte', 'dev', 'test', 'cliente'], EDIT = ['admin', 'cliente', 'test'];
const RN = { admin: 'Administrador', soporte: 'Soporte', dev: 'Desarrollador', test: 'Test', cliente: 'Cliente' };

/* ---------- utilidades ---------- */
const enc = o => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', K, iv);
  const b = Buffer.concat([c.update(JSON.stringify(o), 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), b]).toString('base64'); };
const dec = t => { const b = Buffer.from(t, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', K, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')); };
const wrap = f => (q, s, n) => f(q, s, n).catch(x => { console.error(x); s.status(500).json({ error: 'Error interno' }); });
const okMail = m => typeof m === 'string' && m.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m);
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const audit = (uid, action, ip) => pool.query('INSERT INTO audit_log(user_id,action,ip) VALUES($1,$2,$3)', [uid, action, ip]).catch(() => {});
const pub = u => ({ email: u.email, role: u.role, tokens: u.tokens });
const sign = u => jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '2h' });
const setCookie = (s, t) => s.cookie('fa_token', t, { httpOnly: true, secure: prod, sameSite: 'strict', maxAge: 2 * 3600 * 1000 });
const dummyHash = bcrypt.hashSync('dummy-password', 12);

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'test', tokens INT NOT NULL DEFAULT 5, failed INT NOT NULL DEFAULT 0,
      locked_until TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS workspace(id INT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}', version INT NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS integrations(user_id INT REFERENCES users(id) ON DELETE CASCADE, provider TEXT, secret TEXT,
      PRIMARY KEY(user_id, provider));
    CREATE TABLE IF NOT EXISTS audit_log(id BIGSERIAL PRIMARY KEY, user_id INT, action TEXT, ip TEXT, at TIMESTAMPTZ DEFAULT now());
    INSERT INTO workspace(id) VALUES(1) ON CONFLICT DO NOTHING;`);
  if (ADMIN_EMAIL && ADMIN_PASSWORD && okMail(ADMIN_EMAIL)) {
    const h = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await pool.query("INSERT INTO users(email,hash,role,tokens) VALUES($1,$2,'admin',999) ON CONFLICT(email) DO UPDATE SET role='admin'", [ADMIN_EMAIL.toLowerCase(), h]);
  }
}

/* ---------- app y seguridad ---------- */
const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ['https://gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      scriptSrcAttr: ["'unsafe-inline'"]
    }
  }
}));

//app.use(helmet({ contentSecurityPolicy: { directives: {
//  defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
 // fontSrc: ['https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], frameAncestors: ["'none'"], objectSrc: ["'none'"] } } }));
app.use(express.json({ limit: '1mb' }));
app.use(cookie());
app.use('/api', (q, s, n) => (q.method === 'GET' || q.get('x-requested-with') === 'fetch') ? n() : s.status(403).json({ error: 'Solicitud no permitida' })); // defensa CSRF extra
const authLimit = rate({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados intentos. Probá más tarde.' } });
app.use('/api', rate({ windowMs: 60 * 1000, limit: 120 }));

async function auth(q, s, n) {
  try {
    const { id } = jwt.verify(q.cookies.fa_token, JWT_SECRET);
    const { rows } = await pool.query('SELECT id,email,role,tokens FROM users WHERE id=$1', [id]); // el rol siempre sale de la base
    if (!rows[0]) throw 0; q.user = rows[0]; n();
  } catch (_) { s.status(401).json({ error: 'No autenticado' }); }
}
const need = (...r) => (q, s, n) => r.includes(q.user.role) ? n() : s.status(403).json({ error: 'Sin permiso' });

/* ---------- autenticación ---------- */
app.post('/api/auth/register', authLimit, wrap(async (q, s) => {
  if (process.env.ALLOW_REGISTER === 'false') return s.status(403).json({ error: 'El registro está cerrado' });
  const { email, password } = q.body || {};
  if (!okMail(email) || typeof password !== 'string' || password.length < 10 || password.length > 100)
    return s.status(400).json({ error: 'Correo inválido o contraseña de menos de 10 caracteres' });
  try {
    const h = await bcrypt.hash(password, 12);
    const { rows } = await pool.query("INSERT INTO users(email,hash,role,tokens) VALUES($1,$2,'test',5) RETURNING id,email,role,tokens", [email.toLowerCase(), h]);
    setCookie(s, sign(rows[0])); audit(rows[0].id, 'register', q.ip); s.json(pub(rows[0]));
  } catch (_) { s.status(400).json({ error: 'No se pudo crear la cuenta' }); }
}));
app.post('/api/auth/login', authLimit, wrap(async (q, s) => {
  const { email, password } = q.body || {};
  const bad = () => s.status(401).json({ error: 'Correo o contraseña incorrectos' });
  if (!okMail(email) || typeof password !== 'string') return bad();
  const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
  const u = rows[0];
  if (u && u.locked_until && new Date(u.locked_until) > new Date()) return s.status(429).json({ error: 'Cuenta bloqueada temporalmente. Probá en 15 minutos.' });
  const ok = await bcrypt.compare(password, u ? u.hash : dummyHash); // mismo costo exista o no el usuario
  if (!u || !ok) {
    if (u) await pool.query("UPDATE users SET failed=failed+1, locked_until=CASE WHEN failed+1>=5 THEN now()+interval '15 minutes' END WHERE id=$1", [u.id]);
    return bad();
  }
  await pool.query('UPDATE users SET failed=0, locked_until=NULL WHERE id=$1', [u.id]);
  setCookie(s, sign(u)); audit(u.id, 'login', q.ip); s.json(pub(u));
}));
app.post('/api/auth/logout', (q, s) => { s.clearCookie('fa_token'); s.json({ ok: 1 }); });
app.get('/api/auth/me', auth, (q, s) => s.json(pub(q.user)));

/* ---------- workspace compartido ---------- */
app.get('/api/workspace', auth, wrap(async (q, s) => {
  const { rows } = await pool.query('SELECT data,version FROM workspace WHERE id=1'); s.json(rows[0]);
}));
app.put('/api/workspace', auth, wrap(async (q, s) => {
  const { data, version } = q.body || {};
  if (!data || typeof data !== 'object' || !Number.isInteger(version)) return s.status(400).json({ error: 'Datos inválidos' });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query('SELECT data,version FROM workspace WHERE id=1 FOR UPDATE');
    if (rows[0].version !== version) { await c.query('ROLLBACK'); return s.status(409).json({ error: 'Conflicto de versión' }); }
    let nd = rows[0].data || {};
    if (EDIT.includes(q.user.role)) {
      if (Array.isArray(data.reqs) && data.reqs.length <= 500) nd.reqs = data.reqs;
      if (Array.isArray(data.tables) && data.tables.length <= 200) nd.tables = data.tables;
    }
    if (data.qd && typeof data.qd === 'object' && !Array.isArray(data.qd)) nd.qd = data.qd; // el checklist lo tildan todos los perfiles
    const r = await c.query('UPDATE workspace SET data=$1, version=version+1 WHERE id=1 RETURNING version', [nd]);
    await c.query('COMMIT'); s.json({ version: r.rows[0].version });
  } catch (x) { await c.query('ROLLBACK').catch(() => {}); throw x; } finally { c.release(); }
}));
app.post('/api/comments', auth, wrap(async (q, s) => {
  const { i, text } = q.body || {};
  if (!Number.isInteger(i) || typeof text !== 'string' || !text.trim() || text.length > 1000) return s.status(400).json({ error: 'Comentario inválido' });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query('SELECT data FROM workspace WHERE id=1 FOR UPDATE');
    const d = rows[0].data; if (!d.reqs || !d.reqs[i]) { await c.query('ROLLBACK'); return s.status(404).json({ error: 'Requerimiento inexistente' }); }
    (d.reqs[i].com = d.reqs[i].com || []).push({ w: `${q.user.email.split('@')[0]} (${RN[q.user.role]})`, x: text.trim() });
    await c.query('UPDATE workspace SET data=$1, version=version+1 WHERE id=1', [d]);
    await c.query('COMMIT'); s.json({ ok: 1 });
  } catch (x) { await c.query('ROLLBACK').catch(() => {}); throw x; } finally { c.release(); }
}));

/* ---------- tokens y administración ---------- */
app.post('/api/tokens/consume', auth, wrap(async (q, s) => {
  if (q.user.role !== 'test') return s.json({ tokens: q.user.tokens });
  const { rows } = await pool.query("UPDATE users SET tokens=tokens-1 WHERE id=$1 AND role='test' AND tokens>0 RETURNING tokens", [q.user.id]);
  rows[0] ? s.json({ tokens: rows[0].tokens }) : s.status(402).json({ error: 'Sin tokens' });
}));
app.get('/api/admin/users', auth, need('admin'), wrap(async (q, s) => {
  s.json((await pool.query('SELECT id,email,role,tokens FROM users ORDER BY id')).rows);
}));
app.put('/api/admin/users/:id', auth, need('admin'), wrap(async (q, s) => {
  const id = Number(q.params.id), { role } = q.body || {};
  if (!ROLES.includes(role) || !Number.isInteger(id) || id === q.user.id) return s.status(400).json({ error: 'Cambio no permitido' });
  await pool.query('UPDATE users SET role=$1, tokens=CASE WHEN $1=\'test\' THEN GREATEST(tokens,5) ELSE tokens END WHERE id=$2', [role, id]);
  audit(q.user.id, `role:${id}:${role}`, q.ip); s.json({ ok: 1 });
}));

/* ---------- integraciones (Jira, Confluence, Azure DevOps) ---------- */
const creds = async (uid, p) => { const { rows } = await pool.query('SELECT secret FROM integrations WHERE user_id=$1 AND provider=$2', [uid, p]); return rows[0] ? dec(rows[0].secret) : null; };
const basic = (u, t) => 'Basic ' + Buffer.from(`${u}:${t}`).toString('base64');
const adf = n => !n ? '' : typeof n === 'string' ? n : (n.text || '') + (n.content || []).map(adf).join('') + (n.type === 'paragraph' ? '\n' : '');
const G = [auth, need('admin', 'cliente')];

app.post('/api/integrations/:p', ...G, wrap(async (q, s) => {
  const p = q.params.p, b = q.body || {};
  let v;
  if (p === 'jira' && /^[a-z0-9-]+\.atlassian\.net$/i.test(b.site) && okMail(b.email) && b.token) v = { site: b.site, email: b.email, token: String(b.token) };
  else if (p === 'azure' && /^[\w.-]+$/.test(b.org || '') && /^[\w .-]+$/.test(b.project || '') && b.token) v = { org: b.org, project: b.project, token: String(b.token) };
  else return s.status(400).json({ error: 'Datos de conexión inválidos' });
  await pool.query('INSERT INTO integrations(user_id,provider,secret) VALUES($1,$2,$3) ON CONFLICT(user_id,provider) DO UPDATE SET secret=$3', [q.user.id, p, enc(v)]);
  audit(q.user.id, 'integration:' + p, q.ip); s.json({ ok: 1 });
}));
app.post('/api/integrations/jira/import', ...G, wrap(async (q, s) => {
  const c = await creds(q.user.id, 'jira'); if (!c) return s.status(400).json({ error: 'Primero guardá la conexión con Jira' });
  const jql = String((q.body || {}).q || 'order by created DESC').slice(0, 500);
  const r = await fetch(`https://${c.site}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary,description&maxResults=20`, { headers: { Authorization: basic(c.email, c.token), Accept: 'application/json' } });
  if (!r.ok) return s.status(502).json({ error: `Jira respondió ${r.status}. Revisá sitio, correo, token y JQL.` });
  const j = await r.json();
  s.json({ items: (j.issues || []).map(i => ({ t: `${i.key} ${i.fields.summary}`.slice(0, 200), obj: adf(i.fields.description).trim().slice(0, 2000) })) });
}));
app.post('/api/integrations/azure/import', ...G, wrap(async (q, s) => {
  const c = await creds(q.user.id, 'azure'); if (!c) return s.status(400).json({ error: 'Primero guardá la conexión con Azure DevOps' });
  const base = `https://dev.azure.com/${c.org}/${encodeURIComponent(c.project)}/_apis/wit`, h = { Authorization: basic('', c.token), 'Content-Type': 'application/json' };
  const w = await fetch(`${base}/wiql?api-version=7.1&$top=20`, { method: 'POST', headers: h, body: JSON.stringify({ query: "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] IN ('User Story','Product Backlog Item','Requirement') ORDER BY [System.Id] DESC" }) });
  if (!w.ok) return s.status(502).json({ error: `Azure DevOps respondió ${w.status}. Revisá organización, proyecto y PAT.` });
  const ids = ((await w.json()).workItems || []).slice(0, 20).map(x => x.id); if (!ids.length) return s.json({ items: [] });
  const r = await fetch(`${base}/workitems?ids=${ids.join(',')}&fields=System.Title,System.Description&api-version=7.1`, { headers: h });
  if (!r.ok) return s.status(502).json({ error: `Azure DevOps respondió ${r.status}` });
  s.json({ items: ((await r.json()).value || []).map(i => ({ t: `#${i.id} ${i.fields['System.Title']}`.slice(0, 200), obj: String(i.fields['System.Description'] || '').replace(/<[^>]*>/g, ' ').trim().slice(0, 2000) })) });
}));
app.post('/api/integrations/confluence/publish', ...G, wrap(async (q, s) => {
  const c = await creds(q.user.id, 'jira'); if (!c) return s.status(400).json({ error: 'Confluence usa la conexión de Jira: guardala primero' });
  const { space, req } = q.body || {};
  if (!/^[\w~-]+$/.test(space || '') || !req || !req.t) return s.status(400).json({ error: 'Espacio o requerimiento inválido' });
  const sec = (t, x) => `<h2>${t}</h2><p>${esc(x).replace(/\n/g, '<br/>')}</p>`;
  const html = sec('Objetivo', req.obj) + sec('Alcance', req.alc) + sec('Casos de uso', req.cu) + sec('Criterios de aceptación', req.ca) + sec('Parámetros', req.par);
  const r = await fetch(`https://${c.site}/wiki/rest/api/content`, { method: 'POST', headers: { Authorization: basic(c.email, c.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'page', title: String(req.t).slice(0, 200), space: { key: space }, body: { storage: { value: html, representation: 'storage' } } }) });
  if (!r.ok) return s.status(502).json({ error: `Confluence respondió ${r.status}. ¿Existe el espacio? ¿Ya hay una página con ese título?` });
  const j = await r.json(); s.json({ url: (j._links && j._links.base ? j._links.base + j._links.webui : 'página creada') });
}));

/* ---------- frontend estático ---------- */
app.get('/healthz', (q, s) => s.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (q, s) => s.status(404).json({ error: 'No encontrado' }));

init().then(() => app.listen(process.env.PORT || 3000, () => console.log('FUNTION ANALYTS en puerto', process.env.PORT || 3000)))
  .catch(x => { console.error('Error al iniciar', x.message); process.exit(1); });
