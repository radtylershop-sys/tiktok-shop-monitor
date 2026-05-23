/* 
Minimal TikTok Shop monitor script
Requirements: Node 18+, Playwright, googleapis, csv-writer, node-fetch
Env:
  GDRIVE_CREDENTIALS JSON string
  GDRIVE_FOLDER_ID
*/
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { google } = require('googleapis');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fetch = (...args) => import('node-fetch').then(m => m.default(...args));

const PRODUCTS_FILE = path.join(__dirname, '..', 'config', 'products.json');

function nowISO() { return new Date().toISOString(); }

async function loadProducts() {
  if (!fs.existsSync(PRODUCTS_FILE)) throw new Error('Missing config/products.json');
  const raw = fs.readFileSync(PRODUCTS_FILE, 'utf8');
  return JSON.parse(raw);
}

function normalize(s='') { return String(s).replace(/\s+/g,' ').trim().toLowerCase(); }

async function countTikTokVideosForKeyword(browser, keyword, daysWindow=30) {
  const page = await browser.newPage();
  try {
    const q = encodeURIComponent(keyword);
    const url = https://www.tiktok.com/search?q=${q};
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

text

Collapse


 Copy

// broad selectors; TikTok DOM changes often so this is best-effort
const items = await page.$$('[data-e2e="search-video-item"], article, div');
let count = 0;
for (const it of items.slice(0, 200)) {
  try {
    const text = await it.innerText().catch(()=>'');
    const match = text.match(/(\d+)\s*(s|m|h|d|w|month|year)/i);
    if (!match) {
      // fallback: assume recent if text contains the keyword
      if (text.toLowerCase().includes(keyword.toLowerCase())) count++;
    } else {
      const val = parseInt(match[1],10);
      const unit = match[2].toLowerCase();
      let daysAgo = 0;
      if (unit.startsWith('s') || unit.startsWith('m')) daysAgo = 0;
      else if (unit.startsWith('h')) daysAgo = 0;
      else if (unit.startsWith('d')) daysAgo = val;
      else if (unit.startsWith('w')) daysAgo = val * 7;
      else if (unit.includes('month')) daysAgo = val * 30;
      else daysAgo = 365;
      if (daysAgo <= daysWindow) count++;
    }
  } catch(e){ continue; }
}
await page.close();
return count;
  } catch(err){
    try{ await page.close(); }catch(e){}
    return 0;
  }
}

async function scrapeProductPage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  const result = { title: '', price: '', stock: '', sold: '', sku: '' };

  // JSON-LD extraction
  const jsonld = await page.$$eval('script[type="application/ld+json"]', nodes => nodes.map(n => n.innerText));
  for (const txt of jsonld) {
    try {
      const j = JSON.parse(txt);
      if (j && j.name && !result.title) result.title = j.name;
      if (j && j.offers && j.offers.price && !result.price) result.price = j.offers.price;
      if (j && j.sku && !result.sku) result.sku = j.sku;
    } catch(e){}
  }

  try {
    const t1 = await page.$('h1') || await page.$('[data-e2e="product-title"]');
    if (t1) {
      const txt = await t1.innerText().catch(()=>'');
      if (txt && !result.title) result.title = txt.trim();
    }
  } catch(e){}

  try {
    const psel = await page.$('[data-e2e="product-price"]') || await page.$('div.price') || await page.$('span.price');
    if (psel) {
      const ptxt = await psel.innerText().catch(()=>'');
      if (ptxt) result.price = ptxt.trim();
    }
  } catch(e){}

  try {
    const soldSel = await page.$('div.sold-count, span.sold-count, .sold');
    if (soldSel) {
      const st = await soldSel.innerText().catch(()=>'');
      if (st) result.sold = st.trim();
    }
    const stockSel = await page.$('div.stock, span.stock, [data-e2e="stock"]');
    if (stockSel) {
      const st2 = await stockSel.innerText().catch(()=>'');
      if (st2) result.stock = st2.trim();
    }
  } catch(e){}

  return result;
}

async function uploadToDrive(buffer, filename, driveFolderId, credentialsJson) {
  const creds = JSON.parse(credentialsJson);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive.file','https://www.googleapis.com/auth/drive']
  });
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [driveFolderId]
    },
    media: {
      mimeType: 'text/csv',
      body: buffer
    }
  });
  return res.data;
}

(async () => {
  console.log('Monitor run start', nowISO());
  const products = await loadProducts();
  const browser = await chromium.launch({ headless: true });
  const csvRows = [];
  try {
    for (const p of products) {
      console.log('Processing', p.id || p.title);
      const page = await browser.newPage();
      let meta = {};
      try {
        meta = await scrapeProductPage(page, p.url);
      } catch (e) {
        console.error('Error scraping product page', e.message);
      } finally {
        await page.close();
      }

text

Collapse


 Copy

  const keywords = (p.keywords && p.keywords.length) ? p.keywords.slice(0,5) : [p.title];
  let videos7 = 0, videos30 = 0;
  for (const kw of keywords) {
    try {
      const c7 = await countTikTokVideosForKeyword(browser, kw, 7);
      const c30 = await countTikTokVideosForKeyword(browser, kw, 30);
      videos7 += c7;
      videos30 += c30;
    } catch(err){
      console.error('TikTok search error for', kw, err.message);
    }
  }
  videos7 = Math.min(videos7, 9999);
  videos30 = Math.min(videos30, 9999);

  const row = {
    id: p.id || '',
    brand: p.brand || '',
    title: meta.title || p.title || '',
    url: p.url,
    price: meta.price || '',
    stock: meta.stock || '',
    sold_counter: meta.sold || '',
    videos_7d: videos7,
    videos_30d: videos30,
    last_checked: nowISO()
  };
  csvRows.push(row);
  console.log('Row:', row.id, 'v7=', row.videos_7d, 'v30=', row.videos_30d);
}
  } catch(err){
    console.error('Fatal error', err);
  } finally {
    await browser.close();
  }

  const outName = monitor-${(new Date()).toISOString().slice(0,10)}.csv;
  const csvPath = path.join(__dirname, '..', outName);
  const csvWriter = createCsvWriter({
    path: csvPath,
    header: [
      {id:'id', title:'id'},
      {id:'brand', title:'brand'},
      {id:'title', title:'title'},
      {id:'url', title:'url'},
      {id:'price', title:'price'},
      {id:'stock', title:'stock'},
      {id:'sold_counter', title:'sold_counter'},
      {id:'videos_7d', title:'videos_7d'},
      {id:'videos_30d', title:'videos_30d'},
      {id:'last_checked', title:'last_checked'}
    ]
  });
  await csvWriter.writeRecords(csvRows);
  console.log('CSV written', csvPath);

  const GDRIVE_CREDENTIALS = process.env.GDRIVE_CREDENTIALS;
  const GDRIVE_FOLDER_ID = process.env.GDRIVE_FOLDER_ID;
  if (!GDRIVE_CREDENTIALS || !GDRIVE_FOLDER_ID) {
    console.warn('GDRIVE_CREDENTIALS or GDRIVE_FOLDER_ID not set — skipping upload');
    process.exit(0);
  }

  const fileStream = fs.createReadStream(csvPath);
  try {
    await uploadToDrive(fileStream, outName, GDRIVE_FOLDER_ID, GDRIVE_CREDENTIALS);
    console.log('Uploaded CSV to Drive:', outName);
  } catch(err){
    console.error('Drive upload failed', err);
  }

  console.log('Monitor run complete', nowISO());
  process.exit(0);
})();
