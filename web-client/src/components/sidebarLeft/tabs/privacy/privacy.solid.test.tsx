/** @jsxImportSource solid-js */
/**
 * Вкладки правил приватности (`sidebarLeft/tabs/privacy/*.solid.tsx`) на
 * `components/privacySection.solid.tsx` — порт tweb `privacySection.tsx` и
 * `privacy/*` (812502980), задача 17 плана волны 2D.
 *
 * Вкладки гоняются НАСТОЯЩИЕ — объявления `solidJsTabs/tabs.ts`, открытые через
 * колоночный слайдер (`sidebarLeft/index.ts`) тем же путём, что строки хаба
 * «Конфиденциальность» (`privacyAndSecurity.solid.tsx`). Стабы — только границы: менеджер правил (воркер) и
 * геометрия; стор правил (`stores/privacyStore.ts`) — настоящий.
 *
 * Предмет:
 *  • строка исключения — `Row.Icon` + `Row.Title` + `Row.Subtitle` со счётчиком,
 *    без `titleRight`: справа значение съедало русский заголовок до «Н…»
 *    (tweb `privacySection.tsx:214-216`);
 *  • радио — `Row.RadioField` с `disable-hover`, подпись секции вне карточки
 *    и меняется/прячется по выбору (`replaceCaption`, `:346-356`), строки
 *    исключений прячутся по типу (`:180-184`);
 *  • правило пишется на `destroy` вкладки, а не на щелчке (`:271`, `:279-344`);
 *  • исключения открывают `AppAddMembersTab` с `type: 'privacy'` (`:189-210`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type SliderSuperTab from '@components/sliderTab'
import lang from '@/lang'
import { i18n } from '@lib/langPack'
import type { PrivacyKey, PrivacyRule } from '@core/managers/privacyManager'
import { usePrivacyStore } from '@stores/privacyStore'
import {
  AppAddMembersTab,
  AppPrivacyLastSeenTab,
  AppPrivacyPhoneNumberTab,
} from '@components/solidJsTabs/tabs'
import { installSpecLabelActivation } from '@/test/specLabelActivation'
import { installSidebarLeft, type InstalledSidebarLeft } from '@/test/sidebarLeft'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const rule = (key: PrivacyKey, patch: Partial<PrivacyRule> = {}): PrivacyRule =>
  ({ key, value: 'everybody', allowUserIds: [], denyUserIds: [], ...patch })

let host: InstalledSidebarLeft
let uninstallLabelActivation: () => void
let setRule: ReturnType<typeof vi.fn<(rule: PrivacyRule) => Promise<PrivacyRule>>>

beforeEach(() => {
  uninstallLabelActivation = installSpecLabelActivation()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)

  usePrivacyStore.getState().set([
    rule('last_seen', { value: 'contacts', denyUserIds: [5, 6] }),
    rule('phone_number', { value: 'contacts' }),
    rule('added_by_phone', { value: 'contacts' }),
    rule('read_time'),
  ])
  setRule = vi.fn(async(r: PrivacyRule) => r)

  const managers = { privacy: { setRule, rule: vi.fn() } } as unknown as Managers
  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = installSidebarLeft(managers, columnEl)
})

afterEach(async() => {
  uninstallLabelActivation()
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

/** Вкладку открыли и дождались правил (они приходят промисом, как у tweb). */
async function open(ctor: typeof AppPrivacyLastSeenTab) {
  const tab = await host.openTab(ctor)
  await pause(0)
  return tab
}

function section(tab: SliderSuperTab, name: string) {
  const el = [...tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-container')]
    .find((c) => c.querySelector('.sidebar-left-section-name')?.textContent === name)
  if(!el) throw new Error('no section ' + name)
  return el
}

function row(root: HTMLElement, title: string) {
  const el = [...root.querySelectorAll<HTMLElement>('.row')]
    .find((r) => r.querySelector('.row-title')?.textContent === title)
  if(!el) throw new Error('no row ' + title)
  return el
}

const caption = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(':scope > .sidebar-left-section-caption')!

const checkedTitle = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('.row')]
    .find((r) => r.querySelector<HTMLInputElement>('input[type="radio"]')?.checked)
    ?.querySelector('.row-title')?.textContent

async function close(tab: SliderSuperTab) {
  tab.close()
  await pause(400)
}

