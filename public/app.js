const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const num = (value, places = 2) => Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: places, minimumFractionDigits: places }) : '—';
const ago = t => !t ? 'No data yet' : Math.max(0, Math.floor((Date.now() - t) / 1000)) < 60 ? `${Math.max(0, Math.floor((Date.now() - t) / 1000))}s ago` : `${Math.floor((Date.now() - t) / 60000)}m ago`;
const when = date => new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
let state = null, page = 'overview', csrf = null, first = true;
const fields = [
  ['tradeSol', 'Trade size', 'SOL per new position', .01], ['maxPositions', 'Max open positions', 'Concurrent trades', 1],
  ['maxDailyLossSol', 'Daily loss cap', 'SOL realized loss', .01],
  ['minCap', 'Min market cap', 'USD', 1000], ['maxCap', 'Max market cap', 'USD', 1000],
  ['minVolume', 'Minimum 5m volume', 'USD', 500], ['minBuys', 'Minimum 5m buys', 'Transactions', 1],
  ['minUnique', 'Minimum buyers', 'Distinct wallets', 1], ['minRatio', 'Buy / sell ratio', 'By USD volume', .1],
  ['minAcceleration', 'Volume acceleration', 'Vs previous 5m', .1],
  ['stopPct', 'Stop loss', '% quoted P&L', 1], ['takeProfitPct', 'Take profit', '% quoted P&L', 1],
  ['trailActivatePct', 'Start trailing at', '% quoted P&L', 1], ['trailDistancePct', 'Trailing distance', 'Percent points', 1],
  ['maxHoldMs', 'Max hold', 'Minutes', 1], ['maxRoundtripPct', 'Max round-trip cost', '% quoted cost', .5],
];
function showPage(name) {
  page = name;
  for (const p of ['overview', 'activity', 'strategy']) $(`#${p}-page`).classList.toggle('hidden', p !== name);
  document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  $('#page-title').textContent = ({ overview: 'Overview', activity: 'Activity', strategy: 'Strategy' })[name];
  $('#page-kicker').textContent = ({ overview: 'COMMAND CENTER', activity: 'EVENT HISTORY', strategy: 'PAPER MODE SETTINGS' })[name];
}
function filteredEvents(events) {
  const filter = $('#activity-filter').value;
  return events.filter(e => filter === 'all' || (filter === 'trades' && ['entry', 'exit'].includes(e.type)) ||
    (filter === 'signals' && e.type === 'snapshot') || (filter === 'errors' && /error|rejected/.test(e.type)));
}
function eventInfo(e) {
  const mint = e.mint || e.pair?.mint;
  const short = mint ? `${mint.slice(0, 5)}…${mint.slice(-4)}` : '';
  if (e.type === 'entry') return { title: `Paper entry · ${short}`, detail: `${num(e.costSol, 4)} SOL invested · ${num(Number(e.tokensRaw), 0)} raw token units`, tone: 'good', icon: '↗' };
  if (e.type === 'exit') return { title: `Exit · ${short}`, detail: `${escape(e.reason)} · ${e.pnlSol >= 0 ? '+' : ''}${num(e.pnlSol, 4)} SOL`, tone: e.pnlSol >= 0 ? 'good' : 'error', icon: '↘' };
  if (e.type === 'snapshot') return { title: `Signal · ${short}`, detail: `${num(e.pair?.recentUsd, 0)} USD / 5m · ${e.signal?.uniqueBuyers ?? 0} buyers · ${e.signal?.eligible ? 'eligible' : escape(e.signal?.reasons?.join(', ') || 'screened')}`, tone: e.signal?.eligible ? 'good' : 'warn', icon: '◈' };
  if (e.type === 'entry_rejected') return { title: `Entry rejected · ${short}`, detail: escape(e.message), tone: 'warn', icon: '!' };
  if (e.type === 'control') return { title: e.paused ? 'New entries paused' : 'New entries resumed', detail: 'Dashboard control', tone: 'warn', icon: '⏸' };
  if (e.type === 'settings_changed') return { title: 'Paper settings updated', detail: Object.keys(e.changes || {}).join(', '), tone: 'good', icon: '⌘' };
  if (/error/.test(e.type)) return { title: e.type.replaceAll('_', ' '), detail: escape(e.message || JSON.stringify(e.error || '')), tone: 'error', icon: '!' };
  return { title: e.type.replaceAll('_', ' '), detail: short, tone: 'good', icon: '·' };
}
function item(e, compact = false) {
  const v = eventInfo(e);
  if (compact) return `<div class="list-item"><div class="item-main"><div class="item-title">${escape(v.title)}</div><div class="item-detail">${v.detail}</div></div><div class="item-side muted">${ago(Date.parse(e.at))}</div></div>`;
  return `<div class="activity-row"><div class="activity-icon ${v.tone === 'good' ? '' : v.tone}">${v.icon}</div><div class="activity-row-main"><div class="activity-row-title">${escape(v.title)}</div><div class="activity-row-detail">${v.detail}</div></div><div class="activity-time">${when(e.at)}</div></div>`;
}
function paint(s) {
  state = s; csrf = s.csrf;
  $('#login').classList.add('hidden'); $('#shell').classList.remove('hidden');
  $('#mode-pill').textContent = s.mode.toUpperCase(); $('#mode-pill').classList.toggle('live', s.mode === 'live');
  $('#mode-text').textContent = s.mode === 'paper' ? 'Paper simulation' : 'LIVE CAPITAL';
  $('#cash').textContent = s.mode === 'paper' ? `${num(s.cashSol, 4)} SOL` : 'Live wallet';
  $('#pnl').textContent = `${s.dayPnlSol >= 0 ? '+' : ''}${num(s.dayPnlSol, 4)} SOL`;
  $('#pnl').classList.toggle('green', s.dayPnlSol > 0); $('#pnl').classList.toggle('red', s.dayPnlSol < 0);
  $('#pnl-foot').textContent = `Realized P&L · ${s.day || 'today'} UTC`;
  $('#positions-count').textContent = s.positions.length;
  $('#positions-foot').textContent = `${s.positions.length} / ${s.limits.maxOpen} positions`;
  $('#sol-price').textContent = s.stream.solUsd ? `$${num(s.stream.solUsd, 2)}` : '—';
  $('#tracked').textContent = `${s.stream.trackedTokens} tracked`;
  const online = s.stream.health === 'connected' && Date.now() - s.stream.lastPacketAt < 90000;
  $('#stream-health').textContent = online ? 'Receiving transactions' : s.stream.health === 'connected' ? 'Connected · awaiting trades' : s.stream.health;
  $('#stream-health').className = online ? 'green' : 'red';
  $('#last-event').textContent = ago(s.stream.latestAt); $('#last-cycle').textContent = ago(s.lastTickAt);
  $('#entry-status').textContent = s.paused ? 'Paused' : s.pending ? 'Pending trade' : online ? 'Active' : 'Waiting for feed';
  $('#watchlist').textContent = s.watch.length ? `${s.watch.length} token${s.watch.length === 1 ? '' : 's'}` : 'Auto discovery';
  $('#sidebar-status').textContent = online ? 'Stream online' : 'Waiting for stream';
  $('.dot').classList.toggle('online', online); $('.dot').classList.toggle('offline', s.stream.health === 'error');
  $('#pause-button').textContent = s.paused ? 'Resume entries' : 'Pause entries';
  $('#pause-button').classList.toggle('resume', s.paused);
  $('#pause-button').disabled = !!s.pending;
  $('#updated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
  const message = s.pending ? 'A live transaction needs manual reconciliation. New entries are blocked.' : s.lastError;
  $('#banner').textContent = message || ''; $('#banner').classList.toggle('hidden', !message);
  const candidates = s.candidates.slice(0, 12);
  $('#markets').innerHTML = candidates.length ? candidates.map(({ p, signal }) => `<tr><td title="${escape(p.mint)}">${escape(p.mint.slice(0, 6))}…${escape(p.mint.slice(-4))}</td><td>$${num(p.cap, 0)}</td><td>$${num(p.recentUsd, 0)}</td><td>${p.uniqueBuyers}</td><td>${num(signal.ratio, 1)}×</td><td><span title="${escape(signal.reasons.join(', '))}" class="badge ${signal.eligible ? 'eligible' : ''}">${signal.eligible ? 'ELIGIBLE' : 'WATCHING'}</span></td></tr>`).join('') : '<tr><td colspan="6" class="empty">Collecting on-chain trades. Signals begin after 10 minutes of continuous data.</td></tr>';
  $('#positions').innerHTML = s.positions.length ? s.positions.map(p => `<div class="list-item"><div class="item-main"><div class="item-title" title="${escape(p.mint)}">${escape(p.mint.slice(0, 7))}…${escape(p.mint.slice(-5))}</div><div class="item-detail">Entered ${when(p.openedAt)} · ${num(p.costSol, 4)} SOL</div></div><div class="item-side"><div>Peak +${num(p.highPct || 0, 1)}%</div><div class="item-detail">Entry $${num(p.entryPriceUsd, 6)}</div></div></div>`).join('') : '<div class="empty">No open positions</div>';
  const relevant = s.events.filter(e => !['chain_swap', 'stream_connected'].includes(e.type));
  $('#recent').innerHTML = relevant.length ? relevant.slice(0, 5).map(e => item(e, true)).join('') : '<div class="empty">No decisions yet</div>';
  const activity = filteredEvents(s.events);
  $('#activity').innerHTML = activity.length ? activity.map(e => item(e)).join('') : '<div class="empty">No matching events yet</div>';
  if (first) { renderSettings(s); first = false; }
  $('#settings-form').querySelectorAll('input').forEach(x => x.disabled = s.mode !== 'paper');
  $('#settings-form').querySelector('button').disabled = s.mode !== 'paper';
}
function renderSettings(s) {
  $('#settings-grid').innerHTML = fields.map(([key, label, hint, step]) => `<div class="field"><label for="set-${key}">${label}</label><input id="set-${key}" name="${key}" type="number" step="${step}" value="${key === 'maxHoldMs' ? s.settings[key] / 60000 : s.settings[key]}" required><small>${hint}</small></div>`).join('');
}
async function load() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (response.status === 401) { $('#shell').classList.add('hidden'); $('#login').classList.remove('hidden'); return; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    paint(await response.json());
  } catch (e) { if (state) { $('#banner').textContent = `Dashboard refresh failed: ${e.message}`; $('#banner').classList.remove('hidden'); } }
}
async function action(endpoint, body) {
  const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  await load();
  return data;
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#login-error').textContent = '';
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: $('#password').value }) });
    if (!r.ok) throw new Error((await r.json()).error || 'Sign in failed');
    $('#password').value = ''; await load();
  } catch (e) { $('#login-error').textContent = e.message; }
});
document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
$('#activity-filter').addEventListener('change', () => { if (state) paint(state); });
$('#pause-button').addEventListener('click', async () => {
  if (!state) return;
  try { await action('/api/pause', { paused: !state.paused }); }
  catch (e) { alert(e.message); }
});
$('#logout').addEventListener('click', async () => {
  try { await action('/api/logout', {}); } catch { /* a refresh still checks the session */ }
  state = null; first = true; await load();
});
$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const next = Object.fromEntries(fields.map(([k]) => [k, Number($(`#set-${k}`).value) * (k === 'maxHoldMs' ? 60000 : 1)]));
  try { await action('/api/settings', next); $('#settings-message').textContent = 'Saved. Active on the next cycle.'; }
  catch (e) { $('#settings-message').textContent = e.message; }
});
load(); setInterval(load, 6000);
