const { chromium } = require('playwright');
const fs = require('fs');

const SOURCES = [
  {
    url: 'https://www.insidelacrosse.com/article/di-mens-transfer-portal-tracker-2026/dc4b1552-9795-47d7-94ab-53717ee3d850',
    gender: "Men's",
    division: 'D1',
    note: 'DI Men\'s Transfer Portal Tracker 2026',
  },
  {
    url: 'https://www.insidelacrosse.com/article/DI%20Women\'s%20Transfer%20Portal%20Tracker%202026/ad712a8d-e949-4657-8a67-60c02b940bc6',
    gender: "Women's",
    division: 'D1',
    note: 'DI Women\'s Transfer Portal Tracker 2026',
  },
  {
    url: 'https://laxextras.com/2026/05/13/transfer-portal-tracker-2026/',
    gender: "Women's",
    division: 'D1/D2/D3',
    note: 'Lax Extras Women\'s Transfer Portal Tracker 2026',
  },
];

const OUTPUT_FILE = 'transfers.json';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function dismissPopups(page) {
  const selectors = [
    'button:has-text("Accept")',
    'button:has-text("Agree")',
    'button:has-text("Got it!")',
    'button:has-text("Close")',
    'button:has-text("Continue")',
    '[aria-label="Close"]',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
        await el.click();
        await sleep(1000);
      }
    } catch (_) {}
  }
}

function cleanText(text) {
  return text.replace(/\s+/g, ' ').replace(/\n/g, ' ').trim();
}

async function extractFromTables(page) {
  const tables = await page.locator('table').all();
  const results = [];

  for (let i = 0; i < tables.length; i++) {
    try {
      const table = tables[i];
      const rows = await table.locator('tr').all();
      if (rows.length < 2) continue;

      const headers = await rows[0].locator('th, td').allInnerTexts();
      const headerMap = headers.map((h, idx) => ({ text: cleanText(h).toLowerCase(), index: idx }));

      // Skip non-transfer tables
      const headerText = headerMap.map(h => h.text).join(' ');
      if (!/player|name|school|from|to|previous|new|position|class|year/i.test(headerText)) continue;

      for (let r = 1; r < rows.length; r++) {
        const cells = await rows[r].locator('td, th').allInnerTexts();
        const row = {};
        headerMap.forEach(({ text, index }) => {
          row[text] = cleanText(cells[index] || '');
        });

        const raw = cleanText(cells.join(' '));
        results.push({ row, raw, tableIndex: i });
      }
    } catch (_) {}
  }

  return results;
}

async function extractHeadingsAndLists(page) {
  return await page.evaluate(() => {
    const out = [];
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'));
    headings.forEach(h => {
      let el = h.nextElementSibling;
      const sectionItems = [];
      while (el && !/^H[1-4]$/i.test(el.tagName)) {
        if (/^UL|^OL$/i.test(el.tagName)) {
          Array.from(el.querySelectorAll('li')).forEach(li => {
            sectionItems.push(li.innerText.trim().replace(/\s+/g, ' '));
          });
        } else if (/^P$/i.test(el.tagName) && el.innerText.trim().length > 0) {
          sectionItems.push(el.innerText.trim().replace(/\s+/g, ' '));
        }
        el = el.nextElementSibling;
      }
      if (sectionItems.length > 0) {
        out.push({ heading: h.innerText.trim().replace(/\s+/g, ' '), items: sectionItems });
      }
    });
    return out;
  });
}

