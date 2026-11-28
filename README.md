# Product Content Collector

> **Note:** This is an initial version, built with AI-generated code (Claude) for personal use. It has not been hardened or reviewed for production use.

A Chrome extension (Manifest V3, side panel) for collecting product information from existing websites into an Excel workbook, ready for WooCommerce or any other shop import.

You import a workbook that holds product URLs. The extension opens each product in the current tab. You point at headings, paragraphs, lists and images on the page, type categories and other values, and export the same workbook with your columns filled in.

Everything runs locally: no server, no account, no paid API. Data is stored in the browser (IndexedDB).

---

## 1. Install

The ready-built extension is in **`dist/`**. Requires Chrome 116 or newer.

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `dist` folder of this project.
4. Pin the extension (puzzle icon → pin). Clicking its icon opens the side panel.

After an update or rebuild, click the reload icon on the extension's card in `chrome://extensions`.

## 2. Quick start

1. **Projects** tab: create a project.
2. **Import** tab: choose the workbook, the worksheet and the column with product URLs.
3. **Fields** tab: check which information you collect and which column each piece goes to. Set up image naming if you export images.
4. **Collect** tab: open each product, select content on the page, type categories, then **Complete & next**.
5. **Export** tab: download the filled-in workbook (optionally as a ZIP with all images).

Everything is saved automatically, so you can close Chrome and continue later.

## 3. Projects

- **Create:** enter a name (e.g. "Client A – TVs") and click *Create*.
- **Open:** the panel also reopens the last project automatically.
- **Progress:** each project shows a progress bar and how many products are completed or skipped.
- **Backup:** downloads one `.json` file with everything: settings, fields, product data and the original workbook.
- **Restore backup…:** loads such a file. If the original project still exists, the backup becomes a separate copy named "(restored)"; nothing is overwritten.
- **Delete:** asks for confirmation first.

Each project has its own workbook and settings, so different clients can use completely different templates.

## 4. Importing an Excel file

1. Choose an `.xlsx` file.
2. Pick the **worksheet**. The one with the most rows is preselected.
3. Pick the **Product URL column**. It is guessed from the header ("url", "link") or from the cell contents.
4. Check the preview and the count of valid URLs, then click **Import N products**.

- The first row is the header row. Every non-empty row below it becomes a product.
- Rows without a valid URL are still imported; you can type their data or skip them. A `www.` address without `https://` is accepted.
- **Importing again** replaces the workbook but keeps your work for rows that still exist (matched by row number): collected data, status, custom image file names, renamed columns and added columns.

## 5. Setting up (Fields tab)

The Fields tab has four sections. Click a section's title to collapse it to a one-line summary; the panel remembers this. **Cell formatting** starts collapsed.

### Columns

- **Rename** a column: the new name is written to the header cell on export.
- **Add** a column: it is added after the existing ones on export.
- **Product URL column:** change which column holds the product links.
- **Product identifier:** the column that names each product in the Collect tab's product list (e.g. SKU or name). *Automatic* uses a SKU-like column, otherwise a name/title column. When a product's cell is empty, its URL is shown.

### Fields

A *field* is one piece of information you collect. On the first import these are created for you and matched to existing columns: SKU, Product title, Main categories, Subcategories, Product intro, Product description, Main image and Gallery images (plus Short description if the sheet has that column).

- **+ Ready-made field…** adds one of these standard fields, already set up.
- **+ Add field** adds an empty field to set up yourself.

