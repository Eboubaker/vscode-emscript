#!/usr/bin/env node
/*
 * Scrape https://www.kok-emm.com/docs/reference/<slug> pages and emit
 * data/api.json describing free functions and classes with their members.
 *
 * Each class reference page is structured as:
 *   <div class="...macrorify-doc-content-heading..." id="constructor|constants|static-methods|methods">
 *       Constructor | Constants | Static Methods | Methods
 *   </div>
 *   <div class="...macrorify-doc-content-sub" id="<anchor>">memberName</div>
 *   <code>signature</code>
 *   <p>description...</p>
 *   <table>Parameters table</table>
 * Constants are paragraphs: <p id="constant-X"><code>NAME</code>: <span>type</span> = value</p>
 *
 * Usage:
 *   node scripts/extract-api.js                # write data/api.json
 *   node scripts/extract-api.js --write-grammar  # also patch the TextMate grammar
 */

const fs = require('fs');
const path = require('path');

const BASE = 'https://www.kok-emm.com/docs/reference/';

const FREE_FUNCTIONS = ['click', 'swipe', 'wait'];

const CLASS_SLUGS = [
  'array', 'map', 'point', 'swipepoint', 'multiswipe', 'multiswipebuilder',
  'touch', 'region', 'match', 'matchtext', 'template', 'templatebuilder',
  'cparam', 'sparam', 'fparam', 'tparam', 'rparam',
  'setting', 'settingbuilder',
  'dialog', 'textview', 'edittext', 'checkbox', 'radiogroup', 'imagepicker',
  'recorder', 'tablayout', 'record', 'onscreentext',
  'console', 'str', 'num', 'color', 'datetime', 'timespan', 'stopwatch',
  'clipboard', 'overlay', 'file', 'sys', 'cache', 'screencapture', 'env',
  'math', 'version'
];

const SLUG_TO_CLASS_NAME = {
  console: 'Con',
  datetime: 'DateTime',
  timespan: 'TimeSpan',
  matchtext: 'MatchText',
  multiswipe: 'MultiSwipe',
  multiswipebuilder: 'MultiSwipeBuilder',
  onscreentext: 'OnScreenText',
  screencapture: 'ScreenCapture',
  settingbuilder: 'SettingBuilder',
  swipepoint: 'SwipePoint',
  tablayout: 'TabLayout',
  templatebuilder: 'TemplateBuilder',
  textview: 'TextView',
  edittext: 'EditText',
  imagepicker: 'ImagePicker',
  radiogroup: 'RadioGroup',
  cparam: 'CParam',
  sparam: 'SParam',
  fparam: 'FParam',
  tparam: 'TParam',
  rparam: 'RParam'
};

