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
    fs.appendFileSync(path.join(this.dir, `${this.mode}-events.jsonl`), JSON.stringify({ at: new Date().toISOString(), type, ...data }) + '\n', { mode: 0o600 });
  }
  snapshot(pair, signal) { this.log('snapshot', { pair, signal }); }
  newDay() { const day = new Date().toISOString().slice(0, 10); if (this.state.day !== day) { this.state.day = day; this.state.dayPnlSol = 0; this.save(); } }
}
