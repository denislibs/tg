// Пины `components/rowTsxController.solid.tsx` — порт tweb `components/rowTsxController.tsx`
// (812502980) в портированном объёме: императивный фасад над Solid `Row` для
// единственного потребителя — строки чатлиста (`lib/appDialogsManager.ts`, как у tweb
// `lib/appDialogsManager.ts:321`). Сценарии — из tweb `src/tests/rowTsxController.test.tsx`
// (`:136`, `:226`, `:247`, `:402`) на тех опциях, что у нас есть.
import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getMiddleware } from '@helpers/middleware'
import { attachRowController, type RowTsxController } from './rowTsxController.solid'

afterEach(() => document.body.replaceChildren())

const mountController = (options: Parameters<typeof attachRowController>[1]) => {
  const row = attachRowController({}, options)
  document.body.append(row.container)
  return row
}

describe('rowTsxController: части строки доступны императивному коду', () => {
  it('заголовок/подпись/правые слоты — узлы Solid `Row`, доступны синхронно после монтирования', () => {
    const row = mountController({
      title: true,
      titleRightSecondary: true,
      subtitle: true,
      subtitleRight: true,
      noWrap: true,
      noRipple: true,
    })

    expect(row.container.classList.contains('row')).toBe(true)
    expect(row.titleRow.className).toBe('row-row row-title-row')
    expect(row.title.className).toBe('row-title no-wrap')
    expect(row.title.parentElement).toBe(row.titleRow)
    expect(row.titleRight.className).toBe('row-title row-title-right row-title-right-secondary no-wrap')
    expect(row.subtitleRow.className).toBe('row-row row-subtitle-row')
    expect(row.subtitle.className).toBe('row-subtitle no-wrap')
    expect(row.subtitleRight.className).toBe('row-subtitle row-subtitle-right no-wrap')
    // порядок частей — HEAD `rowTsx.tsx:247-257`: заголовок, подпись
    expect(Array.from(row.container.children)).toEqual([row.titleRow, row.subtitleRow])
  })

  it('без `subtitle` подписи нет вовсе (tweb `:300-302`)', () => {
    const row = mountController({ title: true, noRipple: true })
    expect(row.container.querySelector('.row-subtitle')).toBeNull()
    expect(row.container.classList.contains('no-subtitle')).toBe(true)
  })

  it('applyMediaElement кладёт узел последним ребёнком с классами размера; замена снимает прежний (tweb тест `:136`)', () => {
    const row = mountController({ title: true, noRipple: true })

    const media = document.createElement('div')
    expect(row.applyMediaElement(media, 'abitbigger')).toBe(media)
    expect(row.media).toBe(media)
    expect(media.classList.contains('row-media')).toBe(true)
    expect(media.classList.contains('row-media-abitbigger')).toBe(true)
    expect(row.container.lastElementChild).toBe(media)
    expect(row.container.classList.contains('row-with-padding')).toBe(true)

    const replacement = document.createElement('div')
    row.applyMediaElement(replacement, 'big')
    expect(row.media).toBe(replacement)
    expect(replacement.classList.contains('row-media-big')).toBe(true)
    expect(replacement.parentElement).toBe(row.container)
    expect(media.parentElement).toBeNull()
    // классы части сняты с ушедшего узла (`registerExternalElement`)
    expect(media.classList.contains('row-media')).toBe(false)
  })

  it('ссылки на части стабильны, даже если императивный код заменил узел (tweb тест `:226`)', () => {
    const row = mountController({ title: true, subtitle: true, noRipple: true })
    const original = row.subtitle
    const replacement = original.cloneNode(true) as HTMLElement

    original.replaceWith(replacement)

    expect(row.subtitle).toBe(original)
    expect(row.container.querySelector('.row-subtitle')).toBe(replacement)
  })

  it('`asLink` — строка это `a`, `clickable: true` без функции не вешает обработчик клика', () => {
    const row = mountController({ title: true, clickable: true, asLink: true })
    expect(row.container.tagName).toBe('A')
    for(const cls of ['row-clickable', 'hover-effect', 'rp']) {
      expect(row.container.classList.contains(cls), cls).toBe(true)
    }
    // у ссылки роль не выводится (`inferredButton` требует отсутствия `as`)
    expect(row.container.hasAttribute('role')).toBe(false)
  })
})

describe('rowTsxController: время жизни Solid-корня', () => {
  it('корень гаснет на destroy переданной middleware, а не раньше (tweb тест `:247`)', () => {
    const helper = getMiddleware()
    const row = mountController({ title: true, noRipple: true, middleware: helper.get() })

    const before = document.createElement('div')
    row.applyMediaElement(before)
    expect(before.parentElement).toBe(row.container)

    helper.clean()
    // clean — отмена промисов, не разрушение: строка ещё живая
    const afterClean = document.createElement('div')
    row.applyMediaElement(afterClean)
    expect(afterClean.parentElement).toBe(row.container)

    helper.destroy()
    // корень разобран: сигнал медиа больше некому рисовать
    const afterDestroy = document.createElement('div')
    row.applyMediaElement(afterDestroy)
    expect(afterDestroy.parentElement).toBeNull()
  })

  it('dispose() идемпотентен', () => {
    const row = mountController({ title: true, noRipple: true })
    row.dispose()
    expect(() => row.dispose()).not.toThrow()
  })
})

describe('attachRowController: дескрипторы — на прототипе класса (tweb тест `:402`)', () => {
  it('у экземпляра нет своих свойств контроллера; части читаются через прототип, у каждого экземпляра — свои', () => {
    // eslint-disable-next-line typescript/no-unsafe-declaration-merging -- форма tweb (`appDialogsManager.ts:288-290`)
    interface TestRow extends RowTsxController {}
    // eslint-disable-next-line typescript/no-unsafe-declaration-merging -- форма tweb (`appDialogsManager.ts:288-290`)
    class TestRow {}

    const a = attachRowController(new TestRow(), { title: true, noRipple: true })
    const b = attachRowController(new TestRow(), { title: true, noRipple: true })

    expect(Object.prototype.hasOwnProperty.call(a, 'container')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(TestRow.prototype, 'container')).toBe(true)
    expect(a.container.classList.contains('row')).toBe(true)
    expect(a.container).not.toBe(b.container)
    expect(a.title).toBe(a.container.querySelector('.row-title'))
    a.dispose()
    b.dispose()
  })
})

// tweb `src/tests/rowTsxSafeMigrations.test.ts:56-66` — императивный контроллер
// остаётся мостом ТОЛЬКО для строки чатлиста; всё новое пишет JSX `<Row>`.
describe('граница миграции: контроллер — только у строки чатлиста', () => {
  const SRC = resolve(__dirname, '..')
  const collect = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name)
    if(entry.isDirectory()) return entry.name === 'node_modules' ? [] : collect(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : []
  })

  it('импортирует `rowTsxController.solid` только `lib/appDialogsManager.ts`', () => {
    const importers = collect(SRC)
      .filter((file) => !file.endsWith('rowTsxController.solid.tsx'))
      .filter((file) => /from '(?:@components|\.)\/rowTsxController\.solid'/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file))
    expect(importers).toEqual(['lib/appDialogsManager.ts'])
  })
})
