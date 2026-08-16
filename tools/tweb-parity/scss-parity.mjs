#!/usr/bin/env node
/**
 * Сверка портированных стилей с оригиналом tweb по набору селекторов.
 *
 *   node tools/tweb-parity/scss-parity.mjs --all              сводка по всем портированным файлам
 *   node tools/tweb-parity/scss-parity.mjs _chatBubble.scss   полный дифф одного файла
 *
 * Сравниваются итоговые селекторы после разворачивания вложенности и `&`.
 * Значения свойств не сравниваются: цель — найти пропущенные состояния и ветки
 * (`.bubble.is-out .time`, `.is-selecting &`), а не расхождения в пикселях.
 *
 * Селекторы с интерполяцией `#{}` пропускаются с обеих сторон.
 */

import {readFileSync} from 'node:fs';
import {basename, join} from 'node:path';

import {parseScss} from './lib/scss.mjs';
import {TWEB_DIR, WEB_CLIENT_SRC, assertTweb, isScss, walk} from './lib/sources.mjs';

function indexByBase(files) {
  const map = new Map();
  for(const file of files) {
    const base = basename(file);
    if(!map.has(base)) map.set(base, file);
  }
  return map;
}

function selectorsOf(file) {
  return new Set(parseScss(readFileSync(file, 'utf8')).selectors);
}

function diff(twebFile, ourFile) {
  const tweb = selectorsOf(twebFile);
  const ours = selectorsOf(ourFile);
  const missing = [...tweb].filter((s) => !ours.has(s)).sort();
  const extra = [...ours].filter((s) => !tweb.has(s)).sort();
  return {tweb, ours, missing, extra};
}

function main() {
  assertTweb();
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex === -1 ? 60 : Number(args[limitIndex + 1]) || 60;

  const twebByBase = indexByBase(walk(join(TWEB_DIR, 'src/scss'), isScss));
  const ourByBase = indexByBase(walk(join(WEB_CLIENT_SRC, 'styles'), isScss));

  if(args.includes('--all')) {
    const rows = [];
    for(const [base, ourFile] of ourByBase) {
      const twebFile = twebByBase.get(base);
      if(!twebFile) continue;
      const {tweb, missing, extra} = diff(twebFile, ourFile);
      rows.push({base, total: tweb.size, missing: missing.length, extra: extra.length});
    }
    rows.sort((a, b) => b.missing - a.missing);
    const pad = (value, width) => String(value).padEnd(width);
    console.log(`${pad('файл', 34)}${pad('селекторов', 12)}${pad('нет у нас', 11)}наших лишних`);
    for(const row of rows) {
      console.log(`${pad(row.base, 34)}${pad(row.total, 12)}${pad(row.missing, 11)}${row.extra}`);
    }
    const totalMissing = rows.reduce((sum, r) => sum + r.missing, 0);
    console.log(`\nВсего файлов сверено: ${rows.length}, не хватает селекторов: ${totalMissing}`);
    console.log('Детали по файлу: scss-parity.mjs <имя файла>');
    return;
  }

  const target = args.find((a) => !a.startsWith('--') && a !== String(limit));
  if(!target) {
    console.error('Использование: scss-parity.mjs --all | scss-parity.mjs <файл.scss> [--limit N]');
    process.exit(2);
  }

  const base = basename(target);
  const twebFile = twebByBase.get(base);
  const ourFile = ourByBase.get(base);
  if(!twebFile) {
    console.error(`В tweb нет файла ${base}.`);
    process.exit(2);
  }
  if(!ourFile) {
    console.error(`У нас нет файла ${base} — портируй целиком, сверять пока нечего.`);
    process.exit(1);
  }

  const {tweb, ours, missing, extra} = diff(twebFile, ourFile);
  console.log(`${base}: в tweb ${tweb.size} селекторов, у нас ${ours.size}`);

  console.log(`\nНет у нас: ${missing.length}`);
  for(const selector of missing.slice(0, limit)) console.log(`  ${selector}`);
  if(missing.length > limit) console.log(`  … ещё ${missing.length - limit}`);

  console.log(`\nЕсть только у нас: ${extra.length}`);
  for(const selector of extra.slice(0, limit)) console.log(`  ${selector}`);
  if(extra.length > limit) console.log(`  … ещё ${extra.length - limit}`);
  console.log('');

  process.exit(missing.length ? 1 : 0);
}

main();
