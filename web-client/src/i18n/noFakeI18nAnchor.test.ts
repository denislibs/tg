// ── ПИН: класс `i18n` ставит только ЯДРО ────────────────────────────────────
//
// В tweb `.i18n` — не оформление, а ЯКОРЬ ОБХОДА: `applyLangPack` берёт
// `document.querySelectorAll('.i18n')`, достаёт для каждого узла инстанс из
// `weakMap` и зовёт `update()` (`lib/langPack.ts:568-572`, порт tweb
// `langPack.ts:328-335`). Ставит класс сам конструктор `IntlElement` (`:780`),
// то есть он ЯВЛЯЕТСЯ СЛЕДСТВИЕМ того, что узел построен ядром. CSS у класса
// нет ни в tweb (`grep` по `tweb/src/scss` пуст), ни у нас.
//
// Написанный руками `class="i18n"` этого следствия не имеет: узел в `weakMap`
// не записан, `weakMap.get` даёт `undefined`, и обход молча его пропускает.
// Получается разметка, которая ЧИТАЕТСЯ как локализованная, а поведения за ней
// нет. Ровно на этом обмане дефект дат (#121) прожил незамеченным: класс на
// месте, дата не менялась.
//
// ── Почему в React-разметке класс просто СНЯТ, а не сделан настоящим ─────────
// В React текст этих узлов и так следует за языком, но ДРУГИМ механизмом: на
// `language_apply` стор кладёт новый `t` (`src/i18n/index.tsx`), новая ссылка —
// сигнал перерисовки, и `t(key)` перечитывается. Механизм рабочий и свой.
// Класс же принадлежит механизму ЯДРА и обещает обход, которого не будет.
// Сделать эти узлы настоящими (через `DomNode` + `i18n(key)`) можно, но это
// заменило бы работающий механизм на равный по результату и более громоздкий —
// ради класса, у которого нет ни CSS, ни другого потребителя.
//
// Поэтому правило: класс `i18n` в продуктовом коде ставит только ядро. Места,
// где узел ОБЯЗАН быть узлом ядра (ванильный слой — там своей перерисовки нет),
// строятся через `i18n()`/`IntlElement` и класс получают от него.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/** Корень исходников — от МЕСТА ЭТОГО ФАЙЛА (разбор — в соседних пинах). */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Обоснованные исключения: `путь → причина`.
 *
 * Причина обязана нести НОМЕР ЗАДАЧИ, снимающей расхождение: оба оставшихся
 * места — ванильные, там подделка класса означает ещё и застывший текст (своей
 * перерисовки у ванильного узла нет), и чинится она не снятием класса, а
 * постройкой настоящего узла ядра. Это работа по подсистеме, а не правка строки.
 */
const ALLOWED: Record<string, string> = {
  // Ядро локализации — единственное место, которому класс ставить положено.
  'src/lib/langPack.ts': 'ВЛАДЕЛЕЦ класса: IntlElementBase ставит его на свой узел',
  // Футер комментариев под постом канала. У оригинала текст ведёт
  // `I18n.IntlElement` с `compareAndUpdate({key: 'Comments', args:[n]})`
  // (`chat/replies.ts:89-101`); у нас — строка из `commentsLabel`, и ключи наши
  // (`Chat.Title.Comments`/`Chat.CommentsLabel`) вместо `Comments`/`LeaveAComment`.
  'src/components/chat/replies.ts': 'ЗАДАЧА #128 — порт футера комментариев на IntlElement',
  // Фраза сервисного сообщения. У оригинала её собирает `_i18n(element, key, args)`
  // (`langPack.ts:652`), то есть узел ядра с подстановкой; у нас — сборка из
  // сегментов `serviceMsgSegs` с готовыми строками.
  'src/components/chat/serviceMessage.ts': 'ЗАДАЧА #129 — порт wrapMessageActionText на _i18n',
}

/** Пробелы вместо вырезанного — чтобы номер строки совпадал с номером в файле. */
const blank = (text: string) => text.replace(/[^\n]/g, ' ')
const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, blank)
  .replace(/(^|[^:])\/\/[^\n]*/g, (match: string, before: string) => before + blank(match.slice(before.length)))

/**
 * Класс, поставленный РУКАМИ, во всех трёх формах:
 * `className="i18n …"`, `classNames(…, 'i18n', …)`, `classList.add('i18n')`,
 * `el.className = 'i18n'`.
 */
const PATTERNS: RegExp[] = [
  /className\s*=\s*"[^"]*\bi18n\b[^"]*"/g,
  /className\s*=\s*'[^']*\bi18n\b[^']*'/g,
  /classNames\([^)]*['"]i18n['"]/g,
  /classList\.add\([^)]*['"]i18n['"]/g,
  /\.className\s*=\s*['"][^'"]*\bi18n\b/g,
]

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(path)) yield path
  }
}

/** Находки одного файла. Вынесено, чтобы проверить САМИ НОМЕРА СТРОК. */
export function fakeAnchors(source: string, rel: string) {
  const lines = stripComments(source).split('\n')
  const hits: string[] = []
  for (let i = 0; i < lines.length; i++) {
    for (const re of PATTERNS) {
      re.lastIndex = 0
      if (re.test(lines[i])) {
        hits.push(`${rel}:${i + 1}: ${lines[i].trim()}`)
        break
      }
    }
  }
  return hits
}

function scan() {
  const hits: string[] = []
  let files = 0
  for (const file of sourceFiles(SRC)) {
    const rel = relative(resolve(SRC, '..'), file)
    // Тесты класс ПРОВЕРЯЮТ, а не ставят — их разметка не идёт в бой.
    if (/\.test\.tsx?$/.test(rel)) continue
    if (rel in ALLOWED) continue
    files++
    hits.push(...fakeAnchors(readFileSync(file, 'utf8'), rel))
  }
  return { hits, files }
}

describe('класс i18n ставит только ядро', () => {
  it('скан вообще дошёл до исходников', () => {
    expect(scan().files).toBeGreaterThan(500)
  })

  it('ни один продуктовый модуль не пишет класс руками', () => {
    expect(scan().hits).toEqual([])
  })

  it('у каждого исключения, кроме владельца класса, есть номер задачи', () => {
    for (const [path, reason] of Object.entries(ALLOWED)) {
      if (path === 'src/lib/langPack.ts') continue
      expect(reason, path).toMatch(/ЗАДАЧА #\d+/)
    }
  })

  it('исключения не мёртвые: в каждом и правда есть такая строка', () => {
    // Иначе список пережил бы починку и стерёг бы пустоту.
    for (const path of Object.keys(ALLOWED)) {
      const hits = fakeAnchors(readFileSync(resolve(SRC, '..', path), 'utf8'), path)
      expect(hits.length, path).toBeGreaterThan(0)
    }
  })

  it('номер строки указывает на строку ФАЙЛА, а не обрезанного текста', () => {
    const source = [
      '/**',
      ' * Докблок: цитата `className="i18n"` внутри — не находка.',
      ' */',
      '// и в однострочном: classList.add(\'i18n\')',
      'const el = <span className="i18n">{t(\'X\')}</span>',
    ].join('\n')

    expect(fakeAnchors(source, 'x.tsx')).toEqual([
      'x.tsx:5: const el = <span className="i18n">{t(\'X\')}</span>',
    ])
  })
})
