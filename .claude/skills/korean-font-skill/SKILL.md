---
name: korean-font-skill
description: Find a free Korean or Latin font, get its webfont CSS from Google Fonts or noonnu, check whether it may be served as a webfont, and render sample PNGs to compare fonts by eye. Use whenever a design, web page, slide or video needs a free commercial-use font, Korean font, 한글 폰트, 무료 폰트 or webfont CSS.
---

# korean-font-skill

CLI: `node bin/fontkit.cjs <command>`, run from this skill's folder (the folder that holds this file). Add `--json` for structured output.

## Pick a font in four steps

1. **Narrow the candidates.** `search <word>` looks in the bundled list `data/fonts.json` (maker, official page, license). For a font you already know, skip to step 2.
2. **Find where it lives.** `locate <name>` checks Google Fonts, noonnu and Sandoll Cloud and prints which have it.
3. **Look before you choose.** `contact "<a>, <b>, <c>" --text "<your real text>" --out compare.png`, then open the PNG and judge the letter shapes against the job. Do not choose from names alone; popular fonts win by name, not by fit. A row marked "font did not load" shows a fallback font, so ignore it.
4. **Get the CSS.** `css <name>` prints `@font-face` or `@import` CSS to paste at the top of the stylesheet; use the `font-family` it names.

`sample` and `contact` need Playwright (`npm install` in the repository root, then `npx playwright install chromium`). `search`, `locate` and `css` need only Node 18 or newer.

## Rules that matter

- `css` refuses fonts our audit marks as not allowed as a webfont, and warns on conditional ones. Do not pass `--force` unless the user has the maker's permission. Such fonts can still be installed locally for print or images.
- Sandoll Cloud fonts have no webfont CSS. Give the user the page `fontkit` prints; they download the font and self-host only if the license allows.
- The `license` field in the list is a short summary. Before commercial use, open `official_url` and read the maker's own terms.
- One font per request. Do not loop `locate` or `css` over many names to build a list.
- If something is wrong with a font (dead page, broken CSS, fallback in the sample, wrong license), tell the user and suggest opening a **Font problem** issue on this skill's repository with the command and its output.