describe('«Был в сети» — разметка', () => {
  it('исключение: заголовок + подпись со счётчиком под ним, без titleRight (не «Н…»)', async() => {
    const tab = await open(AppPrivacyLastSeenTab)
    const exceptions = section(tab, lang.PrivacyExceptions)

    const never = row(exceptions, lang['PrivacySettingsController.NeverShare'])
    expect(never.querySelector('.row-title-right')).toBeNull()
    expect(never.classList.contains('no-subtitle')).toBe(false)
    expect(never.querySelector('.row-icon')).not.toBeNull()
    expect(never.querySelector('.row-subtitle')!.textContent).toBe('2 users')

    const always = row(exceptions, lang['PrivacySettingsController.AlwaysShare'])
    expect(always.querySelector('.row-title-right')).toBeNull()
    expect(always.querySelector('.row-subtitle')!.textContent).toBe(lang['PrivacySettingsController.AddUsers'])

    expect(caption(exceptions).textContent).toBe(lang['PrivacySettingsController.PeerInfo'])
  })

  it('радио — Row.RadioField c disable-hover в form; отмечено значение правила; подпись вне карточки', async() => {
    const tab = await open(AppPrivacyLastSeenTab)
    const radio = section(tab, lang.LastSeenTitle)
    const rows = [...radio.querySelectorAll<HTMLElement>('form > .row')]

    expect(rows.map((r) => r.querySelector('.row-title')!.textContent)).toEqual([
      lang['PrivacySettingsController.Everbody'],
      lang['PrivacySettingsController.MyContacts'],
      lang['PrivacySettingsController.Nobody'],
    ])
    for(const r of rows) {
      expect(r.querySelector('.radio-field.disable-hover input[type="radio"]')).not.toBeNull()
    }
    expect(checkedTitle(radio)).toBe(lang['PrivacySettingsController.MyContacts'])

    const cap = caption(radio)
    expect(cap.parentElement).toBe(radio)
    expect(cap.classList.contains('hide')).toBe(false)
    expect(cap.textContent).toBe(lang['PrivacySettingsController.LastSeenDescription'])
  })

  it('строки исключений прячутся по типу: «Все» — без Always, «Никто» — без Never', async() => {
    const tab = await open(AppPrivacyLastSeenTab)
    const radio = section(tab, lang.LastSeenTitle)
    const exceptions = section(tab, lang.PrivacyExceptions)
    const never = row(exceptions, lang['PrivacySettingsController.NeverShare'])
    const always = row(exceptions, lang['PrivacySettingsController.AlwaysShare'])

    expect([never.classList.contains('hide'), always.classList.contains('hide')]).toEqual([false, false])

    row(radio, lang['PrivacySettingsController.Everbody']).click()
    expect([never.classList.contains('hide'), always.classList.contains('hide')]).toEqual([false, true])

    row(radio, lang['PrivacySettingsController.Nobody']).click()
    expect([never.classList.contains('hide'), always.classList.contains('hide')]).toEqual([true, false])
  })

  it('вкладка: шапка PrivacyLastSeen, классы privacy-tab; после закрытия остров снят (DoD 5)', async() => {
    const tab = await open(AppPrivacyLastSeenTab)
    expect(tab.container.querySelector('.sidebar-header__title')!.textContent).toBe(lang.PrivacyLastSeen)
    expect(tab.container.classList.contains('privacy-tab')).toBe(true)
    expect(tab.container.classList.contains('privacy-last-seen')).toBe(true)

    await close(tab)
    expect(document.querySelectorAll('.sidebar-left-section-container')).toHaveLength(0)
  })
})

