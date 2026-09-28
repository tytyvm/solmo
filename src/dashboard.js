import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'] };
const editable = {
  tradeSol: [0.001, 1], maxPositions: [1, 8], maxDailyLossSol: [0.001, 2],
  minCap: [1000, 10000000], maxCap: [1000, 100000000], minVolume: [0, 10000000],
  minBuys: [1, 10000], minRatio: [0.1, 100], minAcceleration: [0.1, 100], minUnique: [1, 10000],
  stopPct: [1, 90], takeProfitPct: [1, 1000], trailActivatePct: [1, 1000],
  trailDistancePct: [1, 90], maxHoldMs: [60000, 86400000], maxRoundtripPct: [0.1, 50],
};
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" };
const valid = (actual, expected) => {
  const a = Buffer.from(String(actual)), b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const send = (res, status, value, extra = {}) => {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  res.writeHead(status, { ...headers, 'content-type': typeof value === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', ...extra });
  res.end(body);
};
const readBody = async req => {
  let s = '';
  for await (const chunk of req) {
    s += chunk;
    if (s.length > 8192) throw new Error('Request too large');
  }
  return JSON.parse(s);
};

export function createDashboard(bot, password, options = {}) {
  if (!password || password.length < 16) throw new Error('Set DASHBOARD_PASSWORD (at least 16 characters) before starting the dashboard');
  const secret = crypto.createHash('sha256').update(password).digest();
  const failures = new Map();
  const sign = payload => crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const session = req => {
    const token = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('momentum_session='))?.slice(17);
    if (!token) return null;
    const [exp, nonce, signature] = token.split('.');
    if (!exp || !nonce || !signature || Number(exp) < Date.now() || !valid(signature, sign(`${exp}.${nonce}`))) return null;
    return { csrf: sign(`csrf.${nonce}`).slice(0, 32) };
  };
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url || '/', 'http://localhost').pathname;
      if (pathname === '/health' && req.method === 'GET') return send(res, 200, { ok: true });
      if (pathname === '/api/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress || 'unknown';
        const prior = failures.get(ip);
        const attempt = prior && Date.now() < prior.until ? prior : { count: 0, until: 0 };
        if (attempt.count >= 5 && Date.now() < attempt.until) return send(res, 429, { error: 'Too many attempts. Try later.' });
        const data = await readBody(req);
        if (!valid(data.password, password)) {
          failures.set(ip, { count: attempt.count + 1, until: Date.now() + 15 * 60000 });
          return send(res, 401, { error: 'Incorrect password' });
        }
        failures.delete(ip);
        const exp = Date.now() + 7 * 86400000, nonce = crypto.randomBytes(20).toString('hex');
        const token = `${exp}.${nonce}.${sign(`${exp}.${nonce}`)}`;
        const secure = options.secureCookies ?? Boolean(process.env.RAILWAY_ENVIRONMENT);
        return send(res, 200, { ok: true }, { 'set-cookie': `momentum_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure ? '; Secure' : ''}` });
      }
      const auth = session(req);
      if (pathname.startsWith('/api/')) {
        if (!auth) return send(res, 401, { error: 'Sign in required' });
        if (pathname === '/api/status' && req.method === 'GET') {
          const m = bot.market, s = bot.store.state, c = bot.cfg;
          const recent = bot.store.recent(90);
          return send(res, 200, { mode: c.mode, csrf: auth.csrf, now: Date.now(),
            paused: s.paused, pending: s.pending || null, lastError: s.lastError, lastTickAt: bot.lastTickAt,
            stream: { health: m.health, connectedAt: m.connectedAt, latestAt: m.latestAt,
              solUsd: m.solUsd, trackedTokens: m.events.size, lastPacketAt: m.lastPacketAt },
            cashSol: s.cashSol, dayPnlSol: s.dayPnlSol, day: s.day,
            positions: Object.values(s.positions), candidates: bot.lastCandidates, events: recent,
            settings: Object.fromEntries(Object.keys(editable).map(k => [k, c[k]])),
            limits: { maxPositionSol: c.maxPositionSol, maxOpen: c.maxPositions },
            watch: c.watch });
        }
        if (req.method === 'POST' && !valid(req.headers['x-csrf-token'], auth.csrf)) return send(res, 403, { error: 'Invalid session request' });
        if (pathname === '/api/logout' && req.method === 'POST') {
          return send(res, 200, { ok: true }, { 'set-cookie': 'momentum_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
        }
        if (pathname === '/api/pause' && req.method === 'POST') {
          const { paused } = await readBody(req);
          if (typeof paused !== 'boolean') return send(res, 400, { error: 'Invalid pause value' });
          if (!paused && bot.store.state.pending) return send(res, 409, { error: 'Reconcile pending live transaction first' });
          bot.store.state.paused = paused;
          bot.store.save(); bot.store.log('control', { paused });
          return send(res, 200, { paused });
        }
        if (pathname === '/api/settings' && req.method === 'POST') {
          if (bot.cfg.mode !== 'paper') return send(res, 403, { error: 'Dashboard settings can only be edited in paper mode' });
          const data = await readBody(req);
          if (!data || Array.isArray(data) || Object.keys(data).some(k => !(k in editable))) return send(res, 400, { error: 'Invalid settings' });
          const next = {};
          for (const [k, v] of Object.entries(data)) {
            const [min, max] = editable[k];
            if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max ||
              (['maxPositions', 'minBuys', 'minUnique'].includes(k) && !Number.isInteger(v)))
              return send(res, 400, { error: `Invalid ${k}` });
            next[k] = v;
          }
          const merged = { ...bot.cfg, ...next };
          if (merged.minCap >= merged.maxCap || merged.tradeSol > merged.maxPositionSol)
            return send(res, 400, { error: 'Market cap range or trade size exceeds limits' });
          const persistent = { ...bot.store.settings(), ...next };
          bot.store.saveSettings(persistent);
          Object.assign(bot.cfg, next);
          bot.store.log('settings_changed', { changes: next });
          return send(res, 200, { settings: next });
        }
        return send(res, 404, { error: 'Not found' });
      }
      if (req.method !== 'GET' || !(pathname in files)) return send(res, 404, 'Not found');
      const [name, mime] = files[pathname];
      res.writeHead(200, { ...headers, 'content-type': mime });
      fs.createReadStream(path.join(publicDir, name)).pipe(res);
    } catch (e) { send(res, 400, { error: e.message === 'Request too large' ? e.message : 'Invalid request' }); }
  });
  return server;
}
