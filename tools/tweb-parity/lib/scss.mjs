/**
 * Мини-парсер SCSS: разворачивает вложенность и `&`, отдаёт плоский список
 * итоговых селекторов. Нужен, чтобы сравнивать наши стили с tweb по факту,
 * а не по глазам: в tweb `.bubbles-group { &-avatar { … } }` даёт класс
 * `bubbles-group-avatar`, которого в тексте файла буквально нет.
 *
 * Это не полноценный компилятор sass: миксины, циклы и вычисляемые селекторы
 * не раскрываются. Селекторы с интерполяцией возвращаются отдельным списком
 * `dynamic` и в статистику классов не идут.
 */

const AT_RULES_TRANSPARENT = new Set(['media', 'supports', 'container', 'layer']);
const AT_RULES_STERILE = new Set([
  'keyframes', 'mixin', 'function', 'font-face', 'property', 'counter-style'
]);

/** Маркер спрятанной интерполяции: один символ, которого не бывает в SCSS. */
const INTERP = String.fromCharCode(1);

/** Убирает комментарии; строки сохраняются как есть. */
function stripComments(src) {
  let out = '';
  let i = 0;
  while(i < src.length) {
    const c = src[i];
    if(c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      out += ' ';
      continue;
    }
    if(c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? src.length : end;
      out += ' ';
      continue;
    }
    if(c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while(j < src.length && src[j] !== quote) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, Math.min(j + 1, src.length));
      i = j + 1;
      continue;
    }
    out += c;
    ++i;
  }
  return out;
}

/**
 * Прячет `#{…}` под маркер ДО основного разбора: иначе фигурная скобка
 * интерполяции читается как начало блока и селектор рвётся пополам
 * (`#{$parent}-container` превращался в мусор вида `.popup-stickers -container`).
 */
function maskInterpolation(src) {
  let out = '';
  let i = 0;
  while(i < src.length) {
    if(src[i] === '#' && src[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while(j < src.length && depth > 0) {
        if(src[j] === '{') ++depth;
        else if(src[j] === '}') --depth;
        ++j;
      }
      out += INTERP;
      i = j;
      continue;
    }
    out += src[i];
    ++i;
  }
  return out;
}

const unmask = (selector) => selector.split(INTERP).join('#{}');

/** Делит селектор по запятым верхнего уровня (не внутри скобок). */
function splitTopLevel(selector) {
  const parts = [];
  let depth = 0;
  let current = '';
  for(const c of selector) {
    if(c === '(' || c === '[') ++depth;
    else if(c === ')' || c === ']') --depth;
    if(c === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += c;
  }
  if(current.trim()) parts.push(current.trim());
  return parts;
}

/** Подставляет родителей в место `&`; без `&` — обычная вложенность через пробел. */
function resolveAgainstParents(part, parents) {
  if(!parents.length) return part.includes('&') ? [] : [part];
  if(!part.includes('&')) return parents.map((p) => `${p} ${part}`);
  return parents.map((p) => part.split('&').join(p));
}

/**
 * @param {string} src содержимое .scss
 * @returns {{selectors: string[], dynamic: string[]}}
 *   selectors — статические селекторы, dynamic — те, где осталась интерполяция.
 */
export function parseScss(src) {
  const text = maskInterpolation(stripComments(src));
  const selectors = [];
  const dynamic = [];
  /** @type {Array<string[]|null>} null = стерильный контекст (@keyframes/@mixin) */
  const stack = [];
  let buffer = '';

  const currentParents = () => {
    for(let i = stack.length - 1; i >= 0; --i) {
      if(stack[i] === null) return null;
      if(stack[i].length) return stack[i];
    }
    return [];
  };

  for(let i = 0; i < text.length; ++i) {
    const c = text[i];
    if(c === '{') {
      const raw = buffer.trim();
      buffer = '';
      const atMatch = /^@([\w-]+)/.exec(raw);
      if(atMatch) {
        const name = atMatch[1].toLowerCase();
        stack.push(AT_RULES_TRANSPARENT.has(name) && !AT_RULES_STERILE.has(name) ? [] : null);
        continue;
      }
      const parents = currentParents();
      if(parents === null) {
        stack.push(null);
        continue;
      }
      const resolved = [];
      for(const part of splitTopLevel(raw)) {
        for(const full of resolveAgainstParents(part, parents)) {
          const normalized = full.replace(/\s+/g, ' ').trim();
          if(!normalized) continue;
          if(normalized.includes(INTERP)) dynamic.push(unmask(normalized));
          else selectors.push(normalized);
          resolved.push(normalized);
        }
      }
      stack.push(resolved);
      continue;
    }
    if(c === '}') {
      stack.pop();
      buffer = '';
      continue;
    }
    if(c === ';') {
      buffer = '';
      continue;
    }
    buffer += c;
  }

  return {selectors: [...new Set(selectors)], dynamic: [...new Set(dynamic)]};
}

/** Все имена классов, встречающиеся в списке селекторов. */
export function classesOf(selectors) {
  const classes = new Set();
  for(const selector of selectors) {
    for(const m of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(m[1]);
  }
  return classes;
}

/** Селекторы, содержащие данный класс (для отчётов «где это в tweb»). */
export function selectorsWithClass(selectors, className) {
  const re = new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
  return selectors.filter((s) => re.test(s));
}
