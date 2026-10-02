/** @jsxImportSource solid-js */
/**
 * Хаб «Конфиденциальность и безопасность» (`privacyAndSecurity.solid.tsx`, порт
 * tweb `sidebarLeft/tabs/privacyAndSecurity.tsx`, 812502980) — задача 23 плана
 * волны 2D.
 *
 * Вкладка НАСТОЯЩАЯ — `AppPrivacyAndSecurityTab` из `solidJsTabs/tabs.ts`,
 * открытая колоночным слайдером, как её открывает строка корня настроек
 * (`settings.tsx:254`, `makeSubTabConfig`). Стабы — только границы: менеджеры
 * воркера, геометрия, IndexedDB кода-пароля, интро-попап ключей доступа (мост к
 * React до 2C-10). Стор правил (`stores/privacyStore.ts`) и стор настроек —
 * настоящие.
 *
 * Предмет — DOM и поведение оригинала:
 *  • первая секция без имени, `no-delimiter`, подпись `SessionsInfo` вне
 *    карточки (`:656-660`); у ВСЕХ строк значение — `Row.Subtitle` под
 *    заголовком, без `titleRight` (`:216-306`); до ответа — `Loading`, строка
 *    «заморожена»;
 *  • наших лишних строк нет: «Активные сессии» (у tweb — только в корне,
 *    «Устройства»), «Удалить аккаунт» (у tweb в приложении нет вовсе),
 *    «Время прочтения» (у tweb — тумблер на «Был в сети», `privacy/lastSeen.tsx`);
 *  • секция `PrivacyTitle` → `Privacy.MessagesCaption`, контент
 *    `privacy-navigation-container`, строки правил в порядке `:416-472`, подпись
 *    «Тип (-d, +a)» (`:517-535`), перерисовка на смене правила
 *    (`privacy_update`, `:542-544`), звезда премиума у голосовых/сообщений;
 *  • каждая строка открывает свою вкладку тем же слайдером (`tab.slider.createTab`);
 *  • «Заблокированные» перечитываются на `peer_block` (`:320-337`);
 *  • «Код-пароль» при включённом коде — сначала ввод текущего, главная вкладка
 *    срезает ввод ДО хаба (`tabs.ts:31-37`);
 *  • «Passkeys»: ключи читаются на открытии хаба в Solid-стор, подпись следит за
 *    ним; без ключей — интро-попап; без ключей и без WebAuthn строка скрыта
 *    (`:172-190`, `:289-307`);
 *  • «Удалить облачные черновики» — `Button` в секции `FilterChats`, попап
 *    `popup-delete-drafts`, кнопка выключена до ответа (`:105-120`, `:687-695`);
 *  • закрытая вкладка снимает свой Solid-остров (DoD 5).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import lang, { type LangPackKey } from '@/lang'
import type { Passkey } from '@layer'
import type { PasswordState } from '@core/managers/authManager'
import type { PrivacyKey, PrivacyRule } from '@core/managers/privacyManager'
import type SliderSuperTab from '@components/sliderTab'
import rootScope from '@lib/rootScope'
import Icon from '@components/icon'
import { useSettingsStore } from '@/settings'
import { useChatsStore } from '@stores/chatsStore'
import { usePrivacyStore } from '@stores/privacyStore'
import { enablePasscode } from '@lib/passcode/actions'
import {
  AppBlockedUsersTab,
  AppMessagesAutoDeleteTab,
  AppPasscodeLockTab,
  AppPasskeysTab,
  AppPrivacyAboutTab,
  AppPrivacyAddToGroupsTab,
  AppPrivacyAndSecurityTab,
  AppPrivacyBirthdayTab,
  AppPrivacyCallsTab,
  AppPrivacyForwardMessagesTab,
  AppPrivacyLastSeenTab,
  AppPrivacyMessagesTab,
  AppPrivacyPhoneNumberTab,
  AppPrivacyProfilePhotoTab,
  AppPrivacyVoicesTab,
  AppTwoStepVerificationEnterPasswordTab,
  AppTwoStepVerificationTab,
} from '@components/solidJsTabs/tabs'
import { mountTestColumnSlider, type TestColumnSlider } from '@/test/columnSlider'

// Для «Код-пароля»: IndexedDB — словарь в памяти (хеш кода кладёт настоящий
// `lib/passcode/actions.ts`), канал к воркеру — заглушка, лотти-заставка — заглушка.
vi.mock('@/client/passcodeClient', () => ({ invokePasscode: vi.fn(async() => undefined) }))
const idb = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@core/store/idbKv', () => ({
  idbGet: async(key: string) => idb.get(key),
  idbSet: async(key: string, val: unknown) => { idb.set(key, val) },
  idbDel: async(key: string) => { idb.delete(key) },
}))
const showPasskeyPopup = vi.hoisted(() => vi.fn<(onCreation?: (passkey: Passkey) => void) => void>())
vi.mock('@components/sidebarLeft/settingsPopups', async(importOriginal) => ({
  ...(await importOriginal<object>()),
  showPasskeyPopup,
}))
vi.mock('@lib/lottie/lottieLoader', () => ({
  default: { loadAnimationAsAsset: vi.fn(async() => ({ playOrRestart() {}, remove() {} })) },
}))

const DAY = 86400
const ME = 1

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await pause(0)
}

/** Отложенный ответ: тест сам решает, когда «сервер» ответил. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

const rule = (key: PrivacyKey, patch: Partial<PrivacyRule> = {}): PrivacyRule =>
  ({ key, value: 'everybody', allowUserIds: [], denyUserIds: [], ...patch })

const passkey = (id: string, name: string): Passkey => ({ _: 'passkey', id, name, date: 1_700_000_000 })

let host: TestColumnSlider
let columnEl: HTMLElement
let getBlocked: ReturnType<typeof vi.fn<() => Promise<{ count: number, peerIds: PeerId[] }>>>
let autoDelete: ReturnType<typeof vi.fn<() => Promise<number>>>
let passwordState: ReturnType<typeof vi.fn<() => Promise<PasswordState>>>
let passkeysList: ReturnType<typeof vi.fn<() => Promise<Passkey[]>>>
let clearAllDrafts: ReturnType<typeof vi.fn<() => Promise<void>>>
let refreshDialogs: ReturnType<typeof vi.fn<() => Promise<void>>>
let rules: ReturnType<typeof vi.fn<() => Promise<PrivacyRule[]>>>

// Модуль хаба тянет мосты попапов (`settingsPopups.tsx` → премиум, звёзды, QR) —
// холодный импорт не должен съедать бюджет первого теста.
beforeAll(async() => { await import('./privacyAndSecurity.solid') }, 60_000)

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  rootScope.myId = ME
  useChatsStore.setState({ me: { user: { _: 'user', id: ME, first_name: 'Me', pFlags: { self: true } } } } as never)
  usePrivacyStore.setState({ loaded: false })
  usePrivacyStore.getState().set([
    rule('phone_number', { value: 'contacts' }),
    rule('last_seen', { value: 'contacts', denyUserIds: [5, 6], allowUserIds: [7] }),
    rule('profile_photo'),
    rule('about'),
    rule('calls', { value: 'nobody', allowUserIds: [8] }),
    rule('forwards', { denyUserIds: [9] }),
    rule('chat_invite', { value: 'contacts' }),
    rule('voice_messages'),
    rule('messages'),
    rule('birthday', { value: 'contacts' }),
    rule('read_time'),
  ])
  showPasskeyPopup.mockReset()

  getBlocked = vi.fn(async() => ({ count: 3, peerIds: [2, 3, 4] }))
  autoDelete = vi.fn(async() => 0)
  passwordState = vi.fn(async() => ({ enabled: false, hint: '', email: '' }))
  passkeysList = vi.fn(async() => [])
  clearAllDrafts = vi.fn(async() => {})
  refreshDialogs = vi.fn(async() => {})
  rules = vi.fn(async() => [])

  const managers = {
    privacy: { getBlocked, autoDelete, rules, setRule: vi.fn(async(r: PrivacyRule) => r), rule: vi.fn() },
    auth: { passwordState, passkeysList },
    drafts: { clearAll: clearAllDrafts },
    dialogs: { refresh: refreshDialogs },
  } as unknown as Managers

  columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = mountTestColumnSlider(columnEl, managers)
})

afterEach(async() => {
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  idb.clear()
  useSettingsStore.getState().update({ passcodeEnabled: false })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const open = async() => {
  const tab = await host.openTab(AppPrivacyAndSecurityTab)
  await settle()
  return tab
}

type Tab = Awaited<ReturnType<typeof open>>

// глиф иконки (`tgico`) — символ из области частного использования
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/[-]/g, '').trim()
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

const containers = (tab: Tab) => [...tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-container')]
const rowsOf = (root: Element) => [...root.querySelectorAll<HTMLElement>('.row')]
const titleOf = (row: Element) => text(row.querySelector('.row-title:not(.row-title-right)'))

function row(tab: Tab, title: LangPackKey) {
  const found = rowsOf(tab.scrollable.container).find((r) => titleOf(r) === lang[title])
  expect(found, `строка «${title}» не найдена`).toBeDefined()
  return found!
}
const subtitle = (tab: Tab, title: LangPackKey) => text(row(tab, title).querySelector('.row-subtitle'))

/** Вкладки слайдера, кроме `.item-main`, в порядке DOM. */
const tabs = () => [...columnEl.querySelectorAll<HTMLElement>('.sidebar-slider > .tabs-tab.item-secondary')]

