#!/usr/bin/env node
// DOM-diff харнес, часть 4 — генерация эталонов из живого DOM-референса.
//
//   node scripts/domdiff/extract-expected.js
//
// Читает дампы `docs/research/tweb-dom/*.json`, разбирает деревья баблов и кладёт
// их в `expected/bubbles.json` (структура) и `expected/computed.json` (замеры).
// Эталоны генерируемые — руками не правим, правим источник или список секций.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDump, slugify } from './parseDump.js'

const here = dirname(fileURLToPath(import.meta.url))
const DUMPS = resolve(here, '../../../docs/research/tweb-dom')
const OUT = resolve(here, 'expected')

// Файлы-дампы с баблами. Порядок влияет только на порядок ключей в выдаче.
const SOURCES = [
  '03-bubbles-123.json',
  '03c-sticker-poll-video.json',
  '03-album-channel.json',
  '03-document.json',
  '03-reply-audio.json',
  '03-service-round.json',
  '03-video-poll.json',
]

const bubbles = {}
const computed = {}

for (const file of SOURCES) {
  const raw = JSON.parse(readFileSync(resolve(DUMPS, file), 'utf8'))
  for (const section of parseDump(raw)) {
    if (section.computed) {
      computed[`${file}:${section.title}`] = section.computed
      continue
    }
    const key = slugify(section.title)
    if (bubbles[key]) {
      console.warn(`! дубль ключа ${key} (${file}) — пропущен`)
      continue
    }
    bubbles[key] = { source: file, title: section.title, tree: section.tree }
  }
}

mkdirSync(OUT, { recursive: true })
writeFileSync(resolve(OUT, 'bubbles.json'), JSON.stringify(bubbles, null, 2) + '\n')
writeFileSync(resolve(OUT, 'computed.json'), JSON.stringify(computed, null, 2) + '\n')

const count = (n) => 1 + (n.children ?? []).reduce((s, c) => s + count(c), 0)
for (const [key, v] of Object.entries(bubbles)) {
  console.log(`${key.padEnd(46)} ${String(count(v.tree)).padStart(4)} узлов  (${v.source})`)
}
console.log(`\n${Object.keys(bubbles).length} эталонов, ${Object.keys(computed).length} блоков computed → scripts/domdiff/expected/`)
