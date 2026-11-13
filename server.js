import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './lib/db.js';
import { createTracker, adLibraryUrl } from './lib/tracker.js';
import { overview } from './lib/snapshot.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4320);
const host = process.env.HOST || '127.0.0.1';
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const publicHosts = (process.env.PUBLIC_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
const allowedHosts = ['localhost', '127.0.0.1', '[::1]', ...publicHosts];

const db = await createDb(dataDir).init();
const tracker = createTracker(db);
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
  // Host allowlist blocks DNS rebinding; origin check blocks cross-site writes.
  if (!allowedHosts.includes(req.hostname)) return res.status(403).json({ error: 'Host not allowed.' });
  if (req.headers.origin && ![`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin)) return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
  next();
});
app.use(express.json({ limit: '4kb' }));

let addHits = [];
const view = s => ({ ...s, adLibrary: adLibraryUrl(s.brand), refreshing: tracker.isRunning(s.id), changeCount: db.state.events.filter(e => e.storeId === s.id).length,
  recentChangeCount: db.state.events.filter(e => e.storeId === s.id && Date.now() - Date.parse(e.at) < 7 * 864e5).length });

app.get('/api/health', (_req, res) => res.json({ status: 'ok', stores: db.state.stores.length }));
app.get('/api/stores', (_req, res) => res.json({ stores: db.state.stores.map(view) }));
app.post('/api/stores', async (req, res) => {
  if (!req.is('application/json') || typeof req.body?.url !== 'string') return res.status(415).json({ error: 'Send JSON with a url.' });
  addHits = addHits.filter(t => Date.now() - t < 60_000);
  if (addHits.length >= 6) return res.status(429).json({ error: 'Slow down a sec, try again in a minute.' });
  addHits.push(Date.now());
  try { const { store, existed } = await tracker.addStore(req.body.url); res.status(existed ? 200 : 201).json({ store: view(store), existed }); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
app.get('/api/stores/:id', async (req, res) => {
  const store = db.state.stores.find(s => s.id === req.params.id);
  if (!store) return res.status(404).json({ error: 'Store not found.' });
  const snap = await db.readSnapshot(store.id);
  res.json({ store: view(store), overview: snap ? overview(snap.products) : null, demoSnapshot: !!snap?.demo,
    events: db.state.events.filter(e => e.storeId === store.id).slice(0, 200) });
});
app.post('/api/stores/:id/refresh', async (req, res) => {
  if (!db.state.stores.some(s => s.id === req.params.id)) return res.status(404).json({ error: 'Store not found.' });
  try { const r = await tracker.refresh(req.params.id); res.json({ store: view(r.store), newEvents: r.newEvents }); }
  catch (error) { res.status(502).json({ error: `Couldn't refresh: ${error.message}` }); }
});
app.delete('/api/stores/:id', async (req, res) => res.json({ removed: await tracker.removeStore(req.params.id) }));
let refreshingAll = false;
app.post('/api/refresh-all', async (_req, res) => {
  if (refreshingAll) return res.status(409).json({ error: 'Already refreshing everything.' });
  refreshingAll = true;
  try { res.json({ results: await tracker.refreshDue({ all: true }) }); } finally { refreshingAll = false; }
});
app.get('/api/feed', (req, res) => {
  const type = typeof req.query.type === 'string' ? req.query.type : '';
  const events = db.state.events.filter(e => !type || e.type === type || (type === 'price' && /^price_/.test(e.type)) || (type === 'stock' && ['sold_out', 'restocked'].includes(e.type)));
  res.json({ events: events.slice(0, 300), total: events.length });
});
app.use(express.static(path.join(root, 'public')));
app.use((error, _req, res, _next) => res.status(error.status === 413 ? 413 : 400).json({ error: 'Invalid request.' }));

app.listen(port, host, () => {
  console.log(`Competitor Tracker on http://${host}:${port} (data: ${dataDir})`);
  if (process.env.DISABLE_SCHEDULE !== '1') tracker.startSchedule();
});