function classNameForSlug(slug) {
  return SLUG_TO_CLASS_NAME[slug] || (slug.charAt(0).toUpperCase() + slug.slice(1));
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchPage(slug) {
  const url = BASE + slug;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

function parseParams(paramStr) {
  if (!paramStr.trim()) return [];
  const params = [];
  let depth = 0, current = '';
  for (const ch of paramStr) {
    if (ch === '(' || ch === '[' || ch === '<') depth++;
    else if (ch === ')' || ch === ']' || ch === '>') depth--;
    else if (ch === ',' && depth === 0) {
      params.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) params.push(current.trim());
  return params.map(p => {
    const m = p.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+?)(\s*=\s*(.+))?$/);
    if (m) return { name: m[1].trim(), type: m[2].trim(), default: m[4] ? m[4].trim() : undefined };
    return { name: p, type: '', default: undefined };
  });
}

// Match: [static] [returnType] name(params)
const SIG_RE = /^(static\s+)?(?:([A-Za-z_][A-Za-z0-9_]*(?:\[\])?)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)\s*$/;

function parseSignature(text) {
  const m = text.match(SIG_RE);
  if (!m) return null;
  return {
    isStatic: !!m[1],
    returnType: m[2] || '',
    name: m[3],
    params: parseParams(m[4])
  };
}

/* ---------- section-aware page parsing ---------- */

// Returns array of { sectionId, sectionName, subId, subName, codeBlocks: [string], descriptionHtml }
function extractSections(html) {
  // Find the doc-content area to ignore the sidebar navigation
  const docStart = html.indexOf('macrorify-doc-content');
  const docHtml = docStart >= 0 ? html.slice(docStart) : html;

  // Find all section headings (with id) and sub-headings (with id), in document order
  const markers = [];
  const headingRe = /<[^>]*class="[^"]*macrorify-doc-content-heading[^"]*"[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/[a-z]+>/gi;
  const subRe = /<[^>]*class="[^"]*macrorify-doc-content-sub[^"]*"[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/[a-z]+>/gi;
  let m;
  while ((m = headingRe.exec(docHtml)) !== null) {
    markers.push({ type: 'section', offset: m.index, end: m.index + m[0].length, id: m[1], name: stripTags(m[2]) });
  }
  while ((m = subRe.exec(docHtml)) !== null) {
    markers.push({ type: 'sub', offset: m.index, end: m.index + m[0].length, id: m[1], name: stripTags(m[2]) });
  }
  markers.sort((a, b) => a.offset - b.offset);

  // Walk markers, assigning content between this marker and the next to it
  const results = [];
  let currentSection = null;
  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i];
    const next = markers[i + 1];
    const sliceEnd = next ? next.offset : docHtml.length;
    const body = docHtml.slice(cur.end, sliceEnd);

    if (cur.type === 'section') {
      currentSection = cur;
      // Harvest code blocks that appear directly under this heading
      // (e.g. constructor overloads have no per-overload sub-heading).
      const codeBlocks = [];
      const cre = /<code[^>]*>([\s\S]*?)<\/code>/g;
      let c;
      while ((c = cre.exec(body)) !== null) {
        codeBlocks.push(stripTags(c[1]));
      }
      if (codeBlocks.length) {
        results.push({
          sectionId: cur.id,
          sectionName: cur.name,
          subId: null,
          subName: null,
          codeBlocks,
          paramDocs: {},
          description: ''
        });
      }
    } else {
      // sub-heading: only the FIRST <code> after the heading is the signature.
      // Later <code> blocks in the same body are inline references in the description text
      // (e.g. the "down" sub-section mentions <code>up()</code> in prose — not an overload).
      const codeBlocks = [];
      const cMatch = body.match(/<code[^>]*>([\s\S]*?)<\/code>/);
      if (cMatch) codeBlocks.push(stripTags(cMatch[1]));
      // parameter table: extract { paramName -> description }
      const paramDocs = {};
      const tableMatch = body.match(/<table[\s\S]*?<\/table>/);
      if (tableMatch) {
        const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
        let rm;
        while ((rm = rowRe.exec(tableMatch[0])) !== null) {
          const cells = [...rm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => stripTags(c[1]));
          if (cells.length >= 2 && !/parameters/i.test(cells[0])) {
            paramDocs[cells[0]] = cells[1];
          }
        }
      }
      // description: first <p> after the code block
      let description = '';
      const pMatch = body.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      if (pMatch) description = stripTags(pMatch[1]);

      results.push({
        sectionId: currentSection ? currentSection.id : null,
        sectionName: currentSection ? currentSection.name : null,
        subId: cur.id,
        subName: cur.name,
        codeBlocks,
        paramDocs,
        description
      });
    }
  }

  // Also extract constants as <p id="constant-X">...</p>
  const constants = [];
  const constRe = /<p[^>]*id="constant-[^"]+"[^>]*>([\s\S]*?)<\/p>/gi;
  let cm;
  while ((cm = constRe.exec(docHtml)) !== null) {
    const text = stripTags(cm[1]);
    const cMatch = text.match(/^([A-Z_][A-Z0-9_]*)\s*:\s*([^=]+?)\s*=\s*(.+)$/);
    if (cMatch) constants.push({ name: cMatch[1], type: cMatch[2].trim(), value: cMatch[3].trim() });
  }

  return { entries: results, constants };
}

/* ---------- per-page extractors ---------- */

async function extractFreeFunction(slug) {
  const html = await fetchPage(slug);
  const { entries } = extractSections(html);
  // Free-function pages typically have a single signature block.
  const signatures = [];
  let description = '';
  for (const entry of entries) {
    for (const code of entry.codeBlocks) {
      const sig = parseSignature(code);
      if (sig && sig.name.toLowerCase() === slug.toLowerCase()) {
        signatures.push({
          returnType: sig.returnType,
          params: attachParamDocs(sig.params, entry.paramDocs)
        });
        if (entry.description) description = entry.description;
      }
    }
  }
  // Fallback: scan all <code> blocks if section-aware path found nothing
  if (signatures.length === 0) {
    const re = /<code[^>]*>([\s\S]*?)<\/code>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const sig = parseSignature(stripTags(m[1]));
      if (sig && sig.name.toLowerCase() === slug.toLowerCase()) {
        signatures.push({ returnType: sig.returnType, params: sig.params });
      }
    }
  }
  return { name: slug, signatures, description };
}

