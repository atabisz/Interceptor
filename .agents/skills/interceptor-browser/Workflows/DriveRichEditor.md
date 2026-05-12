# DriveRichEditor

You are driving a rich editor: Canva, Google Docs, Google Slides, Sheets, Figma, a design tool, or any canvas-rendered surface where DOM refs are not enough. Standard `act`/`click`/`type` won't reach the content because the editor renders its own canvas and intercepts events.

## First step — always

```bash
interceptor scene profile
```

This tells you which scene model the page exposes. **Do not guess** how to interact before running this. If the profile is empty or unsupported, the page doesn't have scene support — fall back to DOM reads or `eval --main` recipes.

## Workflow by editor

### Google Docs
- **Strongest structured target.** Scene exposes paragraphs, lines, tables.
- Insert text: `interceptor scene insert "..."`
- Navigate selection: `interceptor scene cursor-to <scene-ref>`
- Read current content: `interceptor scene text <scene-ref>`
- **Table cells:** see "Canvas-rendered editor input" below — `scene insert` doesn't handle table cell positioning; you need dispatched events.

### Google Slides
- Navigation + selection work via scene.
- `interceptor scene slide list` / `slide current` / `slide goto 3`
- Text insertion and table growth often require `eval --main` with dispatched events.
- Read notes: `interceptor scene notes`
- Render thumbnail: `interceptor scene render`

### Canva
- Partial scene support — confirm with `scene profile --verbose`.
- Prefer accessible menus + toolbar (DOM refs) before scene clicks.
- Layer manipulation often needs dispatched events (see below).

### Figma / design tools
- DOM refs cover the side panels.
- Canvas interactions (layer selection, zoom, pan) require dispatched `MouseEvent` / `WheelEvent` with the `__interceptor_trust` marker (see below).

## Canvas-rendered editor input (Docs / Slides / Sheets)

When `scene insert` is not enough — cell-precise writes, paragraph style changes, keyboard shortcuts to surfaces with no scene equivalent — use the pre-load trust override path. Pattern (run via `interceptor eval --main`):

1. **Caret positioning:** dispatch `mousedown`/`mouseup`/`click` on `.kix-canvas-tile-content` with `event.__interceptor_trust = true` and target pixel — moves the canvas-side caret. Verify via `iwin.getSelection().anchorNode` parent chain for the target `<TD>`.
2. **Text entry:** construct `KeyboardEvent` from the iframe's OWN window (`new iwin.KeyboardEvent(...)`), dispatch on the iframe document (`idoc.dispatchEvent(ev)`).
3. **Printable keys** (letters, digits, symbols, Space, Enter): full `keydown` → `keypress` → `keyup`.
4. **Navigation/control keys** (Tab, Arrow*, Home, End, Escape, Backspace, Delete, modifiers): `keydown` → `keyup` ONLY — never `keypress`. Dispatching `keypress` on a navigation key inserts its ASCII character (Tab=`\t`, ArrowUp=`&`, ArrowLeft=`%`, ArrowRight=`'`).

**Trap:** in Docs tables, **Tab past the last cell of the last row creates a new row.** Fill row N with N writes and N−1 Tabs; exit the table with `ArrowDown`.

Full mechanic and worked recipes: [`../references/rich-editors.md`](../references/rich-editors.md).

## Canvas camera apps (WebGL viewers)

Same `userActivation` override + `__interceptor_trust` pattern drives WebGL camera apps. Pan via dispatched `MouseEvent` (mousedown → mousemove sweep → mouseup) on the canvas; zoom via `WheelEvent { deltaY: ±120 }` or `Minus`/`Equal` keystrokes. Anchor DOM overlays to lat/lng with a Web Mercator projection helper (`pixels per deg lng = 256 * 2^zoom / 360`). Refresh on every URL change.

Full mechanic: [`../references/rich-editors.md`](../references/rich-editors.md).

## Native export capture (any client-side-rendering app)

Modern editor webapps render exports client-side: WebGL/Canvas2D → `Blob` → `URL.createObjectURL` → `<a download>.click()`. To capture the resulting bytes without a Save dialog or clipboard hit:

1. **Patch `URL.createObjectURL`** in MAIN world to record every blob the app stages.
2. **Patch `HTMLAnchorElement.prototype.click`** to swallow programmatic auto-downloads with `download` attribute or `blob:` href.
3. **`fetch(blobUrl).then(r => r.arrayBuffer())`** before the app revokes the URL.

End-to-end recipe (frame enumeration, per-frame export, blob extraction loop): [`../references/rich-editors.md`](../references/rich-editors.md).

## Verify

After driving an editor, verify the change landed by reading the actual rendered text — not the editor's own UI state.

```bash
interceptor scene text <scene-ref>          # Re-read what's in the surface
interceptor scene render                    # Thumbnail for visual confirm
```

Re-read after every dispatched-event sequence. The selection/caret state can shift in ways the dispatch sequence didn't predict.