| Setting | Meaning |
|---|---|
| Capture method | **Manual input**, **Visual selection** (click on the page) or **Existing spreadsheet data** (shows the cell; can be overridden per product) |
| Content type | Manual: Text, Comma-separated list or HTML. Visual: Text, HTML or Image(s) |
| Destination column | An existing column, a new one (**+ New column…**), or none (not exported) |
| Image type | For image fields: *Main image* (`name-main`) or *Gallery* (`name-1`, `name-2` …) |
| Clicks on the page | For HTML fields: each click a separate item, or all clicks build one list (see [Lists](#lists)) |
| Join multiple values with | Separator between this field's own values (`\n` = new line) |
| Multiple values | Several selections allowed. Off = a new selection replaces the old one |
| Required | A product cannot be completed while this field is empty |

### Image settings

These apply to every image field in the project. Set them up before collecting; they can be changed any time before exporting.

| Setting | Effect |
|---|---|
| Name image files after column | Column whose value names the files (default: the SKU column). Can be changed per product in the Collect tab. |
| New image location | For example `https://www.jacmat.cc/some-images/`. The spreadsheet then gets `https://www.jacmat.cc/some-images/<file name>` instead of the original image URL. Empty = keep the original URLs. |
| Format | JPG, WebP, PNG, or *Keep original file* (no resizing). |
| Quality | JPG/WebP quality, 1–100 (default 85). |
| Max width / height | Images are scaled down to fit, never enlarged (0 = no limit). |
| Lowercase file names | `TV001-main.jpg` → `tv001-main.jpg`. |
| Download images as ZIP on export | When on, **Export** downloads a ZIP with the workbook and all images (see [Exporting](#8-exporting)). |

The section shows example file names, and warns when two products would give different images the same name.

### Cell formatting (several fields in one column)

When several fields write to the same column (for example *Main categories* and *Subcategories* → `Categories`), nothing is overwritten. Values are combined in field order, in one of three ways:

| Mode | Example result |
|---|---|
| Separated list | `Electronics, Television, Smart TVs` |
| One path | `Electronics > Television > Smart TVs` |
| Path per value of last field | `Electronics > Television > Smart TVs, Electronics > Television > 4K TVs` (WooCommerce hierarchy style) |

Both separators can be changed, and a preview shows the result for the current product. Category relationships are never guessed: the path is built only from what you typed.

## 6. Collecting (Collect tab)

### Moving between products

- The top shows **Product N of M**, its status (*Pending / In progress / Completed / Skipped*), its URL, and a list to jump to any product.
- **Open** loads the product in the current tab. **Previous / Next** save and move. **Skip** marks the product skipped and moves on.
- **Mark completed / Complete & next** checks required fields first.
- If the tab shows a different page than the product's URL, a warning appears. What you capture still goes to the current product.

### Copying from a similar product

For variants that are almost the same (another colour, small text differences), open the **Copy from a completed product** section below the product navigation. It is collapsed by default; click its title to open it.

1. Choose a completed product. The list shows the same names as the product list.
2. Tick **Include images** if the photos are the same too.
3. Click **Copy**, then change only what differs.

- Manual and visual-selection fields are copied. Fields set to *Existing spreadsheet data* (e.g. SKU) keep this product's own value, and the image file name is not copied.
- Copied fields replace what the current product had. If it already has data in those fields, you are asked to confirm first.
- The copy is independent: changing it never affects the product you copied from.

### Categories and other typed values

Type comma-separated values, for example `Electronics, Television, Entertainment`. Spaces, empty entries and duplicates are removed. Each value is shown as a chip; click × to remove it. Every product has its own values.

### Selecting content on the page

1. Click **Select on page** (or **Select image**) on a field.
2. Move the mouse over the page. The element under the cursor is outlined, with its tag and size. Small inline parts (bold text, links) select their whole paragraph, heading or list item.
3. Click to capture. The click never triggers the page's links or buttons.
   - **↑** selects the surrounding element (e.g. the whole list instead of one item), **↓** goes back, **Enter** captures.
4. Keep clicking to add more. Stop with **Esc**, the **Done** button on the page, or **Stop selecting** in the panel. Single-value fields stop after one capture.

If the page reloads while you are selecting, selection starts again once it has loaded.

Each captured element appears in the panel. You can:

- change its **output tag**: keep, remove wrapper, H1–H6, P, DIV, UL, OL, blockquote, strong, em
- **reorder** (↑ ↓), **edit** (✎) or **remove** (✕) it. The editor shows the exact HTML that will be exported, and what you type is kept as is (no `<div>` is added)
- **Clear** all selections of the field
- open the **HTML preview**, rendered or as source

### Lists

Three ways to get a `<ul>` (bullets) or `<ol>` (numbers) without formatting it by hand:

1. **Clicks build one list.** Set **Clicks on the page** to *Clicks build one bullet list* or *…numbered list*. Every element you click is added to the same list: a paragraph or heading becomes one item, lines separated by `<br>` become one item each, and an existing list's items are copied. Select a container with ↑ to turn everything inside it into items. Starting a new selection starts a new list.
2. **Tick and merge.** Tick items you already captured and click **Make bullet list** or **Make numbered list**. They become one list, in the place of the first ticked item.
3. **One element → list.** Set an item's output tag to `<ul>` or `<ol>`; its content is split into list items.

A list can be switched between `<ul>` and `<ol>` later with the output tag.

### Images

The extension finds the real, largest image even on pages that load images lazily (`srcset`, `data-src`, `<picture>` and similar), and ignores placeholders. If a thumbnail links to a full-size file, that file is used. CSS background images work too. You can also edit the URL or paste one.

When the project has image fields, an **Image file name** box shows the file names for this product. Leave it empty to use the name from Image settings, or type your own:

- main image: `<name>-main.jpg` (a second one: `<name>-main-2.jpg`)
- gallery images: `<name>-1.jpg`, `<name>-2.jpg` …

### Output preview and autosave

The bottom of the tab shows exactly what will be written to each column for this product.

Every change is saved automatically, about a third of a second after you stop typing, and immediately before moving to another product, exporting or making a backup. The top right shows *Saving… / Saved*.

## 7. How captured HTML is cleaned

**On the page:** links and image URLs are made absolute; lazy images are resolved; buttons, forms, scripts, styles, iframes, SVGs, screen-reader-only text, hidden empty elements and tiny tracking images are removed.

**In the panel:**
- Only basic tags are kept: headings, paragraphs, lists, bold/italic, links, tables, blockquote and images.
- Only `href`, `src`, `alt`, `title`, `colspan` and `rowspan` attributes are kept. Classes, styles, `data-*` attributes and event handlers are removed; `javascript:` links are blocked.
- `span` and `div` wrappers are removed; a div with only text becomes a `<p>`.

Changing a tag keeps the content and formatting inside. For example, a DIV with several paragraphs changed to P gets `<br>` line breaks instead of invalid nested blocks.

## 8. Exporting

**Export** tab → **Export .xlsx** downloads `<original name>-export.xlsx`.

- The original workbook is the base: all other worksheets, rows and columns stay as they were.
- Your columns are filled in, new columns are added at the end, renamed headers are updated.
- **Empty values never erase existing cells**, so SKUs and other data already in the sheet are kept.
- *Existing spreadsheet data* fields are only written if you changed them for a product.
- HTML is stored as plain text. A value starting with `=` never becomes a formula.
- Optional: **Only write data of completed products**.

With **Download images as ZIP** switched on (Fields → Image settings), the button becomes **Export .zip**. The ZIP contains:

- `<workbook>-export.xlsx`: the workbook, with the new image URLs
- `images/`: every image, downloaded from the original site, resized and converted
- `image-report.csv`: one line per image with its row, file name, new and original URL, status, any error, and sizes

Example: `https://www.denon.com/…/AVR-X2800H_front.png?sw=3000` on the row with SKU `AVR-X2800H`, with location `https://www.jacmat.cc/some-images/`, JPG and max 1200 px, becomes `images/AVR-X2800H-main.jpg` in the ZIP and `https://www.jacmat.cc/some-images/AVR-X2800H-main.jpg` in the spreadsheet.

- Images that cannot be downloaded are listed in the Export tab and the report. Their new URL is still written, so you can add the file yourself.
- Transparent areas become white in JPG files.
- If two products would give different images the same file name, the later one gets `-row<N>` added. The same image used twice keeps one file.

## 9. Known limitations

- **Excel formatting:** values, formulas, sheets, merged cells and column widths are kept. Some rich formatting (fonts, colours, conditional formatting), charts, images, comments and data validation may be lost or simplified. Keep the original file. `.xls` / `.xlsm` can be read but are exported as `.xlsx`.
- **Rows are matched by row number.** Do not insert or delete rows in the source workbook mid-project; re-import if you must.
- The header row is always the first used row of the worksheet.
- Excel cells hold at most 32,767 characters. The panel warns when a value is longer.
- Content inside **iframes** and **closed shadow DOM** cannot be selected.
- Chrome does not allow extensions on `chrome://` pages or the Chrome Web Store. For `file://` pages, enable "Allow access to file URLs" on the extension.
- Hidden elements are removed only when they contain no text, so collapsed tab or accordion content you select on purpose is kept.
- Some sites block image downloads (hotlink protection, login); those images show up as failures in the report. Very large exports are built in memory and can take a while.
- Animated GIFs become a still image when converted. Use *Keep original file* to keep the animation.
- If the side panel is closed during selection, selection stays active on the page until you press Esc or click Done.
- Opening the real side panel from the toolbar cannot be tested automatically; check once by hand that it opens and stays open while you navigate.

---

## 10. For developers

### Commands

```bash
npm install
npm run build        # builds the extension into dist/
```

| Command | Purpose |
|---|---|
| `npm run build` | Build into `dist/` |
| `npm test` | Unit tests (Vitest, jsdom, fake IndexedDB) |
| `npm run test:e2e` | Build, generate sample files, and run the Playwright tests with the real extension loaded |
| `npm run fixtures` | Regenerate the sample workbooks and images |
| `node tests/fixtures/server.js` | Serve the sample product pages at http://localhost:4599 for manual testing |

### How it fits together

There are three parts, which talk to each other with Chrome messages:

- **Side panel** (`src/sidepanel/`): the React interface. `App.jsx` holds the state and actions; each tab is a component in `components/`.
- **Content script** (`src/content/`): injected into the product page only while you select, so normal browsing is never affected. It highlights elements, blocks clicks and sends the captured HTML or image URL to the panel.
- **Services** (`src/services/`): plain functions without UI, used by the panel.

```
manifest.json                       MV3 manifest (copied into dist/)
index.html                          side panel page
vite.config.js                      side panel build (+ test config)
vite.content.config.js              content script → dist/content.js
vite.worker.config.js               service worker → dist/service-worker.js

src/background/service-worker.js    opens the side panel on toolbar click
src/content/content.js              message handling
src/content/selector.js             hover highlight, click blocking, keyboard navigation
src/content/extractor.js            element and image extraction, lazy image resolution

src/services/excelService.js        reading the workbook, re-import merging, export
src/services/storageService.js      IndexedDB: projects, products, workbooks, backups
src/services/htmlService.js         HTML cleaning (DOMPurify), tag changes, lists
src/services/fieldService.js        field values, column combining, image file names
src/services/imageService.js        image download, resize/convert, ZIP writer, report
src/services/navigationService.js   tab navigation, content script injection

src/sidepanel/App.jsx               state, autosave, capture handling, navigation
src/sidepanel/components/           one file per tab, plus:
  FieldCard.jsx                     settings of one field (Fields tab)
  CellFormatting.jsx                Cell formatting section (Fields tab)
  ImageSettings.jsx                 Image settings section (Fields tab)
  FieldEditors.jsx                  field editors in the Collect tab
  common.jsx                        shared small components and helpers

tests/unit/                         Vitest unit tests
tests/e2e/                          Playwright tests (real extension, local fixture site)
tests/fixtures/                     sample product pages, fixture server, file generators
samples/                            sample workbooks (URLs point to the fixture server)
scripts/make-icons.js               generates the PNG icons
```

### Tests

- **Unit tests** (`npm test`, 94 tests): Excel import, re-import and export, fields and category formatting, copying between products, HTML cleaning and lists, IndexedDB storage and backups, image extraction, file naming, resizing and the ZIP writer.
- **End-to-end tests** (`npm run test:e2e`, 7 tests): run the real extension against a local test shop and cover the whole workflow (import → configure → collect → export → backup/restore), lists, copying from a completed product, and image export (resize, convert, ZIP).