function attachParamDocs(params, paramDocs) {
  return params.map(p => ({ ...p, description: paramDocs[p.name] || undefined }));
}

async function extractClass(slug) {
  const className = classNameForSlug(slug);
  const html = await fetchPage(slug);
  const { entries, constants } = extractSections(html);

  const constructors = [];
  const staticMethods = new Map();
  const methods = new Map();

  for (const entry of entries) {
    const section = (entry.sectionId || '').toLowerCase();
    if (section === 'constants') continue; // handled separately
    for (const code of entry.codeBlocks) {
      const sig = parseSignature(code);
      if (!sig) continue;

      // Macrorify's docs occasionally have copy-paste typos where a sub-section's
      // <code> block uses the wrong method name (e.g. Cache#regionOff shows
      // "screenOff()", Color#getAll shows "get(...)"). The sub-heading text is the
      // canonical name — prefer it when the two disagree.
      // Sub-headings may carry a " (Deprecated)" annotation we must strip.
      const rawSubName = entry.subName || '';
      const deprecated = /\(Deprecated\)/i.test(rawSubName);
      const cleanSubName = rawSubName.replace(/\s*\(Deprecated\)\s*/i, '').trim();
      const canonicalName = cleanSubName || sig.name;

      const sigObj = {
        params: attachParamDocs(sig.params, entry.paramDocs),
        returnType: sig.returnType,
        description: entry.description || undefined,
        deprecated: deprecated || undefined
      };

      if (section === 'constructor' || (canonicalName === className && !sig.returnType && !sig.isStatic)) {
        constructors.push(sigObj);
      } else if (section === 'static-methods' || sig.isStatic) {
        if (!staticMethods.has(canonicalName)) staticMethods.set(canonicalName, []);
        staticMethods.get(canonicalName).push(sigObj);
      } else {
        if (!methods.has(canonicalName)) methods.set(canonicalName, []);
        methods.get(canonicalName).push(sigObj);
      }
    }
  }

  return {
    name: className,
    constructors,
    staticMethods: [...staticMethods.entries()].map(([name, signatures]) => ({ name, signatures })),
    methods: [...methods.entries()].map(([name, signatures]) => ({ name, signatures })),
    constants
  };
}

/* ---------- main ---------- */

async function main() {
  const writeGrammar = process.argv.includes('--write-grammar');

  console.log(`Fetching ${FREE_FUNCTIONS.length} free functions + ${CLASS_SLUGS.length} classes...`);

  const freeFunctions = [];
  for (const slug of FREE_FUNCTIONS) {
    try {
      const fn = await extractFreeFunction(slug);
      freeFunctions.push(fn);
      console.log(`  fn ${slug}: ${fn.signatures.length} signature(s)`);
    } catch (e) {
      console.warn(`  fn ${slug}: FAILED - ${e.message}`);
    }
  }

  const classes = [];
  for (const slug of CLASS_SLUGS) {
    try {
      const cls = await extractClass(slug);
      classes.push(cls);
      console.log(`  class ${cls.name}: ${cls.constructors.length} ctor, ${cls.staticMethods.length} static, ${cls.methods.length} methods, ${cls.constants.length} const`);
    } catch (e) {
      console.warn(`  class ${slug}: FAILED - ${e.message}`);
    }
  }

  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'api.json');
  fs.writeFileSync(outPath, JSON.stringify({ freeFunctions, classes }, null, 2));
  console.log(`Wrote ${outPath}`);

  if (writeGrammar) patchGrammar(freeFunctions, classes);
}

function patchGrammar(freeFunctions, classes) {
  const grammarPath = path.join(__dirname, '..', 'syntaxes', 'emscript.tmLanguage.json');
  const grammar = JSON.parse(fs.readFileSync(grammarPath, 'utf8'));
  const classNames = classes.map(c => c.name).filter(Boolean);
  const fnNames = freeFunctions.map(f => f.name).filter(Boolean);
  grammar.repository['builtin-classes'].match = `\\b(${classNames.join('|')})\\b`;
  grammar.repository['builtin-functions'].match = `\\b(${fnNames.join('|')})(?=\\s*\\()`;
  fs.writeFileSync(grammarPath, JSON.stringify(grammar, null, 2));
  console.log(`Patched grammar: ${classNames.length} classes, ${fnNames.length} functions`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
