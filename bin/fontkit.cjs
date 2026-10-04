#!/usr/bin/env node
// fontkit - find free Korean/Latin fonts, pull their webfont CSS, and render samples.
//
//   fontkit search <name>                 search the bundled font list (web-researched)
//   fontkit locate <name>                 check Google Fonts, noonnu and Sandoll Cloud for the font
//   fontkit css <name> [--from google|noonnu]   print the webfont @font-face / @import CSS
//   fontkit sample <name> [--text T] [--out a.png]        render one font to PNG
//   fontkit contact <name,name,...> [--text T] [--out a.png]  render several fonts in one sheet
//
// Every network lookup is for ONE font at a time, with a pause between requests.
// Nothing fetched from a site is written to disk except the PNG you ask for.
'use strict';
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const UA = 'Mozilla/5.0 (compatible; fontkit/0.1; +https://github.com/)';
const PAUSE_MS = 2000;
const TIMEOUT_MS = 40000;

// ---------- small helpers ----------
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      a[k] = v;
    } else a._.push(t);
  }
  return a;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-_·.]/g, '');
const unescapeHtml = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fail(msg) { console.error('ERROR: ' + msg); process.exitCode = 2; }

let lastRequest = 0;
async function get(url) {
  const wait = lastRequest + PAUSE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal, redirect: 'follow' });
    return { status: r.status, url: r.url, text: await r.text() };
  } finally { clearTimeout(t); }
}

function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); }
const fontList = () => loadJson('fonts.json').fonts;
function findInList(name) {
  const q = norm(name);
  const list = fontList();
  return list.find((f) => norm(f.name) === q) || list.find((f) => norm(f.name).includes(q) || q.includes(norm(f.name)));
}
function verdict(name) {
  const v = loadJson('webfont-verdicts.json');
  const q = norm(name);
  for (const k of ['no', 'conditional']) {
    for (const [n, info] of Object.entries(v[k])) {
      if (norm(n) === q || (info.name_en && norm(info.name_en) === q)) return { verdict: k, font: n, maker: info.maker };
    }
  }
  return null;
}
function familyFromCss(css) { const m = /font-family:\s*['"]?([^;'"]+)['"]?/i.exec(css || ''); return m ? m[1].trim() : null; }

// ---------- sources ----------
// Google Fonts: the official CSS API answers 200 with @font-face for a real family, 400 otherwise.
async function googleCss(family) {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`;
  const r = await get(url);
  if (r.status !== 200 || !/@font-face/.test(r.text)) return null;
  return { source: 'google', page: `https://fonts.google.com/specimen/${family.replace(/ /g, '+')}`, family, css: `@import url('${url}');` };
}

// noonnu: search page /search/<name> lists /font_page/<id> links; the font page holds the
// copy-ready CSS in an element named "webfontSource".
async function noonnuFind(name) {
  const r = await get(`https://noonnu.cc/search/${encodeURIComponent(name)}`);
  if (r.status !== 200) return null;
  const hits = [...r.text.matchAll(/href="\/font_page\/(\d+)"[\s\S]{0,600}?alt="([^"]+)"/g)].map((m) => ({ id: m[1], name: unescapeHtml(m[2]) }));
  if (!hits.length) return null;
  const q = norm(name);
  return hits.find((h) => norm(h.name) === q) || hits.find((h) => norm(h.name).includes(q)) || hits[0];
}
async function noonnuCss(name) {
  const hit = await noonnuFind(name);
  if (!hit) return null;
  const page = `https://noonnu.cc/font_page/${hit.id}`;
  const r = await get(page);
  if (r.status !== 200) return null;
  // the CSS box is a <textarea> on some pages and a <pre> on others
  const m = /<(textarea|pre)[^>]*name="webfontSource"[^>]*>([\s\S]*?)<\/\1>/.exec(r.text);
  const dl = /<a href="([^"]+)"[^>]*>\s*<span>다운로드 페이지로 이동<\/span>/.exec(r.text);
  const css = m ? unescapeHtml(m[2].replace(/<[^>]+>/g, '')).trim() : null;
  return { source: 'noonnu', page, name: hit.name, family: familyFromCss(css), css, download: dl ? dl[1] : null };
}

