// Isolated headless browser against the local app only.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.BASE_URL || 'http://127.0.0.1:4320';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const settle = async () => { await page.addStyleTag({ content: '.tabs{position:static}' }).catch(() => {}); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(800); };
const noOverflow = async name => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: horizontal overflow`);
try {
  const stores = (await (await fetch(`${base}/api/stores`)).json()).stores;
  await page.goto(`${base}/#/`); await page.locator('.store-card').first().waitFor(); await settle();
  await noOverflow('dashboard'); await page.screenshot({ path: 'screenshots/dashboard-mobile.png', fullPage: true });
  for (const s of stores) {
    await page.goto(`${base}/#/store/${s.id}`); await page.locator('.store-head').waitFor(); await settle();
    await noOverflow(s.domain); await page.screenshot({ path: `screenshots/store-${s.domain}-mobile.png`, fullPage: true });
    await page.screenshot({ path: `screenshots/store-${s.domain}-mobile-top.png` });
  }
  await page.goto(`${base}/#/feed`); await page.locator('.events').waitFor(); await settle();
  await noOverflow('feed'); await page.screenshot({ path: 'screenshots/feed-mobile.png', fullPage: true });
  await page.screenshot({ path: 'screenshots/feed-mobile-top.png' });
  await page.goto(`${base}/#/feed?type=price`); await page.locator('.events').waitFor(); await settle();
  await page.screenshot({ path: 'screenshots/feed-prices-mobile.png', fullPage: true });
  await page.goto(`${base}/#/`); await page.locator('#store-url').fill('ikea.com'); await page.locator('#add-button').click();
  await page.locator('.error:not([hidden])').waitFor({ timeout: 60000 });
  await page.screenshot({ path: 'screenshots/add-not-shopify-mobile.png' });
  assert.deepEqual(errors, []);
  console.log('screenshots ok');
} finally { await browser.close(); }
