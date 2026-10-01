/** @jsxImportSource solid-js */
/**
 * Тесты вкладки «Язык» (`language.solid.tsx`, порт tweb
 * `sidebarLeft/tabs/language.tsx`, 812502980).
 *
 * Вкладка гоняется НАСТОЯЩАЯ — `AppLanguageTab` из `solidJsTabs/tabs.ts`,
 * открытая через колоночный слайдер (`sidebarLeft/columnSlider.ts`) тем же путём, что строка корня
 * настроек: под пином и объявление вкладки, и её содержимое, и уборка острова на
 * закрытии. Стабы — только границы: менеджер языков (воркер), применение пакета
 * (`I18n`) и геометрия (happy-dom её не считает).
 *
 * Предмет проверок:
 *  • разметка HEAD — `form` со строками `Row.RadioField` + `Row.Title` +
 *    `Row.Subtitle` прямо в секции, радио `disable-hover` (tweb `:127-150`);
 *  • открытие ЖДЁТ список (сбор в `promiseCollector`), а не въезжает пустым;
 *  • порядок строк — СЕРВЕРНЫЙ, вкладка его не сортирует;
 *  • на открытии отмечен ПРИМЕНЁННЫЙ язык, а не первый в списке;
 *  • клик по строке применяет язык ровно один раз и переносит отметку.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type { LangPackLanguage } from '@layer'
import type SliderSuperTab from '@components/sliderTab'
import lang from '@/lang'
import I18n from '@lib/langPack'
import { AppLanguageTab } from '@components/solidJsTabs/tabs'
import { mountTestColumnSlider, type TestColumnSlider } from '@/test/columnSlider'
import { installSpecLabelActivation } from '@/test/specLabelActivation'

/** Поля конструктора, которые вкладка не читает, но тип требует. */
const rest = { plural_code: '', strings_count: 0, translated_count: 0, translations_url: '' }

const LANGS: LangPackLanguage[] = [
  { _: 'langPackLanguage', name: 'English', native_name: 'English', lang_code: 'en', pFlags: {}, ...rest },
  { _: 'langPackLanguage', name: 'Russian', native_name: 'Русский', lang_code: 'ru', pFlags: {}, ...rest },
  { _: 'langPackLanguage', name: 'German', native_name: 'Deutsch', lang_code: 'de', pFlags: {}, ...rest },
]

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let host: TestColumnSlider
let uninstallLabelActivation: () => void
let getLanguages: ReturnType<typeof vi.fn>
let getCacheLangPackAndApply: ReturnType<typeof vi.spyOn>
let getLangPackAndApply: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  uninstallLabelActivation = installSpecLabelActivation()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)

  getLanguages = vi.fn(async() => LANGS)
  getCacheLangPackAndApply = vi.spyOn(I18n, 'getCacheLangPackAndApply')
    .mockResolvedValue({ _: 'langPackDifference', lang_code: 'ru', from_version: 0, version: 1, strings: [] })
  getLangPackAndApply = vi.spyOn(I18n, 'getLangPackAndApply').mockResolvedValue(undefined)

  const managers = { langPack: { getLanguages } } as unknown as Managers
  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = mountTestColumnSlider(columnEl, managers)
})

