#!/usr/bin/env node
// DOM-diff харнес, часть 4 — генерация эталонов из живого DOM-референса.
//
//   node scripts/domdiff/extract-expected.js
//
// Читает дампы `docs/research/tweb-dom/*.json` и раскладывает их по эталонам:
//   expected/bubbles.json  — деревья баблов ленты (фаза 2)
//   expected/viewers.json  — деревья полноэкранных поверхностей (фаза 5)
//   expected/computed.json — блоки замеров из тех же дампов
//   expected/anims.json    — списки бегущих анимаций из тех же дампов
// Эталоны генерируемые — руками не правим, правим источник или список секций.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDump, slugify } from './parseDump.js'

const here = dirname(fileURLToPath(import.meta.url))
const DUMPS = resolve(here, '../../../docs/research/tweb-dom')
const OUT = resolve(here, 'expected')

// Файлы-дампы с баблами. Порядок влияет только на порядок ключей в выдаче.
const BUBBLE_SOURCES = [
  '03-bubbles-123.json',
  '03c-sticker-poll-video.json',
  '03-album-channel.json',
  '03-document.json',
  '03-reply-audio.json',
  '03-service-round.json',
  '03-video-poll.json',
]

// Полноэкранные поверхности (фаза 5). У каждой — селектор, которым снимается
// наш стенд (`run.js --snippet <selector>`), и режим сравнения:
//   'classes'   — имена классов значимы (медиавьюер: tweb пишет их руками);
//   'structure' — имена классов у tweb и у нас одинаково хешированы CSS-модулями,
//                 differ гасит их с обеих сторон (config.moduleClasses) и сверяет
//                 теги, порядок, вложенность, немодульные классы и computed.
// `pick` — регулярка по классу узла, с которого начинается эталон: у сториз
// корень дампа — статичный маунт `#stories-viewer` плюс обёртка solid-js Portal,
// в наш DOM они не переносятся (React-портал обёртки не создаёт).
const VIEWER_SOURCES = [
  {
    file: '09-media-viewer.json',
    selector: '.media-viewer-whole',
    mode: 'classes',
  },
  {
    file: '07b-stories-viewer.json',
    // Маунт `#stories-viewer` есть и у tweb (index.html), и у нас; первый его
    // ребёнок — корень вьюера (у tweb между ними ещё обёртка solid-js Portal).
    selector: '#stories-viewer > div',
    mode: 'structure',
    pick: /^_Viewer_/,
    mount: 'stories-viewer',
  },
  // Фаза 6 — композер. Все три дампа сняты в чате «123 123»: композер в покое
  // (в черновике был reply-хелпер — снят как есть), эмодзи-дропдаун открыт
  // кликом по toggle-emoticons, attach-меню — кликом по скрепке.
  {
    file: '04-composer-rest.json',
    selector: '.chat-input',
    mode: 'classes',
  },
  {
    file: '04-emoji-dropdown.json',
    selector: '.emoji-dropdown',
    mode: 'classes',
  },
  {
    // Меню скрепки живёт не внутри композера, а отдельным узлом в body.
    file: '04-attach-menu.json',
    selector: '.btn-menu.top-right',
    mode: 'classes',
  },
  // Экран авторизации (дампы `13-auth-*.json`, снято живьём 2026-08-09 в
  // изолированном браузерном контексте `tweb-auth-recon`). В tweb auth-флоу —
  // единственная поверхность на CSS-модулях (`pages/authFlow.module.scss`,
  // `components/mediaHeader.module.scss`, `components/codeInputField.module.scss`),
  // поэтому режим только 'structure': дословный перенос хешей невозможен, но
  // теги, порядок, вложенность и ГЛОБАЛЬНЫЕ классы (`whole`, `btn-icon`, `rp`,
  // `c-ripple`, `tgico`, `scrollable`, `input-wrapper`, `input-field`,
  // `input-select`, `select-wrapper`, `btn-primary`, `i18n`, `text-center`,
  // `media-sticker-wrapper`, `preloader`, `avatar-edit`…) обязаны совпасть.
  // Корень эталона — маунт `#auth-pages`: он есть и в tweb, и в целевой вёрстке.
  // `selectors` — переопределение селектора для отдельных секций файла
  // (выпадающий список стран снимается своим селектором, не от `#auth-pages`).
  {
    file: '13-auth-signqr.json',
    selector: '#auth-pages',
    mode: 'structure',
  },
  {
    file: '13-auth-signin.json',
    selector: '#auth-pages',
    mode: 'structure',
    selectors: {
      'auth-country-dropdown-select-wrapper': '.input-field.input-select .select-wrapper',
      'auth-country-dropdown-li': '.input-field.input-select .select-wrapper li',
    },
  },
  {
    file: '13-auth-authcode.json',
    selector: '#auth-pages',
    mode: 'structure',
  },
  {
    file: '13-auth-password.json',
    selector: '#auth-pages',
    mode: 'structure',
  },
  {
    file: '13-auth-signup.json',
    selector: '#auth-pages',
    mode: 'structure',
  },
  {
    file: '13-auth-emailrecover.json',
    selector: '#auth-pages',
    mode: 'structure',
  },
  {
    file: '13-auth-signimport.json',
    selector: '#auth-pages',
    mode: 'structure',
  },
]

