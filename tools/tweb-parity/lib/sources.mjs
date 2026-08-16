/** Пути к исходникам и загрузка нашего кода одним индексом. */

import {readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const TWEB_DIR = resolve(process.env.TWEB_DIR || '/Users/denisurevic/Documents/tweb');
export const WEB_CLIENT_SRC = join(REPO_ROOT, 'web-client/src');
export const INVENTORY_DIR = join(REPO_ROOT, 'docs/tweb/inventory');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__']);

export function walk(dir, predicate) {
  const found = [];
  const visit = (current) => {
    let entries;
    try {
      entries = readdirSync(current, {withFileTypes: true});
    } catch {
      return;
    }
    for(const entry of entries) {
      if(entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = join(current, entry.name);
      if(entry.isDirectory()) visit(full);
      else if(predicate(full)) found.push(full);
    }
  };
  visit(dir);
  return found;
}

export function assertTweb() {
  try {
    statSync(join(TWEB_DIR, 'src/scss'));
  } catch {
    console.error(
      `Не найдены исходники tweb в ${TWEB_DIR}.\n` +
      'Укажи путь через переменную окружения TWEB_DIR.'
    );
    process.exit(2);
  }
}

export const isScss = (f) => f.endsWith('.scss');
export const isCode = (f) => /\.(ts|tsx|js|jsx)$/.test(f);

export function relFromRepo(file) {
  return relative(REPO_ROOT, file);
}

export function relFromTweb(file) {
  return relative(TWEB_DIR, file);
}

/**
 * Индекс нашего кода: множество всех «словоподобных» токенов из ts/tsx и
 * множество классов из наших scss. По нему проверяем, встречается ли класс
 * tweb у нас хоть где-то — в стилях или в строковом литерале компонента.
 */
export function loadOurIndex() {
  const scssFiles = walk(join(WEB_CLIENT_SRC, ''), isScss);
  const codeFiles = walk(WEB_CLIENT_SRC, isCode);

  const codeTokens = new Set();
  for(const file of codeFiles) {
    const text = readFileSync(file, 'utf8');
    for(const m of text.matchAll(/[-_a-zA-Z][\w-]*/g)) codeTokens.add(m[0]);
  }

  return {scssFiles, codeFiles, codeTokens};
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}
