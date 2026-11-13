import { randomUUID } from 'node:crypto';
import { fetchPublic, requireSuccess, normalizeTarget, fetchJson } from './fetch.js';
import { detect } from './detect.js';
import { snapshotCatalog, overview } from './snapshot.js';
import { diffSnapshots } from './diff.js';

export const MAX_STORES = 25, MAX_EVENTS = 3000;
export const DAY = 24 * 60 * 60 * 1000;
const bare = host => host.replace(/^www\./, '').toLowerCase();
export const adLibraryUrl = brand => `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=${encodeURIComponent(brand)}&search_type=keyword_unordered`;

export function createTracker(db, { log = console } = {}) {
  const running = new Map();

  async function inspect(input) {
    const origin = normalizeTarget(input);
    let tech = null, homeBase = origin;
    try {
      const home = requireSuccess(await fetchPublic(origin, { timeout: 15000 }));
      homeBase = new URL(home.url).origin;
      tech = detect(home.text, home.headers, homeBase);
    } catch {}
    // Shopify check: a working public products.json (on the domain they gave us,
    // then wherever the homepage landed), or at least a Shopify homepage signature.
    for (const base of [...new Set([origin, homeBase])]) {
      try {
        const { data, url } = await fetchJson(`${base}/products.json?limit=1`, { timeout: 10000 });
        if (Array.isArray(data?.products)) return { base: new URL(url).origin, tech };
      } catch {}
    }
    if (tech?.platform === 'Shopify') return { base: homeBase, tech };
    throw new Error("That doesn't look like a Shopify store (or it's blocking public product data).");
  }

  async function addStore(input) {
    const { base, tech } = await inspect(input);
    const domain = bare(new URL(base).hostname);
    const existing = db.state.stores.find(s => s.domain === domain);
    if (existing) return { store: existing, existed: true };
    if (db.state.stores.length >= MAX_STORES) throw new Error(`You can track up to ${MAX_STORES} stores in this preview.`);
    const fromDomain = domain.split('.')[0].replace(/^./, c => c.toUpperCase());
    const brand = (tech?.brand && !/^https?:|^[\w-]+(\.[\w-]+)+$/.test(tech.brand) ? tech.brand : fromDomain).slice(0, 80);
    const store = {
      id: randomUUID().slice(0, 8), domain, url: base, brand,
      theme: tech?.theme?.name || null, themeSchema: tech?.theme?.schemaName || null,
      apps: (tech?.apps || []).map(a => ({ name: a.name, category: a.category })),
      currency: tech?.currency || null,
      addedAt: new Date().toISOString(), lastCheckedAt: null, lastError: null, snapshotCount: 0, stats: null
    };
    db.state.stores.push(store); await db.save();
    await refresh(store.id).catch(() => {});
    return { store: db.state.stores.find(s => s.id === store.id) || store, existed: false };
  }

  function refresh(id) {
    if (running.has(id)) return running.get(id);
    const task = (async () => {
      const store = db.state.stores.find(s => s.id === id);
      if (!store) throw new Error('Store not found.');
      try {
        const prev = await db.readSnapshot(id);
        const next = await snapshotCatalog(store.url);
        const events = diffSnapshots(prev, next).map(e => ({ ...e, id: randomUUID(), storeId: id, domain: store.domain, brand: store.brand, at: next.takenAt, demo: !!prev?.demo }));
        await db.writeSnapshot(id, next);
        db.state.events.unshift(...events);
        db.state.events = db.state.events.slice(0, MAX_EVENTS);
        const o = overview(next.products);
        Object.assign(store, { lastCheckedAt: next.takenAt, lastError: null, snapshotCount: (store.snapshotCount || 0) + 1, complete: next.complete, warnings: next.warnings,
          stats: { productCount: o.productCount, priceMin: o.priceMin, priceMax: o.priceMax, priceAvg: o.priceAvg, onSaleCount: o.onSaleCount, soldOutCount: o.soldOutCount } });
        await db.save();
        return { store, newEvents: events.length };
      } catch (error) {
        Object.assign(store, { lastCheckedAt: new Date().toISOString(), lastError: error.message });
        await db.save();
        throw error;
      }
    })().finally(() => running.delete(id));
    running.set(id, task);
    return task;
  }

  async function removeStore(id) {
    const before = db.state.stores.length;
    db.state.stores = db.state.stores.filter(s => s.id !== id);
    db.state.events = db.state.events.filter(e => e.storeId !== id);
    await db.save(); await db.removeSnapshot(id);
    return before !== db.state.stores.length;
  }

  // One at a time, with a pause between stores, to stay polite.
  async function refreshDue({ maxAge = DAY, all = false } = {}) {
    const due = db.state.stores.filter(s => all || !s.lastCheckedAt || Date.now() - Date.parse(s.lastCheckedAt) >= maxAge);
    const results = [];
    for (const s of due) {
      try { const r = await refresh(s.id); results.push({ id: s.id, ok: true, newEvents: r.newEvents }); }
      catch (error) { results.push({ id: s.id, ok: false, error: error.message }); log.warn?.(`Refresh failed for ${s.domain}: ${error.message}`); }
      await new Promise(r => setTimeout(r, 1500));
    }
    return results;
  }

  function startSchedule({ every = 60 * 60 * 1000 } = {}) {
    let busy = false;
    const tick = async () => { if (busy) return; busy = true; try { await refreshDue(); } finally { busy = false; } };
    const timer = setInterval(tick, every); timer.unref();
    setTimeout(tick, 30_000).unref();
    return timer;
  }

  return { addStore, refresh, removeStore, refreshDue, startSchedule, isRunning: id => running.has(id) };
}
