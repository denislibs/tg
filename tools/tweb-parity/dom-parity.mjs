#!/usr/bin/env node
/**
 * Сверка нашего DOM с эталонным дампом tweb.
 *
 *   node tools/tweb-parity/dom-parity.mjs <эталон> <наш-снимок> [--json] [--limit N]
 *
 * <эталон>      — имя дампа из docs/tweb/dom/dumps (например `03-bubbles-123`)
 *                 или путь к файлу.
 * <наш-снимок>  — файл, снятый `snapshot-dom.js` на нашем стенде (txt или json-строка).
 *
 * Сравниваются тег, классы и вложенность. Атрибуты, тексты и порядок соседей
 * игнорируются: в дампах это данные живого аккаунта.
 *
 * Отчёт: каких классов эталона у нас нет, у каких изменился родитель,
 * какие классы у нас лишние.
 */

import {existsSync, readFileSync} from 'node:fs';
import {basename, join} from 'node:path';

import {REPO_ROOT} from './lib/sources.mjs';
import {anchorOf, indexByClass, parseTree, signatureOf} from './lib/tree.mjs';

const DUMPS_DIR = join(REPO_ROOT, 'docs/tweb/dom/dumps');

/** Хешированные имена CSS-модулей (`_ListContainer_176w2_77`) сравнивать бессмысленно. */
const HASHED = /^_.+_[a-z0-9]{4,}_?\d*$/;

function loadTreeSource(arg) {
  const candidates = [
    arg,
    join(DUMPS_DIR, arg),
    join(DUMPS_DIR, `${arg}.json`),
    join(DUMPS_DIR, `${arg}.txt`)
  ];
  const file = candidates.find((c) => existsSync(c) && !c.endsWith('/'));
  if(!file) {
    console.error(`Не найден файл: ${arg}`);
    console.error(`Искал также в ${DUMPS_DIR}`);
    process.exit(2);
  }
  const raw = readFileSync(file, 'utf8');
  if(file.endsWith('.json')) {
    const parsed = JSON.parse(raw);
    // Дампы сохранены как одна JSON-строка с деревом внутри.
    if(typeof parsed === 'string') return {file, text: parsed};
    if(typeof parsed?.tree === 'string') return {file, text: parsed.tree};
    console.error(`${file}: ожидалась JSON-строка с деревом.`);
    process.exit(2);
  }
  return {file, text: raw};
}

/** Путь до узла по классам предков — «где именно это лежит». */
function pathOf(node, maxDepth = 3) {
  const parts = [];
  let current = node;
  while(current && parts.length < maxDepth) {
    parts.unshift(signatureOf(current));
    current = anchorOf(current);
  }
  return parts.join(' > ');
}

function compare(reference, ours) {
  const refIndex = indexByClass(reference.root);
  const ourIndex = indexByClass(ours.root);

  const missing = [];
  const reparented = [];
  for(const [cls, nodes] of refIndex) {
    if(HASHED.test(cls)) continue;
    if(!ourIndex.has(cls)) {
      missing.push({class: cls, count: nodes.length, where: pathOf(nodes[0])});
      continue;
    }
    const refAnchors = new Set(nodes.map((n) => anchorOf(n)).map((a) => (a ? signatureOf(a) : '#root')));
    const ourAnchors = new Set(
      ourIndex.get(cls).map((n) => anchorOf(n)).map((a) => (a ? signatureOf(a) : '#root'))
    );
    const shared = [...refAnchors].some((a) => ourAnchors.has(a));
    if(!shared) {
      reparented.push({
        class: cls,
        expected: [...refAnchors].join(' | '),
        actual: [...ourAnchors].join(' | ')
      });
    }
  }

  const extra = [];
  for(const [cls, nodes] of ourIndex) {
    if(HASHED.test(cls) || refIndex.has(cls)) continue;
    extra.push({class: cls, count: nodes.length, where: pathOf(nodes[0])});
  }

  missing.sort((a, b) => b.count - a.count || a.class.localeCompare(b.class));
  extra.sort((a, b) => b.count - a.count || a.class.localeCompare(b.class));
  reparented.sort((a, b) => a.class.localeCompare(b.class));
  return {missing, reparented, extra};
}

function report({missing, reparented, extra}, meta, limit) {
  const section = (title, rows, render) => {
    console.log(`\n${title}: ${rows.length}`);
    if(!rows.length) return;
    for(const row of rows.slice(0, limit)) console.log(`  ${render(row)}`);
    if(rows.length > limit) console.log(`  … ещё ${rows.length - limit} (--limit N покажет больше)`);
  };

  console.log(`Эталон: ${meta.reference}${meta.referenceHeader ? ` (${meta.referenceHeader})` : ''}`);
  console.log(`Наш снимок: ${meta.ours}${meta.oursHeader ? ` (${meta.oursHeader})` : ''}`);

  section('Классы эталона, которых у нас нет', missing, (r) =>
    `${r.class}${r.count > 1 ? ` ×${r.count}` : ''} — ${r.where}`);
  section('Классы с другим родителем', reparented, (r) =>
    `${r.class}: ожидалось внутри ${r.expected}, у нас внутри ${r.actual}`);
  section('Наши классы, которых нет в эталоне', extra, (r) =>
    `${r.class}${r.count > 1 ? ` ×${r.count}` : ''} — ${r.where}`);
  console.log('');
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex === -1 ? 40 : Number(args[limitIndex + 1]) || 40;
  const positional = args.filter((a, i) =>
    !a.startsWith('--') && !(limitIndex !== -1 && i === limitIndex + 1));

  if(positional.length < 2) {
    console.error('Использование: dom-parity.mjs <эталон> <наш-снимок> [--json] [--limit N]');
    console.error('Снять наш DOM: см. tools/tweb-parity/snapshot-dom.js');
    process.exit(2);
  }

  const referenceSource = loadTreeSource(positional[0]);
  const oursSource = loadTreeSource(positional[1]);
  const reference = parseTree(referenceSource.text);
  const ours = parseTree(oursSource.text);
  const result = compare(reference, ours);
  const meta = {
    reference: basename(referenceSource.file),
    referenceHeader: reference.header,
    ours: basename(oursSource.file),
    oursHeader: ours.header
  };

  if(asJson) console.log(JSON.stringify({meta, ...result}, null, 2));
  else report(result, meta, limit);

  process.exit(result.missing.length || result.reparented.length ? 1 : 0);
}

main();
