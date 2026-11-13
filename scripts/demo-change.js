// DEMO ONLY. Edits a store's saved snapshot so the next "Refresh now" has
// something to show. Every change it causes is tagged "Demo" in the app.
// Usage: node scripts/demo-change.js <domain>   (then hit Refresh now)
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const dir = path.resolve(process.env.DATA_DIR || 'data');
const domain = process.argv[2];
const db = JSON.parse(await readFile(path.join(dir, 'db.json'), 'utf8'));
const store = db.stores.find(s => s.domain === domain);
if (!store) { console.error(`Not tracking ${domain}. Tracked: ${db.stores.map(s => s.domain).join(', ')}`); process.exit(1); }
const file = path.join(dir, 'snapshots', `${store.id}.json`);
const snap = JSON.parse(await readFile(file, 'utf8'));
const ps = snap.products, did = [];
const date = p => Date.parse(p.publishedAt || p.createdAt) || 0;
// 1) Hide the two newest products, so they show up as new drops.
for (const p of [...ps].sort((a, b) => date(b) - date(a)).slice(0, 2)) { ps.splice(ps.indexOf(p), 1); did.push(`hid ${p.title}`); }
// 2) Pretend two regular-price items cost something else before (price cut + price up).
const regular = ps.filter(p => !p.onSale && p.price);
if (regular[0]) { regular[0].price = Math.round(regular[0].price * 1.25); did.push(`raised old price of ${regular[0].title}`); }
if (regular[1]) { regular[1].price = Math.round(regular[1].price * 0.8); did.push(`lowered old price of ${regular[1].title}`); }
// 3) Pretend a sale item wasn't on sale before.
const sale = ps.find(p => p.onSale);
if (sale) { sale.onSale = false; sale.compareAt = null; sale.price = sale.price; did.push(`unmarked sale on ${sale.title}`); }
// 4) Flip stock on one item each way.
const avail = ps.find(p => p.soldOut === false && p !== sale && !regular.slice(0, 2).includes(p));
if (avail) { avail.soldOut = true; did.push(`marked ${avail.title} sold out (will show restocked)`); }
const out = ps.find(p => p.soldOut === true && p !== avail);
if (out) { out.soldOut = false; did.push(`marked ${out.title} in stock (will show sold out)`); }
snap.demo = true;
await writeFile(file, JSON.stringify(snap));
console.log(`DEMO snapshot edited for ${domain}:\n- ${did.join('\n- ')}\nNow tap "Refresh now" on that store.`);
