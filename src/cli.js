import fs from 'node:fs';
import { loadEnv, config } from './config.js';
import { Bot } from './bot.js';
import { createDashboard } from './dashboard.js';

loadEnv();
const cmd = process.argv[2] || 'run';
if (cmd === 'status') {
  const mode = process.env.MODE || 'paper', path = `${process.env.DATA_DIR || './data'}/${mode}-state.json`;
  console.log(fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : 'No state yet');
} else if (['run', 'once'].includes(cmd)) {
  try {
    const bot = new Bot(config());
    if (cmd === 'run') {
      const server = createDashboard(bot, process.env.DASHBOARD_PASSWORD);
      const port = Number(process.env.PORT || 3000);
      server.listen(port, '0.0.0.0', () => console.log(`Dashboard listening on port ${port}`));
    }
    console.log(`Mode: ${bot.cfg.mode}; market: ${bot.cfg.watch.length ? 'watchlist' : 'Raydium CPMM discovery'}; wallet: ${bot.jupiter.signer?.publicKey || 'none'}`);
    await bot.run(cmd === 'once');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
} else { console.error('Usage: npm start | npm run once | npm run status'); process.exitCode = 1; }
