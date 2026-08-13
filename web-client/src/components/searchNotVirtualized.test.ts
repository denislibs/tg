// Пин к поправке спеки этапа 4: выдача поиска НЕ идёт через ядро виртуализации.
//
// Родительская спека (`docs/superpowers/specs/2026-08-12-dialogs-ownership-and-virtual-list-design.md`)
// называла `SearchView` потребителем ядра «с itemSize 72». Проверка исходников
// tweb это не подтвердила: `itemSize: 72` в `appSearchSuper` относится к вкладке
// «Избранное» (`appSearchSuper.ts:1897-1907`, `loadSavedDialogs`), а обычные
// результаты поиска — чаты, глобальный поиск, сообщения, медиа, ссылки, файлы,
// музыка, голосовые — идут СЕКЦИЯМИ с заголовками и медиа-гридом, которых список
// однородных строк фиксированной высоты не умеет. Разбор — раздел «Поправка к
// родительской спеке» в `docs/superpowers/specs/2026-08-13-remaining-lists-design.md`.
//
// Без этого пина следующий подход «допишет» `SearchView` по инерции — по
// родительской спеке, а не по tweb. Скан по исходникам — образец
// `stores/noManualOrder.test.ts:76-84`.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const WHY = [
  'SearchView не виртуализируем — см. раздел «Поправка к родительской спеке» в',
  'docs/superpowers/specs/2026-08-13-remaining-lists-design.md.',
  'Коротко: в tweb `itemSize: 72` (appSearchSuper.ts:1905) относится к вкладке',
  '«Избранное», а обычные результаты поиска идут секциями с заголовками и',
  'медиа-гридом, которые список фиксированной высоты не умеет.',
].join(' ')

const SRC = readFileSync(join(__dirname, 'SearchView.tsx'), 'utf8')
  // Комментарии выкидываем: в них про виртуализацию можно писать прозой —
  // инвариант про код, а не про документацию.
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

describe('SearchView: результаты поиска мимо ядра виртуализации', () => {
  it('не импортирует components/virtual/', () => {
    const fromVirtual = [...SRC.matchAll(/from\s+'([^']+)'/g)]
      .map((m) => m[1])
      .filter((path) => /(^|\/)virtual\//.test(path))

    expect(fromVirtual, WHY).toEqual([])
  })

  it('не упоминает сами компоненты ядра (импорт мог бы приехать и другим путём)', () => {
    expect(SRC.match(/DeferredSortedVirtualList|VerticalVirtualList/g) ?? [], WHY).toEqual([])
  })
})
