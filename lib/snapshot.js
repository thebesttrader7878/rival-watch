import { fetchJson } from './fetch.js';

export const PAGE_LIMIT = 10; // up to 2,500 products per store
const pause = ms => new Promise(r => setTimeout(r, ms));
const num = v => (v === null || v === undefined || String(v).trim() === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

// Turn one raw /products.json product into the small shape we store and diff.
export function normalizeProduct(p, base) {
  const variants = (Array.isArray(p.variants) ? p.variants : []).filter(v => v && typeof v === 'object');
  const priced = variants.map(v => ({ price: num(v.price), compareAt: num(v.compare_at_price), available: v.available })).filter(v => v.price !== null);
  const cheapest = priced.reduce((best, v) => (!best || v.price < best.price ? v : best), null);
  const onSaleVariants = priced.filter(v => v.compareAt !== null && v.compareAt > v.price);
  const availKnown = variants.some(v => typeof v.available === 'boolean');
  const available = variants.filter(v => v.available === true).length;
  const image = p.images?.[0]?.src || p.image?.src || null;
  return {
    id: String(p.id),
    title: String(p.title || p.handle).slice(0, 200),
    handle: p.handle,
    url: new URL(`/products/${encodeURIComponent(p.handle)}`, base).href,
    image: typeof image === 'string' && /^https:\/\//.test(image) ? image : null,
    price: cheapest?.price ?? null,
    maxPrice: priced.length ? Math.max(...priced.map(v => v.price)) : null,
    compareAt: onSaleVariants.length ? Math.max(...onSaleVariants.map(v => v.compareAt)) : null,
    onSale: onSaleVariants.length > 0,
    variants: variants.length,
    variantsAvailable: availKnown ? available : null,
    soldOut: availKnown && variants.length ? available === 0 : null,
    createdAt: p.created_at || null,
    publishedAt: p.published_at || null
  };
}

// Polite paginated crawl of the public catalog.
export async function snapshotCatalog(base, { requestJson = fetchJson, pagePause = 800, signal } = {}) {
  const products = [], seen = new Set(), warnings = [];
  let complete = false;
  for (let page = 1; page <= PAGE_LIMIT; page++) {
    let data;
    try { ({ data } = await requestJson(`${base}/products.json?limit=250&page=${page}`, { signal, timeout: 15000 })); }
    catch (error) {
      if (!products.length) throw new Error(`products.json not available: ${error.message}`);
      warnings.push(`Stopped at page ${page}: ${error.message}`); break;
    }
    if (!Array.isArray(data?.products)) {
      if (!products.length) throw new Error('products.json did not return a product list.');
      break;
    }
    let added = 0;
    for (const raw of data.products) {
      if (!raw || raw.id == null || typeof raw.handle !== 'string' || seen.has(String(raw.id))) continue;
      seen.add(String(raw.id)); products.push(normalizeProduct(raw, base)); added++;
    }
    if (data.products.length < 250) { complete = true; break; }
    if (!added) { warnings.push('Store repeated a page, stopped early.'); break; }
    if (page < PAGE_LIMIT) await pause(pagePause);
  }
  if (!complete && !warnings.length) warnings.push(`Only the first ${PAGE_LIMIT * 250} products are tracked.`);
  return { takenAt: new Date().toISOString(), complete, warnings, products };
}

export function overview(products) {
  const priced = products.filter(p => p.price !== null);
  const prices = priced.map(p => p.price);
  const date = p => Date.parse(p.publishedAt || p.createdAt) || 0;
  return {
    productCount: products.length,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: priced.length ? Math.max(...priced.map(p => p.maxPrice ?? p.price)) : null,
    priceAvg: prices.length ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100 : null,
    onSaleCount: products.filter(p => p.onSale).length,
    soldOutCount: products.filter(p => p.soldOut === true).length,
    newest: [...products].sort((a, b) => date(b) - date(a)).slice(0, 8),
    onSale: products.filter(p => p.onSale).sort((a, b) => discount(b) - discount(a)).slice(0, 12)
  };
}
export const discount = p => (p.onSale && p.compareAt ? Math.round((1 - p.price / p.compareAt) * 100) : 0);
