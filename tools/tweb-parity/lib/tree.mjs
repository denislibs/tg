/**
 * Разбор текстового дерева DOM — формата, в котором сняты эталонные дампы
 * `docs/tweb/dom/dumps/*.json` и в котором снимает наш DOM `snapshot-dom.js`.
 *
 * Строка узла: `tag.class1.class2 [attr="value"] "текст"`, вложенность — отступом
 * в два пробела. Первая строка может быть заголовком `=== #root depth N ===`.
 *
 * Сравниваем только тег, классы и вложенность: атрибуты и текст в дампах сняты
 * с живого аккаунта, их совпадение ничего не значит.
 */

const HEADER = /^===\s*(.*?)\s*===$/;

/** @typedef {{tag: string, classes: string[], depth: number, children: Node[], parent: Node|null, line: number}} Node */

export function parseTree(text) {
  const lines = String(text).split('\n');
  /** @type {Node} */
  const root = {tag: '#root', classes: [], depth: -1, children: [], parent: null, line: 0};
  const stack = [root];
  let header = null;

  lines.forEach((raw, index) => {
    if(!raw.trim()) return;
    const headerMatch = HEADER.exec(raw.trim());
    if(headerMatch) {
      header ??= headerMatch[1];
      return;
    }
    const indent = raw.length - raw.trimStart().length;
    const depth = Math.floor(indent / 2);
    const body = raw.trim();
    // Отрезаем атрибуты и текст — остаётся `tag.class.class`.
    const head = body.split(/\s+\[|\s+"/)[0].trim();
    if(!head) return;
    const [tag, ...classes] = head.split('.');
    const node = {
      tag: tag || 'div',
      classes: classes.filter(Boolean),
      depth,
      children: [],
      parent: null,
      line: index + 1
    };
    while(stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1];
    node.parent = parent === root ? null : parent;
    parent.children.push(node);
    stack.push(node);
  });

  return {root, header};
}

export function walkTree(root, visit) {
  for(const child of root.children) {
    visit(child);
    walkTree(child, visit);
  }
}

/** Ближайший предок, у которого есть классы, — «якорь» узла в вёрстке. */
export function anchorOf(node) {
  let current = node.parent;
  while(current && !current.classes.length) current = current.parent;
  return current;
}

export function signatureOf(node) {
  return node.classes.length ? `${node.tag}.${node.classes.join('.')}` : node.tag;
}

/**
 * Индекс дерева: класс → узлы, в которых он встречается.
 * @returns {Map<string, Node[]>}
 */
export function indexByClass(root) {
  const index = new Map();
  walkTree(root, (node) => {
    for(const cls of node.classes) {
      if(!index.has(cls)) index.set(cls, []);
      index.get(cls).push(node);
    }
  });
  return index;
}
