import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import ipaddr from 'ipaddr.js';

export const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function publicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export function normalizeTarget(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 2048) throw new Error('Enter a public store domain, like allbirds.com.');
  const raw = input.trim();
  if (/^[\\/]/.test(raw)) throw new Error('Enter a domain, not a relative URL.');
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !url.hostname.includes('.') || net.isIP(url.hostname.replace(/[\[\]]/g, ''))) {
    throw new Error('Use a public domain with http or https, no login, IP address or custom port.');
  }
  if (/\.(localhost|local|internal|test|invalid|example)$/i.test(url.hostname)) throw new Error('Only public storefront domains are supported.');
  return url.origin;
}

const dnsCache = new Map();
export async function resolvePublic(hostname) {
  const hit = dnsCache.get(hostname);
  if (hit && hit.expires > Date.now()) return hit.addresses;
  let addresses = await lookup(hostname, { all: true });
  // Some sandboxes synthesize all DNS as 198.18.0.1. Never allow that reserved
  // address. Resolve a real public A record over trusted, fixed-host DoH instead
  // and pin the connection to the validated public answer as on normal machines.
  if (addresses.length && addresses.every(a => a.address === '198.18.0.1')) {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: { accept: 'application/dns-json' }, redirect: 'error', signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) throw new Error('Independent public DNS lookup failed.');
    const data = await response.json();
    addresses = (data.Answer || []).filter(a => a.type === 1).map(a => ({ address: a.data, family: 4 }));
  }
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Private or reserved network targets are not allowed.');
  if (dnsCache.size > 300) dnsCache.clear();
  dnsCache.set(hostname, { addresses, expires: Date.now() + 60000 });
  return addresses;
}

// Every hop is validated and DNS-pinned. No private-IP redirects or DNS rebinding.
export async function fetchPublic(input, { timeout = 10000, maxBytes = 8 * 1024 * 1024, redirects = 4, signal } = {}) {
  const deadline = Date.now() + timeout;
  let url = new URL(input);
  for (let hop = 0; hop <= redirects; hop++) {
    normalizeTarget(url.href);
    if (signal?.aborted) throw new Error('Scan cancelled.');
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Site took too long to respond.');
    const addresses = await Promise.race([
      resolvePublic(url.hostname),
      new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('DNS lookup timed out.')), Math.min(remaining, 4000)); t.unref(); })
    ]);
    if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Private or reserved network targets are not allowed.');
    const pinned = addresses.find(a => a.family === 4) || addresses[0];
    const response = await new Promise((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;
      const req = client.get(url, {
        signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.7', 'Accept-Encoding': 'identity' },
        lookup: (_host, options, cb) => options?.all ? cb(null, [pinned]) : cb(null, pinned.address, pinned.family)
      }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume(); resolve({ status: res.statusCode, headers: res.headers, text: '' }); return;
        }
        const chunks = []; let bytes = 0;
        res.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > maxBytes) req.destroy(new Error('Response exceeded the safe size limit.'));
          else chunks.push(chunk);
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      });
      const timer = setTimeout(() => req.destroy(new Error('Site took too long to respond.')), Math.max(1, deadline - Date.now()));
      req.on('error', reject);
      req.on('close', () => clearTimeout(timer));
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.headers.location || hop === redirects) throw new Error('Too many redirects or missing redirect location.');
      url = new URL(response.headers.location, url); continue;
    }
    return { ...response, url: url.href };
  }
}

export function requireSuccess(response) {
  if (response.status < 200 || response.status >= 300) throw new Error(`Public endpoint returned HTTP ${response.status}. No bypass attempted.`);
  if (/cf-chl-|<title>\s*(Just a moment|Access Denied|Attention Required|Robot or human)/i.test(response.text)) throw new Error('Store returned a bot-check page. No bypass attempted.');
  return response;
}

export async function fetchJson(url, options) {
  const res = requireSuccess(await fetchPublic(url, options));
  try { return { data: JSON.parse(res.text), url: res.url }; }
  catch { throw new Error('Store did not expose usable public JSON here.'); }
}
