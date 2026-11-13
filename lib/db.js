import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

// Tiny JSON-file store. db.json holds stores + events; each store's latest
// catalog snapshot lives in snapshots/<id>.json. Writes are atomic and serialized.
export function createDb(dir) {
  const dbFile = path.join(dir, 'db.json');
  const snapDir = path.join(dir, 'snapshots');
  let state = null, chain = Promise.resolve();
  const atomic = async (file, data) => { const tmp = `${file}.${process.pid}.tmp`; await writeFile(tmp, JSON.stringify(data)); await rename(tmp, file); };
  const queue = fn => (chain = chain.then(fn, fn));
  return {
    async init() {
      await mkdir(snapDir, { recursive: true });
      try { state = JSON.parse(await readFile(dbFile, 'utf8')); } catch { state = { stores: [], events: [] }; }
      state.stores ||= []; state.events ||= [];
      return this;
    },
    get state() { return state; },
    save() { return queue(() => atomic(dbFile, state)); },
    async readSnapshot(id) { try { return JSON.parse(await readFile(path.join(snapDir, `${id}.json`), 'utf8')); } catch { return null; } },
    writeSnapshot(id, snap) { return queue(() => atomic(path.join(snapDir, `${id}.json`), snap)); },
    removeSnapshot(id) { return queue(() => rm(path.join(snapDir, `${id}.json`), { force: true })); }
  };
}
