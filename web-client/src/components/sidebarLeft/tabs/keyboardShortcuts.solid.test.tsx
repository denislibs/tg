/** @jsxImportSource solid-js */
/**
 * Вкладка «Горячие клавиши» (`keyboardShortcuts.solid.tsx`, порт tweb
 * `sidebarLeft/tabs/keyboardShortcuts.tsx`, 812502980) — задача 10 плана волны 2D.
 *
 * Вкладка гоняется НАСТОЯЩАЯ — `AppKeyboardShortcutsTab` из `solidJsTabs/tabs.ts`,
 * открытая через колоночный слайдер (`sidebarLeft/columnSlider.ts`) тем же путём, что строка корня
 * настроек. Стаб — только платформа (`IS_APPLE`): от неё зависят подписи клавиш.
 *
 * Предмет — видимое в DOM:
 *  • состав: секции и строки — ровно те сочетания, которые клиент обрабатывает
 *    (строк без обработчика у нас на вкладке нет);
 *  • строка — `Row.Title` с `titleRight` + `titleRightSecondary` (классы
 *    `row-title-right row-title-right-secondary`), клавиши — чипы `kbd` через `+`;
 *  • подпись секции — вне карточки (ребёнок `-container`);
 *  • подписи клавиш по платформе (⌘/⇧ на Apple, Ctrl/Shift на остальных);
 *  • остров снят после закрытия (DoD 5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type SliderSuperTab from '@components/sliderTab'
import lang from '@/lang'
import { AppKeyboardShortcutsTab } from '@components/solidJsTabs/tabs'
import { mountTestColumnSlider, type TestColumnSlider } from '@/test/columnSlider'
import styles from './keyboardShortcuts.module.scss'

const platform = vi.hoisted(() => ({ apple: false }))
vi.mock('@environment/userAgent', async(importOriginal) => ({
  ...(await importOriginal<object>()),
  get IS_APPLE() { return platform.apple },
}))

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let host: TestColumnSlider

beforeEach(() => {
  platform.apple = false
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = mountTestColumnSlider(columnEl, {} as Managers)
})

afterEach(async() => {
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const open = () => host.openTab(AppKeyboardShortcutsTab)

function sections(tab: SliderSuperTab) {
  return [...tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-container')]
}

function section(tab: SliderSuperTab, name: string) {
  const el = sections(tab).find((c) => c.querySelector('.sidebar-left-section-name')?.textContent === name)
  if(!el) throw new Error('no section ' + name)
  return el
}

function row(tab: SliderSuperTab, title: string) {
  const el = [...tab.scrollable.container.querySelectorAll<HTMLElement>('.row')]
    .find((r) => r.querySelector('.row-title')?.textContent === title)
  if(!el) throw new Error('no row ' + title)
  return el
}

/** Подписи клавиш строки: тексты чипов, разделители — как есть. */
function keysOf(rowEl: HTMLElement) {
  const keys = rowEl.querySelector('.' + styles.keys)
  if(!keys) throw new Error('no keys')
  return [...keys.querySelectorAll(`.${styles.kbd}, .${styles.plus}, .${styles.or}`)].map((el) => el.textContent)
}

