// Compare two catalog snapshots and describe what changed, in plain terms.
// Each event: { type, productId, title, url, image, from, to }
export const EVENT_TYPES = ['new_product', 'removed_product', 'price_down', 'price_up', 'sale_started', 'sold_out', 'restocked'];

const lite = p => ({ productId: p.id, title: p.title, url: p.url, image: p.image });

export function diffSnapshots(prev, next) {
  if (!prev?.products || !next?.products) return [];
  const before = new Map(prev.products.map(p => [p.id, p]));
  const after = new Map(next.products.map(p => [p.id, p]));
  const events = [];
  for (const [id, p] of after) {
    const old = before.get(id);
    if (!old) {
      // On a capped crawl a product can just slide into view; only call it new if it was published after the last check.
      const published = Date.parse(p.publishedAt || p.createdAt);
      if (prev.complete !== false || (published && published > Date.parse(prev.takenAt))) events.push({ type: 'new_product', ...lite(p), to: { price: p.price } });
      continue;
    }
    if (old.price !== null && p.price !== null && old.price !== p.price) {
      events.push({ type: p.price < old.price ? 'price_down' : 'price_up', ...lite(p), from: { price: old.price }, to: { price: p.price } });
    }
    if (p.onSale && !old.onSale) events.push({ type: 'sale_started', ...lite(p), from: { price: old.price }, to: { price: p.price, compareAt: p.compareAt } });
    if (p.soldOut === true && old.soldOut === false) events.push({ type: 'sold_out', ...lite(p) });
    if (p.soldOut === false && old.soldOut === true) events.push({ type: 'restocked', ...lite(p) });
  }
  // An incomplete crawl can't prove a product was removed.
  if (next.complete !== false) {
    for (const [id, p] of before) if (!after.has(id)) events.push({ type: 'removed_product', ...lite(p), from: { price: p.price } });
  }
  return events;
}
