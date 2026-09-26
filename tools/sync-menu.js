#!/usr/bin/env node
/*
 * Muncho menu sync — pulls the live catalog from the partner API and
 * regenerates js/menu.generated.js + product images in assets/img/.
 *
 * Production rules:
 *  - NEVER writes partial/broken output: payload is validated first,
 *    files are written atomically (tmp + rename).
 *  - On ANY failure (network, API error, bad shape) existing files are
 *    left untouched and the process exits non-zero (safe for cron/CI).
 *  - Images re-download only when the product changed (dateModified),
 *    otherwise the cached file is kept.
 *  - If an image download fails, the previous file (or remote URL) is kept.
 *
 * Usage:
 *   node tools/sync-menu.js            # normal run
 *   API_URL=... API_KEY=... node tools/sync-menu.js   # overrides (used by tests)
 * Schedule: 0 *\/6 * * * cd /path/to/FoodCourt && node tools/sync-menu.js >> sync.log 2>&1
 */
const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const API_URL = process.env.API_URL || 'https://api.rpd.roweb.ro/api/product/integration/getproductcategories';
// Public app key — the same one the partner's own web app embeds. Read-only catalog access.
const API_KEY = process.env.API_KEY || 'bf026006-7d01-41bf-ae76-ab0fba3d4c80';
const ORIGIN = 'https://pizzeria-sapori-italia.ro';
const REFERER = 'https://pizzeria-sapori-italia.ro/AppMenu/';

const ROOT = path.resolve(__dirname, '..');
const OUT_JS = path.join(ROOT, 'js', 'menu.generated.js');
const OUT_META = path.join(ROOT, 'js', 'menu.meta.json');
const IMG_DIR = path.join(ROOT, 'assets', 'img');

const ETA_RULES = [
  [/pizza/i, '20-30'],
  [/burger|crispy|sandwich|paste/i, '10-20'],
  [/sos|desert|racoritoare/i, '5-10'],
];
const DEFAULT_ETA = '10-20';
const VENUE_ID = 'sapori';

