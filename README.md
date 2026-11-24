# Product Content Collector

A Chrome extension (Manifest V3, side panel) for collecting product information from existing websites into an Excel workbook, ready for WooCommerce or any other shop import.

You import a workbook that holds product URLs. The extension opens each product in the current tab. You point at headings, paragraphs, lists and images on the page, type categories and other values, and export the same workbook with the configured columns filled in.

Everything runs locally. There is no server, no account and no paid API. Data is stored in the browser's IndexedDB.

---

## 1. Install (Chrome developer mode)

The ready-built extension is in **`dist/`**.

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `dist` folder of this project.
4. Pin the extension (puzzle icon → pin). Clicking its toolbar icon opens the side panel.

Requires Chrome 116 or newer.

After a rebuild, click the reload icon on the extension card in `chrome://extensions`.

### Building from source

```bash
npm install
npm run build        # outputs dist/
```

| Command | Purpose |
|---|---|
| `npm run build` | Production build into `dist/` |
| `npm test` | Unit tests (Vitest + jsdom + fake IndexedDB) |
| `npm run test:e2e` | Build, generate sample workbooks, run the Playwright end-to-end tests with the real extension loaded |
| `npm run fixtures` | Regenerate the sample workbooks |
| `node tests/fixtures/server.js` | Serve the sample product pages at http://localhost:4599 for manual testing |

---

## 2. Projects

**Projects** tab:

- **Create:** enter a name (e.g. "Client A – TVs") and click *Create*.
- **Open:** opens a project. The panel also reopens the last project automatically.
- **Progress:** each project shows a progress bar and product counts (completed, skipped).
- **Backup:** downloads one `.json` file containing everything: settings, fields, all product data and the original workbook.
- **Restore backup…:** loads such a file. If the original project still exists, the backup is restored as a separate copy named "(restored)", so nothing is overwritten.
- **Delete:** asks for confirmation first.

Each project has its own workbook, columns and field configuration, so different clients can use completely different templates.

## 3. Importing an Excel file

**Import** tab:

1. Choose an `.xlsx` file.
2. Pick the **worksheet**. The sheet with the most rows is preselected.
3. Pick the **Product URL column**. It is guessed from the header name ("url", "link") or from the cell contents.
4. Check the column list, the row preview and the count of valid and invalid URLs, then click **Import N products**.

Notes:

- The first row of the used range is treated as the header row. Every non-empty row below it becomes a product.
- Rows with a missing or invalid URL are still imported. You can type data for them or skip them. A `www.` address without `https://` is accepted.
- Importing again replaces the workbook but keeps collected data for rows that still exist (matched by row number).

## 4. Configuring columns, fields and images (Fields tab)

The Fields tab has four sections: **Columns**, **Fields**, **Image settings** and **Cell formatting**. Click a section's title to collapse it to a one-line summary (for example "7 fields: SKU, Product title, …"). Click it again to expand it. **Cell formatting** starts collapsed; the others start open. The panel remembers which sections you collapsed or expanded.

### Columns

- Rename any column. The new name is written to the header cell on export.
- Add new columns. They are appended after the existing ones on export.
- Change the product URL column.

### Fields

A *field* is one piece of information you collect. After the first import, suggested fields are created: SKU, Product title, Main categories, Subcategories, **Product intro**, Product description, Main image and Gallery images (plus Short description if the sheet has such a column). They are matched to headers that already exist, and each one can be changed, reordered or removed.

To add more fields:

- **+ Ready-made field…** adds one of the standard fields, already set up. This is how you add, for example, *Product intro* to a project created before it existed.
- **+ Add field** adds an empty field that you set up yourself.

*Product intro* is set up the same way as *Product description*: visual selection, HTML, multiple values, joined with a new line. It goes into a column named "Intro" / "Product intro" if the sheet has one; otherwise choose a column or create one with **+ New column…**.

For every field you set:

| Setting | Meaning |
|---|---|
| Name | Label shown in the Collect view |
| Capture method | **Manual input**, **Visual selection** (click on the page) or **Existing spreadsheet data** (shows the cell and can be overridden per product) |
| Content type | Manual: Text, Comma-separated list, HTML. Visual: Text, HTML, Image(s) |
| Destination column | An existing column, a new one (**+ New column…**), or none |
| Join multiple values with | Separator between this field's own values (`\n` = new line) |
| Multiple values | Several selections or values allowed (for example a gallery). Off = the next selection replaces the previous one |
| Required | A product cannot be marked completed while this field is empty |

