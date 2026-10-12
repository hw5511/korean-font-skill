---
name: korean-font-skill
description: Find a free Korean or Latin font, get its webfont CSS from Google Fonts or noonnu, check whether it may be served as a webfont, and render sample PNGs to compare fonts by eye. Use whenever a design, web page, slide or video needs a free commercial-use font, Korean font, 한글 폰트, 무료 폰트 or webfont CSS.
---

# korean-font-skill

CLI: `node "<this skill's folder>/bin/fontkit.cjs" <command>` (the folder that holds this file). Run it from your project folder: relative `--out` paths are saved relative to the folder you run it from. Add `--json` for structured output, `--help` for usage.

## Pick a font in four steps

1. **Narrow the candidates.** `search <words>` looks in the bundled list `data/fonts.json` (maker, official page, license) by Korean name, English name (`"Noto Sans KR"`, `Pretendard`, `Galmuri`) or style tag: `sans` 고딕, `serif` 명조, `handwriting` 손글씨, `brush` 붓, `display` 제목, `rounded` 둥근, `cute` 귀여운, `pixel` 도트, `mono` 코딩. Several words narrow further (`search cute 손글씨`). It prints the top 20; `--all` shows every match. Only part of the list carries tags, so an untagged font can still fit.
2. **Find where it lives.** `locate <name>` checks Google Fonts, noonnu and Sandoll Cloud and prints which have it.
3. **Look before you choose.** `contact "<a>, <b>, <c>" --text "<your real text>" --out compare.png`, then open the PNG and judge the letter shapes against the job. Do not choose from names alone; popular fonts win by name, not by fit. A row whose label is red shows a system fallback for some or all of the text ("font did not load", or "FALLBACK: Korean glyphs not in this font"), so do not judge that font from it. `--size` changes the sample size.
4. **Get the CSS.** `css <name>` prints `@font-face` or `@import` CSS and the `font-family` to use. An `@import` must be the first rule of the stylesheet. For Google Fonts, `--weights 400,700` asks for more weights (it says which weights the font does not have).

`sample` and `contact` need Playwright. Install it once, in this skill's folder:
`npm install --no-save playwright && npx playwright install chromium` (the CLI prints the same command with the full path when Playwright is missing). `search`, `locate` and `css` need only Node 18 or newer.

## Rules that matter

- `css` refuses fonts our audit marks as not allowed as a webfont, and warns on conditional ones. It then lists allowed fonts from the bundled list with a similar style; compare those with `contact` instead of picking a replacement from memory. Do not pass `--force` unless the user has the maker's permission. Refused fonts can still be installed locally for print or images.
- Sandoll Cloud itself offers no webfont CSS, only a download. `css` may still find a webfont copy of the same font elsewhere (Google Fonts or noonnu) and print it; otherwise give the user the page `fontkit` prints, and they download the font and self-host only if the license allows.
- The `license` field in the list is a short summary. Before commercial use, open `official_url` and read the maker's own terms.
- One font per request means: do not loop `locate` or `css` over many names to harvest a list. Running them a few times for the candidates you are actually comparing is fine.
- If something is wrong with a font (dead page, broken CSS, fallback in the sample, wrong license), tell the user and suggest opening a **Font problem** issue on this skill's repository with the command and its output.

Exit codes: 2 = refused or not found, 3 = Playwright missing.