// Sandoll Cloud: free-font pages (/free-font/<id>/<any-slug>) carry no webfont CSS; the font is
// downloaded or installed through Sandoll. The page gives the title and the license text.
async function sandollInfo(id) {
  const page = `https://www.sandollcloud.com/free-font/${id}/font`;
  const r = await get(page);
  if (r.status !== 200) return null;
  const title = (/<title>([^<]+)<\/title>/.exec(r.text) || [])[1];
  const lic = /라이선스 원문<\/h4>\s*<div[^>]*>([\s\S]*?)<\/div>/.exec(r.text);
  const license = lic ? unescapeHtml(lic[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')).replace(/\s+/g, ' ').trim() : null;
  return { source: 'sandoll', page, title: title ? title.replace(/\s*\|.*$/, '').trim() : null, css: null, license };
}

// ---------- commands ----------
function cmdSearch(a) {
  const q = norm(a._.slice(1).join(' '));
  if (!q) return fail('search needs a name');
  const rows = fontList().filter((f) => norm(f.name).includes(q) || norm(f.maker).includes(q));
  if (a.json) return console.log(JSON.stringify(rows, null, 2));
  if (!rows.length) return console.log('no match in the bundled list - try: fontkit locate <name>');
  for (const f of rows) console.log(`${f.name} | ${f.maker} | ${f.license} | ${f.official_url}`);
}

async function locateAll(name) {
  const entry = findInList(name);
  const out = { name, in_list: entry || null, google: null, noonnu: null, sandoll: null, verdict: verdict(name) };
  const gfam = (entry && entry.google_family) || name;
  if (/^[\x00-\x7F]+$/.test(gfam)) out.google = await googleCss(gfam);
  out.noonnu = await noonnuCss(name);
  if (entry && entry.sandoll_id) out.sandoll = await sandollInfo(entry.sandoll_id);
  return out;
}

async function cmdLocate(a) {
  const name = a._.slice(1).join(' ');
  if (!name) return fail('locate needs a name');
  const r = await locateAll(name);
  if (a.json) return console.log(JSON.stringify(r, null, 2));
  console.log(`# ${name}`);
  console.log(`list    : ${r.in_list ? `${r.in_list.maker} | ${r.in_list.license} | ${r.in_list.official_url}` : '-'}`);
  console.log(`google  : ${r.google ? r.google.page : '-'}`);
  console.log(`noonnu  : ${r.noonnu ? `${r.noonnu.page} (${r.noonnu.name}${r.noonnu.css ? ', css' : ', no css'})` : '-'}`);
  console.log(`sandoll : ${r.sandoll ? `${r.sandoll.page} (${r.sandoll.title}; download only)` : (r.in_list && r.in_list.sandoll_id ? 'page not reachable' : '-')}`);
  if (r.verdict) console.log(`webfont : ${r.verdict.verdict === 'no' ? 'NOT ALLOWED as a webfont' : 'conditional - check the maker terms'} (our audit)`);
}

async function resolveCss(name, from) {
  const v = verdict(name);
  const entry = findInList(name);
  if (entry && entry.webfont_css_url && !from) {
    return { source: 'official', page: entry.official_url, family: null, css: `@import url('${entry.webfont_css_url}');`, verdict: v };
  }
  const gfam = (entry && entry.google_family) || name;
  if (from !== 'noonnu' && /^[\x00-\x7F]+$/.test(gfam)) {
    const g = await googleCss(gfam);
    if (g) return { ...g, verdict: v };
    if (from === 'google') return null;
  }
  const n = await noonnuCss(name);
  if (n && n.css) return { ...n, verdict: v };
  if (entry && entry.sandoll_id) return { ...(await sandollInfo(entry.sandoll_id)), verdict: v };
  return n ? { ...n, verdict: v } : null;
}

async function cmdCss(a) {
  const name = a._.slice(1).join(' ');
  if (!name) return fail('css needs a name');
  const r = await resolveCss(name, a.from);
  if (!r) return fail(`'${name}' not found on Google Fonts or noonnu`);
  if (r.verdict && r.verdict.verdict === 'no' && !a.force) {
    return fail(`'${name}': our audit says this font may NOT be served as a webfont (maker: ${r.verdict.maker}). Use it as an installed font instead, or pass --force if you have the maker's permission.`);
  }
  if (a.json) return console.log(JSON.stringify(r, null, 2));
  if (!r.css) {
    console.log(`/* ${name}: no webfont CSS at ${r.source}. Download from ${r.download || r.page} and self-host only if its license allows. */`);
    if (r.license) console.log(`/* license: ${r.license} */`);
    return;
  }
  if (r.verdict && r.verdict.verdict === 'conditional') console.log(`/* WARNING: conditional webfont license - check the maker's terms (${r.verdict.maker}) */`);
  console.log(`/* source: ${r.source} ${r.page} */`);
  console.log(r.css);
}

// ---------- rendering ----------
function loadPlaywright() {
  for (const t of ['playwright', 'playwright-core']) { try { return require(t); } catch (_) {} }
  try {
    const g = require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require(path.join(g, 'playwright'));
  } catch (_) {}
  console.error('ERROR: playwright not found. Install: npm i -g playwright && npx playwright install chromium');
  process.exit(3);
}
async function render(fonts, text, size, out) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    // @import must come before every other rule, or the browser ignores it
    const all = fonts.map((f) => f.css).join('\n');
    const css = (all.match(/@import[^;]+;/g) || []).join('\n') + '\n' + all.replace(/@import[^;]+;/g, '');
    const rows = fonts.map((f) =>
      `<div class="row"><div class="lbl">${escapeHtml(f.name)} &middot; ${escapeHtml(f.family)} &middot; ${escapeHtml(f.source)}</div>` +
      `<div class="smp" style="font-family:'${f.family}',sans-serif">${escapeHtml(text)}</div></div>`).join('');
    await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}
      body{margin:0;background:#fff;color:#111;width:1100px;font-family:system-ui,sans-serif}
      .row{padding:18px 32px;border-bottom:1px solid #eee}
      .lbl{font-size:12px;color:#888;margin-bottom:6px}
      .smp{font-size:${size}px;line-height:1.3;word-break:keep-all}</style></head><body>${rows}</body></html>`, { waitUntil: 'networkidle' });
    // ask for each face with the sample text, so unicode-range subsets (Korean) are fetched too
    const loaded = await page.evaluate(async ({ fams, text }) => {
      const res = [];
      for (const f of fams) res.push((await document.fonts.load(`16px '${f}'`, text).catch(() => [])).length > 0);
      await document.fonts.ready;
      return res;
    }, { fams: fonts.map((f) => f.family), text });
    await page.waitForTimeout(500);
    await page.screenshot({ path: out, fullPage: true });
    return loaded;
  } finally { await browser.close(); }
}

async function cssForRender(name) {
  const r = await resolveCss(name);
  if (!r || !r.css) return null;
  let family = r.family || familyFromCss(r.css);
  let css = r.css;
  if (!family && /@import/.test(css)) { // Google / official @import: read the family from the stylesheet itself
    const url = /url\('([^']+)'\)/.exec(css)[1];
    const sheet = await get(url);
    family = familyFromCss(sheet.text);
  }
  return { name, family, css, source: r.source, verdict: r.verdict };
}

async function cmdSample(a) { return cmdContact({ ...a, _: ['contact', a._.slice(1).join(' ')] }, true); }

async function cmdContact(a, single) {
  const names = (single ? [a._[1]] : a._.slice(1).join(' ').split(',')).map((s) => s.trim()).filter(Boolean);
  if (!names.length) return fail('give one or more font names (comma separated)');
  const text = a.text || '다람쥐 헌 쳇바퀴에 타고파 Quick Fox 0123';
  const size = Number(a.size || (single ? 56 : 38));
  const out = a.out || `fontkit-${single ? 'sample' : 'contact'}-${Date.now()}.png`;
  const fonts = [];
  for (const n of names) {
    const f = await cssForRender(n);
    if (!f) { console.error(`skip: '${n}' has no webfont CSS`); continue; }
    if (f.verdict && f.verdict.verdict === 'no') console.error(`note: '${n}' may not be served as a webfont - rendering locally for a look only`);
    fonts.push(f);
  }
  if (!fonts.length) return fail('nothing to render');
  const loaded = await render(fonts, text, size, out);
  console.log(`saved ${out}`);
  fonts.forEach((f, i) => console.log(`  ${f.name} (${f.family}, ${f.source})${loaded[i] ? '' : '  <- font did not load, the row shows a fallback'}`));
}

function usage() {
  console.log(`fontkit - free font finder (bundled web-researched list + live lookup on Google Fonts, noonnu, Sandoll Cloud)

  fontkit search <name>                       search the bundled list
  fontkit locate <name>                       where the font is available
  fontkit css <name> [--from google|noonnu]   webfont CSS (refuses fonts our audit marks not-for-webfont; --force to override)
  fontkit sample <name> [--text T] [--out p.png]
  fontkit contact <a,b,c> [--text T] [--out p.png]
  add --json for machine-readable output`);
}

(async () => {
  const a = parseArgs(process.argv.slice(2));
  try {
    switch (a._[0]) {
      case 'search': return cmdSearch(a);
      case 'locate': return await cmdLocate(a);
      case 'css': return await cmdCss(a);
      case 'sample': return await cmdSample(a);
      case 'contact': return await cmdContact(a);
      default: return usage();
    }
  } catch (e) { fail(e.message || String(e)); }
})();