### Several fields in one column (Cell formatting)

When several fields share a column (for example *Main categories* and *Subcategories* → `Categories`), nothing is overwritten. The values are combined in field order. For each column you choose how:

| Mode | Example result |
|---|---|
| Separated list | `Electronics, Television, Smart TVs` (with a configurable separator) |
| One path | `Electronics > Television > Smart TVs` |
| Path per value of last field | `Electronics > Television > Smart TVs, Electronics > Television > 4K TVs` (WooCommerce hierarchy style) |

Separators and the path separator can be changed. A live preview shows the cell value for the current product.

Category relationships are never guessed. The path is built only from what you typed, in field order.

## 5. Collecting product information (Collect tab)

- The top of the tab shows **Product N of M**, the status (*Pending / In progress / Completed / Skipped*), the URL, and a dropdown to jump to any product.
- **Open** loads the product in the current tab. **Previous / Next** save and navigate. **Skip** marks the product as skipped and moves on.
- **Mark completed / Complete & next** checks required fields first.
- If the tab shows a different page than the product URL, a warning appears. Captures still go to the current product.

### Main categories and subcategories

Type comma-separated values, for example `Electronics, Television, Entertainment`. Spaces are trimmed, and empty entries and duplicates are removed. The result is shown as chips; click × on a chip to remove that value. Every product has its own values, and changing one product never affects another.

### Visual selection

1. Click **Select on page** (or **Select image**) on a field.
2. Move the mouse over the page. The element under the cursor is outlined, with its tag and size.
3. Click to capture. The click never triggers the page's links or buttons.
   - Inline elements (span, strong, a…) select their surrounding heading, paragraph or list item. This avoids grabbing tiny fragments, and the deepest element under the cursor is used, so large parent containers are not picked by accident.
   - **↑** selects the parent element, **↓** goes back to the child, **Enter** captures the outlined element.
4. Keep clicking to add more (multi-value fields). Exit with **Esc**, the **Done** button on the page, or **Stop selecting** in the panel. Single-value fields stop on their own after one capture.
5. If the page navigates or reloads while you are selecting, selection mode starts again automatically once the page has loaded.

Each captured element appears in the panel, where you can:

- change the **output tag** (keep, remove wrapper, H1–H6, P, DIV, UL, OL, blockquote, strong, em)
- **reorder** (↑ ↓), **edit** (✎) or **remove** (✕) it. The editor shows the final HTML that will be exported, and exactly what you type is kept. No `<div>` or other wrapper is ever added; if you type several elements (for example only `<li>` items), they are exported as they are. Choose output tag `<ul>` if you want them wrapped in a list.
- **Clear** all selections of the field
- open **HTML preview**, which shows the combined result rendered or as source

### Turning selections into lists (description, intro and other HTML fields)

Three ways to get a `<ul>` (bullet) or `<ol>` (numbered) list without formatting it by hand:

1. **Clicks build one list.** Above the selections there's a **Clicks on the page** option: *Each click = separate item* (default), *Clicks build one bullet list (ul)* or *Clicks build one numbered list (ol)*. In a list mode, every element you click is added to the same list:
   - a paragraph, heading or div becomes one `<li>`
   - lines separated by `<br>` become one `<li>` each
   - a list's items are taken over as they are
   - a container (select it with ↑) has everything inside turned into list items

   Starting a new selection (or changing the option) starts a new list. The option is remembered per field and can also be set in the Fields tab.
2. **Tick and merge.** Tick the checkboxes of items you already captured, then click **Make bullet list** or **Make numbered list**. They are combined, in their current order, into one list, which takes the place of the first ticked item.
3. **One element → list.** Set an item's output tag to `<ul>` or `<ol>`. Everything inside it is split into list items (blocks, `<br>` lines, existing list items).

A list can be switched between `<ul>` and `<ol>` later with the output tag.

### Images