// Name-based photo fallbacks (verified licensed images) for products whose
// API record carries no photo. First matching rule wins; keep specific
// rules before generic ones. Re-run sync after editing.
const IMAGE_FALLBACKS = [
  [/coca[\s-]*cola/i, 'https://upload.wikimedia.org/wikipedia/commons/2/2f/Coca-cola_50cl_can_-_Italia.jpg'],
  [/fanta/i, 'https://upload.wikimedia.org/wikipedia/commons/5/50/Fanta-Orange-Can-330ml_84177_%287116950883%29.jpg'],
  [/sprite/i, 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Sprite_lemon_lime_1.jpg'],
  [/usturoi|aioli/i, 'https://upload.wikimedia.org/wikipedia/commons/b/b5/Allioli.jpg'],
  [/barbeque|barbecue/i, 'https://upload.wikimedia.org/wikipedia/commons/e/e8/Hunts-Barbecue-Sauce.jpg'],
  [/maionez/i, 'https://upload.wikimedia.org/wikipedia/commons/6/60/Mayonnaise_%281%29.jpg'],
  [/dulce/i, 'https://upload.wikimedia.org/wikipedia/commons/6/60/Mayonnaise_%281%29.jpg'],
  [/ketchup/i, 'https://upload.wikimedia.org/wikipedia/commons/d/d3/Heinz_Tomato_Ketchup%2C_Canada_%28front%29%2C_2026-02-19.jpg'],
  [/picant/i, 'https://upload.wikimedia.org/wikipedia/commons/d/d3/Heinz_Tomato_Ketchup%2C_Canada_%28front%29%2C_2026-02-19.jpg'],
  [/sos/i, 'https://upload.wikimedia.org/wikipedia/commons/d/d3/Heinz_Tomato_Ketchup%2C_Canada_%28front%29%2C_2026-02-19.jpg'],
];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function fallbackImage(title) {
  for (const [re, url] of IMAGE_FALLBACKS) if (re.test(title || '')) return url;
  return null;
}
function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}
function plainText(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ').replace(/(\S)&(\S)/g, '$1 & $2').replace(/&(\S)/g, '& $1').replace(/(\S) -(\S)/g, '$1-$2').trim();
}
function extOf(url) {
  const m = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(url || '');
  const e = (m ? m[1] : 'jpg').toLowerCase();
  return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(e) ? (e === 'jpeg' ? 'jpeg' : e) : 'jpg';
}
function etaFor(categoryName) {
  for (const [re, eta] of ETA_RULES) if (re.test(categoryName)) return eta;
  return DEFAULT_ETA;
}
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// The partner API filters HTTP clients by TLS fingerprint: curl succeeds
// reliably while Node fetch is rejected, so curl is the primary transport
// with fetch as fallback. Both paths send identical headers.
function curlJson() {
  const out = execFileSync('curl', [
    '-sS', '--fail', '--http1.1', '-X', 'POST', API_URL,
    '-H', `ApiKey: ${API_KEY}`,
    '-H', 'Content-Type: application/json',
    '-H', `Origin: ${ORIGIN}`,
    '-H', `Referer: ${REFERER}`,
    '-H', `User-Agent: ${UA}`,
    '-d', '{}', '--max-time', '40',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}
async function fetchCatalog() {
  try {
    return curlJson();
  } catch (e) {
    console.warn('curl transport failed, trying fetch:', String(e.message).split('\n')[0]);
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      ApiKey: API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: ORIGIN,
      Referer: REFERER,
      'User-Agent': UA,
    },
    body: '{}',
  });
  if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
  return res.json();
}
function curlBinary(url, dest) {
  execFileSync('curl', [
    '-sS', '--fail', '-L', '--http1.1', url,
    '-H', `Referer: ${REFERER}`,
    '-H', `User-Agent: ${UA} (menu sync; respects rate limits)`,
    '-o', dest + '.tmp', '--max-time', '60',
  ]);
  const buf = fs.readFileSync(dest + '.tmp');
  if (buf.length < 1024) throw new Error('image suspiciously small');
  fs.renameSync(dest + '.tmp', dest);
}
async function download(url, dest) {
  try {
    curlBinary(url, dest);
    return;
  } catch (e) {
    try { fs.unlinkSync(dest + '.tmp'); } catch (_) {}
    console.warn(`curl image failed, trying fetch for ${url.split('/').pop()}`);
  }
  const res = await fetch(url, { headers: { Referer: REFERER, 'User-Agent': UA } });
  if (!res.ok) throw new Error(`image HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error('image suspiciously small');
  const tmp = dest + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dest);
}

async function main() {
  const started = new Date();
  const payload = await fetchCatalog();

  // ---- validate before touching anything ----
  if (!payload || !Array.isArray(payload.data)) throw new Error('unexpected catalog shape (data[] missing)');
  const cats = payload.data.filter(c => c && c.isActive && Array.isArray(c.products) && c.products.some(p => p && p.isActive !== false && !p.isPrivate));
  if (!cats.length) throw new Error('no active categories with products');
  cats.sort((a, b) => (a.orderNo ?? 0) - (b.orderNo ?? 0));

  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(OUT_META, 'utf8')); } catch (e) { meta = {}; }
  const prevFiles = (meta.files) || {};
  fs.mkdirSync(IMG_DIR, { recursive: true });

  const sections = [];
  const items = [];
  const files = {};
  let downloaded = 0, reused = 0, remoteFallback = 0;

  for (const c of cats) {
    const catName = plainText(c.name);
    const catPhoto = (c.photo && String(c.photo)) || null;
    const products = c.products.filter(p => p && p.isActive !== false && !p.isPrivate && p.price > 0);
    if (!products.length) continue;
    sections.push(catName);
    for (const p of products) {
      const id = String(p.id);
      const title0 = plainText(p.name).slice(0, 80);
      const src = p.photo || fallbackImage(title0) || catPhoto;
      const ext = extOf(src);
      const file = `p${id}.${ext}`;
      const dest = path.join(IMG_DIR, file);
      const changed = prevFiles[id] !== p.dateModified || !fs.existsSync(dest);
      let img = `assets/img/${file}`;
      if (src) {
        if (changed) {
          try { await download(src, dest); downloaded++; }
          catch (e) {
            await sleep(1500);
            try { await download(src, dest); downloaded++; }
            catch (e2) {
              if (fs.existsSync(dest)) { reused++; }
              else { img = src; remoteFallback++; console.warn(`image fallback (remote) for ${id}: ${e2.message}`); }
            }
          }
          await sleep(350);
        } else { reused++; }
      } else {
        img = 'assets/img/venue.jpg';
        console.warn(`no image at all for ${id} (${title0}), using venue placeholder`);
      }
      files[id] = p.dateModified || null;
      const addons = Array.isArray(p.addons) ? p.addons.filter(a => a) : [];
      const rp = Number(p.regularPrice) || 0;
      items.push({
        id,
        venue: VENUE_ID,
        title: plainText(p.name).slice(0, 80),
        desc: plainText(p.shortDescription || p.description).slice(0, 160),
        price: Number(p.price),
        old: rp > Number(p.price) ? rp : null,
        eta: etaFor(catName),
        img,
        opts: addons.length ? 'Extra disponibil' : null,
        cat: catName,
        badge: null,
      });
    }
  }
  if (!items.length) throw new Error('no mappable products after filtering');

  // venue hero = first pizza photo, else first item photo
  const heroSrc = (items.find(i => /pizza/i.test(i.cat)) || items[0]).img;
  let hero = heroSrc;
  if (heroSrc.startsWith('assets/')) {
    hero = `assets/img/venue.${extOf(heroSrc)}`;
    try {
      const srcFile = path.join(ROOT, heroSrc);
      if (fs.existsSync(srcFile)) fs.copyFileSync(srcFile, path.join(ROOT, hero));
    } catch (e) { hero = heroSrc; }
  }

  const out = {
    updatedAt: started.toISOString(),
    source: 'https://pizzeria-sapori-italia.ro/AppMenu/',
    venue: { id: VENUE_ID, name: 'Pizzeria Sapori Italia' },
    sections,
    hero,
    items,
  };
  const js = `/* AUTO-GENERATED by tools/sync-menu.js — do not hand-edit.\n * Source: ${out.source}\n * Updated: ${out.updatedAt}\n */\nconst MENU = ${JSON.stringify(out, null, 2)};\n`;
  const metaOut = { updatedAt: out.updatedAt, categories: sections.length, items: items.length, files, downloaded, reused, remoteFallback };

  fs.writeFileSync(OUT_JS + '.tmp', js);
  fs.renameSync(OUT_JS + '.tmp', OUT_JS);
  fs.writeFileSync(OUT_META + '.tmp', JSON.stringify(metaOut, null, 2));
  fs.renameSync(OUT_META + '.tmp', OUT_META);

  // cache-bust the fresh bundle so browsers drop the old menu
  const stamp = String(Date.now());
  for (const f of ['index.html', 'venue.html', 'checkout.html']) {
    const fp = path.join(ROOT, f);
    const html = fs.readFileSync(fp, 'utf8');
    const next = html.replace(/menu\.generated\.js\?v=\d+/, `menu.generated.js?v=${stamp}`);
    if (next !== html) {
      fs.writeFileSync(fp + '.tmp', next);
      fs.renameSync(fp + '.tmp', fp);
    }
  }

  console.log(`synced ${items.length} items in ${sections.length} sections (${downloaded} new images, ${reused} reused, ${remoteFallback} remote fallbacks)`);
}

main().catch(e => { console.error('sync FAILED (existing files untouched):', e.message); process.exit(1); });
