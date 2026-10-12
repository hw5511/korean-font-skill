#!/usr/bin/env node
// fontkit (korean-font-skill) - find free Korean/Latin fonts, pull their webfont CSS, and render samples.
//
//   fontkit search <words> [--all|--limit N]      search the bundled list by name, English name or style tag
//   fontkit locate <name>                         check Google Fonts, noonnu and Sandoll Cloud for the font
//   fontkit css <name> [--from google|noonnu] [--weights 400,700]   print the webfont CSS
//   fontkit page <url> [--max N]                  print the text of a JavaScript-rendered page (Playwright)
//   fontkit sample <name> [--text T] [--size N] [--out a.png]        render one font to PNG
//   fontkit contact <name,name,...> [--text T] [--size N] [--out a.png]  render several fonts in one sheet
//
// Runs from any folder: the data is found next to this file, and relative --out paths are
// resolved against the folder you run the command from.
// Every network lookup is for ONE font at a time, with a pause between requests.
// Nothing fetched from a site is written to disk except the PNG you ask for.
'use strict';
const fs = require('fs');
const path = require('path');

const SKILL_DIR = path.join(__dirname, '..');
const DATA = path.join(SKILL_DIR, 'data');
const UA = 'Mozilla/5.0 (compatible; korean-font-skill/0.1; +https://github.com/)';
const PAUSE_MS = 2000;
const TIMEOUT_MS = 40000;
const SEARCH_LIMIT = 20;
const SKILL_FWD = path.resolve(SKILL_DIR).replace(/\\/g, '/');
// Two plain commands (no &&, so they also work in Windows PowerShell 5). --prefix pins node_modules to
// <skill folder>/node_modules; without it npm installs next to the nearest package.json further up.
const PLAYWRIGHT_INSTALL = `npm install --no-save --prefix "${SKILL_FWD}" playwright\n  node "${SKILL_FWD}/node_modules/playwright/cli.js" install chromium\n  (node_modules ends up in ${SKILL_FWD}/node_modules. The CLI also finds Playwright in any parent folder's node_modules, in the current folder's node_modules, or installed globally.)`;

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
const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-_·.()]/g, '');
// name without a trailing "체" / "font", so "주아" and "주아체" meet
const core = (s) => norm(s).replace(/(체|font|폰트)$/, '');
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