Image fields capture the image URL. Lazy-loading and responsive attributes are resolved: `srcset`, `data-srcset`, `<picture>` sources, `data-src`, `data-lazy-src`, `data-large_image` and similar. The largest real image is chosen; data-URI placeholders are ignored. If a thumbnail links to a full-size image file, the linked file is used. CSS background images can be captured too. The URL can be edited, or you can paste an image URL directly. Images are stored as URLs only and are not downloaded.

### Image file names (per product)

When the project has image fields, the Collect tab shows an **Image file name** box. It is empty by default, and the name comes from the column chosen in **Fields tab → Image settings** (SKU by default). Type a name to use your own for this product. The list below the box shows the resulting file names:

- main image: `<name>-main.jpg` (a second main image would be `<name>-main-2.jpg`)
- gallery images: `<name>-1.jpg`, `<name>-2.jpg`, `<name>-3.jpg` …

Whether an image field counts as *main* or *gallery* is set per field in the Fields tab (**Image type**).

### Spreadsheet output preview

At the bottom of the Collect tab you can see exactly what will be written to each column for the current product.

### Autosave

Every change is saved to IndexedDB automatically, about 0.35 s after you stop typing. Saving also happens immediately before navigating, when the panel is hidden, and before export or backup. The status at the top right shows *Saving… / Saved*. You can close Chrome at any time and continue later.

## 6. HTML cleaning

Captured HTML is cleaned in two steps.

**On the page:**
- Links and image URLs are made absolute.
- Lazy images are resolved.
- Buttons, forms, scripts, styles, iframes, SVGs, screen-reader-only text and hidden empty elements are removed.
- Tracking pixels (1×1 images) are removed.

**In the panel (DOMPurify):**
- Only basic semantic tags are kept: headings, p, lists, b/strong/i/em, links, tables, blockquote, img.
- Only `href`, `src`, `alt`, `title`, `colspan`, `rowspan` attributes are kept. All classes, inline styles, `data-*` attributes and event handlers are removed. `javascript:` links are blocked.
- `span` and `div` wrappers are removed (a div that only holds text becomes a `<p>`).

When you change a tag, child content and inline formatting are kept. For example, a DIV holding several paragraphs that is changed to P gets `<br>` line breaks instead of invalid nested blocks.

## 7. Exporting

**Export** tab → **Export .xlsx**. The file is downloaded as `<original name>-export.xlsx`.

- The original workbook is the base, so all other worksheets, rows and columns stay as they were.
- Configured columns are filled in. New columns are added at the end. Renamed headers are updated.
- **Empty values never erase existing cells.** For example, SKUs and other client data in the sheet are kept.
- *Existing spreadsheet data* fields are written only if you overrode them for a product.
- HTML is stored as a literal text cell. Even a value starting with `=` is never turned into a formula.
- Optional: **Only write data of completed products**.

### Images: new location, resizing, format and ZIP download

Image settings are in **Fields tab → Image settings**, so they can be set up before you start collecting. They are saved with the project and can be changed at any time before exporting. The Export tab shows a one-line summary of these settings and a **Change image settings** link.

| Setting | Effect |
|---|---|
| Name image files after column | Column whose value names the files (default: the SKU column). The file name can be changed per product in the Collect tab. Unsafe characters become `-`. |
| New image location | For example `https://www.jacmat.cc/some-images/`. When set, the spreadsheet gets `https://www.jacmat.cc/some-images/<file name>` instead of the original image URL. Empty = keep the original URLs. |
| Format | JPG, WebP, PNG, or *Keep original file* (downloaded as-is, no resizing). |
| Quality | JPG/WebP quality, 1–100 (default 85). |
| Max width / height | Images are scaled down to fit, keeping their proportions, and never made larger (0 = no limit). |
| Lowercase file names | `TV001-main.jpg` → `tv001-main.jpg`. |
| Download images as ZIP on export | Optional. When on, **Export** downloads one ZIP file instead of the .xlsx. |

The ZIP contains:

- `<workbook>-export.xlsx`: the workbook, with the new image URLs.
- `images/`: every image, downloaded from the original site, then resized and converted.
- `image-report.csv`: one line per image with row, file name, new URL, original URL, status, error, size in pixels, and original and new file size.