afterEach(async() => {
  uninstallLabelActivation()
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const open = () => host.openTab(AppLanguageTab)

const radios = (tab: SliderSuperTab) =>
  [...tab.scrollable.container.querySelectorAll<HTMLInputElement>('input[type="radio"]')]

const checkedCodes = (tab: SliderSuperTab) => radios(tab).filter((input) => input.checked).map((input) => input.value)

/** Строка по английскому имени языка. */
function row(tab: SliderSuperTab, name: string) {
  const el = [...tab.scrollable.container.querySelectorAll('.row')]
    .find((r) => r.querySelector('.row-title')?.textContent === name)
  if(!el) throw new Error('no row ' + name)
  return el as HTMLElement
}

describe('вкладка «Язык» — разметка HEAD', () => {
  it('одна секция без имени: строки — прямые дети form в карточке, без обёртки', async() => {
    const tab = await open()

    const containers = tab.scrollable.container.querySelectorAll('.sidebar-left-section-container')
    // Секция перевода сообщений (tweb `TranslateSection`) не портирована — шапка файла.
    expect(containers).toHaveLength(1)
    expect(containers[0].querySelector('.sidebar-left-section-name')).toBeNull()

    const form = containers[0].querySelector('.sidebar-left-section-content > form')!
    expect(form).not.toBeNull()
    expect([...form.children].map((child) => child.classList.contains('row'))).toEqual([true, true, true])
  })

  it('строка: радио слева (row-radio-field, disable-hover), имя — .row-title, самоназвание — .row-subtitle', async() => {
    const tab = await open()

    const russian = row(tab, 'Russian')
    expect(russian.tagName).toBe('LABEL')
    expect(russian.classList.contains('row-with-padding')).toBe(true)
    expect(russian.querySelector('.row-subtitle')!.textContent).toBe('Русский')

    const field = russian.querySelector('.radio-field')!
    expect([...field.classList].sort()).toEqual(['disable-hover', 'radio-field', 'row-radio-field'])
    // Слева, а не в правой части заголовка (`radioFieldRight` у «Языка» нет).
    expect(field.parentElement).toBe(russian)
    expect(russian.querySelector('.row-title-right')).toBeNull()
  })

  it('все радио — одна группа (общий name)', async() => {
    const tab = await open()
    const names = new Set(radios(tab).map((input) => input.name))
    expect(names.size).toBe(1)
    expect([...names][0]).not.toBe('')
  })
})

describe('вкладка «Язык» — список', () => {
  it('открытие ЖДЁТ ответ ручки, а не показывает пустую секцию', async() => {
    let release!: (langs: LangPackLanguage[]) => void
    getLanguages.mockImplementation(() => new Promise<LangPackLanguage[]>((r) => { release = r }))

    const opened = vi.fn()
    const p = open()
    void p.then(opened)

    // Граница макрозадачи сливает всю очередь микрозадач — тот же приём, что в
    // `scaffoldSolidJSTab.solid.test.tsx`: считать тики вручную хрупко.
    await pause(0)
    expect(opened).not.toHaveBeenCalled()

    release(LANGS)
    const tab = await p
    expect(opened).toHaveBeenCalled()
    expect(tab.scrollable.container.querySelectorAll('.row')).toHaveLength(LANGS.length)
  })

  it('порядок строк — серверный, вкладка его НЕ сортирует', async() => {
    const tab = await open()
    // Английский, русский, немецкий — в выдаче именно так (предложенные первыми),
    // алфавит дал бы 'de', 'en', 'ru'.
    expect(radios(tab).map((input) => input.value)).toEqual(['en', 'ru', 'de'])
  })

  it('отмечен ПРИМЕНЁННЫЙ язык, а не первый в списке', async() => {
    const tab = await open()
    expect(getCacheLangPackAndApply).toHaveBeenCalled()
    expect(checkedCodes(tab)).toEqual(['ru'])
  })

  it('применённого языка нет в серверном списке — молча ничего не отмечено', async() => {
    getCacheLangPackAndApply.mockResolvedValue(
      { _: 'langPackDifference', lang_code: 'xx', from_version: 0, version: 1, strings: [] } as never,
    )

    const tab = await open()
    expect(checkedCodes(tab)).toHaveLength(0)
  })
})

describe('вкладка «Язык» — выбор', () => {
  it('клик по ТЕКСТУ строки применяет язык ровно один раз и переносит отметку', async() => {
    const tab = await open()

    row(tab, 'German').querySelector<HTMLElement>('.row-title')!.click()

    expect(getLangPackAndApply).toHaveBeenCalledTimes(1)
    expect(getLangPackAndApply).toHaveBeenCalledWith('de')
    expect(checkedCodes(tab)).toEqual(['de'])
  })

  it('клик по радио — тоже ровно один раз', async() => {
    const tab = await open()

    row(tab, 'German').querySelector<HTMLInputElement>('input[type="radio"]')!.click()

    expect(getLangPackAndApply).toHaveBeenCalledTimes(1)
    expect(getLangPackAndApply).toHaveBeenCalledWith('de')
  })

  it('клик по уже отмеченному языку ничего не применяет', async() => {
    const tab = await open()

    row(tab, 'Russian').querySelector<HTMLElement>('.row-title')!.click()

    expect(getLangPackAndApply).not.toHaveBeenCalled()
  })
})

describe('вкладка «Язык» — каркас', () => {
  it('шапка — Telegram.LanguageViewController, с линией; контейнер language-container', async() => {
    const tab = await open()
    expect(tab.container.querySelector('.sidebar-header__title')!.textContent)
      .toBe(lang['Telegram.LanguageViewController'])
    expect(tab.header.classList.contains('with-border')).toBe(true)
    expect(tab.container.classList.contains('language-container')).toBe(true)
  })

  it('после закрытия Solid-остров снят: строк в DOM нет (DoD 5)', async() => {
    const tab = await open()
    expect(document.querySelectorAll('.row').length).toBeGreaterThan(0)

    tab.close()
    await pause(400)

    expect(document.querySelectorAll('.row')).toHaveLength(0)
    expect(tab.container.isConnected).toBe(false)
  })
})