/** Перехват `tab.slider.createTab` — чтобы видеть, какую вкладку и с чем открыли. */
function spyCreateTab(tab: Tab) {
  const openTab = vi.fn()
  const createTab = vi.spyOn(tab.slider as unknown as { createTab: (ctor: unknown) => unknown }, 'createTab')
    .mockReturnValue({ open: openTab })
  return { createTab, openTab }
}

describe('«Конфиденциальность» — каркас', () => {
  it('шапка PrivacySettings, класс dont-u-dare-block-me; вкладка — Eventable, после закрытия остров снят', async() => {
    const tab = await open()
    expect(text(tab.container.querySelector('.sidebar-header__title'))).toBe(lang.PrivacySettings)
    expect(tab.container.classList.contains('dont-u-dare-block-me')).toBe(true)
    expect(typeof (tab as unknown as { eventListener?: unknown }).eventListener).toBe('object')

    tab.close()
    await pause(400)
    expect(document.querySelectorAll('.sidebar-left-section-container')).toHaveLength(0)
  })

  it('секции: без имени no-delimiter → SessionsInfo; PrivacyTitle → Privacy.MessagesCaption; FilterChats — и только они', async() => {
    const tab = await open()
    const [sessions, privacy, drafts, ...rest] = containers(tab)
    expect(rest).toHaveLength(0)

    // подпись — ВНЕ карточки: прямой ребёнок контейнера после `.sidebar-left-section`
    const [sessionsSection, sessionsCaption] = [...sessions.children]
    expect(sessionsSection.classList.contains('sidebar-left-section')).toBe(true)
    expect(sessionsSection.classList.contains('no-delimiter')).toBe(true)
    expect(sessionsSection.querySelector('.sidebar-left-section-name')).toBeNull()
    expect(sessionsCaption.classList.contains('sidebar-left-section-caption')).toBe(true)
    expect(text(sessionsCaption)).toBe(lang.SessionsInfo)

    expect(text(privacy.querySelector('.sidebar-left-section-name'))).toBe(lang.PrivacyTitle)
    expect(text(privacy.querySelector(':scope > .sidebar-left-section-caption'))).toBe(lang['Privacy.MessagesCaption'])
    expect(privacy.querySelector('.sidebar-left-section-content.privacy-navigation-container')).not.toBeNull()

    expect(text(drafts.querySelector('.sidebar-left-section-name'))).toBe(lang.FilterChats)
    expect(drafts.querySelector(':scope > .sidebar-left-section-caption')).toBeNull()
  })
})

