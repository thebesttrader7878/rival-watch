import * as cheerio from 'cheerio';

const apps = [
  ['Klaviyo', 'Email / SMS', /klaviyo\.com|klaviyo\.js|_learnq/i],
  ['Judge.me', 'Reviews', /judge\.me|judgeme/i],
  ['Yotpo', 'Reviews', /yotpo\.com|yotpo-widget/i],
  ['Loox', 'Reviews', /loox\.io|loox-rating/i],
  ['Okendo', 'Reviews', /okendo\.io|okendo-reviews/i],
  ['Stamped', 'Reviews', /stamped\.io|stamped-main-widget/i],
  ['ReCharge', 'Subscriptions', /rechargepayments\.com|rechargecdn\.com|recharge-subscriptions/i],
  ['Gorgias', 'Customer support', /gorgias\.chat|gorgias\.io|gorgias-chat/i],
  ['Attentive', 'SMS', /attentivemobile\.com|attn\.tv/i],
  ['Postscript', 'SMS', /postscript\.io|postscript-api\.com/i],
  ['Afterpay', 'Payments', /afterpay\.com|afterpay\.js|afterpay-placement/i],
  ['Klarna', 'Payments', /klarna\.com|klarna-placement/i],
  ['Rebuy', 'Personalization', /rebuyengine\.com|rebuy-widget/i],
  ['Smile.io', 'Loyalty', /smile\.io|smile-ui/i],
  ['Shop Pay', 'Payments', /shop\.app\/pay|shopify-accelerated-checkout|shop-pay-button/i],
  ['Zendesk', 'Customer support', /static\.zdassets\.com|zendesk\.com/i],
  ['Privy', 'Email capture', /privy\.com|privy-widget/i],
  ['Trustpilot', 'Reviews', /widget\.trustpilot\.com|trustbox/i]
];
const pixels = [
  ['Meta Pixel', /connect\.facebook\.net|facebook\.com\/tr[/?]|\bfbq\s*\(/i],
  ['TikTok Pixel', /analytics\.tiktok\.com|\bttq\s*\.\s*(load|page|track)\s*\(/i],
  ['Google Analytics / GA4', /google-analytics\.com|googletagmanager\.com\/gtag\/js\?id=(?:G-|UA-)|["']G-[A-Z0-9]{6,}["']|["']UA-\d+-\d+["']/],
  ['Google Tag Manager', /googletagmanager\.com\/gtm\.js|\bGTM-[A-Z0-9]+\b/i],
  ['Google Ads', /googleadservices\.com|googleads\.g\.doubleclick\.net|\bAW-\d+\b/i],
  ['Pinterest Tag', /s\.pinimg\.com\/ct|\bpintrk\s*\(/i],
  ['Snap Pixel', /sc-static\.net\/scevent|\bsnaptr\s*\(/i],
  ['Microsoft Clarity', /clarity\.ms\/tag/i]
];
export const PIXEL_NAMES = pixels.map(p => p[0]);

export function jsonLd($) {
  const nodes = [];
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    nodes.push(value);
    for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child);
  }
  $('script[type="application/ld+json"]').each((_, el) => { try { walk(JSON.parse($(el).text())); } catch {} });
  return nodes;
}

export function detect(html, headers, base) {
  const $ = cheerio.load(html);
  const evidence = [];
  const add = (name, regex, header = false) => {
    const text = header ? `${html}\n${JSON.stringify(headers)}` : html;
    const match = text.match(regex);
    if (match) evidence.push({ name, evidence: match[0].slice(0, 130), source: header ? 'HTML / response headers' : 'Public homepage HTML' });
  };
  add('Shopify', /cdn\.shopify\.com|Shopify\.shop\s*=|x-shopify|\/cdn\/shop\//i, true);
  add('WooCommerce', /wp-content\/plugins\/woocommerce|woocommerce-no-js|wc-add-to-cart|woocommerce\.min\.js/i);
  add('BigCommerce', /cdn\d*\.bigcommerce\.com|stencil-utils|BCData\s*=/i);
  add('Wix', /static\.wixstatic\.com|wix-thunderbolt|X-Wix-/i, true);
  add('Squarespace', /static\d*\.squarespace\.com|squarespace-cdn\.com|squarespace-context/i);
  add('WordPress', /wp-content\/|wp-includes\//i);
  const platform = evidence.find(e => e.name !== 'WordPress')?.name || evidence[0]?.name || 'Not identified';
  const themeBlock = html.match(/(?:window\.)?Shopify\.theme\s*=\s*({[^;]{0,6000}})/);
  let theme = null;
  if (themeBlock) {
    try { const obj = JSON.parse(themeBlock[1]); theme = { name: obj.name, id: obj.id, schemaName: obj.schema_name, schemaVersion: obj.schema_version }; }
    catch { const name = themeBlock[1].match(/["']?name["']?\s*:\s*["']([^"']+)/); if (name) theme = { name: name[1] }; }
  }
  const detectedApps = apps.flatMap(([name, category, pattern]) => { const m = html.match(pattern); return m ? [{ name, category, evidence: m[0], source: 'Public homepage HTML' }] : []; });
  const detectedPixels = pixels.map(([name, pattern]) => { const m = html.match(pattern); return { name, detected: !!m, evidence: m?.[0] || null }; });
  const socialMap = new Map();
  const socialHosts = [['Instagram', /(^|\.)instagram\.com$/], ['TikTok', /(^|\.)tiktok\.com$/], ['Facebook', /(^|\.)facebook\.com$/], ['YouTube', /(^|\.)(youtube\.com|youtu\.be)$/], ['X', /(^|\.)(twitter\.com|x\.com)$/]];
  $('a[href]').each((_, el) => {
    try {
      const url = new URL($(el).attr('href'), base);
      if (!['http:', 'https:'].includes(url.protocol) || !url.pathname.replace(/\//g, '') || /\/(share|sharer|intent|dialog|watch|reel|p|status|hashtag|search)(\/|\.php|$)/i.test(url.pathname)) return;
      const entry = socialHosts.find(([, pattern]) => pattern.test(url.hostname));
      if (entry && !socialMap.has(entry[0])) socialMap.set(entry[0], { platform: entry[0], url: `${url.origin}${url.pathname}`, followers: null, note: 'Link only. Follower counts not available in the fetched public page.' });
    } catch {}
  });
  const ld = jsonLd($);
  const productNodes = ld.filter(n => [n['@type']].flat().includes('Product'));
  const reviews = productNodes.filter(n => n.aggregateRating).map(n => ({ name: n.name || '', url: n.url || '', count: n.aggregateRating.reviewCount ?? n.aggregateRating.ratingCount, rating: n.aggregateRating.ratingValue || null })).filter(n => n.count != null && String(n.count).trim() !== '' && Number.isFinite(Number(n.count)) && Number(n.count) >= 0).map(n => ({ ...n, count: Number(n.count) }));
  const brand = $('meta[property="og:site_name"]').attr('content') || ld.find(n => [n['@type']].flat().some(t => ['Organization', 'Store', 'Restaurant'].includes(t)))?.name || $('title').text().split(/\s[|–-]\s/)[0] || new URL(base).hostname;
  const currencies = new Set();
  for (const n of ld) if (/^[A-Z]{3}$/.test(n.priceCurrency)) currencies.add(n.priceCurrency);
  const metaCurrency = $('meta[property="og:price:currency"],meta[property="product:price:currency"]').first().attr('content');
  const shopCurrency = html.match(/Shopify\.currency\s*=\s*\{[^}]*["']active["']\s*:\s*["']([A-Z]{3})["']/)?.[1];
  const currency = shopCurrency || metaCurrency || (currencies.size === 1 ? [...currencies][0] : null);
  return {
    status: 'ok', platform, platformEvidence: evidence, theme, apps: detectedApps, pixels: detectedPixels,
    social: [...socialMap.values()], reviews,
    currency: /^[A-Z]{3}$/.test(currency || '') ? currency : null,
    brand: String(brand).trim().slice(0, 160),
    title: $('title').text().trim().slice(0, 200),
    note: 'Homepage signatures only. Detected means referenced, not confirmed active. Consent, tag managers, custom pixels and dynamic loading can hide tools. Not observed does not mean absent.'
  };
}
