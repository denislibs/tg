/** @jsxImportSource solid-js */
/**
 * Вкладка «Автоудаление сообщений» (`autoDeleteMessages/index.solid.tsx`, порт tweb
 * `sidebarLeft/tabs/autoDeleteMessages/*`, 812502980) и попап своего срока
 * (`customTimePopup/*`) — задача 20 плана 2D (+ задача 11 плана 2C).
 *
 * Вкладка гоняется НАСТОЯЩАЯ — `AppMessagesAutoDeleteTab` из `solidJsTabs/tabs.ts`
 * через колоночный слайдер, тем же `createTab(…).open({period, onSaved})`, что у
 * строки хаба «Конфиденциальность». Попап подтверждения и попап срока — настоящие.
 * Стабы — только границы: запись периода (`managers.privacy.setAutoDelete`),
 * лотти-заставка, Web Animations (у happy-dom их нет) и геометрия.
 *
 * Предмет — DOM и сетевой вызов:
 *  • разметка: заставка, секция `AutoDeleteMessages.SectionTitle` с подписью ВНЕ
 *    карточки, четыре радио-строки (Off / 1 день / 1 неделя / 1 месяц) и строка
 *    «Set other time» с иконкой `tools`;
 *  • свой срок вне списка — радио-строка по порядку сроков; старые 30 дней — это
 *    «1 месяц» (±10%);
 *  • выбор НЕ пишется сразу: галочка в шапке появляется только при изменении, по
 *    клику — один `setAutoDelete`, `onSaved`, вкладка закрыта;
 *  • закрытие с изменениями — «Unsaved Changes» с Save/Discard: Save пишет,
 *    Discard закрывает без записи, крестик попапа оставляет вкладку;
 *  • попап срока: барабан «Never» + 16 сроков, «Save» отдаёт ВЫБРАННЫЙ срок;
 *  • DoD 5: закрытая вкладка снимает свой Solid-остров.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import lang from '@/lang'
import { AppMessagesAutoDeleteTab } from '@components/solidJsTabs/tabs'
import type SliderSuperTab from '@components/sliderTab'
import { installSidebarLeft, type InstalledSidebarLeft } from '@/test/sidebarLeft'
import { installSpecLabelActivation } from '@/test/specLabelActivation'
import lottieStyles from '@components/settingsTabLottieAnimation.module.scss'

vi.mock('@lib/lottie/lottieLoader', () => ({
  default: { loadAnimationAsAsset: vi.fn(async() => ({ playOrRestart() {}, remove() {} })) },
}))

const DAY = 86400
const WEEK = 7 * DAY
const MONTH = 31 * DAY

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor<T>(get: () => T | null | undefined | false, timeout = 3000): Promise<T> {
  const started = Date.now()
  for(;;) {
    const value = get()
    if(value) return value
    if(Date.now() - started > timeout) throw new Error('waitFor: timeout')
    await pause(10)
  }
}

// Первый `import()` модуля вкладки (с попапами и барабаном) в холодном vitest
// дольше тайм-аута теста — грузим его заранее.
beforeAll(async() => {
  await import('./index.solid')
}, 30000)

let host: InstalledSidebarLeft
let columnEl: HTMLElement
let setAutoDelete: ReturnType<typeof vi.fn>
let uninstallLabelActivation: () => void

beforeEach(() => {
  uninstallLabelActivation = installSpecLabelActivation()
  Element.prototype.animate = vi.fn(() => ({ finished: Promise.resolve() }) as unknown as Animation)
  // Барабан — 5 строк по 40px: середина (100px) над строкой `scrollTop / 40`.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420, height: 200 } as DOMRect)

  setAutoDelete = vi.fn(async(_period: number) => {})
  const managers = { privacy: { setAutoDelete } } as unknown as Managers

  columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = installSidebarLeft(managers, columnEl)
  columnEl = host.column // синглтон колонки — свой узел из статики
})

afterEach(async() => {
  uninstallLabelActivation()
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  delete (Element.prototype as { animate?: unknown }).animate
  vi.restoreAllMocks()
})

const open = (period: number, onSaved = vi.fn()) => host.openTab(AppMessagesAutoDeleteTab, { period, onSaved })

const tabEls = () => [...columnEl.querySelectorAll<HTMLElement>('.sidebar-slider > .tabs-tab.sidebar-slider-item:not(.item-main)')]

const radios = (tab: SliderSuperTab) =>
  [...tab.scrollable.container.querySelectorAll<HTMLInputElement>('input[type="radio"]')]

const rowTitles = (tab: SliderSuperTab) =>
  [...tab.scrollable.container.querySelectorAll('.row .row-title')].map((el) => el.textContent)

const checkedTitle = (tab: SliderSuperTab) =>
  radios(tab).find((input) => input.checked)?.closest('.row')?.querySelector('.row-title')?.textContent

function row(tab: SliderSuperTab, title: string) {
  const el = [...tab.scrollable.container.querySelectorAll<HTMLElement>('.row')]
    .find((r) => r.querySelector('.row-title')?.textContent === title)
  if(!el) throw new Error('no row ' + title)
  return el
}

const saveButton = (tab: SliderSuperTab) => tab.header.querySelector<HTMLButtonElement>('button.btn-icon.blue')

function popupButton(root: Element, text: string) {
  const el = [...root.querySelectorAll<HTMLButtonElement>('.popup-button')].find((b) => b.textContent === text)
  if(!el) throw new Error('no popup button ' + text)
  return el
}

describe('вкладка «Автоудаление» — разметка', () => {
  it('шапка, заставка и секция: подпись ВНЕ карточки, четыре срока и «Set other time»', async() => {
    const tab = await open(0)

    expect(tab.title.textContent).toBe(lang.AutoDeleteMessages)
    // Заставка — перед секцией: Space 1rem, лотти, Space 2rem (tweb :96-98).
    const lottie = tab.scrollable.container.querySelector(`.${lottieStyles.Container}`)!
    expect(lottie).not.toBeNull()
    const container = tab.scrollable.container.querySelector('.sidebar-left-section-container')!
    expect(lottie.compareDocumentPosition(container) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect((lottie.previousElementSibling as HTMLElement).style.paddingTop).toBe('1rem')
    expect((lottie.nextElementSibling as HTMLElement).style.paddingTop).toBe('2rem')

    expect(container.querySelector('.sidebar-left-section-name')!.textContent).toBe(lang['AutoDeleteMessages.SectionTitle'])
    const caption = container.querySelector('.sidebar-left-section-caption')!
    expect(caption.textContent).toBe(lang['AutoDeleteMessages.SectionCaption'])
    expect(caption.parentElement).toBe(container)

    expect(rowTitles(tab)).toEqual(['Off', '1 day', '1 week', '1 month', lang['AutoDeleteMessages.SetOtherTime']])
    expect(radios(tab).map((input) => input.value)).toEqual(['0', String(DAY), String(WEEK), String(MONTH)])
    expect(radios(tab).every((input) => input.name === 'input-radio-auto-delete-period')).toBe(true)

    const other = row(tab, lang['AutoDeleteMessages.SetOtherTime'])
    expect(other.querySelector('.row-icon.row-icon-colored > .row-icon-icon.tgico')).not.toBeNull()
    expect(other.querySelector('input')).toBeNull()
    // галочки сохранения нет, пока ничего не изменено
    expect(saveButton(tab)).toBeNull()
  })

  it('отмечен текущий период', async() => {
    const tab = await open(WEEK)
    expect(checkedTitle(tab)).toBe('1 week')
  })

  it('свой срок вне списка встаёт радио-строкой по порядку сроков', async() => {
    const tab = await open(3 * DAY)
    expect(rowTitles(tab).slice(0, 5)).toEqual(['Off', '1 day', '3 days', '1 week', '1 month'])
    expect(checkedTitle(tab)).toBe('3 days')

    const long = await open(6 * MONTH)
    expect(rowTitles(long).slice(0, 5)).toEqual(['Off', '1 day', '1 week', '1 month', '6 months'])

    // Срок вне барабана — подпись `formatDuration` (два старших разряда).
    const odd = await open(10 * DAY)
    const titles = rowTitles(odd)
    expect(titles.slice(0, 3)).toEqual(['Off', '1 day', '1 week'])
    expect(titles[3]).toMatch(/^1 week.*3 days$/)
    expect(titles[4]).toBe('1 month')
    expect(checkedTitle(odd)).toBe(titles[3])
  })

  it('старые 30 дней (прежний React-экран) — это «1 month», лишней строки нет', async() => {
    const tab = await open(30 * DAY)
    expect(rowTitles(tab)).toHaveLength(5)
    expect(checkedTitle(tab)).toBe('1 month')
  })
})

describe('вкладка «Автоудаление» — сохранение', () => {
  it('выбор не пишется сразу; галочка в шапке пишет один раз, зовёт onSaved и закрывает вкладку', async() => {
    const onSaved = vi.fn()
    const tab = await open(0, onSaved)

    row(tab, '1 week').querySelector<HTMLInputElement>('input')!.click()
    expect(checkedTitle(tab)).toBe('1 week')
    expect(setAutoDelete).not.toHaveBeenCalled()

    const btn = await waitFor(() => saveButton(tab))
    expect(btn.querySelector('.tgico')).not.toBeNull()
    btn.click()

    await waitFor(() => tabEls().length === 0)
    expect(setAutoDelete).toHaveBeenCalledTimes(1)
    expect(setAutoDelete).toHaveBeenCalledWith(WEEK)
    expect(onSaved).toHaveBeenCalledWith(WEEK)
  })

  it('возврат к исходному сроку снимает галочку', async() => {
    const tab = await open(0)
    row(tab, '1 day').querySelector<HTMLInputElement>('input')!.click()
    await waitFor(() => saveButton(tab))

    row(tab, 'Off').querySelector<HTMLInputElement>('input')!.click()
    await waitFor(() => !saveButton(tab))
  })

  it('закрытие без изменений — без попапа и без записи; остров снят (DoD 5)', async() => {
    const tab = await open(DAY)
    tab.closeBtn.click()

    await waitFor(() => tabEls().length === 0)
    await pause(300)
    expect(document.querySelector('.popup-confirmation')).toBeNull()
    expect(setAutoDelete).not.toHaveBeenCalled()
    expect(tab.scrollable.container.querySelector('.row')).toBeNull()
  })

  it('закрытие с изменениями спрашивает Unsaved Changes; Save пишет выбранное', async() => {
    const onSaved = vi.fn()
    const tab = await open(0, onSaved)
    row(tab, '1 month').querySelector<HTMLInputElement>('input')!.click()

    tab.closeBtn.click()
    const popup = await waitFor(() => document.querySelector('.popup-confirmation'))
    expect(popup.querySelector('.popup-title')!.textContent).toBe(lang.UnsavedChanges)
    expect(popup.querySelector('.popup-description')!.textContent).toBe(lang['UnsavedChangesDescription.Privacy'])
    expect([...popup.querySelectorAll('.popup-button')].map((b) => b.textContent)).toEqual(['Save', 'Discard'])
    expect(tabEls()).toHaveLength(1)

    popupButton(popup, 'Save').click()
    await waitFor(() => tabEls().length === 0)
    expect(setAutoDelete).toHaveBeenCalledTimes(1)
    expect(setAutoDelete).toHaveBeenCalledWith(MONTH)
    expect(onSaved).toHaveBeenCalledWith(MONTH)
  })

  it('Discard закрывает вкладку без записи', async() => {
    const tab = await open(0)
    row(tab, '1 month').querySelector<HTMLInputElement>('input')!.click()

    tab.closeBtn.click()
    const popup = await waitFor(() => document.querySelector('.popup-confirmation'))
    popupButton(popup, 'Discard').click()

    await waitFor(() => tabEls().length === 0)
    await pause(300)
    expect(setAutoDelete).not.toHaveBeenCalled()
  })

  it('закрытие попапа мимо кнопок (Esc) оставляет вкладку открытой', async() => {
    const tab = await open(0)
    row(tab, '1 month').querySelector<HTMLInputElement>('input')!.click()

    tab.closeBtn.click()
    await waitFor(() => document.querySelector('.popup-confirmation.active'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

    await waitFor(() => !document.querySelector('.popup-confirmation'))
    await pause(300)
    expect(tabEls()).toHaveLength(1)
    expect(setAutoDelete).not.toHaveBeenCalled()
    expect(checkedTitle(tab)).toBe('1 month')
  })
})

describe('попап своего срока', () => {
  const openPopup = async(tab: SliderSuperTab) => {
    row(tab, lang['AutoDeleteMessages.SetOtherTime']).click()
    return waitFor(() => document.querySelector<HTMLElement>('.popup.auto-delete-messages-custom-time-popup'))
  }

  it('разметка: заголовок, описание, барабан Never + 16 сроков, Save/Cancel', async() => {
    const tab = await open(0)
    const popup = await openPopup(tab)

    expect(popup.classList.contains('old')).toBe(true)
    expect(popup.querySelector('.popup-title')!.textContent).toBe(lang.AutoDeleteMessages)
    const content = popup.querySelector('auto-delete-messages-custom-time-popup-content')!
    expect(content.textContent).toContain(lang['AutoDeleteMessages.InfoDefault'])
    const scrollable = content.querySelector('[style*="--option-size"] > div')!
    const labels = [...scrollable.children].map((el) => el.textContent).filter(Boolean)
    expect(labels).toHaveLength(17)
    expect(labels.slice(0, 3)).toEqual(['Never', '1 day', '2 days'])
    expect(labels[labels.length - 1]).toBe('1 year')
    expect([...popup.querySelectorAll('.popup-button')].map((b) => b.textContent)).toEqual(['Save', 'Cancel'])
  })

  it('Save отдаёт выбранный барабаном срок — он встаёт строкой и отмечен; запись — только галочкой', async() => {
    const tab = await open(0)
    const popup = await openPopup(tab)

    // Прокрутка на пятую строку барабана (Never, 1–4 дня → «5 days»).
    const scrollable = popup.querySelector<HTMLElement>('auto-delete-messages-custom-time-popup-content [style*="--option-size"] > div')!
    scrollable.scrollTop = 5 * 40
    scrollable.dispatchEvent(new Event('scroll'))
    await pause(50)

    popupButton(popup, 'Save').click()
    await waitFor(() => checkedTitle(tab) === '5 days')
    expect(rowTitles(tab).slice(0, 5)).toEqual(['Off', '1 day', '5 days', '1 week', '1 month'])
    expect(setAutoDelete).not.toHaveBeenCalled()
    await waitFor(() => saveButton(tab))
  })

  it('Cancel закрывает попап без изменения срока', async() => {
    const tab = await open(WEEK)
    const popup = await openPopup(tab)

    const scrollable = popup.querySelector<HTMLElement>('auto-delete-messages-custom-time-popup-content [style*="--option-size"] > div')!
    scrollable.scrollTop = 2 * 40
    scrollable.dispatchEvent(new Event('scroll'))
    await pause(50)

    popupButton(popup, 'Cancel').click()
    await waitFor(() => !document.querySelector('.popup.auto-delete-messages-custom-time-popup'))
    expect(checkedTitle(tab)).toBe('1 week')
    expect(saveButton(tab)).toBeNull()
  })
})