describe('«Конфиденциальность» — первая секция', () => {
  it('строки и иконки в порядке tweb; у всех значение — Row.Subtitle, без titleRight; наших лишних нет', async() => {
    const tab = await open()
    const [sessions] = containers(tab)
    const rows = rowsOf(sessions)

    expect(rows.map(titleOf)).toEqual([
      lang.BlockedUsers,
      lang.AutoDeleteMessages,
      lang['PasscodeLock.Item.Title'],
      lang.TwoStepVerification,
      lang['Privacy.Passkeys'],
    ])
    const glyph = (name: Parameters<typeof Icon>[0]) => Icon(name).textContent
    expect(rows.map((r) => r.querySelector('.row-icon .row-icon-icon')?.textContent)).toEqual([
      glyph('person_crossed_filled'),
      glyph('auto_delete_filled'),
      glyph('key_filled'),
      glyph('two_factor_auth_filled'),
      glyph('faceid_filled'),
    ])
    for(const r of rows) {
      expect(r.querySelector('.row-title-right')).toBeNull()
      expect(r.querySelector('.row-subtitle')).not.toBeNull()
      expect(r.classList.contains('row-clickable')).toBe(true)
    }

    const all = rowsOf(tab.scrollable.container).map(titleOf)
    expect(all).not.toContain(lang.SessionsTitle)
    expect(all).not.toContain('Delete My Account')
    expect(all).not.toContain('Who can see when I read their messages?')
  })

  it('до ответов — Loading и строки «заморожены»; после — значения tweb', async() => {
    const blocked = deferred<{ count: number, peerIds: PeerId[] }>()
    const period = deferred<number>()
    const password = deferred<PasswordState>()
    getBlocked.mockReturnValue(blocked.promise)
    autoDelete.mockReturnValue(period.promise)
    passwordState.mockReturnValue(password.promise)
    const tab = await open()

    expect(subtitle(tab, 'BlockedUsers')).toBe(lang.Loading)
    expect(subtitle(tab, 'AutoDeleteMessages')).toBe(lang.Loading)
    expect(subtitle(tab, 'TwoStepVerification')).toBe(lang.Loading)

    const { createTab } = spyCreateTab(tab)
    click(row(tab, 'BlockedUsers'))
    click(row(tab, 'AutoDeleteMessages'))
    click(row(tab, 'TwoStepVerification'))
    expect(createTab).not.toHaveBeenCalled()

    blocked.resolve({ count: 3, peerIds: [2, 3, 4] })
    period.resolve(0)
    password.resolve({ enabled: true, hint: '', email: '' })
    await settle()

    expect(subtitle(tab, 'BlockedUsers')).toBe('3 users')
    expect(subtitle(tab, 'AutoDeleteMessages')).toBe(lang.Off)
    expect(subtitle(tab, 'PasscodeLock.Item.Title')).toBe(lang['PrivacyAndSecurity.Item.Off'])
    expect(subtitle(tab, 'TwoStepVerification')).toBe(lang['PrivacyAndSecurity.Item.On'])
  })

  it('пустой чёрный список — BlockedEmpty; «Заблокированные» открываются с первой страницей', async() => {
    getBlocked.mockResolvedValue({ count: 0, peerIds: [] })
    const tab = await open()
    expect(subtitle(tab, 'BlockedUsers')).toBe(lang.BlockedEmpty)

    getBlocked.mockResolvedValue({ count: 2, peerIds: [3, 4] })
    rootScope.dispatchEventSingle('peer_block', { peerId: 3, blocked: true })
    await settle()
    expect(getBlocked).toHaveBeenCalledTimes(2)
    expect(subtitle(tab, 'BlockedUsers')).toBe('2 users')

    const { createTab, openTab } = spyCreateTab(tab)
    click(row(tab, 'BlockedUsers'))
    expect(createTab).toHaveBeenCalledWith(AppBlockedUsersTab)
    expect(openTab).toHaveBeenCalledWith({ peerIds: [3, 4] })
  })

  it('после закрытия хаба peer_block его больше не перечитывает', async() => {
    const tab = await open()
    tab.close()
    await pause(400)
    rootScope.dispatchEventSingle('peer_block', { peerId: 3, blocked: true })
    await settle()
    expect(getBlocked).toHaveBeenCalledTimes(1)
  })

  it('«Автоудаление» открывает вкладку с периодом; onSaved обновляет подпись узлом label() вкладки', async() => {
    autoDelete.mockResolvedValue(3 * DAY)
    const tab = await open()
    expect(subtitle(tab, 'AutoDeleteMessages')).toBe('3 days')

    const { createTab, openTab } = spyCreateTab(tab)
    click(row(tab, 'AutoDeleteMessages'))
    expect(createTab).toHaveBeenCalledWith(AppMessagesAutoDeleteTab)
    const payload = openTab.mock.calls[0][0] as { period: number, onSaved: (period: number) => void }
    expect(payload.period).toBe(3 * DAY)

    payload.onSaved(0)
    expect(subtitle(tab, 'AutoDeleteMessages')).toBe(lang.Off)
    payload.onSaved(31 * DAY)
    expect(subtitle(tab, 'AutoDeleteMessages')).toBe('1 month')
    // подпись — узел i18n самой вкладки (`findExistingOrCreateCustomOption(p).label()`)
    expect(row(tab, 'AutoDeleteMessages').querySelector('.row-subtitle .i18n')).not.toBeNull()
  })

  it('2FA: пароль включён — ввод текущего с состоянием; выключен — главная вкладка мастера', async() => {
    const on: PasswordState = { enabled: true, hint: 'кот', email: '' }
    passwordState.mockResolvedValue(on)
    let tab = await open()
    let spy = spyCreateTab(tab)
    click(row(tab, 'TwoStepVerification'))
    expect(spy.createTab).toHaveBeenCalledWith(AppTwoStepVerificationEnterPasswordTab)
    expect(spy.openTab).toHaveBeenCalledWith({ state: on })
    spy.createTab.mockRestore()
    tab.close()
    await pause(400)

    const off: PasswordState = { enabled: false, hint: '', email: '' }
    passwordState.mockResolvedValue(off)
    tab = await open()
    spy = spyCreateTab(tab)
    click(row(tab, 'TwoStepVerification'))
    expect(spy.createTab).toHaveBeenCalledWith(AppTwoStepVerificationTab)
    expect(spy.openTab).toHaveBeenCalledWith({ state: off })
  })

  it('«Код-пароль» без кода — главная вкладка; подпись следит за настройкой', async() => {
    const tab = await open()
    expect(subtitle(tab, 'PasscodeLock.Item.Title')).toBe(lang['PrivacyAndSecurity.Item.Off'])

    useSettingsStore.getState().update({ passcodeEnabled: true })
    expect(subtitle(tab, 'PasscodeLock.Item.Title')).toBe(lang['PrivacyAndSecurity.Item.On'])
    useSettingsStore.getState().update({ passcodeEnabled: false })

    const { createTab, openTab } = spyCreateTab(tab)
    click(row(tab, 'PasscodeLock.Item.Title'))
    expect(createTab).toHaveBeenCalledWith(AppPasscodeLockTab)
    expect(openTab).toHaveBeenCalledWith()
  })

  it('«Код-пароль» с кодом: ввод → верный код → главная вкладка, ввод срезан ДО хаба', async() => {
    await enablePasscode('1111', { clearAll: async() => {} })
    useSettingsStore.getState().update({ passcodeEnabled: true })
    const privacy = await open()

    click(row(privacy, 'PasscodeLock.Item.Title'))
    const fieldLabel = (t: HTMLElement) => t.querySelector('.input-field label')?.textContent
    await vi.waitFor(() => expect(tabs().some((t) => fieldLabel(t) === 'Enter your passcode')).toBe(true))
    const enter = tabs().find((t) => fieldLabel(t) === 'Enter your passcode')!

    const input = enter.querySelector<HTMLInputElement>('input.input-field-input')!
    input.value = '1111'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await pause(0)
    enter.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    await vi.waitFor(() => expect(tabs().some((t) => t.textContent?.includes('Turn Passcode Off'))).toBe(true), { timeout: 3000 })
    await vi.waitFor(() => expect(tabs()).toHaveLength(2), { timeout: 3000 })
    const history = host.slider.getHistory()
    expect(history).toHaveLength(2)
    expect(history[0]).toBe(privacy)
    expect(history[1]).toBeInstanceOf(AppPasscodeLockTab)
  })
})