describe('«Был в сети» — запись', () => {
  it('щелчок радио не пишет; закрытие — ровно одна запись, исключения по типу, стор обновлён', async() => {
    const tab = await open(AppPrivacyLastSeenTab)
    const radio = section(tab, lang.LastSeenTitle)

    row(radio, lang['PrivacySettingsController.Nobody']).click()
    expect(checkedTitle(radio)).toBe(lang['PrivacySettingsController.Nobody'])
    expect(setRule).not.toHaveBeenCalled()

    await close(tab)
    // «Никто» — список Never не пишется (tweb :313-318)
    expect(setRule.mock.calls).toEqual([[rule('last_seen', { value: 'nobody' })]])
    expect(usePrivacyStore.getState().rules.last_seen).toEqual(rule('last_seen', { value: 'nobody' }))
  })

  it('без изменений закрытие всё равно пишет правило (tweb пишет безусловно)', async() => {
    const tab = await open(AppPrivacyLastSeenTab)
    await close(tab)
    expect(setRule.mock.calls).toEqual([[rule('last_seen', { value: 'contacts', denyUserIds: [5, 6] })]])
  })

  it('исключения — AppAddMembersTab type privacy; выбор меняет подпись и уходит в запись', async() => {
    const tab = await open(AppPrivacyLastSeenTab)
    const open_ = vi.fn()
    const createTab = vi.spyOn(tab.slider as unknown as { createTab: (ctor: unknown) => unknown }, 'createTab')
      .mockReturnValue({ open: open_ })
    const exceptions = section(tab, lang.PrivacyExceptions)
    const never = row(exceptions, lang['PrivacySettingsController.NeverShare'])

    never.click()
    await pause(0)
    expect(createTab).toHaveBeenCalledWith(AppAddMembersTab)
    const payload = open_.mock.calls[0][0]
    expect(payload).toMatchObject({
      type: 'privacy',
      skippable: true,
      title: 'PrivacySettingsController.NeverShare',
      placeholder: 'PrivacyModal.Search.Placeholder',
      filterPeerTypeBy: ['isUser'],
      selectedPeerIds: [5, 6],
    })

    payload.takeOut([7])
    expect(never.querySelector('.row-subtitle')!.textContent).toBe('1 user')
    expect(setRule).not.toHaveBeenCalled()

    createTab.mockRestore()
    await close(tab)
    expect(setRule.mock.calls).toEqual([[rule('last_seen', { value: 'contacts', denyUserIds: [7] })]])
  })
})

describe('«Номер телефона» — две секции', () => {
  it('вторая секция сразу за первой, видна только при «Никто»; подпись первой при «Никто» спрятана', async() => {
    const tab = await open(AppPrivacyPhoneNumberTab)
    const phone = section(tab, lang.PrivacyPhoneTitle)
    const byPhone = section(tab, lang.PrivacyPhoneTitle2)

    expect(phone.nextElementSibling).toBe(byPhone)
    expect(tab.container.classList.contains('privacy-phone-number')).toBe(true)
    expect(byPhone.classList.contains('hide')).toBe(true)
    expect(byPhone.querySelectorAll('form > .row')).toHaveLength(2)
    expect(caption(phone).textContent).toBe(lang.PrivacyPhoneInfo)

    row(phone, lang['PrivacySettingsController.Nobody']).click()
    expect(byPhone.classList.contains('hide')).toBe(false)
    expect(caption(phone).classList.contains('hide')).toBe(true)
    expect(caption(phone).textContent).toBe('')
    // смена первой секции сбрасывает вторую на «Все» (tweb :39-42)
    expect(checkedTitle(byPhone)).toBe(lang['PrivacySettingsController.Everbody'])
    expect(caption(byPhone).textContent).toBe(lang.PrivacyPhoneInfo3)
  })

  it('закрытие пишет оба правила', async() => {
    const tab = await open(AppPrivacyPhoneNumberTab)
    const phone = section(tab, lang.PrivacyPhoneTitle)
    const byPhone = section(tab, lang.PrivacyPhoneTitle2)
    row(phone, lang['PrivacySettingsController.Nobody']).click()
    row(byPhone, lang['PrivacySettingsController.MyContacts']).click()

    await close(tab)
    expect(setRule.mock.calls.map(([r]) => r).sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      rule('added_by_phone', { value: 'contacts' }),
      rule('phone_number', { value: 'nobody' }),
    ])
  })
})

