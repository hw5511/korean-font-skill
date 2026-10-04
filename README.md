# korean-font-kit

Find a free Korean or Latin font, get its webfont CSS, and render a sample image so an AI assistant can look at the letters before choosing.

- **A font list we researched ourselves.** `data/fonts.json` lists free fonts with their maker, official download page and license, each taken from the font's official page.
- **Live lookup, one font at a time.** `fontkit` checks Google Fonts, noonnu and Sandoll Cloud for the font you name and pulls the webfont CSS from whichever has it.
- **A webfont license check.** Many free fonts may be used on a website but may not be served as a webfont file. `data/webfont-verdicts.json` is our own audit; `fontkit css` refuses fonts marked "not allowed" and warns on "conditional" ones.
- **Sample images.** `fontkit sample` and `fontkit contact` render one or several fonts to PNG, so the assistant can compare them by eye.

## Install

```bash
git clone <this repo> && cd korean-font-kit
npm install            # installs playwright (only needed for sample/contact)
npx playwright install chromium
```

Node 18 or newer. `search`, `locate` and `css` need no extra packages.

## Use

```bash
node bin/fontkit.cjs search 학교안심                 # search the bundled list
node bin/fontkit.cjs locate 마포당인리발전소          # where the font is available
node bin/fontkit.cjs css "Noto Sans KR"              # webfont CSS (Google Fonts first, then noonnu)
node bin/fontkit.cjs css 프리텐다드 --from noonnu
node bin/fontkit.cjs sample "학교안심 떡볶이" --text "샘플 문장" --out a.png
node bin/fontkit.cjs contact "Noto Sans KR, 프리텐다드, Gowun Batang" --out compare.png
```

Add `--json` to any command for machine-readable output.

### Where the CSS comes from

| Source | How fontkit reads it |
|---|---|
| Google Fonts | the official CSS API `fonts.googleapis.com/css2?family=<name>` |
| noonnu (noonnu.cc) | search page `noonnu.cc/search/<name>`, then the font page's copy-ready webfont box |
| Sandoll Cloud | free-font page `sandollcloud.com/free-font/<id>/<slug>`; these fonts have no webfont CSS, so fontkit gives the page and its license text for download |
| Official CDN | a few fonts publish their own CSS (for example on GitHub / jsDelivr); the list records it |

fontkit asks for one font at a time, waits two seconds between requests and keeps nothing it fetches except the PNG you ask for. Font information belongs to each site and font maker; please follow their terms.

## Report a problem font

If a font in the list is wrong, its CSS does not work, the sample shows a fallback font, or the license looks wrong, open an issue with the **Font problem** template. Include the command you ran, its output, and a link to the official page that shows the right answer.

## License

Code: MIT. The fonts belong to their makers and keep their own licenses.