/** Спуск к первому узлу, чей класс подходит под `re` (обход в глубину). */
function pickSubtree(node, re) {
  if (!node) return null
  if (node.classes.some((c) => re.test(c))) return node
  for (const child of node.children ?? []) {
    const found = pickSubtree(child, re)
    if (found) return found
  }
  return null
}

const bubbles = {}
const viewers = {}
const computed = {}
const anims = {}

function collect(file, onTree) {
  const raw = JSON.parse(readFileSync(resolve(DUMPS, file), 'utf8'))
  for (const section of parseDump(raw)) {
    if (section.computed) computed[`${file}:${section.title}`] = section.computed
    else if (section.anims) anims[`${file}:${section.title}`] = section.anims
    else onTree(section)
  }
}

for (const file of BUBBLE_SOURCES) {
  collect(file, (section) => {
    const key = slugify(section.title)
    if (bubbles[key]) {
      console.warn(`! дубль ключа ${key} (${file}) — пропущен`)
      return
    }
    bubbles[key] = { source: file, title: section.title, tree: section.tree }
  })
}

for (const src of VIEWER_SOURCES) {
  collect(src.file, (section) => {
    const tree = src.pick ? pickSubtree(section.tree, src.pick) : section.tree
    if (!tree) {
      console.warn(`! в ${src.file} нет узла под ${src.pick} — секция «${section.title}» пропущена`)
      return
    }
    const key = slugify(section.title)
    viewers[key] = {
      source: src.file,
      title: section.title,
      selector: src.selectors?.[key] ?? src.selector,
      mode: src.mode,
      ...(src.mount ? { mount: src.mount } : {}),
      tree,
    }
  })
}

mkdirSync(OUT, { recursive: true })
writeFileSync(resolve(OUT, 'bubbles.json'), JSON.stringify(bubbles, null, 2) + '\n')
writeFileSync(resolve(OUT, 'viewers.json'), JSON.stringify(viewers, null, 2) + '\n')
writeFileSync(resolve(OUT, 'computed.json'), JSON.stringify(computed, null, 2) + '\n')
writeFileSync(resolve(OUT, 'anims.json'), JSON.stringify(anims, null, 2) + '\n')

const count = (n) => 1 + (n.children ?? []).reduce((s, c) => s + count(c), 0)
for (const [key, v] of Object.entries(bubbles)) {
  console.log(`${key.padEnd(46)} ${String(count(v.tree)).padStart(4)} узлов  (${v.source})`)
}
for (const [key, v] of Object.entries(viewers)) {
  console.log(`${key.padEnd(46)} ${String(count(v.tree)).padStart(4)} узлов  (${v.source}, ${v.mode})`)
}
console.log(
  `\n${Object.keys(bubbles).length} эталонов баблов, ${Object.keys(viewers).length} поверхностей, ` +
  `${Object.keys(computed).length} блоков computed, ${Object.keys(anims).length} блоков анимаций ` +
  '→ scripts/domdiff/expected/',
)