Example: the original image `https://www.denon.com/…/AVR-X2800H_front.png?sw=3000` on the row with SKU `AVR-X2800H`, with location `https://www.jacmat.cc/some-images/`, JPG and max 1200 px, becomes `images/AVR-X2800H-main.jpg` in the ZIP, and `https://www.jacmat.cc/some-images/AVR-X2800H-main.jpg` in the spreadsheet.

Notes:

- Images that cannot be downloaded are listed in the Export tab and in the report. Their new URL is still written to the spreadsheet, so you can add the file yourself.
- Transparent areas become white in JPG files.
- If two products would produce the same file name for different pictures, Image settings warns you, and the later file gets `-row<N>` added (in both the ZIP and the spreadsheet). The same picture used twice keeps one file.
- Images are downloaded 4 at a time; the export button shows the progress.

---

## 8. Project structure

```
manifest.json               MV3 manifest (copied into dist/)
index.html                  side panel page
vite.config.js              side panel build (+ test config)
vite.content.config.js      content script → single IIFE file dist/content.js
vite.worker.config.js       service worker → dist/service-worker.js
src/background/service-worker.js   opens the side panel on toolbar click
src/content/content.js      message handling, injected on demand only
src/content/selector.js     hover highlight, click capture, keyboard navigation
src/content/extractor.js    element/image extraction, lazy image resolution
src/services/excelService.js       SheetJS import / export
src/services/storageService.js     IndexedDB projects, products, workbooks, backups
src/services/htmlService.js        DOMPurify cleaning, tag changes, combining
src/services/fieldService.js       field values, category parsing, column combination, image file naming
src/services/imageService.js       image download, resize/convert (canvas), ZIP writer, image report
src/services/navigationService.js  tab navigation, content script injection
src/sidepanel/                     React UI (App + components + styles)
tests/unit/                 Vitest unit tests
tests/e2e/                  Playwright tests (real extension, local fixture site)
tests/fixtures/             sample product pages, fixture server, workbook generator
samples/                    sample workbooks (URLs point to the fixture server)
scripts/make-icons.js       generates the PNG icons
```

The content script is **not** registered for every website. It is injected only into the active tab when you start a selection, so normal browsing is unaffected.

## 9. Tests performed

**Unit tests:** `npm test`, 84 tests, all passing.

- **Excel:** import, worksheet listing and selection, header reading (blank and duplicate headers), URL column detection by name and by content, URL validation.
- **Export:** new and renamed columns, other sheets preserved, existing values preserved, empty values not erasing cells, `=`-prefixed text stays a string, the exported file can be re-imported, base64 round trip.
- **Fields:** comma list parsing, the three category formatting modes, custom separators, multiple fields in one column, source field overrides, image URL columns (no alt/title columns), required fields, per-product isolation, suggested fields only mapping to existing headers.
- **HTML:** sanitisation (scripts, handlers, styles, classes, data attributes, iframes, forms, `javascript:` links), wrapper unwrapping, capture cleaning, tag changes (H1→H3, H2→H3, DIV→P, SPAN→P, DIV with paragraphs→P, list conversions), combining, ordering, preview formatting.
- **Storage (fake IndexedDB):** project create/list/delete with cascade, independence between projects and between products, backup/restore round trip, persistence after the database is closed and reopened, autosave debounce/flush/error handling.
- **Extractor:** srcset parsing, lazy-image resolution, linked full-size images, absolute links, junk removal.
- **Images:** file names (SKU default, per-product override, other column, lowercase, sanitising), `-main` / `-1, -2` suffixes, explicit image types, new-location URLs written to the spreadsheet, original URLs kept when no location is set, unique names across products, extension handling, fit-to-size without upscaling, CRC32, a ZIP that Python's `zipfile` verifies and extracts, CSV report.
- **No `<div>` wrapper:** captured fragments of `<li>` items and edited HTML are exported exactly as typed.

**End-to-end tests:** `npm run test:e2e`, 6 tests, all passing. Chromium is launched with `dist/` loaded unpacked, and a local fixture shop is used.

The main workflow test covers all 20 steps of the specification:

