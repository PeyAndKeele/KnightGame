# Knight

A PS1-style knight game that runs entirely in the browser, built on three.js (r147).
It is plain static files, so it hosts on GitHub Pages with no build step.

## Running it

The game fetches its data files, so it must be served over http (opening `index.html`
straight from disk will not work).

```
npm run serve        # python3 -m http.server 8000, then open http://localhost:8000
```

In a Codespace, open the forwarded port 8000 when the notification appears.
three.js and its GLTFLoader are loaded from the jsDelivr CDN (see the two `<script>` tags
in `index.html`), and the VT323 font from Google Fonts, so you need to be online.

## Dev mode

- Add `?dev` to the address: you own every item, and the game uses a separate save slot
  (`knight-save-dev`), so testing never touches a real playthrough.
- `?dev=0` turns it off again. The setting is remembered in `localStorage` (`knight-dev`),
  so it stays on until you do this.
- Console helpers: `dbg.give('all')`, `dbg.give('hammer')`, `dbg.add(500)`, `dbg.gold(0)`,
  `dbg.reset()`, `dbg.dev(true/false)`, `dbg.save()`.

## How it fits together

| File                        | What it is                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `index.html`                | The page, all of the CSS, the loading screen, and the loader.                                 |
| `main.js`                   | The whole game: one 15,000-line function that runs immediately (an IIFE).                     |
| `manifest.json`             | List of the data files: `{ id, type, url, size }`. `size` weights the loading bar.            |
| `*-data.json`, `*-data.txt` | Models, animations, songs and sound effects as text (about 50 MB in total).                   |
| `scripts/codemap.js`        | Prints a table of contents for `main.js` (`npm run map`).                                     |

### Loading

1. `index.html` shows the loading screen and fetches `manifest.json`
   (it tries `assets/manifest.json` first, then the root).
2. Every file in the manifest is downloaded and added to the page as
   `<script type="{type}" id="{id}">…</script>` with the file's text inside.
   `main.js` reads each one back with `document.getElementById("<id>").textContent`.
3. `main.js` is then loaded. Its models are built asynchronously.
4. `main.js` sets `window.__knightReady()` and the loading screen polls it, lifting itself
   once the knight and the golem exist (or after 20 seconds, whichever comes first).

### Adding a data file

Put the file next to the others and add an entry to `manifest.json` with its `id`, MIME
`type`, `url` and byte `size`. Then read it in `main.js` by id.

### Saving

- Options (look, colors, weapon, world, and so on) are stored in one cookie, `kg_save`
  (`GameSave`). Cookies only work when the page is served over http(s).
- Inventory and gold live in `localStorage` (`knight-save`, or `knight-save-dev` in dev mode).
- The knight's armor and plume colors are mirrored to `localStorage` (`knight-look`) so the
  loading-screen knight can wear them.

### Finding your way around `main.js`

Everything shares one scope, so a variable declared in one section is often used in
others (`playerH`, `scene`, `ps1Mat`, `actions`, and `playerRig` are used almost everywhere).
`main.js` is divided into sections with headers like `/* ---------- title ---------- */`:

```
npm run map
```

prints each section with its line number.

## Formatting

`main.js` and `index.html` are formatted with Prettier.

```
npm install
npm run format
```
