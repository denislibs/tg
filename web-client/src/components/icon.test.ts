// Иконка (`components/icon.ts`, порт tweb `components/icon.ts`).
//
// Пиним ДВА разных предмета:
//  1. поведение — узел `span.tgico` с ГЛИФОМ шрифта (не с именем иконки: пустой
//     или неверный textContent даёт пустой квадрат, а ошибку видно только глазами)
//     и порядок классов/наложение `OverlayedIcon`;
//  2. единственность реализации — сканом исходников (по образцу
//     `core/scrollWriters.test.ts`): порт лежал ТРЕМЯ локальными копиями
//     (`mediaViewer/base.ts::iconSpan`, `wrappers/video.ts::iconSpan`,
//     `lib/richtext/icon.ts`) — враппер ленты не мог импортировать копию из
//     `base.ts`, потому что тот тянет react/react-dom. Возврат любой локальной
//     копии обязан красить тест.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import Icon, { getIconContent, OverlayedIcon } from './icon'
import Icons from '@core/tgico-icons'

describe('Icon — span.tgico с глифом', () => {
  it('кладёт КОДПОИНТ иконки, а не её имя', () => {
    const span = Icon('nosound')
    expect(span.tagName.toLowerCase()).toBe('span')
    expect(span.className).toBe('tgico')
    expect(span.textContent).toBe(String.fromCharCode(parseInt(Icons.nosound, 16)))
    expect(span.textContent).not.toBe('nosound')
    expect(span.textContent!.length).toBe(1)
  })

  it('дополнительные классы приезжают ПОСЛЕ tgico (на них висит размер/позиция глифа)', () => {
    const span = Icon('largeplay', 'button-icon', 'video-time-icon')
    expect(span.className).toBe('tgico button-icon video-time-icon')
  })

  it('каждый вызов — новый узел (одну и ту же иконку вешают в разные места)', () => {
    const a = Icon('check'), b = Icon('check')
    expect(a).not.toBe(b)
    expect(a.textContent).toBe(b.textContent)
  })

  it('getIconContent — глиф строкой, без узла', () => {
    expect(getIconContent('close')).toBe(String.fromCharCode(parseInt(Icons.close, 16)))
  })
})

describe('OverlayedIcon — иконка с плавающей поверх', () => {
  it('первая иконка обычная, остальные несут overlayed-icon__floating-icon', () => {
    const span = OverlayedIcon(['check', 'close'], 'my-class')
    expect(span.className).toBe('overlayed-icon my-class')

    const kids = [...span.children] as HTMLElement[]
    expect(kids).toHaveLength(2)
    expect(kids[0].className).toBe('tgico')
    expect(kids[0].textContent).toBe(getIconContent('check'))
    expect(kids[1].className).toBe('tgico overlayed-icon__floating-icon')
    expect(kids[1].textContent).toBe(getIconContent('close'))
  })

  it('per-icon className приезжает к своему узлу', () => {
    const span = OverlayedIcon([{ icon: 'check', className: 'base' }, { icon: 'close', className: 'floating' }])
    const kids = [...span.children] as HTMLElement[]
    expect(kids[0].className).toBe('tgico base')
    expect(kids[1].className).toBe('tgico overlayed-icon__floating-icon floating')
  })
})

// ── Пин: одна реализация на всех потребителей ────────────────────────────────
const SRC = join(__dirname, '..')

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
  }
  return acc
}

function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

/**
 * Постройка носителя глифа: класс `tgico` строкой в коде. Ловит и локальную
 * ванильную копию (`classList.add('tgico', ...)`), и JSX-копию.
 */
const TGICO_RE = /['"`]tgico['"`]|tgico \$\{|['"`]tgico /g

/**
 * Держатели класса `tgico` в JSX. Узел там строит JSX-рантайм, а не наша
 * функция, поэтому это не копии `Icon()`, но список ведём: рост = кто-то
 * рисует иконку в обход `<TgIcon>`/`<IconTsx>`/`Icon()`. Путь относительно
 * `src/` → число вхождений; правь список руками, а не подгоняй код под тест.
 */
const ALLOWED_TSX: Record<string, number> = {
  // React-версия порта (`<TgIcon>`): глиф берётся из той же карты
  // `@core/tgico-icons`, среда рендера другая (в tweb React'а нет вовсе).
  'components/TgIcon.tsx': 2,
  // Solid-версия порта (`<IconTsx>`, порт tweb `components/iconTsx.tsx`) —
  // ТРЕТИЙ законный рендер той же иконки и последний из трёх: у оригинала их
  // два (`icon.ts` + `iconTsx.tsx`), третий здесь — React, который уйдёт с
  // переездом витрины на Solid. Глиф во всех трёх — из одной карты
  // (`getIconContent`), поэтому расхождению взяться неоткуда.
  'components/iconTsx.solid.tsx': 1,
  // Инпут поиска: класс висит на уже существующем span'е разметки (порт tweb
  // `InputSearch`, где иконку кладёт ButtonIcon) — узел не строится.
  'shared/ui/InputSearch/InputSearch.tsx': 1,
  // Аватарка «Избранное» и галочка/стрелка пунктов меню — глиф из той же карты
  // прямо в JSX (порт разметки tweb, где его кладёт `Icon()`); свести к
  // `<TgIcon>` — отдельная работа, к ванильному порту отношения не имеет.
  'shared/ui/Avatar/Avatar.tsx': 1,
  'shared/ui/Menu/MenuItem.tsx': 1,
  // Пустые span'ы: глиф им ставит CSS (`content` у класса), а не JS.
  'components/UserInfoPanel.tsx': 2,
  'components/group/GroupEditFlow.tsx': 1,
}

describe('tgico: единственный ванильный строитель глифа — components/icon.ts', () => {
  it('в ванильном коде (.ts) класс tgico ставит ТОЛЬКО общий модуль', () => {
    const offenders: Record<string, number> = {}
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, '/')
      if (rel.endsWith('.tsx') || rel === 'components/icon.ts') continue
      const count = (codeOf(file).match(TGICO_RE) ?? []).length
      if (count > 0) offenders[rel] = count
    }

    expect(offenders).toEqual({})
  })

  it('JSX-держатели класса — только известные (React-сторона)', () => {
    const actual: Record<string, number> = {}
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, '/')
      if (!rel.endsWith('.tsx')) continue
      const count = (codeOf(file).match(TGICO_RE) ?? []).length
      if (count > 0) actual[rel] = count
    }

    expect(actual).toEqual(ALLOWED_TSX)
  })

  it('оба потребителя берут иконку из общего модуля', () => {
    for (const rel of ['components/wrappers/video.ts', 'components/mediaViewer/base.ts']) {
      expect(codeOf(join(SRC, rel))).toContain("from '@components/icon'")
    }
  })
})