- create project
- import the workbook, switch worksheets, pick the URL column
- configure fields (image fields have no alt/title column options), rename a column, choose the category path format
- open product 1 in the same tab and enter main categories and subcategories
- select a heading through an inline span, a div through an inline link (verifying the link and its click handler did **not** fire), a nested list using ↑ and Enter, more headings and a paragraph
- change H2 → H3 and reorder the selections
- check the rendered and source HTML preview, including that classes, styles, scripts and screen-reader text are gone
- capture the main image (lazy `data-srcset`) and two gallery images (thumbnail → linked full size)
- complete the product and go to the next one, checking it starts empty
- enter different categories for product 2
- reload the product page while selecting and check that selection re-arms automatically
- go back and check product 1 is intact
- process product 3 (CSS background image; a missing required field blocks completion; SKU override) and skip it
- open the row with an invalid URL and see the error
- **close and reopen the panel** and check that all data is restored
- export, then **reopen the exported .xlsx** and check every cell: other sheet kept, headers, categories, HTML, image URLs, untouched SKU/stock/supplier values, HTML stored as a string
- backup, delete with confirmation, restore, and check the restored data

Other end-to-end tests:

- **Lists:** checks that "clicks build one bullet list" turns four clicks (paragraphs, a div, and a `<br>`-separated block) into one `<ul>`, and that a numbered list started from a click plus a whole container (↑) builds one `<ol>`. Then ticks three separate items and merges them into a numbered list, switches it to `<ul>` and checks the preview and the cell output. Also checks the option works on Product intro and is remembered in the Fields tab.

- **Image export:** edits a description item to bare `<li>` items and checks there is no `<div>` in the panel or the export. Captures a main image (SVG) and gallery images, including a pasted 2400×1600 transparent PNG with `?sw=3000` and a broken URL. Sets a custom file name for product 2, a new image location, JPG, max 600 px and lowercase names. Then:
  - collapses and expands the Fields tab sections, checking the summaries and that the collapsed state is kept when switching tabs; Cell formatting starts collapsed
  - checks that the image settings are no longer on the Export tab
  - exports a plain .xlsx
  - exports the ZIP, unzips it and checks the file list
  - decodes the JPGs (2400×1600 → 600×400; 400×300 not upscaled)
  - checks the report and the 404 failure message
  - checks that the workbook in the ZIP has the new URLs

- A second client structure: different headers, URL column detected from content, a separate subcategory column, a custom manual field in a new column, exported and verified.
- A restricted page (`chrome://version`) shows a clear error.
- The extension loads, the side panel path is set, and the toolbar icon is configured to open the panel.

Two bugs found by these tests were fixed:

- Auto-ending selection on a single-value field could cancel the next field's selection.
- The source view did not indent nested lists.

## 10. Known limitations and items to verify manually

- **Opening the real side panel** (clicking the toolbar icon) cannot be automated with Playwright. The tests run the identical panel page in a tab and check that the panel behaviour and path are configured. Please check once by hand that the panel opens and stays open while you navigate.
- **Excel preservation** depends on SheetJS Community Edition. Cell values, formulas, sheets, merged cells and column widths are kept. Some rich formatting (fonts, colours, conditional formatting), charts, images, comments and data validation in the original workbook may be lost or simplified on export. Keep the original file. `.xls` / `.xlsm` can be read but are always exported as `.xlsx`.
- The header row is always the first row of the used range of the worksheet.
- Excel cells hold at most 32,767 characters. The panel warns when a combined value exceeds this.
- Content inside **iframes** and **closed shadow DOM** cannot be selected. Elements in open shadow roots are reached through the event path.
- Chrome blocks extensions on `chrome://` pages and the Chrome Web Store. `file://` pages need "Allow access to file URLs" enabled on the extension.
- Hidden elements are removed only when they contain no text, so that collapsed tab or accordion content you select on purpose is not lost.
- Product data is matched to spreadsheet rows by row number. Do not insert or delete rows in the source workbook mid-project; re-import if you must.
- Image download fetches each image once per export; sites that block automated image requests (hotlink protection, login) show up as failures in the report. Very large exports (thousands of images) are built in memory, which can take a while.
- Animated GIFs become a single still frame when converted. Use *Keep original file* if you need the animation.
- Description items saved *before* this update that already contain a `<div>` around list items keep it until you edit them once (✎), or change the output tag to *remove wrapper* or `<ul>`.
- If the side panel is closed while you are in selection mode, selection mode stays active on the page until you press Esc or click Done.
