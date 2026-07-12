# Lacrosse Transfer Portal Tracker

Scrapes NCAA men's and women's lacrosse transfer portal data and publishes it as a JSON file for a WordPress page.

## Sources

- DI Men's Transfer Portal Tracker 2026 — Inside Lacrosse
- DI Women's Transfer Portal Tracker 2026 — Inside Lacrosse
- Women's D1/D2/D3 Transfer Portal Tracker 2026 — Lax Extras

## Files

- `scraper.js` — Playwright scraper that extracts transfer data
- `transfers.json` — Generated output file
- `.github/workflows/scrape.yml` — Daily scheduled scraper
- `wordpress-page.html` — HTML/CSS/JS for the WordPress page
- `inspect.js` — Helper script to inspect source page structure

## Setup

```bash
npm install
npm run scrape
```

## WordPress

Paste the contents of `wordpress-page.html` into your WordPress transfer portal page. Update the `mailto:` link in the intro to your actual contact address.

The page reads data from the raw GitHub URL of `transfers.json`.