describe('«Конфиденциальность» — Passkeys', () => {
  const passkeyTitles = (tab: HTMLElement) =>
    [...tab.querySelectorAll('.row .row-title:not(.row-title-right)')].map((el) => el.textContent)

  it('ключи читаются на открытии хаба; вкладка получает Solid-стор, удаление в нём меняет подпись строки', async() => {
    passkeysList.mockResolvedValue([passkey('1', 'Chrome'), passkey('2', 'Safari')])
    const tab = await open()
    expect(passkeysList).toHaveBeenCalledTimes(1)
    expect(subtitle(tab, 'Privacy.Passkeys')).toBe('2 passkeys')
    expect(row(tab, 'Privacy.Passkeys').classList.contains('hide')).toBe(false)

    const { createTab, openTab } = spyCreateTab(tab)
    click(row(tab, 'Privacy.Passkeys'))
    expect(showPasskeyPopup).not.toHaveBeenCalled()
    expect(createTab).toHaveBeenCalledWith(AppPasskeysTab)
    const payload = openTab.mock.calls[0][0] as { passkeys: Passkey[], setPasskeys: (v: Passkey[]) => void }
    expect(payload.passkeys.map((p) => p.name)).toEqual(['Chrome', 'Safari'])

    payload.setPasskeys([payload.passkeys[0]])
    expect(subtitle(tab, 'Privacy.Passkeys')).toBe('1 passkey')
  })

  it('с ключами открывает настоящую вкладку «Passkeys» со списком', async() => {
    passkeysList.mockResolvedValue([passkey('1', 'Chrome'), passkey('2', 'Safari')])
    const tab = await open()
    click(row(tab, 'Privacy.Passkeys'))
    await vi.waitFor(() => expect(tabs().length === 2 && passkeyTitles(tabs()[1]).length > 0).toBe(true), { timeout: 3000 })
    expect(passkeyTitles(tabs()[1])).toEqual(['Chrome', 'Safari'])
  })

  it('без ключей при WebAuthn: интро-попап; созданный ключ — вкладка с ним', async() => {
    vi.stubGlobal('PublicKeyCredential', class {})
    const tab = await open()
    expect(subtitle(tab, 'Privacy.Passkeys')).toBe('0 passkeys')
    expect(row(tab, 'Privacy.Passkeys').classList.contains('hide')).toBe(false)

    const { createTab, openTab } = spyCreateTab(tab)
    click(row(tab, 'Privacy.Passkeys'))
    expect(showPasskeyPopup).toHaveBeenCalledTimes(1)
    expect(createTab).not.toHaveBeenCalled()

    showPasskeyPopup.mock.calls[0][0]!(passkey('9', 'Firefox'))
    expect(createTab).toHaveBeenCalledWith(AppPasskeysTab)
    const payload = openTab.mock.calls[0][0] as { passkeys: Passkey[] }
    expect(payload.passkeys.map((p) => p.name)).toEqual(['Firefox'])
    expect(subtitle(tab, 'Privacy.Passkeys')).toBe('1 passkey')
  })

  it('без ключей и без WebAuthn строка скрыта', async() => {
    const tab = await open()
    expect(row(tab, 'Privacy.Passkeys').classList.contains('hide')).toBe(true)
  })
})

