export function evaluate(p, c, now = Date.now()) {
  const reasons = [];
  const reject = (condition, reason) => { if (condition) reasons.push(reason); };
  const acceleration = p.olderUsd > 0 ? p.recentUsd / p.olderUsd : 0;
  const ratio = p.buyUsd / Math.max(1, p.sellUsd);
  reject(!p.priceUsd || now - p.lastAt > 60000, 'stale price');
  reject(p.cap < c.minCap || p.cap > c.maxCap, 'market cap');
  reject(now - p.firstSeen < 10 * 60000, 'insufficient observation');
  reject(p.recentUsd < c.minVolume, 'volume');
  reject(p.buys < c.minBuys || ratio < c.minRatio, 'buy pressure');
  reject(acceleration < c.minAcceleration, 'volume acceleration');
  reject(p.changePct < 5 || p.changePct > 20, 'price change');
  reject(p.uniqueBuyers < c.minUnique, 'unique buyers');
  return { eligible: reasons.length === 0, reasons, acceleration, ratio, uniqueBuyers: p.uniqueBuyers };
}

export function exitReason(position, markSol, c, now = Date.now()) {
  const pnl = (markSol / position.costSol - 1) * 100;
  if (pnl <= -c.stopPct) return 'stop';
  if (pnl >= c.takeProfitPct) return 'take_profit';
  const high = Math.max(position.highPct || 0, pnl);
  if (high >= c.trailActivatePct && pnl <= high - c.trailDistancePct) return 'trailing';
  if (now - position.openedAt >= c.maxHoldMs) return 'time';
  return null;
}