function parseTransferRow(row, source) {
  const raw = row.raw || '';
  const cells = row.row || {};
  const keys = Object.keys(cells);

  // Try to find fields from headers
  let playerName = '';
  let previousSchool = '';
  let newSchool = '';
  let position = '';
  let playerClass = '';
  let notes = '';

  keys.forEach(k => {
    const v = cells[k];
    if (/player|name/.test(k) && !playerName) playerName = v;
    if (/previous|from|old/.test(k) && !previousSchool) previousSchool = v;
    if (/new|to|destination/.test(k) && !newSchool) newSchool = v;
    if (/position/.test(k) && !position) position = v;
    if (/class|year|eligibility/.test(k) && !playerClass) playerClass = v;
    if (/notes|status/.test(k) && !notes) notes = v;
  });

  // If no headers matched, try regex on raw text
  if (!playerName && raw) {
    // Patterns like "Player Name, Position, Previous School -> New School"
    // or "Player Name (Position) - Previous School to New School"
    playerName = raw.split(/,|(\()|-|\bto\b/i)[0]?.trim() || '';
  }

  if (!playerName) return null;

  return {
    playerName,
    previousSchool,
    newSchool,
    class: playerClass,
    position,
    gender: source.gender,
    division: source.division,
    status: '',
    notes,
    sourceUrl: source.url,
    sourceName: source.note,
  };
}

async function scrapeSource(source, index) {
  console.log(`\n--- Scraping ${source.gender} ${source.division}: ${source.url} ---`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  let results = [];

  try {
    await page.goto(source.url, { waitUntil: 'networkidle', timeout: 90000 });
    await sleep(3000);
    await dismissPopups(page);
    await sleep(2000);

    const slug = `source-${index}`;
    await page.screenshot({ path: `debug-${slug}.png`, fullPage: true });
    fs.writeFileSync(`debug-${slug}.html`, await page.content());
    console.log(`  Saved debug-${slug}.png and debug-${slug}.html`);

    // DOM audit
    const audit = await page.evaluate(() => ({
      title: document.title,
      tables: document.querySelectorAll('table').length,
      headings: Array.from(document.querySelectorAll('h1, h2, h3, h4')).map(h => h.innerText.trim().slice(0, 80)),
      paragraphs: document.querySelectorAll('p').length,
      lists: document.querySelectorAll('ul, ol').length,
    }));
    console.log('  DOM audit:', JSON.stringify(audit, null, 2));

    // Try tables first
    const tableRows = await extractFromTables(page);
    console.log(`  Table rows found: ${tableRows.length}`);

    if (tableRows.length > 0) {
      results = tableRows.map(r => parseTransferRow(r, source)).filter(Boolean);
    } else {
      // Fallback to headings + lists
      const sections = await extractHeadingsAndLists(page);
      console.log(`  Sections found: ${sections.length}`);
      sections.forEach(s => console.log(`    - ${s.heading}: ${s.items.length} items`));

      sections.forEach(section => {
        const status = /incoming|arriv|commit|landed/i.test(section.heading) ? 'incoming'
          : /outgoing|portal|entrant|entered|depart/i.test(section.heading) ? 'outgoing'
          : '';

        section.items.forEach(item => {
          const parsed = parseTransferRow({ raw: item }, source);
          if (parsed) {
            parsed.status = status;
            results.push(parsed);
          }
        });
      });
    }

  } catch (err) {
    console.error('  Scraping error:', err.message);
    await page.screenshot({ path: `debug-error-${index}.png`, fullPage: true });
    fs.writeFileSync(`debug-error-${index}.html`, await page.content());
  }

  await browser.close();
  console.log(`  Parsed results: ${results.length}`);
  return results;
}

async function scrape() {
  const allTransfers = [];

  for (let i = 0; i < SOURCES.length; i++) {
    const transfers = await scrapeSource(SOURCES[i], i);
    allTransfers.push(...transfers);
  }

  // Deduplicate
  const seen = new Set();
  const unique = allTransfers.filter(t => {
    const key = [t.playerName, t.previousSchool, t.newSchool, t.gender, t.division].join('|').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const output = {
    generatedAt: new Date().toISOString(),
    count: unique.length,
    transfers: unique,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nTotal unique transfers saved: ${unique.length}`);
}

scrape().catch(err => {
  console.error('Scraper failed:', err);
  process.exit(1);
});
