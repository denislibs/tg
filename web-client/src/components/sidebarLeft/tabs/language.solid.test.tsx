/** @jsxImportSource solid-js */
/**
 * Тесты вкладки «Язык» (`language.solid.tsx`, порт tweb
 * `sidebarLeft/tabs/language.tsx`).
 *
 * Вкладка гоняется НАСТОЯЩАЯ — через `AppLanguageTab` из `solidJsTabs/tabs.ts`:
 * так под пином оказывается и объявление вкладки (заголовок, ленивый модуль),
 * и её содержимое. Стаб — только слайдер (`sliderTab.testStub.ts`, общий с
 * остальными тестами вкладок) и менеджер языков.
 *
 * Предмет проверок — ровно то, чем вкладка отличается от «списка строк»:
 *  • открытие ЖДЁТ список (сбор в `promiseCollector`), а не въезжает пустым;
 *  • порядок строк — СЕРВЕРНЫЙ, вкладка его не сортирует;
 *  • отмечен ПРИМЕНЁННЫЙ язык, а не тот, по которому кликнули;
 *  • клик применяет язык через ядро.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LangPackLanguage } from '@layer'
import I18n from '@lib/langPack'
import { createSliderStub } from '@components/sliderTab.testStub'
import { AppLanguageTab } from '@components/solidJsTabs/tabs'

/** Поля конструктора, которые вкладка не читает, но тип требует. */
const rest = { plural_code: '', strings_count: 0, translated_count: 0, translations_url: '' }

const LANGS: LangPackLanguage[] = [
  { _: 'langPackLanguage', name: 'English', native_name: 'English', lang_code: 'en', pFlags: {}, ...rest },
  { _: 'langPackLanguage', name: 'Russian', native_name: 'Русский', lang_code: 'ru', pFlags: {}, ...rest },
  { _: 'langPackLanguage', name: 'German', native_name: 'Deutsch', lang_code: 'de', pFlags: {}, ...rest },
]

let getLanguages: ReturnType<typeof vi.fn>
let getCacheLangPackAndApply: ReturnType<typeof vi.spyOn>
let getLangPackAndApply: ReturnType<typeof vi.spyOn>

function makeTab() {
  const tab = new AppLanguageTab(createSliderStub(), true)
  tab.managers = { langPack: { getLanguages } } as never
  return tab
}

beforeEach(() => {
  getLanguages = vi.fn(async () => LANGS)
  getCacheLangPackAndApply = vi.spyOn(I18n, 'getCacheLangPackAndApply')
    .mockResolvedValue({ _: 'langPackDifference', lang_code: 'ru', from_version: 0, version: 1, strings: [] })
  getLangPackAndApply = vi.spyOn(I18n, 'getLangPackAndApply').mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('вкладка «Язык»', () => {
  it('к моменту открытия список УЖЕ нарисован', async () => {
    const tab = makeTab()
    await tab.open()

    const rows = tab.scrollable.container.querySelectorAll('.row')
    expect(rows).toHaveLength(LANGS.length)
  })

  it('открытие ЖДЁТ ответ ручки, а не показывает пустую секцию', async () => {
    let release!: (langs: LangPackLanguage[]) => void
    getLanguages.mockImplementation(() => new Promise<LangPackLanguage[]>((r) => { release = r }))

    const tab = makeTab()
    const opened = vi.fn()
    const p = tab.open().then(opened)

    // Граница макрозадачи сливает всю очередь микрозадач — тот же приём, что в
    // `scaffoldSolidJSTab.solid.test.tsx`: считать тики вручную хрупко.
    await new Promise((r) => setTimeout(r, 0))
    expect(opened).not.toHaveBeenCalled()

    release(LANGS)
    await p
    expect(opened).toHaveBeenCalled()
  })

  it('порядок строк — серверный, вкладка его НЕ сортирует', async () => {
    const tab = makeTab()
    await tab.open()

    const codes = [...tab.scrollable.container.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .map((input) => input.value)
    // Английский, русский, немецкий — в выдаче именно так (предложенные первыми),
    // алфавит дал бы 'de', 'en', 'ru'.
    expect(codes).toEqual(['en', 'ru', 'de'])
  })

  it('строка несёт имя языка и его самоназвание', async () => {
    const tab = makeTab()
    await tab.open()

    const row = tab.scrollable.container.querySelectorAll('.row')[1]
    expect(row.textContent).toContain('Russian')
    expect(row.textContent).toContain('Русский')
  })

  it('отмечен ПРИМЕНЁННЫЙ язык, а не первый в списке', async () => {
    const tab = makeTab()
    await tab.open()

    const checked = [...tab.scrollable.container.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .filter((input) => input.checked)
      .map((input) => input.value)

    expect(getCacheLangPackAndApply).toHaveBeenCalled()
    expect(checked).toEqual(['ru'])
  })

  it('применённого языка нет в серверном списке — молча ничего не отмечено', async () => {
    getCacheLangPackAndApply.mockResolvedValue(
      { _: 'langPackDifference', lang_code: 'xx', from_version: 0, version: 1, strings: [] } as never,
    )

    const tab = makeTab()
    await expect(tab.open()).resolves.toBeUndefined()

    const checked = [...tab.scrollable.container.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .filter((input) => input.checked)
    expect(checked).toHaveLength(0)
  })

  it('выбор строки применяет язык через ядро', async () => {
    const tab = makeTab()
    await tab.open()

    const german = tab.scrollable.container.querySelector<HTMLInputElement>('input[value="de"]')!
    german.checked = true
    german.dispatchEvent(new Event('change', { bubbles: true }))

    expect(getLangPackAndApply).toHaveBeenCalledWith('de')
  })
})
