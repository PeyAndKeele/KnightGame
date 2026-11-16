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
| `scripts/bake-gltf.py`      | Bakes a Blockbench glTF into the `*-data.json` model format (see below).           |

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

## Dungeons

Each dungeon is one entry in `DUNGEONS` (top of `js/09-dungeon-battle.js`) and all of them run through the same
`enterDungeon(id)` code. The fields are documented above the table.

### Adding a dungeon

1. Bake its model(s): `python3 scripts/bake-gltf.py model.gltf name-data.json --center X Y Z`
   (`--center` is the point of the model that lands under the knight's circle; `--skip NAME` drops helper boxes).
2. Add the file(s) to `manifest.json`.
3. Add an entry to `DUNGEONS`, an `initX()` that loads it (copy `initTomb`), and call it next to `initTomb` in `js/02-knight.js`.
4. Point a map spot in `js/11-map.js` at it with `run: () => enterDungeon("id")`.

## Status effects

Bleed and haste are the two status effects, and every one lives in the `STATUS` table in
`js/09-dungeon-battle.js` (search for `STATUS EFFECTS`). Adding another is two steps: add an
entry to `STATUS` (the comment under the table lists every field), then call
`giveStatus(target, "id")` where it should land. Use the helpers (`giveStatus`, `hasStatus`,
`statusLeft`, `clearStatus`, `clearStatuses`) rather than reading the data directly.

## Wave change

When the last enemy of a wave falls, `nextWave()` runs a short timeline (the `WAVE_*` constants
above it): the corpses fade out, the arena stays empty for a second, then the next wave fades in.
Every enemy type fades through `prepEnemyFade` / `startEnemyFade` (see `ENEMY FADES`).

## Adding a weapon

Weapons are items; the inventory, the save, the chest loot, the options menu and the battle code
all know them by id.

1. **Model.** Export the weapon from Blockbench as glTF and bake it:
   `python3 scripts/bake-weapon.py halberd.gltf halberd-data.json` (add `--plume-node "TEXT"` when a
   node whose name starts with TEXT is a gem that should take the plume colour and glow). Add the file
   to `manifest.json` (`id`, `type`, `url`, `size`).
2. **Heavy (two-handed, the `axe` slot).** Add a row to `AXE_STYLE_MODELS` in `js/04-weapons.js`. The model
   rides in the axe's group, so it gets the axe's mount, animations, swoosh and RENDER for free.
   **Light (one-handed, the `sword` slot).** Follow the hatchet-like weapons (`initHatchetLike`) or the Morning Star.
3. **Item.** In `js/13-inventory-save.js`: add the id to `ALL_IDS`, a pixel icon to `WEAPON_ICONS`, and a row to
   the WEAPONS tab of `INV_TABS` (`cls`, `rarity`, `w` + `ss`/`as`, `stats`, `desc`; light weapons also a `grp`).
   Mention it in the effects page (`fxData`, the `by` lists) if it applies RENDER, bleed and so on.
4. **Loot and menus.** A `LOOT` entry in `js/05-chest-save-loot.js`; the OPTIONS > KNIGHT style rows and the help text in `js/14-edit.js`.
5. **Special.** Passive and active specials are in `js/09-dungeon-battle.js` (`WEAPON SPECIALS`): add a constant, an
   `isMyWeapon()` check, and call it where the carve or RENDER lands (see `sweepHit` for the halberd and reaver).

`?dev` then `dbg.give('halberd')` in the console hands you the weapon to try.

### Inventory sections

Light weapons are listed under BLADES, CUTTERS and MACES. A row's `grp` picks its section and `INV_GROUPS`
(`js/13-inventory-save.js`) sets the order; rows with no `grp` (the heavy weapons) are listed without headings.
