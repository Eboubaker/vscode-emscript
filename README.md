# Macrorify EMScript — VSCode Extension

Minimal VSCode language support for [Macrorify](https://www.kok-emm.com)'s
**EMScript** language: syntax highlighting + autocomplete for built-in
functions and classes, sourced directly from the
[online reference sheet](https://www.kok-emm.com/docs/reference/region).

## Features

- TextMate grammar for `.emscript` files (keywords, strings, numbers, comments, built-in classes).
- Snippets for common patterns (`var`, `fun`, `class`, `if`, `for`, `while`, `findclick`...).
- Top-level autocomplete: free functions (`click`, `swipe`, `wait`) and class names (`Region`, `Point`, `Con`, `Str`, ...).
- Member autocomplete after `.` — type `Region.` to see static methods, `someVar.` for instance methods.
- An extractor script (`scripts/extract-api.js`) that scrapes the reference docs and rebuilds `data/api.json` and the grammar's class/function lists.

## Prerequisites

- Visual Studio Code 1.80+
- Node.js 18+ (only required to **refresh** the API catalog; the repo already ships a generated `data/api.json`).

## Refreshing the API catalog (optional)

Run from this folder:

```powershell
node scripts/extract-api.js --write-grammar
```

That fetches every page under `/docs/reference/*`, parses signatures from each
`<code>` block, writes `data/api.json`, and patches the
`builtin-classes` / `builtin-functions` regex inside
`syntaxes/emscript.tmLanguage.json`. Drop the `--write-grammar` flag to only
refresh the JSON.

## Install locally

### Option A — Run in an Extension Development Host (fastest, no packaging)

1. Open this folder (`vscode-emscript`) in VSCode.
2. Press `F5` (or **Run → Start Debugging**).
3. A second VSCode window labelled **"Extension Development Host"** opens with
   the extension active.
4. In that window, open any `.emscript` file (create `test.emscript` if needed)
   and start typing.

Reload the dev host with `Ctrl+R` after editing extension files.

### Option B — Package and install permanently

1. Install the VSCE packager once:
   ```powershell
   npm install -g @vscode/vsce
   ```
2. From this folder, package:
   ```powershell
   vsce package
   ```
   That produces `emscript-0.0.1.vsix`.
3. Install it into your regular VSCode:
   ```powershell
   code --install-extension emscript-0.0.1.vsix
   ```
   Or via UI: **Extensions** panel → `…` menu top-right → **Install from VSIX…** → pick the file.

To uninstall: `code --uninstall-extension local.emscript` (or use the Extensions panel).

> `vsce package` may warn about a missing publisher/license/repository — those
> are fine for a local-only install. Add `--allow-missing-repository` if it
> refuses.

## Using it

1. Create a file with extension `.emscript`. VSCode will recognize the language
   automatically (look for "EMScript" in the bottom-right status bar).
2. Try the [example from the docs](https://www.kok-emm.com/docs/emscript/examples):
   ```
   var region = Region.deviceReg().middle()
   var result = region.find("template", 5000)
   if (result) {
       result.click()
   }
   ```
   - `var`, `if` should appear as keywords.
   - `Region` should appear as a built-in class.
   - `"template"` should be a string, `5000` a number.
3. Type `Region.` — completion popup shows `deviceReg`, `macroReg`, `scale`, etc.
4. Type `fun` and press Tab — the function-definition snippet expands.

## How it works (one-paragraph tour)

`package.json` declares the language, grammar, and snippets file. The grammar
(`syntaxes/emscript.tmLanguage.json`) is a static TextMate JSON whose
`builtin-classes` / `builtin-functions` regex alternations get rewritten by
`scripts/extract-api.js --write-grammar`. At activation,
`src/extension.js` loads `data/api.json` and registers two completion
providers: a default one returning top-level (free fns + class names) and a
`.`-triggered one that looks at the identifier before the dot, treats it as a
class name if it matches one in the catalog (offering static members), and
otherwise returns the union of all instance methods.

## Files

| Path | Purpose |
|---|---|
| `package.json` | Extension manifest. |
| `language-configuration.json` | Brackets, comments, autoclose. |
| `syntaxes/emscript.tmLanguage.json` | TextMate grammar. |
| `snippets/emscript.code-snippets` | Static snippets. |
| `src/extension.js` | Activation + completion providers. |
| `scripts/extract-api.js` | Scraper for the online reference sheet. |
| `data/api.json` | Generated API catalog used at runtime. |
