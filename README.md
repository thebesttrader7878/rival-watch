# Rival Watch (competitor tracker preview)

Watch competitor Shopify stores: new drops, price moves, sales, sellouts and restocks. Free public data only (`/products.json` + homepage HTML). No traffic or revenue numbers.

## Run locally
```
npm install
npm start            # http://127.0.0.1:4320
npm test             # diff + snapshot tests
```
Add a store on the home screen, then "Refresh now" on a store (or "Refresh all"). While the server runs it re-checks any store older than 24h (hourly tick). `DISABLE_SCHEDULE=1` turns that off.

Demo changes: `node scripts/demo-change.js allbirds.com`, then hit Refresh now on that store. Everything it causes is tagged "Demo".

## Config (for a later Render deploy)
- `PORT` (default 4320), `HOST` (default 127.0.0.1, use 0.0.0.0 on Render)
- `PUBLIC_HOSTS` comma list of allowed hostnames, e.g. `my-app.onrender.com`
- `DATA_DIR` where db.json + snapshots live (default ./data). Use a persistent disk, Render free web services wipe the filesystem on restart.

## Notes
- Crawl is polite: 250 per page, 0.8s between pages, up to 2,500 products per store, stores checked one at a time.
- On a capped crawl, removals aren't reported and "new" requires a publish date after the last check.
- Ads link opens Meta Ad Library search for the brand. Facebook isn't scraped.
