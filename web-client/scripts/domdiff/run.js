#!/usr/bin/env node
// DOM-diff харнес, часть 5 — CLI.
//
//   node scripts/domdiff/run.js --list
//   node scripts/domdiff/run.js --snippet ".bubbles-inner"
//   node scripts/domdiff/run.js --actual /tmp/actual.json --key photo-out-mid-21393
//   node scripts/domdiff/run.js --actual /tmp/feed.json --all [--out baseline.txt]
//
// `--actual` — файл со снимком нашего стенда (результат evaluate со SERIALIZE_FN).
// `--all` — сопоставить снимок ленты со всеми эталонами: для каждого бабла из
// снимка берётся эталон с наименьшим числом findings (какой тип узнан), и
// печатается сводка. Это режим прогресса фазы, а не точной приёмки.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { diffTrees, formatFindings, summarize } from './diff.js'
import { evaluateSnippet } from './serialize.js'

const here = dirname(fileURLToPath(import.meta.url))
const expected = JSON.parse(readFileSync(resolve(here, 'expected/bubbles.json'), 'utf8'))
const config = JSON.parse(readFileSync(resolve(here, 'config.json'), 'utf8'))

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i === -1 ? undefined : (argv[i + 1] ?? true)
}
const has = (name) => argv.includes(name)

if (has('--list')) {
  for (const [key, v] of Object.entries(expected)) console.log(`${key.padEnd(46)} ${v.title}  (${v.source})`)
  process.exit(0)
}

if (has('--snippet')) {
  const selector = flag('--snippet')
  const props = flag('--props')
  const computedFor = flag('--computed-for')
  console.log(evaluateSnippet(typeof selector === 'string' ? selector : '.bubbles-inner', {
    ...(typeof computedFor === 'string' ? { computedFor: computedFor.split(',') } : {}),
    ...(typeof props === 'string' ? { props: props.split(',') } : {}),
  }))
  process.exit(0)
}

const actualPath = flag('--actual')
if (typeof actualPath !== 'string') {
  console.error('нужен --actual <файл со снимком> (или --list / --snippet <селектор>)')
  process.exit(2)
}
const actual = JSON.parse(readFileSync(resolve(process.cwd(), actualPath), 'utf8'))

const opts = { ignoreClasses: config.ignoreClasses, tolerance: config.tolerance, attrKeys: config.attrKeys }
const report = []

if (has('--all')) {
  // Все узлы снимка, похожие на бабл (класс bubble или его модуль-аналог) — верхний уровень.
  const bubbles = (actual.children ?? []).flatMap((g) => collectBubbles(g))
  report.push(`снимок: ${actualPath}`)
  report.push(`эталонов: ${Object.keys(expected).length}, баблов в снимке: ${bubbles.length}\n`)
  const detail = flag('--detail')
  const details = []
  // Классы-типы бабла: по ним отбираются кандидаты, иначе «лучшим» окажется
  // самый КОРОТКИЙ бабл снимка (у него меньше узлов — меньше findings), и
  // отчёт врёт: голосовое сравнивалось бы с сервисным.
  const TYPE_CLASSES = ['voice-message', 'audio-message', 'document-message', 'poll-message',
    'contact-message', 'call-message', 'is-album', 'sticker', 'emoji-big', 'round', 'photo',
    'video', 'service', 'is-date', 'is-sponsored', 'is-reply', 'forwarded', 'channel-post',
    'has-webpage']
  const typeSet = (n) => TYPE_CLASSES.filter((c) => n.classes.includes(c)).join(',')
  for (const [key, v] of Object.entries(expected)) {
    // Кандидат должен иметь РОВНО тот же набор классов-типов: иначе обычный
    // текстовый эталон (без типов) матчился бы на сервисный бабл или дату.
    const wanted = typeSet(v.tree)
    const sameType = bubbles.filter((b) => typeSet(b) === wanted)
    const candidates = sameType
    let best = null
    for (const b of candidates) {
      const f = diffTrees(v.tree, b, opts)
      if (!best || f.length < best.length) best = f
    }
    if (!sameType.length) {
      report.push(`${key.padEnd(46)} — в снимке нет бабла типа [${wanted || 'обычный текст'}]`)
      continue
    }
    const sum = best ? summarize(best) : {}
    report.push(`${key.padEnd(46)} ${best ? best.length : '—'} findings  ${JSON.stringify(sum)}`)
    if (best && (detail === true || detail === key)) details.push(formatFindings(best, key))
  }
  if (details.length) report.push('\n' + details.join('\n\n'))
  report.push('\nmissing-node не раскрывается вглубь: целое непортированное поддерево — одна строка.')
} else {
  const key = flag('--key')
  if (typeof key !== 'string' || !expected[key]) {
    console.error(`нужен --key из списка (--list). Получено: ${key}`)
    process.exit(2)
  }
  const findings = diffTrees(expected[key].tree, actual, opts)
  report.push(formatFindings(findings, key))
  report.push('\nсводка: ' + JSON.stringify(summarize(findings)))
}

const text = report.join('\n')
const out = flag('--out')
if (typeof out === 'string') {
  writeFileSync(resolve(process.cwd(), out), text + '\n')
  console.log(`отчёт → ${out}`)
} else {
  console.log(text)
}

/**
 * Найти в поддереве узлы-баблы (верхний уровень: не спускаемся внутрь найденного).
 * Маркер — `data-mid` (есть и у tweb, и у нас) либо класс `bubble`; по классу
 * искать недостаточно, пока поверхность не перестроена на классы tweb.
 */
function collectBubbles(node) {
  if (!node) return []
  const isBubble = node.attrs?.['data-mid'] != null || node.classes.includes('bubble')
  if (isBubble) return [node]
  return (node.children ?? []).flatMap(collectBubbles)
}
