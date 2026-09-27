import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSwap, NATIVE } from '../src/market.js';
import { evaluate } from '../src/strategy.js';
import { Bot } from '../src/bot.js';
import { config } from '../src/config.js';

const mint = 'DezXAZ8z7PnrnRJjz3wXBoRgixCaKGunmfE8fXYsWq3';
const trader = '11111111111111111111111111111112';
const tx = (before, after, lamports) => ({ params: { result: { signature: 'sig', slot: 10, transaction: {
  transaction: { message: { accountKeys: [{ pubkey: trader, signer: true }] } },
  meta: { err: null, fee: 5000, preBalances: [1e9], postBalances: [1e9 + lamports - 5000],
    preTokenBalances: [{ mint, owner: trader, uiTokenAmount: { uiAmountString: String(before) } }],
    postTokenBalances: [{ mint, owner: trader, uiTokenAmount: { uiAmountString: String(after) } }] },
} } } });

test('decodes confirmed trader buy and rejects ambiguous direction', () => {
  const event = parseSwap(tx(0, 1000, -1e8), 200, 100)[0];
  assert.equal(event.side, 'buy'); assert.equal(event.usd, 20); assert.equal(event.priceUsd, 0.02);
  assert.equal(parseSwap(tx(0, 1000, 1e8), 200).length, 0);
});

test('momentum requires prior observation and independent buyers', () => {
  const c = { minCap: 75000, maxCap: 500000, minVolume: 10000, minBuys: 25, minRatio: 1.5,
    minAcceleration: 1.7, minUnique: 8 };
  const now = Date.now();
  const p = { priceUsd: 0.01, cap: 100000, firstSeen: now - 700000, lastAt: now,
    recentUsd: 12000, olderUsd: 5000, buyUsd: 9000, sellUsd: 3000,
    buys: 35, uniqueBuyers: 14, changePct: 9 };
  assert.equal(evaluate(p, c, now).eligible, true);
  assert.equal(evaluate({ ...p, uniqueBuyers: 2 }, c, now).eligible, false);
});

test('paper round trip persists token amounts, cash, and realized P&L', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'momentum-test-'));
  try {
    const c = config({ MODE: 'paper', JUPITER_API_KEY: 'test', HELIUS_API_KEY: 'test', DATA_DIR: dir,
      STARTING_SOL: '1', TRADE_SOL: '0.05', MIN_VOLUME_M5_USD: '10000' });
    const bot = new Bot(c);
    bot.jupiter.roundtrip = async () => ({ buy: { outAmount: '1000000' }, costPct: 2 });
    bot.jupiter.order = async () => ({ outAmount: '75000000' });
    await bot.enter({ mint, priceUsd: 0.01 }, {});
    assert.equal(bot.store.state.cashSol, 0.95);
    await bot.managePosition(mint, bot.store.state.positions[mint]);
    assert.equal(bot.store.state.cashSol, 1.025);
    assert.ok(Math.abs(bot.store.state.dayPnlSol - 0.025) < 1e-9);
    assert.deepEqual(bot.store.state.positions, {});
    assert.equal(new Bot(c).store.state.cashSol, 1.025);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('live mode requires two explicit switches and a private key', () => {
  assert.throws(() => config({ MODE: 'live', JUPITER_API_KEY: 'a', HELIUS_API_KEY: 'b',
    BS58_PRIVATE_KEY: 'not-a-real-key' }), /LIVE_TRADING_ENABLED/);
});
