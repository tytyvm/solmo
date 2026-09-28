import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

test('dashboard renders authenticated state and handles paper controls', async () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const script = fs.readFileSync('public/app.js', 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:3000', runScripts: 'dangerously' });
  const { window } = dom;
  const requests = [];
  const status = { mode: 'paper', csrf: 'csrf-test', now: Date.now(), paused: false, pending: null,
    lastError: null, lastTickAt: Date.now(), stream: { health: 'connected', connectedAt: Date.now() - 700000,
      latestAt: Date.now(), lastPacketAt: Date.now(), solUsd: 200, trackedTokens: 1 },
    cashSol: 1.95, dayPnlSol: .05, day: '2026-09-27', positions: [], candidates: [{ p: {
      mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCaKGunmfE8fXYsWq3', cap: 100000, recentUsd: 15000,
      uniqueBuyers: 12 }, signal: { eligible: true, ratio: 2, reasons: [] } }], events: [],
    settings: { tradeSol: .05, maxPositions: 2, maxDailyLossSol: .1, minCap: 75000, maxCap: 500000,
      minVolume: 10000, minBuys: 25, minUnique: 8, minRatio: 1.5, minAcceleration: 1.7,
      stopPct: 12, takeProfitPct: 40, trailActivatePct: 18, trailDistancePct: 9,
      maxHoldMs: 1500000, maxRoundtripPct: 6 }, limits: { maxPositionSol: .1, maxOpen: 2 }, watch: [] };
  window.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return { ok: true, status: 200, json: async () => url === '/api/status' ? status : { ok: true } };
  };
  window.alert = () => {};
  try {
    window.eval(script);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(window.document.querySelector('#shell').classList.contains('hidden'), false);
    assert.match(window.document.querySelector('#markets').textContent, /ELIGIBLE/);
    assert.match(window.document.querySelector('#cash').textContent, /1.95/);
    window.document.querySelector('[data-page="strategy"]').click();
    assert.equal(window.document.querySelector('#strategy-page').classList.contains('hidden'), false);
    window.document.querySelector('#pause-button').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    const pause = requests.find(r => r.url === '/api/pause');
    assert.equal(JSON.parse(pause.options.body).paused, true);
    assert.equal(pause.options.headers['x-csrf-token'], 'csrf-test');
  } finally { window.close(); }
});