describe('вкладка «Горячие клавиши» — состав', () => {
  it('секции и строки — только сочетания, которые клиент обрабатывает, в порядке tweb', async() => {
    const tab = await open()
    const table = sections(tab).map((c) => [
      c.querySelector('.sidebar-left-section-name')!.textContent,
      [...c.querySelectorAll('.row')].map((r) => r.querySelector('.row-title')!.textContent),
    ])
    expect(table).toEqual([
      [lang['KeyboardShortcuts.Section.Formatting'], [
        lang['KeyboardShortcuts.Action.Bold'],
        lang['KeyboardShortcuts.Action.Italic'],
        lang['KeyboardShortcuts.Action.Underline'],
        lang['KeyboardShortcuts.Action.Strikethrough'],
        lang['KeyboardShortcuts.Action.Monospace'],
        lang['KeyboardShortcuts.Action.Spoiler'],
        lang['KeyboardShortcuts.Action.Link'],
      ]],
      [lang['KeyboardShortcuts.Section.Messages'], [
        lang['KeyboardShortcuts.Action.Send'],
        lang['KeyboardShortcuts.Action.NewLine'],
      ]],
      [lang['KeyboardShortcuts.Section.Chat'], [
        lang['KeyboardShortcuts.Action.EditLast'],
        lang['KeyboardShortcuts.Action.ReplyToPrevious'],
        lang['KeyboardShortcuts.Action.NextChat'],
        lang['KeyboardShortcuts.Action.PreviousChat'],
      ]],
      [lang['KeyboardShortcuts.Section.Navigation'], [
        lang['KeyboardShortcuts.Action.OpenSearch'],
        lang['KeyboardShortcuts.Action.SavedMessages'],
        lang['KeyboardShortcuts.Action.ClosePopup'],
      ]],
      [lang['KeyboardShortcuts.Section.MediaViewer'], [
        lang['KeyboardShortcuts.Action.NextMedia'],
        lang['KeyboardShortcuts.Action.PreviousMedia'],
        lang['KeyboardShortcuts.Action.ZoomIn'],
        lang['KeyboardShortcuts.Action.ZoomOut'],
      ]],
      [lang['KeyboardShortcuts.Section.Stories'], [
        lang['KeyboardShortcuts.Action.NextStory'],
        lang['KeyboardShortcuts.Action.PreviousStory'],
        lang['KeyboardShortcuts.Action.PlayPauseStory'],
        lang['KeyboardShortcuts.Action.CloseStories'],
      ]],
      [lang['KeyboardShortcuts.Section.MediaEditor'], [
        lang['KeyboardShortcuts.Action.Undo'],
        lang['KeyboardShortcuts.Action.Redo'],
      ]],
    ])
  })

  it('клавиши строк — те, что слушает клиент', async() => {
    const tab = await open()
    expect(keysOf(row(tab, lang['KeyboardShortcuts.Action.Link']))).toEqual(['Ctrl', '+', 'K'])
    expect(keysOf(row(tab, lang['KeyboardShortcuts.Action.Send']))).toEqual(['Enter'])
    expect(keysOf(row(tab, lang['KeyboardShortcuts.Action.NewLine']))).toEqual(['Shift', '+', 'Enter'])
    expect(keysOf(row(tab, lang['KeyboardShortcuts.Action.NextChat']))).toEqual(['Alt', '+', '↓'])
    expect(keysOf(row(tab, lang['KeyboardShortcuts.Action.SavedMessages']))).toEqual(['Ctrl', '+', '0'])
    expect(keysOf(row(tab, lang['KeyboardShortcuts.Action.ClosePopup']))).toEqual(['Esc'])
    expect(keysOf(row(tab, lang['KeyboardShortcuts.Action.ZoomOut']))).toEqual(['Ctrl', '+', '−'])
    expect(keysOf(row(tab, lang['KeyboardShortcuts.Action.PlayPauseStory']))).toEqual(['Space'])
    // tweb :245 — два сочетания через «/»
    expect(keysOf(row(tab, lang['KeyboardShortcuts.Action.Redo'])))
      .toEqual(['Ctrl', '+', 'Shift', '+', 'Z', '/', 'Ctrl', '+', 'Y'])
  })

  it('на Apple модификаторы — символами (tweb KEY_LABELS)', async() => {
    platform.apple = true
    const tab = await open()
    expect(keysOf(row(tab, lang['KeyboardShortcuts.Action.Bold']))).toEqual(['⌘', '+', 'B'])
    expect(keysOf(row(tab, lang['KeyboardShortcuts.Action.NewLine']))).toEqual(['⇧', '+', '↵'])
    expect(keysOf(row(tab, lang['KeyboardShortcuts.Action.PreviousChat']))).toEqual(['⌥', '+', '↑'])
  })
})

describe('вкладка «Горячие клавиши» — разметка', () => {
  it('строка — Row.Title с правой частью secondary, клавиши внутри неё', async() => {
    const tab = await open()
    const rowEl = row(tab, lang['KeyboardShortcuts.Action.Bold'])
    expect(rowEl.classList.contains('no-subtitle')).toBe(true)
    const titleRow = rowEl.querySelector(':scope > .row-row.row-title-row')!
    expect([...titleRow.children].map((el) => el.className)).toEqual([
      'row-title',
      'row-title row-title-right row-title-right-secondary',
    ])
    expect(titleRow.children[1].firstElementChild!.className).toBe(styles.keys)
  })

  it('подсказка — Row.Subtitle (EditLast, tweb :158-162)', async() => {
    const tab = await open()
    const rowEl = row(tab, lang['KeyboardShortcuts.Action.EditLast'])
    expect(rowEl.classList.contains('no-subtitle')).toBe(false)
    expect(rowEl.querySelector('.row-subtitle')!.textContent).toBe(lang['KeyboardShortcuts.Hint.WhenInputEmpty'])
  })

  it('подпись «Форматирования» — под карточкой; у «Сообщений» подписи нет (выбора отправки нет)', async() => {
    const tab = await open()
    const container = section(tab, lang['KeyboardShortcuts.Section.Formatting'])
    const captionEl = container.querySelector('.sidebar-left-section-caption')!
    expect(captionEl.textContent).toBe(lang['KeyboardShortcuts.Section.Formatting.Caption'])
    expect(captionEl.parentElement).toBe(container)

    expect(section(tab, lang['KeyboardShortcuts.Section.Messages']).querySelector('.sidebar-left-section-caption')).toBeNull()
  })
})

describe('вкладка «Горячие клавиши» — каркас', () => {
  it('шапка — KeyboardShortcuts.Title', async() => {
    const tab = await open()
    expect(tab.container.querySelector('.sidebar-header__title')!.textContent)
      .toBe(lang['KeyboardShortcuts.Title'])
  })

  it('после закрытия Solid-остров снят: секций в DOM нет (DoD 5)', async() => {
    const tab = await open()
    expect(document.querySelectorAll('.sidebar-left-section-container').length).toBeGreaterThan(0)

    tab.close()
    await pause(400)

    expect(document.querySelectorAll('.sidebar-left-section-container')).toHaveLength(0)
    expect(tab.container.isConnected).toBe(false)
  })
})