describe('«Конфиденциальность» — правила', () => {
  it('строки правил в порядке tweb, без иконок, значение — Row.Subtitle «Тип (-d, +a)»', async() => {
    const tab = await open()
    const [, privacy] = containers(tab)
    const rows = rowsOf(privacy)

    expect(rows.map(titleOf)).toEqual([
      lang.PrivacyPhoneTitle,
      lang.LastSeenTitle,
      lang.PrivacyProfilePhotoTitle,
      lang['Privacy.BioRow'],
      lang.WhoCanCallMe,
      lang.PrivacyForwardsTitle,
      lang.WhoCanAddMe,
      lang.PrivacyVoiceMessagesTitle,
      lang.PrivacyMessagesTitle,
      lang['Privacy.BirthdayRow'],
    ])
    for(const r of rows) {
      expect(r.querySelector('.row-icon')).toBeNull()
      expect(r.querySelector('.row-title-right')).toBeNull()
    }

    expect(subtitle(tab, 'PrivacyPhoneTitle')).toBe(lang['PrivacySettingsController.MyContacts'])
    expect(subtitle(tab, 'LastSeenTitle')).toBe(lang['PrivacySettingsController.MyContacts'] + ' (-2, +1)')
    expect(subtitle(tab, 'WhoCanCallMe')).toBe(lang['PrivacySettingsController.Nobody'] + ' (+1)')
    expect(subtitle(tab, 'PrivacyForwardsTitle')).toBe(lang['PrivacySettingsController.Everbody'] + ' (-1)')
  })

  it('смена правила (privacy_update) перерисовывает подпись строки', async() => {
    const tab = await open()
    usePrivacyStore.getState().setRule(rule('about', { value: 'nobody' }))
    expect(subtitle(tab, 'Privacy.BioRow')).toBe(lang['PrivacySettingsController.Nobody'])
  })

  it('правила не загружены — Loading, затем подпись из ответа', async() => {
    usePrivacyStore.setState({ loaded: false })
    const answer = deferred<PrivacyRule[]>()
    rules.mockReturnValue(answer.promise)
    const tab = await open()
    expect(rules).toHaveBeenCalledTimes(1)
    expect(subtitle(tab, 'Privacy.BioRow')).toBe(lang.Loading)

    answer.resolve([rule('about', { value: 'contacts' })])
    await settle()
    expect(subtitle(tab, 'Privacy.BioRow')).toBe(lang['PrivacySettingsController.MyContacts'])
  })

  it('звезда премиума у голосовых и сообщений — только у премиума', async() => {
    const tab = await open()
    const star = (title: LangPackKey) => row(tab, title).querySelector('.row-title .privacy-premium-icon')!
    expect(star('PrivacyVoiceMessagesTitle').classList.contains('hide')).toBe(true)
    expect(star('PrivacyMessagesTitle').classList.contains('hide')).toBe(true)
    expect(row(tab, 'PrivacyPhoneTitle').querySelector('.privacy-premium-icon')).toBeNull()

    useChatsStore.setState({ me: { user: { _: 'user', id: ME, first_name: 'Me', pFlags: { self: true, premium: true } } } } as never)
    expect(star('PrivacyVoiceMessagesTitle').classList.contains('hide')).toBe(false)
    expect(star('PrivacyMessagesTitle').classList.contains('hide')).toBe(false)
  })

  it.each([
    ['PrivacyPhoneTitle', AppPrivacyPhoneNumberTab],
    ['LastSeenTitle', AppPrivacyLastSeenTab],
    ['PrivacyProfilePhotoTitle', AppPrivacyProfilePhotoTab],
    ['Privacy.BioRow', AppPrivacyAboutTab],
    ['WhoCanCallMe', AppPrivacyCallsTab],
    ['PrivacyForwardsTitle', AppPrivacyForwardMessagesTab],
    ['WhoCanAddMe', AppPrivacyAddToGroupsTab],
    ['PrivacyVoiceMessagesTitle', AppPrivacyVoicesTab],
    ['PrivacyMessagesTitle', AppPrivacyMessagesTab],
    ['Privacy.BirthdayRow', AppPrivacyBirthdayTab],
  ] as const)('строка %s открывает свою вкладку тем же слайдером', async(title, ctor) => {
    const tab = await open()
    const { createTab, openTab } = spyCreateTab(tab)
    click(row(tab, title))
    expect(createTab).toHaveBeenCalledTimes(1)
    expect(createTab).toHaveBeenCalledWith(ctor)
    expect(openTab).toHaveBeenCalledTimes(1)
  })
})

