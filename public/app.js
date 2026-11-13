const app = document.getElementById('app');
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
};
const api = async (url, opts = {}) => {
  const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
};
const toast = msg => { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200); };
const money = (n, cur) => n == null ? 'n/a' : new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
const ago = iso => {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`;
};
const ext = (href, ...kids) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, ...kids);
const thumb = src => src ? h('img', { class: 'thumb', src: sized(src), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('div', { class: 'thumb empty' }, '🛍');
let currencies = {};
const render = (...kids) => app.replaceChildren(...kids.flat().filter(k => k != null && k !== false));
function sized(src) { try { const u = new URL(src); if (/shopify|\/cdn\/shop\//.test(u.href)) u.searchParams.set('width', '200'); return u.href; } catch { return src; } }

const META = {
  new_product: ['New drop', 'green', '✦'], removed_product: ['Pulled', 'gray', '−'],
  price_down: ['Price cut', 'green', '↓'], price_up: ['Price up', 'red', '↑'],
  sale_started: ['Sale started', 'amber', '%'], sold_out: ['Sold out', 'red', '○'], restocked: ['Restocked', 'blue', '●']
};
function eventLine(e) {
  const cur = currencies[e.storeId];
  const pct = (a, b) => a ? ` (${Math.round(((b - a) / a) * 100) > 0 ? '+' : ''}${Math.round(((b - a) / a) * 100)}%)` : '';
  switch (e.type) {
    case 'new_product': return `Just added at ${money(e.to?.price, cur)}`;
    case 'removed_product': return `Taken off the store (was ${money(e.from?.price, cur)})`;
    case 'price_down': case 'price_up': return `${money(e.from.price, cur)} → ${money(e.to.price, cur)}${pct(e.from.price, e.to.price)}`;
    case 'sale_started': return `Now ${money(e.to.price, cur)}, was ${money(e.to.compareAt, cur)}`;
    case 'sold_out': return 'Every variant is sold out';
    case 'restocked': return 'Back in stock';
  }
  return '';
}
function eventCard(e, showStore = true) {
  const [label, tone, icon] = META[e.type] || [e.type, 'gray', '•'];
  return h('li', { class: 'event' },
    ext(e.url, thumb(e.image)),
    h('div', { class: 'event-body' },
      h('div', { class: 'event-top' },
        h('span', { class: `tag ${tone}` }, `${icon} ${label}`),
        e.demo ? h('span', { class: 'tag demo', title: 'Created by the demo script, not a real change' }, 'Demo') : null,
        h('span', { class: 'muted small' }, ago(e.at))),
      ext(e.url, h('strong', { class: 'title' }, e.title)),
      h('div', { class: 'small' }, eventLine(e)),
      showStore ? h('a', { class: 'small muted', href: `#/store/${e.storeId}` }, e.brand || e.domain) : null));
}
function productRow(p, cur, extra) {
  return h('li', { class: 'product' }, ext(p.url, thumb(p.image)),
    h('div', { class: 'event-body' }, ext(p.url, h('strong', { class: 'title' }, p.title)),
      h('div', { class: 'small' }, money(p.price, cur), p.onSale ? h('s', { class: 'muted' }, ` ${money(p.compareAt, cur)}`) : null,
        p.soldOut ? h('span', { class: 'tag red tiny' }, 'Sold out') : null),
      extra ? h('div', { class: 'small muted' }, extra(p)) : null));
}
const setTab = t => document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === t));

