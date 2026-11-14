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

| File                        | What it is                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `index.html`                | The page, all of the CSS, the loading screen, and the loader.                      |
| `js/*.js`                   | The game, in 14 numbered parts. `js/parts.json` lists them in load order.          |
| `manifest.json`             | List of the data files: `{ id, type, url, size }`. `size` weights the loading bar. |
| `*-data.json`, `*-data.txt` | Models, animations, songs and sound effects as text (about 50 MB in total).        |
| `scripts/codemap.js`        | Prints a table of contents for the game scripts (`npm run map`).                   |

### Loading

1. `index.html` shows the loading screen and fetches `manifest.json`
   (it tries `assets/manifest.json` first, then the root).
2. Every file in the manifest is downloaded and added to the page as
   `<script type="{type}" id="{id}">…</script>` with the file's text inside.
   The game reads each one back with `document.getElementById("<id>").textContent`.
3. The loader downloads every file in `js/parts.json`, then runs them one after another
   in a single task (as inline scripts named `js/<file>` so they show up properly in
   DevTools). If one of them throws, the rest are not run.
4. The game sets `window.__knightReady()` (end of `js/14-edit.js`) and the loading screen
   polls it, lifting itself once the knight and the golem exist (or after 20 seconds,
   whichever comes first).

### The scripts share one scope

The parts are ordinary scripts, not modules. Top-level `let`, `const` and `function`
declarations in one part are visible in all of the others, exactly as they were when the
game was one file. Two rules follow from that:

- **Order matters while loading.** Code that runs as a part loads can only use things that
  are declared in the same part or an earlier one. Code inside a function can use anything,
  because it runs later. (Example: `js/08-input-explore.js` hooks up the menu button with
  `() => leaveMode()` instead of `leaveMode`, because `leaveMode` is declared in part 9.)
- **Names are global.** Don't give a top-level function or variable the name of a browser
  global (`name`, `status`, `scrollBy`, `stop`, and so on).

### Adding a part

Create `js/NN-name.js` and add its filename to `js/parts.json` at the position where it
should load. Nothing else needs to change.

### Adding a data file

Put the file next to the others and add an entry to `manifest.json` with its `id`, MIME
`type`, `url` and byte `size`. Then read it in the game by id.

### Saving

- Options (look, colors, weapon, world, and so on) are stored in one cookie, `kg_save`
  (`GameSave`). Cookies only work when the page is served over http(s).
- Inventory and gold live in `localStorage` (`knight-save`, or `knight-save-dev` in dev mode).
- The knight's armor and plume colors are mirrored to `localStorage` (`knight-look`) so the
  loading-screen knight can wear them.

### Finding your way around

```
npm run map
```

prints every file with its section headers (`/* ---------- title ---------- */`) and line
numbers.

## Formatting

`js/*.js` and `index.html` are formatted with Prettier.

```
npm install
npm run format
```
