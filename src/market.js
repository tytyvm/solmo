import WebSocket from 'ws';
import { VersionedTransaction } from '@solana/web3.js';
import { rpc } from './http.js';

export const NATIVE = 'So11111111111111111111111111111111111111112';
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const CPMM = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';
const ignored = new Set([NATIVE, USDC]);
const valid = s => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const key = k => typeof k === 'string' ? k : k?.pubkey;
const ui = b => Number(b?.uiTokenAmount?.uiAmountString || '0');

// Extract only swaps with unambiguous trader token and SOL/USDC changes.
export function parseSwap(event, solUsd, now = Date.now()) {
  const record = event?.params?.result;
  const tx = record?.transaction;
  const meta = tx?.meta;
  if (!meta || meta.err) return [];
  let keys = tx?.transaction?.message?.accountKeys?.map(key);
  if (!keys && Array.isArray(tx?.transaction) && tx.transaction[1] === 'base64') {
    try {
      const decoded = VersionedTransaction.deserialize(Buffer.from(tx.transaction[0], 'base64'));
      keys = [ ...decoded.message.staticAccountKeys.map(k => k.toBase58()),
        ...(meta.loadedAddresses?.writable || []), ...(meta.loadedAddresses?.readonly || []) ];
    } catch { return []; }
  }
  if (!keys?.length) return [];
  const trader = keys[0];
  if (!trader || !valid(trader)) return [];
  const tokenDelta = new Map();
  const collect = (balances, sign) => {
    for (const b of balances || []) if (b.owner === trader && valid(b.mint))
      tokenDelta.set(b.mint, (tokenDelta.get(b.mint) || 0) + sign * ui(b));
  };
  collect(meta.preTokenBalances, -1); collect(meta.postTokenBalances, 1);
  const quoteToken = (tokenDelta.get(NATIVE) || 0) * solUsd + (tokenDelta.get(USDC) || 0);
  // Lamport changes may include rent. Ambiguous routed swaps are filtered below.
  const lamports = meta.postBalances?.[0] - meta.preBalances?.[0];
  const quote = quoteToken || (Number.isFinite(lamports) ? (lamports + (meta.fee || 0)) / 1e9 * solUsd : 0);
  if (!Number.isFinite(quote) || Math.abs(quote) < 2) return [];
  const events = [];
  for (const [mint, delta] of tokenDelta) {
    if (ignored.has(mint) || !valid(mint) || !Number.isFinite(delta) || Math.abs(delta) < 1e-9) continue;
    if (Math.sign(delta) === Math.sign(quote)) continue;
    const usd = Math.abs(quote), priceUsd = usd / Math.abs(delta);
    if (Number.isFinite(priceUsd) && priceUsd > 0) events.push({ mint, trader, side: delta > 0 ? 'buy' : 'sell',
      usd, priceUsd, at: now, signature: record.signature, slot: record.slot });
  }
  return events.length === 1 ? events : [];
}

