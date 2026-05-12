const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

function loadApi() {
  const apiPath = path.join(__dirname, '..', 'data', 'api.json');
  if (!fs.existsSync(apiPath)) {
    return { freeFunctions: [], classes: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(apiPath, 'utf8'));
  } catch (e) {
    return { freeFunctions: [], classes: [] };
  }
}

function sigToString(name, sig) {
  const params = (sig.params || []).map(p => p.type ? `${p.name}: ${p.type}` : p.name).join(', ');
  const ret = sig.returnType ? `${sig.returnType} ` : '';
  return `${ret}${name}(${params})`;
}

function makeFunctionItem(name, signatures) {
  const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
  item.insertText = new vscode.SnippetString(`${name}($0)`);
  if (signatures && signatures.length) {
    item.detail = sigToString(name, signatures[0]);
    const md = new vscode.MarkdownString();
    for (const s of signatures) md.appendCodeblock(sigToString(name, s), 'emscript');
    item.documentation = md;
  }
  return item;
}

function makeClassItem(name) {
  const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
  item.insertText = name;
  item.detail = `class ${name}`;
  return item;
}

function makeMemberItem(memberName, signatures, kind) {
  const item = new vscode.CompletionItem(memberName, kind);
  if (kind === vscode.CompletionItemKind.Method) {
    item.insertText = new vscode.SnippetString(`${memberName}($0)`);
  } else {
    item.insertText = memberName;
  }
  if (signatures && signatures.length) {
    item.detail = sigToString(memberName, signatures[0]);
    const md = new vscode.MarkdownString();
    for (const s of signatures) md.appendCodeblock(sigToString(memberName, s), 'emscript');
    item.documentation = md;
    if (signatures.every(s => s.deprecated)) {
      item.tags = [vscode.CompletionItemTag.Deprecated];
    }
  }
  return item;
}

function activate(context) {
  const api = loadApi();

  const topLevel = [];
  for (const fn of api.freeFunctions || []) {
    topLevel.push(makeFunctionItem(fn.name, fn.signatures));
  }
  for (const cls of api.classes || []) {
    topLevel.push(makeClassItem(cls.name));
  }

  const classMap = new Map();
  for (const cls of api.classes || []) {
    classMap.set(cls.name, cls);
  }

  const allInstanceMembers = [];
  for (const cls of api.classes || []) {
    for (const m of cls.methods || []) {
      allInstanceMembers.push(makeMemberItem(m.name, m.signatures, vscode.CompletionItemKind.Method));
    }
  }

  const topLevelProvider = vscode.languages.registerCompletionItemProvider(
    'emscript',
    {
      provideCompletionItems() {
        return topLevel;
      }
    }
  );

  const memberProvider = vscode.languages.registerCompletionItemProvider(
    'emscript',
    {
      provideCompletionItems(document, position) {
        const line = document.lineAt(position).text.slice(0, position.character);
        const match = line.match(/([A-Za-z_][A-Za-z0-9_]*)\.$/);
        if (!match) return [];
        const ident = match[1];
        const cls = classMap.get(ident);
        if (cls) {
          const items = [];
          for (const m of cls.staticMethods || []) {
            items.push(makeMemberItem(m.name, m.signatures, vscode.CompletionItemKind.Method));
          }
          for (const c of cls.constants || []) {
            items.push(makeMemberItem(c.name, [{ returnType: c.type, params: [] }], vscode.CompletionItemKind.Constant));
          }
          return items;
        }
        return allInstanceMembers;
      }
    },
    '.'
  );

  context.subscriptions.push(topLevelProvider, memberProvider);
}

function deactivate() {}

module.exports = { activate, deactivate };
