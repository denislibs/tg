// DOM-diff харнес, часть 3 — разбор живого DOM-референса.
//
// `docs/research/tweb-dom/*.json` — это JSON-строки с текстовым дампом дерева,
// снятым с работающего tweb. Формат строки:
//
//   div.bubble.is-out [data-mid="21335" style="…"] "текст"
//
// отступ = 2 пробела на уровень. Парсер приводит дамп к той же форме Node, что
// выдаёт serialize.js, — так эталон и снимок сравнимы напрямую.

const HEAD = /^([a-zA-Z][\w-]*)((?:\.[^\s.[]+)*)/

/** Разбор `[k="v" k2="v2"]` в объект. */
function parseAttrs(src) {
  const out = {}
  for (const m of src.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = m[2]
  return out
}

/** Найти закрывающую `]`, не спотыкаясь о `]` внутри кавычек. */
function findAttrsEnd(s, start) {
  let inQuote = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (ch === '"') inQuote = !inQuote
    else if (ch === ']' && !inQuote) return i
  }
  return -1
}

/**
 * Разбор одной строки дампа.
 * @returns {{depth: number, node: object}|null}
 */
export function parseLine(line) {
  if (!line.trim()) return null
  const indent = line.length - line.trimStart().length
  const rest = line.trim()
  const head = HEAD.exec(rest)
  if (!head) return null

  const tag = head[1]
  const classes = head[2] ? head[2].slice(1).split('.').filter(Boolean).sort() : []
  const node = { tag, classes }

  let i = head[0].length
  while (rest[i] === ' ') i++
  if (rest[i] === '[') {
    const end = findAttrsEnd(rest, i + 1)
    if (end > 0) {
      const attrs = parseAttrs(rest.slice(i + 1, end))
      if (Object.keys(attrs).length) node.attrs = attrs
      i = end + 1
      while (rest[i] === ' ') i++
    }
  }
  if (rest[i] === '"') {
    const text = rest.slice(i + 1, rest.lastIndexOf('"'))
    if (text) node.text = text // информационно: differ текст не сравнивает
  }
  return { depth: indent / 2, node }
}

/**
 * Разбор блока строк в дерево. Возвращает корень (первую строку нулевого уровня).
 * @param {string} body
 */
export function parseTree(body) {
  const stack = []
  let root = null
  for (const line of body.split('\n')) {
    const parsed = parseLine(line)
    if (!parsed) continue
    const { depth, node } = parsed
    if (depth === 0) {
      // Второй корень в блоке игнорируем: у нас один эталон = одно поддерево.
      if (root) break
      root = node
      stack.length = 0
      stack[0] = node
      continue
    }
    const parent = stack[depth - 1]
    if (!parent) continue
    ;(parent.children ??= []).push(node)
    stack[depth] = node
    stack.length = depth + 1
  }
  return root
}

/**
 * Разбор целого файла-дампа на секции `=== заголовок ===`.
 * Секция `computed` (тело — JSON-объект) возвращается как `{computed: {...}}`.
 * @param {string} raw содержимое файла (уже распарсенный JSON-строкой текст)
 * @returns {Array<{title: string, tree?: object, computed?: object}>}
 */
export function parseDump(raw) {
  const sections = []
  const re = /^===\s*(.+?)\s*===$/gm
  const marks = [...raw.matchAll(re)]
  for (let i = 0; i < marks.length; i++) {
    const title = marks[i][1]
    const from = marks[i].index + marks[i][0].length
    const to = i + 1 < marks.length ? marks[i + 1].index : raw.length
    const body = raw.slice(from, to).trim()
    if (!body || body.startsWith('NOT FOUND')) continue
    if (body.startsWith('{')) {
      try {
        sections.push({ title, computed: JSON.parse(body) })
      } catch {
        // Обрезанный дамп computed — не эталон дерева, просто пропускаем.
      }
      continue
    }
    const tree = parseTree(body)
    if (tree) sections.push({ title, tree })
  }
  return sections
}

/** `text out first+last (mid 21335)` → `text-out-first-last-mid-21335`. */
export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
