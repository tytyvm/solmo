import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDashboard } from '../src/dashboard.js';
import { Bot } from '../src/bot.js';
import { config } from '../src/config.js';

test('dashboard protects data and allows authenticated paper controls', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'momentum-dashboard-'));
  const bot = new Bot(config({ MODE: 'paper', JUPITER_API_KEY: 'test', HELIUS_API_KEY: 'test', DATA_DIR: dir }));
  const server = createDashboard(bot, 'long-local-test-password', { secureCookies: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/status`)).status, 401);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const wrong = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) });
    assert.equal(wrong.status, 401);
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'long-local-test-password' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const status = await fetch(`${base}/api/status`, { headers: { cookie } });
    assert.equal(status.status, 200);
    const state = await status.json();
    assert.equal(state.mode, 'paper');
    assert.equal(state.cashSol, 2);
    assert.equal(JSON.stringify(state).includes('long-local-test-password'), false);
    const noCsrf = await fetch(`${base}/api/pause`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ paused: true }) });
    assert.equal(noCsrf.status, 403);
    const h = { cookie, 'content-type': 'application/json', 'x-csrf-token': state.csrf };
    const pause = await fetch(`${base}/api/pause`, { method: 'POST', headers: h, body: JSON.stringify({ paused: true }) });
    assert.equal(pause.status, 200);
    assert.equal(bot.store.state.paused, true);
    const settings = await fetch(`${base}/api/settings`, { method: 'POST', headers: h, body: JSON.stringify({ minVolume: 9000 }) });
    assert.equal(settings.status, 200);
    assert.equal(bot.cfg.minVolume, 9000);
    assert.equal(new Bot(bot.cfg).cfg.minVolume, 9000);
    const invalid = await fetch(`${base}/api/settings`, { method: 'POST', headers: h, body: JSON.stringify({ minCap: 99999999 }) });
    assert.equal(invalid.status, 400);
    const html = await fetch(base);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /Trading Console/);
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
});