async function dashboard() {
  setTab('home');
  const [{ stores }, { events }] = await Promise.all([api('/api/stores'), api('/api/feed')]);
  stores.forEach(s => (currencies[s.id] = s.currency));
  const input = h('input', { id: 'store-url', type: 'text', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'competitor.com', required: true, 'aria-label': 'Store URL' });
  const btn = h('button', { id: 'add-button', type: 'submit', class: 'primary' }, 'Track it');
  const err = h('p', { class: 'error', hidden: true });
  const form = h('form', { class: 'add', onsubmit: async ev => {
    ev.preventDefault(); err.hidden = true; btn.disabled = true; btn.textContent = 'Grabbing their catalog…';
    try { const r = await api('/api/stores', { method: 'POST', body: JSON.stringify({ url: input.value }) }); toast(r.existed ? 'Already watching that one' : `Now watching ${r.store.brand}`); route(); }
    catch (e) { err.textContent = e.message; err.hidden = false; }
    finally { btn.disabled = false; btn.textContent = 'Track it'; }
  } }, h('label', { for: 'store-url' }, 'Add a competitor\u2019s Shopify store'), h('div', { class: 'row' }, input, btn), err);
  const refreshAll = h('button', { class: 'ghost', onclick: async () => {
    refreshAll.disabled = true; refreshAll.textContent = 'Checking all…';
    try { const { results } = await api('/api/refresh-all', { method: 'POST' }); toast(`${results.reduce((a, r) => a + (r.newEvents || 0), 0)} new changes`); route(); }
    catch (e) { toast(e.message); refreshAll.disabled = false; refreshAll.textContent = 'Refresh all'; }
  } }, 'Refresh all');
  const total7 = stores.reduce((a, s) => a + s.recentChangeCount, 0);
  render(
    h('section', { class: 'hero' }, h('h1', {}, 'Keep tabs on your competitors'),
      h('p', { class: 'muted' }, 'New drops, price moves, sales and sellouts from any Shopify store. Checked daily, all from public data.'), form),
    h('div', { class: 'section-head' }, h('h2', {}, `Watching ${stores.length} store${stores.length === 1 ? '' : 's'}`), stores.length ? refreshAll : null),
    stores.length ? h('ul', { class: 'stores' }, stores.map(s => h('li', {}, h('a', { class: 'store-card', href: `#/store/${s.id}` },
      h('div', { class: 'avatar' }, (s.brand || s.domain)[0].toUpperCase()),
      h('div', { class: 'grow' }, h('strong', {}, s.brand), h('div', { class: 'small muted' }, `${s.domain} · checked ${ago(s.lastCheckedAt)}`),
        s.lastError ? h('div', { class: 'small error-text' }, s.lastError) : h('div', { class: 'small' }, s.stats ? `${s.stats.productCount.toLocaleString()} products · ${s.stats.onSaleCount} on sale` : 'No snapshot yet')),
      h('div', { class: `count ${s.changeCount ? 'hot' : ''}` }, h('b', {}, s.changeCount), h('span', {}, 'changes')))))) :
      h('div', { class: 'empty-state' }, h('p', {}, 'No stores yet. Drop in a competitor above, like allbirds.com.')),
    events.length ? h('div', { class: 'section-head' }, h('h2', {}, 'Latest changes'), h('a', { href: '#/feed' }, `See all (${total7} this week)`)) : null,
    events.length ? h('ul', { class: 'events' }, events.slice(0, 5).map(e => eventCard(e))) : null,
    h('p', { class: 'fine' }, 'We only read public product pages. No traffic or revenue guesses here.'));
}

async function feedPage() {
  setTab('feed');
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const type = params.get('type') || '';
  const [{ stores }, { events, total }] = await Promise.all([api('/api/stores'), api(`/api/feed${type ? `?type=${encodeURIComponent(type)}` : ''}`)]);
  stores.forEach(s => (currencies[s.id] = s.currency));
  const chips = [['', 'All'], ['new_product', 'New drops'], ['price', 'Prices'], ['sale_started', 'Sales'], ['stock', 'Stock'], ['removed_product', 'Pulled']];
  render(
    h('h1', {}, 'What changed'),
    h('p', { class: 'muted' }, `${total} change${total === 1 ? '' : 's'} across ${stores.length} store${stores.length === 1 ? '' : 's'}. Tap any product to see it live.`),
    h('div', { class: 'chips' }, chips.map(([v, l]) => h('a', { class: `chip ${v === type ? 'on' : ''}`, href: v ? `#/feed?type=${v}` : '#/feed' }, l))),
    events.length ? h('ul', { class: 'events' }, events.map(e => eventCard(e))) :
      h('div', { class: 'empty-state' }, h('p', {}, 'Nothing yet. Changes show up after the next check finds something different.')));
}

