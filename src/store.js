import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(dir, mode, startingSol) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.dir = dir; this.mode = mode;
    const statePath = path.join(dir, `${mode}-state.json`);
    this.path = statePath;
    this.state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {
      cashSol: mode === 'paper' ? startingSol : null, positions: {}, day: '', dayPnlSol: 0, paused: false, lastError: null,
    };
  }
  save() { const temp = `${this.path}.tmp`; fs.writeFileSync(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 }); fs.renameSync(temp, this.path); }
  log(type, data) {
    const file = type === 'chain_swap' ? `${this.mode}-swaps.jsonl` : `${this.mode}-events.jsonl`;
    fs.appendFileSync(path.join(this.dir, file), JSON.stringify({ at: new Date().toISOString(), type, ...data }) + '\n', { mode: 0o600 });
  }
  snapshot(pair, signal) { this.log('snapshot', { pair, signal }); }
  settings() {
    const file = path.join(this.dir, 'paper-settings.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  }
  saveSettings(settings) {
    const file = path.join(this.dir, 'paper-settings.json');
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(settings, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  recent(limit = 80) {
    const file = path.join(this.dir, `${this.mode}-events.jsonl`);
    if (!fs.existsSync(file)) return [];
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    try {
      const n = Math.min(size, 1024 * 1024), buffer = Buffer.alloc(n);
      fs.readSync(fd, buffer, 0, n, size - n);
      const lines = buffer.toString('utf8').split('\n');
      if (size > n) lines.shift();
      return lines.filter(Boolean).slice(-limit).reverse().flatMap(line => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
    } finally { fs.closeSync(fd); }
  }
  newDay() { const day = new Date().toISOString().slice(0, 10); if (this.state.day !== day) { this.state.day = day; this.state.dayPnlSol = 0; this.save(); } }
}