// tweb `privacy/lastSeen.tsx:18-74`: тумблер «Hide Read Time» под исключениями,
// виден, только когда «был в сети» от кого-то скрыт (`canHideReadTime`), пишется
// на закрытии и только при изменении. Предмет у нас — правило `read_time`
// (сервер проверяет его взаимно, `usecase/chat/message.go`): «скрыть» = время
// прочтения видят ровно те, кто видит «был в сети» (копия правила `last_seen`),
// «не скрывать» = видят все. Своей строки в хабе и своей вкладки у него больше нет.
describe('«Был в сети» — Hide Read Time', () => {
  const hideSection = (tab: SliderSuperTab) => {
    const el = [...tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-container')]
      .find((c) => c.querySelector('.row-title')?.textContent === lang.HideReadTime)
    if(!el) throw new Error('no Hide Read Time section')
    return el
  }
  const toggle = (tab: SliderSuperTab) => hideSection(tab).querySelector<HTMLInputElement>('input[type="checkbox"]')!
  const readTimeWrites = () => setRule.mock.calls.map(([r]) => r).filter((r) => r.key === 'read_time')

  it('секция за исключениями: Row.CheckboxFieldToggle + подпись HideReadTimeInfo вне карточки', async() => {
    const tab = await open(AppPrivacyLastSeenTab)
    const containers = [...tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-container')]
    expect(containers.indexOf(hideSection(tab))).toBe(containers.indexOf(section(tab, lang.PrivacyExceptions)) + 1)

    const hide = hideSection(tab)
    expect(hide.querySelector('.row .row-checkbox-field-toggle, .row .checkbox-field-toggle')).not.toBeNull()
    expect(caption(hide).textContent).toBe(i18n('HideReadTimeInfo').textContent)
    expect(hide.classList.contains('hide')).toBe(false)
  })

  it('видна, только когда «был в сети» от кого-то скрыт (canHideReadTime)', async() => {
    const tab = await open(AppPrivacyLastSeenTab)
    const radio = section(tab, lang.LastSeenTitle)

    // «Все» c исключениями Never [5, 6] — скрывать есть от кого
    row(radio, lang['PrivacySettingsController.Everbody']).click()
    expect(hideSection(tab).classList.contains('hide')).toBe(false)

    row(radio, lang['PrivacySettingsController.Nobody']).click()
    expect(hideSection(tab).classList.contains('hide')).toBe(false)
  })

  it('«Все» без исключений — секция скрыта', async() => {
    usePrivacyStore.getState().setRule(rule('last_seen'))
    const tab = await open(AppPrivacyLastSeenTab)
    expect(hideSection(tab).classList.contains('hide')).toBe(true)
  })

  it('отметка по правилу read_time; без изменений закрытие read_time не пишет', async() => {
    usePrivacyStore.getState().setRule(rule('read_time', { value: 'contacts', denyUserIds: [5, 6] }))
    const tab = await open(AppPrivacyLastSeenTab)
    expect(toggle(tab).checked).toBe(true)

    await close(tab)
    expect(readTimeWrites()).toEqual([])
  })

  it('включили — закрытие пишет read_time копией нового правила «был в сети»', async() => {
    usePrivacyStore.getState().setRule(rule('read_time'))
    const tab = await open(AppPrivacyLastSeenTab)
    expect(toggle(tab).checked).toBe(false)
    row(section(tab, lang.LastSeenTitle), lang['PrivacySettingsController.Nobody']).click()
    toggle(tab).click()
    expect(setRule).not.toHaveBeenCalled()

    await close(tab)
    expect(readTimeWrites()).toEqual([rule('read_time', { value: 'nobody' })])
    expect(usePrivacyStore.getState().rules.read_time).toEqual(rule('read_time', { value: 'nobody' }))
  })

  it('включено и «был в сети» поменяли — read_time идёт за ним', async() => {
    usePrivacyStore.getState().setRule(rule('read_time', { value: 'contacts', denyUserIds: [5, 6] }))
    const tab = await open(AppPrivacyLastSeenTab)
    row(section(tab, lang.LastSeenTitle), lang['PrivacySettingsController.Nobody']).click()

    await close(tab)
    expect(readTimeWrites()).toEqual([rule('read_time', { value: 'nobody' })])
  })

  it('выключили — read_time «Все» без исключений', async() => {
    usePrivacyStore.getState().setRule(rule('read_time', { value: 'contacts', denyUserIds: [5, 6] }))
    const tab = await open(AppPrivacyLastSeenTab)
    toggle(tab).click()

    await close(tab)
    expect(readTimeWrites()).toEqual([rule('read_time')])
  })

  it('включено, но «был в сети» открыли всем — скрывать не от кого, read_time «Все» (tweb hide && canHideReadTime)', async() => {
    usePrivacyStore.getState().setRule(rule('last_seen', { value: 'contacts' }))
    usePrivacyStore.getState().setRule(rule('read_time', { value: 'contacts' }))
    const tab = await open(AppPrivacyLastSeenTab)
    row(section(tab, lang.LastSeenTitle), lang['PrivacySettingsController.Everbody']).click()
    expect(hideSection(tab).classList.contains('hide')).toBe(true)

    await close(tab)
    expect(readTimeWrites()).toEqual([rule('read_time')])
  })
})