export async function tokenSupply(rpcUrl, mint) {
  const [s, info] = await Promise.all([
    rpc(rpcUrl, 'getTokenSupply', [mint, { commitment: 'confirmed' }]),
    rpc(rpcUrl, 'getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
  ]);
  const parsed = info?.value?.data?.parsed;
  if (parsed?.type !== 'mint' || !['spl-token', 'spl-token-2022'].includes(parsed.program)) return null;
  if (parsed.info?.mintAuthority !== null || parsed.info?.freezeAuthority !== null || parsed.info?.extensions?.length) return null;
  const supply = Number(s?.value?.uiAmountString);
  return Number.isFinite(supply) && supply > 0 ? supply : null;
}

export class Market {
  constructor(cfg, store) {
    this.cfg = cfg; this.store = store; this.events = new Map(); this.supply = new Map();
    this.seen = new Map(); this.prices = new Map(); this.solUsd = 0; this.connectedAt = 0;
    this.latestAt = 0; this.lastPacketAt = 0; this.stream = null; this.seenSigs = new Map(); this.health = 'starting';
  }
  ingest(swap) {
    if (!this.cfg.watch.length || this.cfg.watch.includes(swap.mint)) {
      if (this.seenSigs.has(swap.signature)) return;
      this.seenSigs.set(swap.signature, swap.at);
      const prev = this.events.get(swap.mint) || [];
      prev.push(swap);
      this.events.set(swap.mint, prev.filter(x => swap.at - x.at < 15 * 60000).slice(-3000));
      this.prices.set(swap.mint, swap.priceUsd);
      if (!this.seen.has(swap.mint)) this.seen.set(swap.mint, swap.at);
      this.latestAt = swap.at;
      this.store.log('chain_swap', swap);
    }
  }
  reset() { this.events.clear(); this.prices.clear(); this.seenSigs.clear(); this.connectedAt = 0; this.lastPacketAt = 0; }
  async connect() {
    const url = `wss://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(this.cfg.heliusKey)}`;
    this.stream = new WebSocket(url, { maxPayload: 5 * 1024 * 1024 });
    this.stream.on('open', () => {
      this.reset(); this.connectedAt = Date.now(); this.health = 'connected';
      this.stream.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'transactionSubscribe', params: [
        { vote: false, failed: false, accountInclude: [CPMM] },
        { commitment: 'confirmed', encoding: 'jsonParsed', transactionDetails: 'full', maxSupportedTransactionVersion: 1 },
      ] }));
      this.store.log('stream_connected', {});
    });
    this.stream.on('message', raw => {
      try {
        const packet = JSON.parse(raw);
        if (packet.error) { this.health = 'error'; this.store.log('stream_error', { error: packet.error }); this.stream.close(); return; }
        if (packet.method !== 'transactionNotification') return;
        this.lastPacketAt = Date.now();
        for (const swap of parseSwap(packet, this.solUsd)) this.ingest(swap);
      } catch (e) { this.store.log('parse_error', { message: e.message }); }
    });
    this.stream.on('close', () => { this.health = 'disconnected'; this.reset(); });
    this.stream.on('error', e => { this.health = 'error'; this.store.log('stream_error', { message: e.message }); });
  }
  async ensureStream() {
    if (this.stream?.readyState === WebSocket.OPEN) {
      if (this.lastPacketAt && Date.now() - this.lastPacketAt > 120000) this.stream.close();
      else this.stream.ping();
    }
    if (!this.stream || this.stream.readyState === WebSocket.CLOSED) await this.connect();
  }
  async candidates(now = Date.now()) {
    for (const [sig, t] of this.seenSigs) if (now - t > 15 * 60000) this.seenSigs.delete(sig);
    const list = [];
    for (const [mint, all] of this.events) {
      const events = all.filter(x => now - x.at <= 10 * 60000);
      this.events.set(mint, events);
      if (events.length < 10) continue;
      if (!this.supply.has(mint)) {
        try { this.supply.set(mint, await tokenSupply(this.cfg.rpc, mint)); }
        catch (e) { this.store.log('supply_error', { mint, message: e.message }); continue; }
      }
      const supply = this.supply.get(mint);
      if (!supply) continue;
      const recent = events.filter(x => now - x.at <= 5 * 60000);
      const older = events.filter(x => now - x.at > 5 * 60000);
      const buys = recent.filter(x => x.side === 'buy');
      const sells = recent.filter(x => x.side === 'sell');
      const last = recent.at(-1);
      if (!last || now - last.at > 60000) continue;
      list.push({ mint, priceUsd: last.priceUsd, cap: supply * last.priceUsd,
        recentUsd: recent.reduce((s, x) => s + x.usd, 0), olderUsd: older.reduce((s, x) => s + x.usd, 0),
        buyUsd: buys.reduce((s, x) => s + x.usd, 0), sellUsd: sells.reduce((s, x) => s + x.usd, 0),
        buys: buys.length, uniqueBuyers: new Set(buys.map(x => x.trader)).size,
        firstSeen: this.seen.get(mint), lastAt: last.at,
        changePct: older.length ? (last.priceUsd / older.at(-1).priceUsd - 1) * 100 : 0 });
    }
    return list;
  }
}