const cache = {};
function loadJson(name) { return cache[name] || (cache[name] = JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'))); }
const fontList = () => loadJson('fonts.json').fonts;

// ---------- names, English names and style tags ----------
// Other names a font is known by: its English name, Google Fonts family, CSS family,
// the romanized slug of its Sandoll Cloud page and the name of its GitHub repository.
function aliases(f) {
  const out = [f.name_en, f.google_family, f.css_family, ...(f.alt_names || [])].filter(Boolean);
  const s = /sandollcloud\.com\/free-font\/\d+\/([^/?#]+)/.exec(f.official_url || '');
  if (s && s[1] !== 'font') out.push(s[1].replace(/-/g, ' '));
  const g = /github\.com\/[^/]+\/([^/?#]+)/.exec(f.official_url || '');
  if (g && !/^fonts?$/i.test(g[1])) out.push(g[1]);
  return out;
}

// Search words that mean a style tag. Tags in data/fonts.json use the English keys.
const TAG_WORDS = {
  sans: ['sans', 'sansserif', 'gothic', '고딕', '돋움', '산스', '고딕체'],
  serif: ['serif', 'myeongjo', 'batang', '명조', '바탕', '부리', '명조체', '바탕체'],
  handwriting: ['handwriting', 'handwritten', 'script', '손글씨', '필기', '필기체', '손편지', '손글씨체'],
  brush: ['brush', 'calligraphy', '붓', '붓글씨', '캘리', '캘리그라피', '궁서', '궁서체'],
  cute: ['cute', 'kawaii', '귀여운', '귀여움', '귀엽', '귀엽게', '귀염', '깜찍', '깜찍한', '아기자기'],
  pixel: ['pixel', 'bitmap', 'dot', 'dotfont', '8bit', '도트', '픽셀', '비트맵', '도트폰트', '픽셀폰트'],
  display: ['display', 'title', 'headline', 'heading', 'poster', '제목', '제목용', '타이틀', '헤드라인', '굵은', '굵은제목', '포스터', '임팩트'],
  mono: ['mono', 'monospace', 'monospaced', 'coding', 'code', '코딩', '코드', '고정폭'],
  rounded: ['rounded', 'round', '둥근', '둥글', '둥근체', '라운드'],
};
function tagOf(word) {
  const w = norm(word);
  for (const [tag, words] of Object.entries(TAG_WORDS)) if (words.includes(w)) return tag;
  return null;
}
// Light guess from the name alone, used only for fonts that are not in the list (alternatives).
function tagsFromName(name) {
  const t = [];
  if (/고딕|돋움|산스|sans|gothic/i.test(name)) t.push('sans');
  if (/명조|바탕|부리|serif/i.test(name)) t.push('serif');
  if (/손글씨|필기|글씨|손편지|script/i.test(name)) t.push('handwriting');
  if (/붓|궁서|brush/i.test(name)) t.push('brush');
  if (/제목|title|black|블랙|굵은/i.test(name)) t.push('display');
  if (/둥근|라운드|round/i.test(name)) t.push('rounded');
  return t;
}

function findInList(name) {
  const q = norm(name), qc = core(name);
  if (!q) return null;
  const list = fontList();
  const exact = list.find((f) => norm(f.name) === q) ||
    list.find((f) => (f.alt_names || []).some((x) => norm(x) === q)) ||
    list.find((f) => [f.name_en, f.google_family, f.css_family].some((x) => x && norm(x) === q)) ||
    list.find((f) => core(f.name) === qc);
  if (exact) return exact;
  // partial: the list name contains what was asked; prefer the shortest such name
  const part = list.filter((f) => norm(f.name).includes(q)).sort((x, y) => x.name.length - y.name.length);
  return part[0] || null;
}
// Webfont status of a list entry: not allowed / conditional (our audit), allowed (a font host
// publishes a webfont for it and the audit has no objection), unknown (not audited, no known host).
function webfontStatus(f) {
  const k = verdictOfEntry(f);
  if (k === 'no') return 'not allowed';
  if (k === 'conditional') return 'conditional';
  return f.google_family || f.webfont_css_url ? 'allowed' : 'unknown';
}
function verdict(name) {
  const v = loadJson('webfont-verdicts.json');
  const entry = findInList(name);
  const qs = [norm(name), entry && norm(entry.name)].filter(Boolean);
  for (const k of ['no', 'conditional']) {
    for (const [n, info] of Object.entries(v[k])) {
      if (qs.includes(norm(n)) || (info.name_en && qs.includes(norm(info.name_en)))) return { verdict: k, font: n, ...info };
    }
  }
  return null;
}
function verdictOfEntry(f) {
  const v = loadJson('webfont-verdicts.json');
  for (const k of ['no', 'conditional']) if (Object.keys(v[k]).some((n) => norm(n) === norm(f.name))) return k;
  return null;
}

function verdictReason(v) {
  const extra = ['note', 'reason', 'source'].filter((k) => v[k]).map((k) => `${k}: ${v[k]}`);
  return [`audit entry '${v.font}'`, v.name_en && `English name: ${v.name_en}`, v.maker && `maker: ${v.maker}`, ...extra].filter(Boolean).join('; ');
}
function familiesFromCss(css) {
  const out = [];
  for (const m of String(css || '').matchAll(/font-family:\s*['"]?([^;'"]+)['"]?/gi)) {
    const fam = m[1].trim();
    if (!out.includes(fam)) out.push(fam);
  }
  return out;
}
function familyFromCss(css) { return familiesFromCss(css)[0] || null; }
// One stylesheet can define several families (galmuri.css: Galmuri7, 9, 11, 14, Mono...).
// Pick the one that belongs to the requested font instead of the first one.
function pickFamily(families, name, entry) {
  if (!families.length) return null;
  if (families.length === 1) return families[0];
  const wants = [entry && entry.css_family, entry && entry.name_en, entry && entry.google_family, name, entry && entry.name].filter(Boolean);
  for (const w of wants) { const hit = families.find((f) => norm(f) === norm(w)); if (hit) return hit; }
  const digits = (/\d+/.exec(name) || [])[0];
  if (digits) {
    const mono = /mono|모노/i.test(name);
    const hit = families.find((f) => (/\d+/.exec(f) || [])[0] === digits && /mono/i.test(f) === mono);
    if (hit) return hit;
  }
  return families[0];
}

// ---------- sources ----------
function googleUrl(family, weights) {
  const fam = encodeURIComponent(family).replace(/%20/g, '+');
  return `https://fonts.googleapis.com/css2?family=${fam}${weights && weights.length ? ':wght@' + weights.join(';') : ''}&display=swap`;
}
// Google Fonts: the official CSS API answers 200 with @font-face for a real family, 400 otherwise.
async function googleCss(family, weights) {
  const page = `https://fonts.google.com/specimen/${family.replace(/ /g, '+')}`;
  const base = { source: 'google', page, family };
  if (weights && weights.length) {
    // Google answers with the faces it has and silently leaves out weights the family lacks
    const r = await get(googleUrl(family, weights));
    if (r.status === 200 && /@font-face/.test(r.text)) {
      const got = [...r.text.matchAll(/font-weight:\s*(\d+)(?:\s+(\d+))?/g)].map((m) => [Number(m[1]), Number(m[2] || m[1])]);
      const ok = weights.filter((w) => got.some(([lo, hi]) => Number(w) >= lo && Number(w) <= hi));
      const dropped = weights.filter((w) => !ok.includes(w));
      if (ok.length) return { ...base, weights: ok, dropped, css: `@import url('${googleUrl(family, ok)}');` };
    }
  }
  const r = await get(googleUrl(family));
  if (r.status !== 200 || !/@font-face/.test(r.text)) return null;
  return { ...base, dropped: weights && weights.length ? weights : undefined, css: `@import url('${googleUrl(family)}');` };
}

// noonnu: search page /search/<name> lists /font_page/<id> links; the font page holds the
// copy-ready CSS in an element named "webfontSource".
async function noonnuFind(name) {
  const r = await get(`https://noonnu.cc/search/${encodeURIComponent(name)}`);
  if (r.status !== 200) return null;
  const hits = [...r.text.matchAll(/href="\/font_page\/(\d+)"[\s\S]{0,600}?alt="([^"]+)"/g)].map((m) => ({ id: m[1], name: unescapeHtml(m[2]) }));
  if (!hits.length) return null;
  const q = norm(name);
  return hits.find((h) => norm(h.name) === q) || hits.find((h) => norm(h.name).includes(q) || q.includes(norm(h.name))) || null;
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

// ---------- search ----------
function scoreFont(f, q, tag) {
  const n = norm(f.name);
  const al = aliases(f).map(norm);
  let s = 0;
  if (n === q || al.includes(q)) s = 100;
  else if (n.startsWith(q)) s = 80;
  else if (n.includes(q)) s = 60;
  else if (al.some((x) => x.includes(q))) s = 50;
  if (tag && (f.tags || []).includes(tag)) s = Math.max(s, 40);
  if (!s && norm(f.maker).includes(q)) s = 20;
  return s;
}
function cmdSearch(a) {
  const raw = a._.slice(1).join(' ').trim();
  const q = norm(raw);
  if (!q) return fail('search needs a word: a name, an English name or a style such as 손글씨, pixel, cute, 명조');
  const list = fontList();
  let rows = list.map((f) => ({ f, s: scoreFont(f, q, tagOf(raw)) })).filter((r) => r.s > 0);
  const terms = raw.split(/\s+/).filter(Boolean);
  let usedTags = [tagOf(raw)].filter(Boolean);
  if (!rows.length && terms.length > 1) {
    usedTags = [...new Set(terms.map(tagOf).filter(Boolean))];
    // several words ("cute 손글씨"): every word must match a name, English name, tag or maker
    rows = list.map((f) => {
      const ss = terms.map((t) => scoreFont(f, norm(t), tagOf(t)));
      return { f, s: ss.every((x) => x > 0) ? ss.reduce((x, y) => x + y, 0) : 0 };
    }).filter((r) => r.s > 0);
  }
  // higher score first; among equals, fonts with a known webfont source first
  const easy = (f) => (f.google_family || f.webfont_css_url ? 1 : 0);
  if (a.webfont) rows = rows.filter((r) => webfontStatus(r.f) !== 'not allowed');
  rows.sort((x, y) => y.s - x.s || easy(y.f) - easy(x.f));
  const total = rows.length;
  const limit = a.all ? total : Number(a.limit || SEARCH_LIMIT);
  const shown = rows.slice(0, limit).map((r) => r.f);
  if (a.json) return console.log(JSON.stringify(shown.map((f) => ({ ...f, webfont: webfontStatus(f) })), null, 2));
  if (!total) {
    console.log(`no match in the bundled list${a.webfont ? ' (--webfont hides fonts marked not allowed)' : ''} - try another word, a style tag (sans, serif, handwriting, brush, cute, pixel, display, mono, rounded) or: fontkit locate <name>`);
    return;
  }
  console.log(`${total} match${total === 1 ? '' : 'es'}${usedTags.length ? ` (style tag: ${usedTags.join(', ')})` : ''}`);
  for (const f of shown) {
    const other = [...new Set([f.name_en, f.google_family].filter(Boolean))].filter((x) => x !== f.name);
    const tags = (f.tags || []).length ? ` | ${f.tags.join(',')}` : '';
    console.log(`${f.name}${other.length ? ` (${other.join(' / ')})` : ''} | maker: ${f.maker} | ${f.license} | webfont: ${webfontStatus(f)} | ${f.official_url}${tags}`);
  }
  console.log('webfont: allowed = a font host (Google Fonts / official CDN) serves it and our audit has no objection; conditional = needs the maker\'s permission; not allowed = our audit says no; unknown = not audited and no known webfont host. Add --webfont to hide the not-allowed ones.');
  if (total > shown.length) console.log(`... and ${total - shown.length} more (add --all to see every match, or --limit N)`);
  if (usedTags.length) {
    const tagged = list.filter((f) => (f.tags || []).length).length;
    console.log(`note: only ${tagged} of ${list.length} fonts carry style tags; an untagged font can still fit. Look at a contact sheet before choosing.`);
  }
}

// ---------- locate / css ----------
// noonnu is searched by Korean name; an English query is translated through the bundled list first.
async function noonnuByNames(name, entry) {
  const tries = [...new Set([entry && entry.name, name, entry && entry.name_en].filter(Boolean))];
  for (const t of tries) { const r = await noonnuCss(t); if (r) return r; }
  return null;
}
async function locateAll(name) {
  const entry = findInList(name);
  const out = { name, in_list: entry || null, google: null, noonnu: null, sandoll: null, verdict: verdict(name) };
  const gfam = (entry && entry.google_family) || name;
  if (/^[\x00-\x7F]+$/.test(gfam)) out.google = await googleCss(gfam);
  out.noonnu = await noonnuByNames(name, entry);
  if (entry && entry.sandoll_id) out.sandoll = await sandollInfo(entry.sandoll_id);
  return out;
}

async function cmdLocate(a) {
  const name = a._.slice(1).join(' ');
  if (!name) return fail('locate needs a name');
  const r = await locateAll(name);
  if (a.json) return console.log(JSON.stringify(r, null, 2));
  console.log(`# ${name}`);
  console.log(`list    : ${r.in_list ? `${r.in_list.name} | maker: ${r.in_list.maker} | ${r.in_list.license} | webfont: ${webfontStatus(r.in_list)} | ${r.in_list.official_url}` : '-'}`);
  if (r.in_list && r.in_list.webfont_css_url) console.log(`official: ${r.in_list.webfont_css_url}`);
  console.log(`google  : ${r.google ? r.google.page : '-'}`);
  console.log(`noonnu  : ${r.noonnu ? `${r.noonnu.page} (${r.noonnu.name}${r.noonnu.css ? ', css' : ', no css'})` : '-'}`);
  console.log(`sandoll : ${r.sandoll ? `${r.sandoll.page} (${r.sandoll.title}; Sandoll offers download only, no webfont CSS)` : (r.in_list && r.in_list.sandoll_id ? 'page not reachable' : '-')}`);
  if (r.verdict) console.log(`webfont : ${r.verdict.verdict === 'no' ? 'NOT ALLOWED as a webfont' : 'conditional - check the maker terms'} (our audit; ${verdictReason(r.verdict)})`);
}

// For an official stylesheet that defines several families, say which family to use.
async function officialFamily(entry, name) {
  if (entry.css_family) return entry.css_family;
  const sheet = await get(entry.webfont_css_url);
  return pickFamily(familiesFromCss(sheet.text), name, entry);
}

async function resolveCss(name, from, weights) {
  const v = verdict(name);
  const entry = findInList(name);
  if (entry && entry.webfont_css_url && !from) {
    return { source: 'official', page: entry.official_url, family: entry.css_family || null, style: entry.css_style || null,
      css: `@import url('${entry.webfont_css_url}');`, entry, verdict: v };
  }
  const gfam = (entry && entry.google_family) || name;
  if (from !== 'noonnu' && /^[\x00-\x7F]+$/.test(gfam)) {
    const g = await googleCss(gfam, weights);
    if (g) return { ...g, entry, verdict: v };
    if (from === 'google') return null;
  }
  const n = await noonnuByNames(name, entry);
  if (n && n.css) return { ...n, entry, verdict: v };
  if (entry && entry.sandoll_id) return { ...(await sandollInfo(entry.sandoll_id)), entry, verdict: v };
  return n ? { ...n, entry, verdict: v } : null;
}

// Alternatives for a refused font: allowed fonts with a webfont that really exists (Google Fonts or an
// official stylesheet), ranked by shared style tags, with bold/display fonts first when the refused
// font is bold or display. Fonts with a look flag (outline or shadow letters, Google copy without Korean) are left out.
function alternatives(name, n = 3) {
  const entry = findInList(name);
  const tags = (entry && entry.tags && entry.tags.length) ? entry.tags : tagsFromName(name);
  if (!tags.length) return { tags, list: [] };
  const wantBold = tags.includes('display') || /강한|굵|black|bold|heavy|블랙|extra/i.test(name);
  const isBold = (f) => (f.tags || []).includes('display') || /black|bold|heavy|extra|굵|블랙|헤비/i.test(`${f.name} ${f.google_family || ''}`);
  const list = fontList()
    .filter((f) => f !== entry && (f.tags || []).length && !verdictOfEntry(f) && !f.look && (f.google_family || f.webfont_css_url))
    .map((f) => {
      const overlap = f.tags.filter((t) => tags.includes(t)).length;
      const extra = f.tags.filter((t) => !tags.includes(t)).length;
      const easy = (f.google_family ? 2 : 0) + (f.webfont_css_url ? 1 : 0) + (/^OFL/.test(f.license) ? 1 : 0);
      return { f, s: overlap * 10 - extra * 3 + easy + (wantBold ? (isBold(f) ? 8 : -4) : 0), overlap };
    })
    .filter((x) => x.overlap > 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, n)
    .map((x) => x.f);
  return { tags, list };
}

async function cmdCss(a) {
  const name = a._.slice(1).join(' ');
  if (!name) return fail('css needs a name');
  const weights = a.weights ? String(a.weights).split(/[,;\s]+/).filter((w) => /^\d{3}$/.test(w)) : null;
  // check the audit before any network request
  const v0 = verdict(name);
  if (v0 && v0.verdict === 'no' && !a.force) {
    fail(`'${name}': our audit says this font may NOT be served as a webfont. Use it as an installed font for print or images, or pass --force only if you have the maker's permission.`);
    console.error(`Reason: ${verdictReason(v0)}. The audit file carries no further note; the maker's own page has the terms.`);
    { const e = findInList(name); if (e) console.error(`List entry: ${e.name} | maker: ${e.maker} | license in list: ${e.license} (a general summary; the audit above is about webfont use) | ${e.official_url}`); }
    const alt = alternatives(name);
    if (alt.list.length) {
      console.error(`Allowed fonts with a working webfont and a similar style (tags: ${alt.tags.join(', ')}). Look at them with contact before choosing:`);
      for (const f of alt.list) console.error(`  ${f.name}${f.name_en || f.google_family ? ` (${f.name_en || f.google_family})` : ''} | maker: ${f.maker} | ${f.license} | webfont: ${webfontStatus(f)} | ${f.tags.join(',')} | ${f.official_url}`);
      console.error(`  fontkit contact "${alt.list.map((f) => f.name).join(', ')}" --text "<your text>"`);
    } else {
      console.error('No style tags for this font, or no allowed font with a working webfont shares them. Find allowed fonts by style: fontkit search <style>  (sans, serif, handwriting, brush, cute, pixel, display, mono, rounded)');
    }
    return;
  }
  const r = await resolveCss(name, a.from, weights);
  if (!r) return fail(`font not found: '${name}' is not in the bundled list, Google Fonts or noonnu. Try: fontkit search <word>`);
  if (r.source === 'official' && !r.family) r.family = await officialFamily(r.entry, name);
  if (a.json) { const { entry, ...rest } = r; return console.log(JSON.stringify(rest, null, 2)); }
  if (!r.css) {
    console.log(`/* ${name}: no webfont CSS at ${r.source}. Download from ${r.download || r.page} and self-host only if its license allows. */`);
    if (r.license) console.log(`/* license: ${r.license} */`);
    return;
  }
  if (r.verdict && r.verdict.verdict === 'conditional') console.log(`/* WARNING: conditional webfont license - check the maker's terms (${r.verdict.maker}) */`);
  console.log(`/* source: ${r.source} ${r.page} */`);
  if (r.entry) console.log(`/* font: ${r.entry.name} | maker: ${r.entry.maker} */`);
  if (weights && r.source !== 'google') console.log('/* note: --weights applies to Google Fonts only; this CSS carries the weights its source offers */');
  if (r.dropped && r.dropped.length) console.log(`/* note: Google Fonts does not offer weight ${r.dropped.join(', ')} for ${r.family}; ${r.weights ? 'printed ' + r.weights.join(', ') : 'printed the default weight'} */`);
  if (/@import/.test(r.css)) console.log('/* @import must be the first rule of the stylesheet, or the browser ignores it */');
  console.log(r.css);
  const family = r.family || familyFromCss(r.css);
  if (family) {
    const others = r.source === 'official' && r.entry && r.entry.webfont_css_url ? ' (this stylesheet defines several families; use this one)' : '';
    console.log(`/* use: font-family: '${family}'${r.style ? `; ${r.style}` : ''};${others} */`);
  }
}

// ---------- rendering ----------
// Finds Playwright in: this skill folder or any folder above it (repo root), the current folder or any
// folder above it, or the global npm root.
function loadPlaywright() {
  const dirs = [];
  for (const start of [SKILL_DIR, process.cwd()]) {
    let d = path.resolve(start);
    for (;;) { if (!dirs.includes(d)) dirs.push(d); const up = path.dirname(d); if (up === d) break; d = up; }
  }
  try { dirs.push(require('child_process').execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch (_) {}
  for (const d of dirs) {
    for (const t of ['playwright', 'playwright-core']) {
      for (const p of [path.join(d, 'node_modules', t), path.join(d, t)]) {
        if (fs.existsSync(path.join(p, 'package.json'))) { try { return require(p); } catch (_) {} }
      }
    }
  }
  console.error(`ERROR: playwright not found (looked in node_modules of the skill folder, its parents, the current folder and its parents, and the global npm root). Install it once:\n  ${PLAYWRIGHT_INSTALL}`);
  process.exit(3);
}

async function render(fonts, text, size, out) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1200, height: 200 } });
    // @import must come before every other rule, or the browser ignores it
    const all = fonts.map((f) => f.css).join('\n');
    const css = (all.match(/@import[^;]+;/g) || []).join('\n') + '\n' + all.replace(/@import[^;]+;/g, '');
    // one span per distinct character, off screen, to ask the browser which font drew each one
    const chars = [...new Set([...text].filter((c) => c.trim()))];
    const rows = fonts.map((f, i) => {
      const stack = `font-family:'${f.family}',sans-serif;${f.style || ''}`;
      return `<div class="row"><div class="lbl" id="l${i}">${escapeHtml(f.name)} &middot; font-family: ${escapeHtml(f.family)} &middot; ${escapeHtml(f.source)}</div>` +
        `<div class="smp" style="${stack}">${escapeHtml(text)}</div>` +
        `<div class="probe" id="p${i}" style="${stack}">${chars.map((c) => `<span>${escapeHtml(c)}</span>`).join('')}</div></div>`;
    }).join('');
    await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}
      html,body{margin:0;background:#fff}
      body{color:#111;width:1200px;font-family:system-ui,sans-serif}
      .row{padding:14px 28px 18px;border-bottom:1px solid #e5e5e5}
      .lbl{font-size:15px;color:#777;margin-bottom:6px}
      .lbl.bad{color:#c00;font-weight:600}
      .smp{font-size:${size}px;line-height:1.25;word-break:keep-all}
      .probe{position:absolute;left:-20000px;top:0;font-size:${size}px}</style></head><body>${rows}</body></html>`, { waitUntil: 'networkidle' });
    const loaded = await page.evaluate(async ({ fams, text }) => {
      const own = (fam) => [...document.fonts].some((ff) => ff.family.replace(/^['"]|['"]$/g, '') === fam && ff.status === 'loaded');
      const res = [];
      for (const fam of fams) {
        // ask for the face with the sample text, so unicode-range subsets (Korean) are fetched too.
        // load() rejects when any one face fails, even if another face of the family loaded.
        const faces = await document.fonts.load(`48px '${fam}'`, text).catch(() => []);
        res.push(faces.length > 0 || own(fam));
      }
      await document.fonts.ready;
      return res;
    }, { fams: fonts.map((f) => f.family), text });
    await page.waitForTimeout(300);
    // Chromium reports the fonts that actually drew a node's text; a system (non-web) font there
    // means the web font lacks that character and the browser fell back.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const checks = [];
    for (let i = 0; i < fonts.length; i++) {
      const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: `#p${i} span` });
      const missing = [];
      for (let k = 0; k < nodeIds.length; k++) {
        const { fonts: used } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: nodeIds[k] });
        if (used.some((u) => !u.isCustomFont && u.glyphCount > 0)) missing.push(chars[k]);
      }
      checks.push({ loaded: loaded[i] && missing.length < chars.length, missing });
    }
    const notes = checks.map((c) => {
      if (!c.loaded) return 'FONT DID NOT LOAD - this row shows a system fallback';
      if (!c.missing.length) return '';
      const hangul = c.missing.filter((ch) => /[ᄀ-ᇿ㄰-㆏가-힯]/.test(ch));
      const what = hangul.length === c.missing.length ? 'Korean glyphs' : hangul.length ? 'some glyphs' : 'Latin/other glyphs';
      return `FALLBACK: ${what} missing (${c.missing.slice(0, 6).join(' ')}${c.missing.length > 6 ? ' ...' : ''}), drawn in a system font`;
    });
    await page.evaluate((notes) => notes.forEach((n, i) => {
      if (!n) return;
      const el = document.getElementById('l' + i);
      el.classList.add('bad');
      el.textContent += '  -  ' + n;
    }), notes);
    await page.waitForTimeout(300);
    await page.locator('body').screenshot({ path: out });
    return notes;
  } finally { await browser.close(); }
}

// A stylesheet such as Pretendard's lists local('Pretendard Black') before its CDN files. A copy installed on
// this PC then wins, Chromium does not call it a custom font, and the check wrongly says "did not load".
// So the stylesheet is fetched here, local() sources are dropped, relative URLs made absolute, and it is inlined.
async function inlineSheets(css) {
  const out = [];
  for (const m of css.matchAll(/@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)['"]?\s*\)?\s*;/g)) {
    const url = m[1];
    if (/fonts\.googleapis\.com/.test(url)) { out.push(m[0]); continue; }
    const r = await get(url.startsWith('//') ? 'https:' + url : url);
    if (r.status !== 200) { out.push(m[0]); continue; }
    const base = r.url;
    out.push(r.text
      .replace(/local\([^)]*\)\s*,?\s*/g, '')
      .replace(/url\(\s*(['"]?)(?!data:|https?:|\/\/)([^'")]+)\1\s*\)/g, (_, q, u) => `url("${new URL(u, base).href}")`));
  }
  return out.join('\n') + '\n' + css.replace(/@import[^;]+;/g, '');
}

async function cssForRender(name) {
  const r = await resolveCss(name);
  if (!r || !r.css) return null;
  // the render page has no http origin, so protocol-relative URLs ("//host/...") must get https:
  const css = r.css.replace(/url\(\s*(['"]?)\/\//g, 'url($1https://');
  let family = r.family || familyFromCss(css);
  if (!family && /@import/.test(css)) { // Google / official @import: read the family from the stylesheet itself
    const m = /@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)/.exec(css);
    if (m) family = pickFamily(familiesFromCss((await get(m[1])).text), name, r.entry);
  }
  if (!family) return null;
  return { name, family, css: await inlineSheets(css), style: r.style, source: r.source, verdict: r.verdict, entry: r.entry };
}

async function cmdSample(a) { return cmdContact({ ...a, _: ['contact', a._.slice(1).join(' ')] }, true); }

async function cmdContact(a, single) {
  const names = (single ? [a._[1]] : a._.slice(1).join(' ').split(',')).map((s) => s.trim()).filter(Boolean);
  if (!names.length) return fail('give one or more font names (comma separated)');
  const text = a.text || '다람쥐 헌 쳇바퀴에 타고파 Quick Fox 0123';
  const size = Number(a.size || (single ? 72 : 56));
  // relative paths land in the folder the command was run from
  const out = path.resolve(process.cwd(), a.out || `fontkit-${single ? 'sample' : 'contact'}-${Date.now()}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const fonts = [];
  for (const n of names) {
    const f = await cssForRender(n);
    if (!f) {
      console.error(findInList(n) ? `skip: '${n}' is in the list but has no webfont CSS (download only)` : `skip: font not found: '${n}' is not in the bundled list. Try: fontkit search <word>`);
      continue;
    }
    if (f.verdict && f.verdict.verdict === 'no') console.error(`note: '${n}' may not be served as a webfont - rendering locally for a look only`);
    fonts.push(f);
  }
  if (!fonts.length) return fail('nothing to render');
  const notes = await render(fonts, text, size, out);
  console.log(`saved ${out}`);
  fonts.forEach((f, i) => console.log(`  ${f.name}${f.entry ? ` [maker: ${f.entry.maker}]` : ''} (font-family: ${f.family}, ${f.source})${notes[i] ? '  <- ' + notes[i] : ''}`));
}

// Read an official page that is drawn by JavaScript: open it in Chromium and print its visible text.
async function cmdPage(a) {
  const url = a._[1];
  if (!/^https?:\/\//i.test(url || '')) return fail('page needs a full URL, e.g. fontkit page https://example.com/font');
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(1000);
    const text = await page.evaluate(() => document.body ? document.body.innerText : '');
    const max = Number(a.max || 20000);
    console.log(`# ${await page.title()}
# ${page.url()}
`);
    console.log(text.length > max ? text.slice(0, max) + `
... (cut at ${max} characters; add --max N)` : text);
  } finally { await browser.close(); }
}

function usage() {
  console.log(`fontkit - free font finder (bundled web-researched list + live lookup on Google Fonts, noonnu, Sandoll Cloud)

  fontkit search <words> [--all|--limit N] [--webfont]    search the bundled list by name, English name or style tag
                                              (--webfont hides fonts our audit marks not-allowed as webfont)
                                              (sans, serif, handwriting, brush, cute, pixel, display, mono, rounded,
                                               or Korean: 고딕, 명조, 손글씨, 붓, 귀여운, 도트, 제목, 코딩, 둥근)
  fontkit locate <name>                       (Korean or English name) where the font is available
  fontkit css <name> [--from google|noonnu] [--weights 400,700]
                                              webfont CSS (refuses fonts our audit marks not-for-webfont and lists
                                              allowed alternatives; --weights is for Google Fonts)
  fontkit page <url> [--max N]                print the visible text of a page drawn by JavaScript (needs Playwright)
  fontkit sample <name> [--text T] [--size N] [--out p.png]
  fontkit contact <a,b,c> [--text T] [--size N] [--out p.png]
  add --json for machine-readable output. Relative --out paths are relative to the current folder.
  sample/contact need Playwright: ${PLAYWRIGHT_INSTALL}`);
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
      case 'page': return await cmdPage(a);
      default: return usage();
    }
  } catch (e) { fail(e.message || String(e)); }
})();
