import { Market, NATIVE, USDC } from './market.js';
import { Jupiter } from './jupiter.js';
import { Store } from './store.js';
import { evaluate, exitReason } from './strategy.js';
import { rpc } from './http.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sol = raw => Number(raw) / 1e9;

export class Bot {
  constructor(cfg) {
    this.cfg = cfg;
    this.store = new Store(cfg.dataDir, cfg.mode, cfg.startingSol);
    this.market = new Market(cfg, this.store);
    this.jupiter = new Jupiter(cfg.apiKey, cfg.secret);
    this.lastSolQuote = 0;
    this.lastAttempt = new Map();
  }
  async tick() {
    const c = this.cfg, s = this.store, now = Date.now();
    s.newDay();
    await this.market.ensureStream();
    if (now - this.lastSolQuote > 60000) {
      const quote = await this.jupiter.order(NATIVE, USDC, 1e9);
      this.market.solUsd = Number(quote.outAmount) / 1e6;
      if (!Number.isFinite(this.market.solUsd) || this.market.solUsd <= 0) throw new Error('Invalid SOL/USD quote');
      this.lastSolQuote = now;
    }
    // No entries after a disconnect, subscription error, or stale market stream.
    const fresh = this.market.health === 'connected' && now - this.market.latestAt <= 90000;
    for (const [mint, p] of Object.entries(s.state.positions)) await this.managePosition(mint, p);
    if (!fresh || s.state.paused || s.state.pending || s.state.dayPnlSol <= -c.maxDailyLossSol) return;
    if (Object.keys(s.state.positions).length >= c.maxPositions) return;
    const candidates = (await this.market.candidates(now)).map(p => ({ p, signal: evaluate(p, c, now) }));
    for (const { p, signal } of candidates) {
      if (signal.eligible || p.recentUsd >= c.minVolume) s.snapshot(p, signal);
      if (!signal.eligible || s.state.positions[p.mint] || now - (this.lastAttempt.get(p.mint) || 0) < 30 * 60000) continue;
      this.lastAttempt.set(p.mint, now);
      try { await this.enter(p, signal); } catch (e) { s.log('entry_rejected', { mint: p.mint, message: e.message }); }
      if (Object.keys(s.state.positions).length >= c.maxPositions || s.state.paused) break;
    }
  }
  async enter(p, signal) {
    const c = this.cfg, s = this.store, amount = Math.min(c.tradeSol, c.maxPositionSol);
    if (c.mode === 'paper' && s.state.cashSol < amount) throw new Error('Insufficient paper SOL');
    if (c.mode === 'live') {
      const balance = await rpc(c.rpc, 'getBalance', [this.jupiter.signer.publicKey.toBase58(), { commitment: 'confirmed' }]);
      if (sol(balance.value) < amount + 0.02) throw new Error('Insufficient live SOL including gas reserve');
    }
    const roundtrip = await this.jupiter.roundtrip(p.mint, amount);
    if (roundtrip.costPct > c.maxRoundtripPct || !Number.isFinite(roundtrip.costPct)) throw new Error(`Round-trip cost ${roundtrip.costPct.toFixed(2)}%`);
    if (Number(roundtrip.buy.priceImpactPct || 0) * 100 > c.maxImpactPct) throw new Error('Excessive price impact');
    const order = c.mode === 'live' ? await this.jupiter.order(NATIVE, p.mint, Math.round(amount * 1e9), true) : roundtrip.buy;
    if (Number(order.outAmount) < Number(roundtrip.buy.outAmount) * 0.95) throw new Error('Buy quote changed >5%');
    let tokensRaw = order.outAmount, costSol = amount, signature = null;
    if (c.mode === 'live') {
      s.state.pending = { side: 'buy', mint: p.mint, at: Date.now(), requestId: order.requestId };
      s.save();
      try {
        const result = await this.jupiter.execute(order);
        tokensRaw = result.totalOutputAmount;
        costSol = sol(result.totalInputAmount);
        signature = result.signature;
      } catch (e) { s.state.paused = true; s.state.lastError = `BUY needs reconciliation: ${e.message}`; s.save(); throw e; }
      delete s.state.pending;
    } else s.state.cashSol -= amount;
    s.state.positions[p.mint] = { mint: p.mint, tokensRaw, costSol, openedAt: Date.now(),
      entryPriceUsd: p.priceUsd, highPct: 0, entrySignature: signature };
    s.log('entry', { mint: p.mint, tokensRaw, costSol, signature, signal }); s.save();
  }
  async managePosition(mint, position) {
    const c = this.cfg, s = this.store;
    if (s.state.pending) return;
    try {
      const quote = await this.jupiter.order(mint, NATIVE, position.tokensRaw);
      const markSol = sol(quote.outAmount), pnl = (markSol / position.costSol - 1) * 100;
      position.highPct = Math.max(position.highPct, pnl);
      s.save();
      const reason = exitReason(position, markSol, c);
      if (!reason) return;
      const order = c.mode === 'live' ? await this.jupiter.order(mint, NATIVE, position.tokensRaw, true) : quote;
      let proceedsSol = sol(order.outAmount), signature = null;
      if (c.mode === 'live') {
        s.state.pending = { side: 'sell', mint, at: Date.now(), requestId: order.requestId };
        s.save();
        try {
          const result = await this.jupiter.execute(order);
          proceedsSol = sol(result.totalOutputAmount); signature = result.signature;
        } catch (e) { s.state.paused = true; s.state.lastError = `SELL needs reconciliation: ${e.message}`; s.save(); throw e; }
        delete s.state.pending;
      } else s.state.cashSol += proceedsSol;
      s.state.dayPnlSol += proceedsSol - position.costSol;
      delete s.state.positions[mint];
      s.log('exit', { mint, reason, proceedsSol, costSol: position.costSol,
        pnlSol: proceedsSol - position.costSol, signature }); s.save();
    } catch (e) { s.log('exit_error', { mint, message: e.message }); }
  }
  async run(once = false) {
    do {
      try { await this.tick(); if (!this.store.state.paused) this.store.state.lastError = null; this.store.save(); }
      catch (e) { this.store.state.lastError = e.message; this.store.save(); this.store.log('tick_error', { message: e.message }); }
      if (once) { this.market.stream?.close(); return; }
      await sleep(this.cfg.pollMs);
    } while (true);
  }
}
