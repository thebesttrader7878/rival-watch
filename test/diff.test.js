import test from 'node:test';
import assert from 'node:assert/strict';
import { diffSnapshots } from '../lib/diff.js';
import { normalizeProduct, snapshotCatalog, overview } from '../lib/snapshot.js';

const base = 'https://shop.example.com';
const p = (id, over = {}) => ({ id, title: `P${id}`, url: `${base}/products/p${id}`, image: null, price: 50, maxPrice: 50, compareAt: null, onSale: false, soldOut: false, ...over });
const snap = (products, complete = true) => ({ products, complete });
const types = events => events.map(e => `${e.type}:${e.productId}`).sort();

test('no changes means no events', () => {
  assert.deepEqual(diffSnapshots(snap([p('1'), p('2')]), snap([p('1'), p('2')])), []);
});
test('first snapshot has nothing to compare', () => {
  assert.deepEqual(diffSnapshots(null, snap([p('1')])), []);
});
test('new and removed products', () => {
  assert.deepEqual(types(diffSnapshots(snap([p('1'), p('2')]), snap([p('2'), p('3')]))), ['new_product:3', 'removed_product:1']);
});
test('incomplete crawl never reports removals', () => {
  assert.deepEqual(types(diffSnapshots(snap([p('1'), p('2')]), snap([p('2')], false))), []);
});
test('capped crawl only flags genuinely new products', () => {
  const prev = { products: [p('1')], complete: false, takenAt: '2026-11-01T00:00:00Z' };
  const next = snap([p('1'), p('2', { publishedAt: '2025-01-01T00:00:00Z' }), p('3', { publishedAt: '2026-11-02T00:00:00Z' })], false);
  assert.deepEqual(types(diffSnapshots(prev, next)), ['new_product:3']);
});
test('price up and down carry from/to', () => {
  const ev = diffSnapshots(snap([p('1'), p('2')]), snap([p('1', { price: 40 }), p('2', { price: 65 })]));
  assert.deepEqual(types(ev), ['price_down:1', 'price_up:2']);
  const down = ev.find(e => e.type === 'price_down');
  assert.deepEqual([down.from.price, down.to.price], [50, 40]);
});
test('sale started when compare-at price appears', () => {
  const ev = diffSnapshots(snap([p('1')]), snap([p('1', { price: 40, onSale: true, compareAt: 50 })]));
  assert.deepEqual(types(ev), ['price_down:1', 'sale_started:1']);
  assert.equal(ev.find(e => e.type === 'sale_started').to.compareAt, 50);
});
test('a sale that keeps running is not reported again', () => {
  const s = p('1', { price: 40, onSale: true, compareAt: 50 });
  assert.deepEqual(diffSnapshots(snap([s]), snap([{ ...s }])), []);
});
test('sold out and restocked', () => {
  assert.deepEqual(types(diffSnapshots(snap([p('1'), p('2', { soldOut: true })]), snap([p('1', { soldOut: true }), p('2')]))), ['restocked:2', 'sold_out:1']);
});
test('unknown availability does not trigger stock events', () => {
  assert.deepEqual(diffSnapshots(snap([p('1', { soldOut: null })]), snap([p('1', { soldOut: true })])), []);
});
test('normalizeProduct reads cheapest price, sale and stock', () => {
  const n = normalizeProduct({ id: 9, title: 'Tee', handle: 'tee', images: [{ src: 'https://cdn.shopify.com/a.jpg' }], created_at: '2026-01-01',
    variants: [{ price: '30.00', compare_at_price: '40.00', available: false }, { price: '35.00', compare_at_price: null, available: false }] }, base);
  assert.equal(n.price, 30); assert.equal(n.maxPrice, 35); assert.equal(n.compareAt, 40); assert.equal(n.onSale, true);
  assert.equal(n.soldOut, true); assert.equal(n.url, `${base}/products/tee`); assert.equal(n.id, '9');
});
test('compare-at equal to price is not a sale', () => {
  assert.equal(normalizeProduct({ id: 1, handle: 'x', variants: [{ price: '10', compare_at_price: '10', available: true }] }, base).onSale, false);
});
test('snapshotCatalog paginates and stops on a short page', async () => {
  const calls = [];
  const page = n => Array.from({ length: n }, (_, i) => ({ id: `${calls.length}-${i}`, handle: `h${calls.length}-${i}`, variants: [{ price: '1', available: true }] }));
  const requestJson = async url => { calls.push(url); return { data: { products: calls.length === 1 ? page(250) : page(3) } }; };
  const s = await snapshotCatalog(base, { requestJson, pagePause: 0 });
  assert.equal(calls.length, 2); assert.match(calls[1], /limit=250&page=2/);
  assert.equal(s.products.length, 253); assert.equal(s.complete, true);
});
test('snapshotCatalog fails clearly when products.json is blocked', async () => {
  await assert.rejects(snapshotCatalog(base, { requestJson: async () => { throw new Error('HTTP 403'); }, pagePause: 0 }), /products\.json not available/);
});
test('overview math', () => {
  const o = overview([p('1', { price: 10, maxPrice: 20 }), p('2', { price: 30, maxPrice: 30, onSale: true, compareAt: 60 })]);
  assert.deepEqual([o.productCount, o.priceMin, o.priceMax, o.priceAvg, o.onSaleCount], [2, 10, 30, 20, 1]);
});