async function storePage(id) {
  setTab('');
  const { store: s, overview: o, events, demoSnapshot } = await api(`/api/stores/${encodeURIComponent(id)}`);
  currencies[s.id] = s.currency; const cur = s.currency;
  const refresh = h('button', { class: 'primary', onclick: async () => {
    refresh.disabled = true; refresh.textContent = 'Checking…';
    try { const r = await api(`/api/stores/${s.id}/refresh`, { method: 'POST' }); toast(r.newEvents ? `${r.newEvents} new changes` : 'No changes since last check'); route(); }
    catch (e) { toast(e.message); refresh.disabled = false; refresh.textContent = 'Refresh now'; }
  } }, 'Refresh now');
  const remove = h('button', { class: 'ghost danger', onclick: async () => { if (!confirm(`Stop watching ${s.brand}?`)) return; await api(`/api/stores/${s.id}`, { method: 'DELETE' }); location.hash = '#/'; } }, 'Stop watching');
  const stat = (label, value, wide) => h('div', { class: `stat ${wide ? 'wide' : ''}` }, h('b', {}, value), h('span', {}, label));
  render(
    h('a', { class: 'back', href: '#/' }, '← All stores'),
    h('section', { class: 'store-head' },
      h('div', { class: 'avatar big' }, (s.brand || s.domain)[0].toUpperCase()),
      h('div', { class: 'grow' }, h('h1', {}, s.brand), ext(s.url, s.domain), h('div', { class: 'small muted' }, `Checked ${ago(s.lastCheckedAt)} · auto-checks daily`))),
    h('div', { class: 'actions' }, refresh, ext(s.adLibrary, h('span', { class: 'btn ads' }, 'View their active ads ↗'))),
    s.lastError ? h('p', { class: 'error' }, s.lastError) : null,
    demoSnapshot ? h('p', { class: 'note' }, 'Demo: the saved snapshot was edited by the demo script, so the next refresh will show made-up changes.') : null,
    o ? h('div', { class: 'stats' }, stat('products', o.productCount.toLocaleString() + (s.complete === false ? '+' : '')), stat('avg price', money(o.priceAvg, cur)), stat('on sale', o.onSaleCount),
      stat('price range', `${money(o.priceMin, cur)} to ${money(o.priceMax, cur)}`, true), stat('sold out', o.soldOutCount)) : null,
    h('section', { class: 'card' }, h('h2', {}, 'Their setup'),
      h('div', { class: 'kv' }, h('span', {}, 'Theme'), h('b', {}, s.theme ? `${s.theme}${s.themeSchema && s.themeSchema !== s.theme ? ` (${s.themeSchema})` : ''}` : 'Not visible')),
      h('div', { class: 'kv' }, h('span', {}, 'Apps spotted'), s.apps.length ? h('div', { class: 'chips' }, s.apps.map(a => h('span', { class: 'chip static', title: a.category }, a.name))) : h('b', {}, 'None spotted')),
      h('p', { class: 'fine' }, 'Based on their homepage code. Not spotted doesn\u2019t mean they don\u2019t use it.')),
    h('section', { class: 'card' }, h('h2', {}, `What changed (${events.length})`),
      events.length ? h('ul', { class: 'events' }, events.slice(0, 30).map(e => eventCard(e, false))) : h('p', { class: 'muted' }, 'No changes yet. We\u2019ll flag anything new on the next check.')),
    o?.onSale.length ? h('section', { class: 'card' }, h('h2', {}, `On sale (${o.onSaleCount})`), h('ul', { class: 'products' }, o.onSale.map(p => productRow(p, cur, p => `${Math.round((1 - p.price / p.compareAt) * 100)}% off`)))) : null,
    o ? h('section', { class: 'card' }, h('h2', {}, 'Newest products'), h('ul', { class: 'products' }, o.newest.map(p => productRow(p, cur, p => `Added ${new Date(p.publishedAt || p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`)))) : null,
    h('div', { class: 'foot-actions' }, remove));
}

async function route() {
  const hash = location.hash || '#/';
  try {
    const m = hash.match(/^#\/store\/([\w-]+)/);
    if (m) await storePage(m[1]); else if (hash.startsWith('#/feed')) await feedPage(); else await dashboard();
  } catch (e) { render(h('p', { class: 'error' }, e.message)); }
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);
route();
