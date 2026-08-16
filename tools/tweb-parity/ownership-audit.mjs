#!/usr/bin/env node
/**
 * Аудит границы React ↔ императивный код.
 *
 *   node tools/tweb-parity/ownership-audit.mjs [--json] [--limit N] [--check <имя>]
 *
 * Ищет три класса дефектов, которые появляются, когда портированный из tweb
 * императивный код живёт внутри React-компонента:
 *
 *   ownership — компонент правит DOM в обход React (classList, setAttribute,
 *               appendChild, innerHTML) или ищет узлы через querySelector.
 *               React на следующем рендере это затирает или теряет.
 *   layout    — useEffect, который меряет геометрию или двигает скролл. Он
 *               выполняется ПОСЛЕ пейнта, поэтому правка видна как прыжок;
 *               нужен useLayoutEffect.
 *   reflow    — переключение классов перехода без форсированного чтения
 *               `offsetWidth`. React батчит рендер, и без чтения браузер
 *               схлопывает два класса в один кадр — анимация не играет.
 *
 * Проверяются только React-файлы (те, что импортируют react). Vanilla-модули
 * (`scrollable.ts`, `preloader.ts`, ядро медиавьювера) — это и есть островной
 * слой, императивность там норма и в отчёт не идёт.
 *
 * Все три проверки — эвристики. Осознанное место глушится комментарием
 * `// ownership-ok: причина` на той же или предыдущей строке.
 */

import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {REPO_ROOT, WEB_CLIENT_SRC, isCode, relFromRepo, walk} from './lib/sources.mjs';

const MUTATIONS = [
  {re: /\.classList\s*\.\s*(add|remove|toggle|replace)\s*\(/g, what: 'classList'},
  {re: /\.setAttribute\s*\(/g, what: 'setAttribute'},
  {re: /\.(appendChild|insertBefore|append|prepend|replaceChildren)\s*\(/g, what: 'вставка узла'},
  {re: /\.innerHTML\s*=/g, what: 'innerHTML'},
  {re: /\.querySelector(All)?\s*\(/g, what: 'querySelector'}
];

/** Чтения, ради которых эффект обязан быть layout-фазой. */
const GEOMETRY = /\b(scrollTop|scrollLeft|scrollHeight|scrollWidth|getBoundingClientRect|offsetTop|offsetLeft|offsetHeight|offsetWidth|clientHeight|clientWidth|scrollIntoView|scrollTo)\b/;

/** Классы, которыми tweb переключает переходы. */
const TRANSITION_CLASS = /['"`](animating|forwards|backwards|active|hiding|is-visible|is-hiding|is-shown|open|show)['"`]/;

/** Форсированный рефлоу между двумя классами. */
const REFLOW = /\b(offsetWidth|offsetHeight|getBoundingClientRect|requestAnimationFrame)\b/;

const SUPPRESS = /ownership-ok/;

const CHECKS = ['ownership', 'layout', 'reflow'];

/**
 * React-владение определяем так: файл импортирует `react` и НЕ монтирует React
 * сам через `react-dom/client`. `createRoot` — признак обратной стороны границы:
 * это vanilla-хост, который вставляет в себя React-острова (ядро медиавьювера,
 * точка входа приложения). Императивность там не дефект, а устройство.
 */
function isReactFile(text) {
  return /from\s+['"]react['"]/.test(text) && !/from\s+['"]react-dom\/client['"]/.test(text);
}

function isTest(file) {
  return /\.test\.[jt]sx?$/.test(file);
}

/** Тело вызова `name(` от позиции до парной закрывающей скобки. */
function callBody(text, start) {
  let depth = 0;
  for(let i = start; i < text.length; ++i) {
    const c = text[i];
    if(c === '(') ++depth;
    else if(c === ')') {
      --depth;
      if(depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

function suppressed(lines, line) {
  return SUPPRESS.test(lines[line - 1] ?? '') || SUPPRESS.test(lines[line - 2] ?? '');
}

function auditFile(file, text) {
  const lines = text.split('\n');
  const rel = relFromRepo(file);
  const findings = [];

  for(const {re, what} of MUTATIONS) {
    re.lastIndex = 0;
    let m;
    while((m = re.exec(text)) !== null) {
      const line = lineAt(text, m.index);
      if(suppressed(lines, line)) continue;
      findings.push({check: 'ownership', file: rel, line, what, code: lines[line - 1].trim()});
    }
  }

  const effect = /\buseEffect\s*\(/g;
  let m;
  while((m = effect.exec(text)) !== null) {
    const body = callBody(text, m.index + m[0].length - 1);
    const hit = GEOMETRY.exec(body);
    if(!hit) continue;
    const line = lineAt(text, m.index);
    if(suppressed(lines, line)) continue;
    findings.push({check: 'layout', file: rel, line, what: hit[0], code: lines[line - 1].trim()});
  }

  const classMutation = /\.classList\s*\.\s*(add|remove|toggle|replace)\s*\(([^)]*)\)/g;
  while((m = classMutation.exec(text)) !== null) {
    if(!TRANSITION_CLASS.test(m[2])) continue;
    const line = lineAt(text, m.index);
    if(suppressed(lines, line)) continue;
    const around = lines.slice(Math.max(0, line - 11), line + 10).join('\n');
    if(REFLOW.test(around)) continue;
    findings.push({check: 'reflow', file: rel, line, what: m[2].trim(), code: lines[line - 1].trim()});
  }

  return findings;
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex === -1 ? 25 : Number(args[limitIndex + 1]) || 25;
  const checkIndex = args.indexOf('--check');
  const only = checkIndex === -1 ? CHECKS : [args[checkIndex + 1]].filter((c) => CHECKS.includes(c));

  const files = walk(WEB_CLIENT_SRC, isCode).filter((f) => !isTest(f));
  const findings = [];
  let reactFiles = 0;

  for(const file of files) {
    const text = readFileSync(file, 'utf8');
    if(!isReactFile(text)) continue;
    ++reactFiles;
    findings.push(...auditFile(file, text).filter((f) => only.includes(f.check)));
  }

  if(asJson) {
    console.log(JSON.stringify({scanned: reactFiles, findings}, null, 2));
    return;
  }

  const byFile = new Map();
  for(const f of findings) {
    if(!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  console.log(`React-файлов просмотрено: ${reactFiles} (vanilla-модули не считаются)`);
  for(const check of only) {
    const rows = findings.filter((f) => f.check === check);
    console.log(`  ${check}: ${rows.length}`);
  }

  const ranked = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log(`\nТоп файлов (${Math.min(limit, ranked.length)} из ${ranked.length}):\n`);
  for(const [file, rows] of ranked.slice(0, limit)) {
    const counts = only
      .map((c) => [c, rows.filter((r) => r.check === c).length])
      .filter(([, n]) => n)
      .map(([c, n]) => `${c} ${n}`)
      .join(', ');
    console.log(`${file} — ${counts}`);
    for(const row of rows.filter((r) => r.check !== 'ownership').slice(0, 5)) {
      console.log(`  :${row.line} [${row.check}] ${row.what} — ${row.code.slice(0, 90)}`);
    }
  }

  console.log('\nЭто эвристики. Осознанное место глушится комментарием `// ownership-ok: причина`.');
  console.log('Полный список — с флагом --json; одна проверка — --check layout|reflow|ownership.');
}

main();

export {auditFile};
