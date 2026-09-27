import fs from 'node:fs';

export function loadEnv(path = '.env') {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

export function config(env = process.env) {
  const num = (name, fallback, min = 0) => {
    const v = Number(env[name] ?? fallback);
    if (!Number.isFinite(v) || v < min) throw new Error(`Invalid ${name}`);
    return v;
  };
  const mode = env.MODE ?? 'paper';
  if (!['paper', 'live'].includes(mode)) throw new Error('MODE must be paper or live');
  if (mode === 'live' && (env.LIVE_TRADING_ENABLED !== 'true' || env.LIVE_CONFIRM !== 'I_UNDERSTAND_REAL_FUNDS_ARE_AT_RISK')) throw new Error('Live trading requires LIVE_TRADING_ENABLED=true and LIVE_CONFIRM');
  if (mode === 'live' && !env.BS58_PRIVATE_KEY) throw new Error('Live mode needs BS58_PRIVATE_KEY');
  if (!env.JUPITER_API_KEY || !env.HELIUS_API_KEY) throw new Error('Set JUPITER_API_KEY and HELIUS_API_KEY');
  return {
    mode, apiKey: env.JUPITER_API_KEY, heliusKey: env.HELIUS_API_KEY,
    rpc: env.SOLANA_RPC_URL || `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(env.HELIUS_API_KEY)}`,
    watch: (env.WATCH_TOKENS || '').split(',').map(s => s.trim()).filter(Boolean),
    pollMs: num('POLL_SECONDS', 20, 10) * 1000, dataDir: env.DATA_DIR || './data',
    startingSol: num('STARTING_SOL', 2), tradeSol: num('TRADE_SOL', 0.05, 0.001),
    maxPositionSol: num('MAX_POSITION_SOL', 0.1, 0.001), maxPositions: num('MAX_OPEN_POSITIONS', 2, 1),
    maxDailyLossSol: num('MAX_DAILY_LOSS_SOL', 0.1, 0.001), maxImpactPct: num('MAX_PRICE_IMPACT_PCT', 2),
    maxRoundtripPct: num('MAX_ROUNDTRIP_COST_PCT', 6), stopPct: num('STOP_LOSS_PCT', 12),
    trailActivatePct: num('TRAIL_ACTIVATE_PCT', 18), trailDistancePct: num('TRAIL_DISTANCE_PCT', 9),
    takeProfitPct: num('TAKE_PROFIT_PCT', 40), maxHoldMs: num('MAX_HOLD_MINUTES', 25) * 60000,
    minCap: num('MIN_MARKET_CAP', 75000), maxCap: num('MAX_MARKET_CAP', 500000),
    minVolume: num('MIN_VOLUME_M5_USD', 10000),
    minBuys: num('MIN_M5_BUYS', 25), minRatio: num('MIN_BUY_SELL_RATIO', 1.5),
    minAcceleration: num('MIN_VOLUME_ACCELERATION', 1.7), minUnique: num('MIN_UNIQUE_BUYERS', 8),
    secret: mode === 'live' ? env.BS58_PRIVATE_KEY : undefined,
  };
}
