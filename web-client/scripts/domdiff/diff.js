// DOM-diff харнес, часть 2 — сравнение двух деревьев.
//
// Finding = {
//   path: string,   // 'div>div[0]>span[1]' — позиция узла в дереве
//   kind: 'missing-class'|'extra-class'|'wrong-tag'|'missing-node'|'extra-node'|'computed'|'missing-attr',
//   expected: string,
//   actual: string
// }
//
// Дети сопоставляются по индексу: порядок узлов в tweb значим (CSS опирается на
// него — `:first-child`, `+`, `~`, order), поэтому сдвиг порядка обязан быть
// расхождением, а не сглаживаться сопоставлением «по похожести».

const label = (n) => (n ? n.tag + (n.classes.length ? '.' + n.classes.join('.') : '') : '')

const toMatcher = (c) => {
  if (c instanceof RegExp) return (x) => c.test(x)
  // Строка вида '/^_\\w+_\\w+$/' в JSON-конфиге — регулярка.
  if (typeof c === 'string' && c.startsWith('/') && c.lastIndexOf('/') > 0) {
    const end = c.lastIndexOf('/')
    const re = new RegExp(c.slice(1, end), c.slice(end + 1))
    return (x) => re.test(x)
  }
  return (x) => x === c
}

/**
 * @param {object|null} expected эталонное дерево (из живого tweb)
 * @param {object|null} actual снятое с нашего стенда
 * @param {{ignoreClasses?: (string|RegExp)[], tolerance?: Record<string,number>, attrKeys?: string[]}} [opts]
 * @returns {Array<{path:string,kind:string,expected:string,actual:string}>}
 */
export function diffTrees(expected, actual, opts = {}) {
  const { ignoreClasses = [], tolerance = {}, attrKeys = [] } = opts
  const findings = []
  const matchers = ignoreClasses.map(toMatcher)
  const skip = (c) => matchers.some((m) => m(c))

  const walk = (e, a, path) => {
    if (!e && !a) return
    if (!a) {
      findings.push({ path, kind: 'missing-node', expected: label(e), actual: '' })
      return
    }
    if (!e) {
      findings.push({ path, kind: 'extra-node', expected: '', actual: label(a) })
      return
    }
    if (e.tag !== a.tag) findings.push({ path, kind: 'wrong-tag', expected: e.tag, actual: a.tag })

    const ec = e.classes.filter((c) => !skip(c))
    const ac = a.classes.filter((c) => !skip(c))
    for (const c of ec) if (!ac.includes(c)) findings.push({ path, kind: 'missing-class', expected: c, actual: ac.join(' ') })
    for (const c of ac) if (!ec.includes(c)) findings.push({ path, kind: 'extra-class', expected: ec.join(' '), actual: c })

    // Атрибуты сверяем только по наличию ключа: значения (data-mid, peer-id)
    // у нас и в tweb разные по определению.
    for (const k of attrKeys) {
      const has = (n) => n.attrs && n.attrs[k] != null
      if (has(e) && !has(a)) findings.push({ path, kind: 'missing-attr', expected: k, actual: '' })
    }

    if (e.computed && a.computed) {
      for (const [p, v] of Object.entries(e.computed)) {
        const av = a.computed[p]
        const tol = tolerance[p] ?? 0
        const num = (s) => parseFloat(String(s))
        const near = tol && Number.isFinite(num(v)) && Number.isFinite(num(av)) && Math.abs(num(v) - num(av)) <= tol
        if (av !== v && !near) findings.push({ path, kind: 'computed', expected: `${p}: ${v}`, actual: `${p}: ${av}` })
      }
    }

    const ek = e.children ?? []
    const ak = a.children ?? []
    const n = Math.max(ek.length, ak.length)
    for (let i = 0; i < n; i++) walk(ek[i], ak[i], `${path}>${(ek[i] ?? ak[i]).tag}[${i}]`)
  }

  walk(expected, actual, expected ? expected.tag : 'root')
  return findings
}

/** Текстовый отчёт: findings по порядку обхода, с колонкой вида расхождения. */
export function formatFindings(findings, title = '') {
  if (!findings.length) return `${title ? title + ': ' : ''}0 findings ✓`
  const lines = title ? [`${title}: ${findings.length} findings`] : [`${findings.length} findings`]
  for (const f of findings) {
    lines.push(`  [${f.kind}] ${f.path}`)
    if (f.expected) lines.push(`      tweb: ${f.expected}`)
    if (f.actual) lines.push(`      наше: ${f.actual}`)
  }
  return lines.join('\n')
}

/** Сводка по видам расхождений — для быстрой оценки прогресса фазы. */
export function summarize(findings) {
  const by = {}
  for (const f of findings) by[f.kind] = (by[f.kind] ?? 0) + 1
  return by
}