describe('«Конфиденциальность» — облачные черновики', () => {
  const draftsButton = (tab: Tab) => containers(tab)[2].querySelector<HTMLElement>('.sidebar-left-section-content > button')!

  it('Button btn-primary btn-transparent с иконкой delete, не строка', async() => {
    const tab = await open()
    const button = draftsButton(tab)
    expect(button.classList.contains('btn-primary')).toBe(true)
    expect(button.classList.contains('btn-transparent')).toBe(true)
    expect(button.querySelector('.tgico')).not.toBeNull()
    expect(text(button)).toBe(lang.PrivacyDeleteCloudDrafts)
    expect(rowsOf(containers(tab)[2])).toHaveLength(0)
  })

  it('попап popup-delete-drafts → Delete (danger) → clearAll; кнопка выключена до ответа', async() => {
    const done = deferred<void>()
    clearAllDrafts.mockReturnValue(done.promise)
    const tab = await open()
    click(draftsButton(tab))

    const popup = await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>('.popup.popup-peer.popup-delete-drafts')
      expect(el).not.toBeNull()
      return el!
    })
    expect(text(popup.querySelector('.popup-title'))).toBe(lang.AreYouSureClearDraftsTitle)
    expect(text(popup.querySelector('.popup-description'))).toBe(lang.AreYouSureClearDrafts)
    const del = [...popup.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === lang.Delete)!
    expect(del.classList.contains('danger')).toBe(true)
    expect(clearAllDrafts).not.toHaveBeenCalled()

    del.click()
    await vi.waitFor(() => expect(clearAllDrafts).toHaveBeenCalledTimes(1))
    expect(draftsButton(tab).hasAttribute('disabled')).toBe(true)

    done.resolve()
    await settle()
    expect(draftsButton(tab).hasAttribute('disabled')).toBe(false)
    expect(refreshDialogs).toHaveBeenCalledTimes(1)
  })
})

describe('«Конфиденциальность» — открытие из корня настроек', () => {
  it('у вкладки нет предзагрузки getInitArgs (все её предметы — О-18)', () => {
    expect((AppPrivacyAndSecurityTab as unknown as { getInitArgs?: unknown }).getInitArgs).toBeUndefined()
  })

  it('объявление — Solid-вкладка (не React-мост): в узле вкладки свои шапка и скроллер', async() => {
    const tab: SliderSuperTab = await open()
    expect(tab.container.querySelectorAll('.sidebar-header')).toHaveLength(1)
    expect(tab.scrollable.container.closest('.tabs-tab')).toBe(tab.container)
  })
})
