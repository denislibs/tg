// DOM-diff харнес, часть 1 — сериализатор.
//
// `serializeTree` инжектится в страницу (evaluate через chrome-devtools/playwright
// MCP) как исходный текст функции и возвращает дерево, пригодное для сравнения:
// теги + классы + порядок + выбранные computed-свойства. Одна и та же функция
// снимает и живой tweb, и наш стенд — иначе сравнение неоправданно (разные
// сериализации дают ложные findings).
//
// Node = {
//   tag: string,
//   classes: string[],            // отсортированы (порядок классов в DOM не значим)
//   attrs?: Record<string,string>,
//   computed?: Record<string,string>,
//   children?: Node[]
// }

// Самодостаточная (ничего не захватывает из модуля) — иначе её текст не переживёт
// инжект в страницу.
export const serializeTree = (rootSelector, opts) => {
  const { maxDepth = 14, computedFor = [], props = [] } = opts || {}
  const root = document.querySelector(rootSelector)
  if (!root) return null
  const want = new Set(computedFor)
  const walk = (el, depth) => {
    if (!el || el.nodeType !== 1 || depth > maxDepth) return null
    const tag = el.tagName.toLowerCase()
    // Внутренности svg-иконок структурно не значимы и шумят в diff.
    if (tag === 'path' || tag === 'defs' || tag === 'use') return null
    const raw = typeof el.className === 'string' ? el.className : (el.className?.baseVal ?? '')
    const classes = raw.trim() ? raw.trim().split(/\s+/).sort() : []
    const node = { tag, classes }
    const attrs = {}
    for (const a of ['data-mid', 'data-peer-id', 'href', 'type', 'contenteditable']) {
      const v = el.getAttribute?.(a)
      if (v != null) attrs[a] = v
    }
    if (Object.keys(attrs).length) node.attrs = attrs
    if (want.size && classes.some((c) => want.has(c))) {
      const cs = getComputedStyle(el)
      const out = {}
      for (const p of props) out[p] = cs.getPropertyValue(p)
      node.computed = out
    }
    const kids = [...el.children].map((c) => walk(c, depth + 1)).filter(Boolean)
    if (kids.length) node.children = kids
    return node
  }
  return walk(root, 0)
}

/** Исходник сериализатора — то, что уезжает в страницу. */
export const SERIALIZE_FN = serializeTree.toString()

/**
 * Готовое выражение для `evaluate`: вставляется в MCP-инструмент как есть.
 * @param {string} rootSelector корень поддерева (например '.bubbles-inner')
 * @param {{maxDepth?: number, computedFor?: string[], props?: string[]}} [opts]
 * @returns {string}
 */
export function evaluateSnippet(rootSelector, opts = {}) {
  return `(${SERIALIZE_FN})(${JSON.stringify(rootSelector)}, ${JSON.stringify(opts)})`
}

/**
 * Сериализация уже имеющегося DOM-узла (юнит-тесты, happy-dom): тот же алгоритм,
 * корень помечается временным атрибутом, чтобы не заводить вторую реализацию.
 * @param {Element} root
 * @param {{maxDepth?: number, computedFor?: string[], props?: string[]}} [opts]
 */
export function serializeElement(root, opts = {}) {
  const marker = 'data-domdiff-root'
  root.setAttribute(marker, '1')
  try {
    return serializeTree(`[${marker}="1"]`, opts)
  } finally {
    root.removeAttribute(marker)
  }
}
