/** @jsxImportSource solid-js */
/**
 * Корень настроек `AppSettingsTab` (порт tweb `sidebarLeft/tabs/settings.tsx`,
 * задача 28 плана 2D) — настоящая вкладка на колоночном слайдере
 * (`@/test/sidebarLeft`), тем же путём, что пункт «Settings» бургера.
 *
 * Пины на результат:
 *  • состав и порядок строк — дословно JSX `Settings` оригинала (:376-446):
 *    секция `div.profile-buttons` (семь `makeSubTabConfig` + «Устройства» +
 *    «Язык» + «Горячие клавиши»), Premium-секция («Мои звёзды» — только при
 *    балансе). Наших лишних строк (карточки телефона/имени, «Ночного режима»,
 *    `EmojiStatus.Set`) нет — их место занимает свой `PeerProfile`;
 *  • шапка: ⋮ с `edit`/`qr`/`logout` (danger), класс вкладки `settings-container`;
 *  • «Устройства»: счётчик доезжает после въезда (fire-and-forget), вкладке
 *    уходит ТОТ ЖЕ список, на её `destroy` список перечитывается;
 *  • строки открывают свои вкладки тем же слайдером (`tab.slider.createTab`);
 *  • остров снят: закрытая вкладка отпускает шапку профиля (`cleanup`).
 *
 * Шапка профиля и `PeerProfile` — заглушки (их собственные пины —
 * `peerProfile*.solid.test.tsx`, `peerProfileAvatars.test.ts`): здесь проверяется,
 * ЧТО корень им передаёт, а не как они рисуют. Попапы 2C — шпионы мостов.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Authorization } from '@layer'
import type { Managers } from '@/client/bootstrap'
import lang from '@/lang'
import { getIconContent } from '@components/icon'
import type SliderSuperTab from '@components/sliderTab'
import {
  AppActiveSessionsTab,
  AppChatFoldersTab,
  AppDataAndStorageTab,
  AppGeneralSettingsTab,
  AppKeyboardShortcutsTab,
  AppLanguageTab,
  AppNotificationsTab,
  AppPrivacyAndSecurityTab,
  AppSettingsTab,
  AppSpeakersAndCameraTab,
  AppStickersAndEmojiTab,
} from '@components/solidJsTabs/tabs'
import { setAppStateSilent } from '@stores/appState'
import { useChatsStore } from '@stores/chatsStore'
import { installSidebarLeft, type InstalledSidebarLeft } from '@/test/sidebarLeft'

const avatars = vi.hoisted(() => ({
  instances: [] as { options: { setCollapsedOn: HTMLElement, scrollableEl: HTMLElement }, setPeer: ReturnType<typeof vi.fn>, cleanup: ReturnType<typeof vi.fn> }[],
}))
vi.mock('@components/peerProfileAvatars', () => ({
  default: class {
    public container = document.createElement('div')
    public info = document.createElement('div')
    public hasPhoto = true
    public setPeer = vi.fn(async() => {})
    public setCollapsed = vi.fn()
    public cleanup = vi.fn()
    constructor(public options: { setCollapsedOn: HTMLElement, scrollableEl: HTMLElement }) {
      this.container.className = 'profile-avatars-container'
      avatars.instances.push(this)
    }
  },
}))

const profile = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined }))
vi.mock('@components/peerProfile.solid', () => ({
  default: (props: Record<string, unknown>) => {
    profile.props = props
    const el = document.createElement('div')
    el.className = 'profile-content'
    el.append(props.avatarsContainer as HTMLElement)
    return el
  },
}))

const popups = vi.hoisted(() => ({
  showPremiumPopup: vi.fn(),
  showStarsPopup: vi.fn(),
  showMyQrCodePopup: vi.fn(),
  showLogOutPopup: vi.fn(),
  showSendGiftPicker: vi.fn(),
}))
vi.mock('@components/sidebarLeft/settingsPopups', () => popups)

// Заставка «Папок» предзагружается на открытии корня (`makeSubTabConfig` →
// `getInitArgs`, tweb :62-78) — лотти-движок здесь не нужен.
vi.mock('@lib/lottie/lottieLoader', () => ({
  default: { loadAnimationFromURLManually: vi.fn(async() => ({})) },
}))

type Auth = Authorization.authorization
const auth = (hash: number) => ({
  _: 'authorization', hash, pFlags: hash ? {} : { current: true },
  device_model: 'Chrome', platform: 'browser', system_version: 'macOS', api_id: 0,
  app_name: 'Telegram Web', app_version: '1.0', date_created: 1_700_000_000,
  date_active: 1_700_000_100, ip: '1.2.3.4', country: 'Germany', region: '',
}) as Auth

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** Переход (250) + разрушение вкладки (280) + запас. */
const settle = () => pause(400)

let host: InstalledSidebarLeft
let list: ReturnType<typeof vi.fn<() => Promise<Auth[]>>>

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  avatars.instances.length = 0
  profile.props = undefined
  Object.values(popups).forEach((spy) => spy.mockClear())
  useChatsStore.setState({ me: { user: { _: 'user', id: 7, first_name: 'Me', pFlags: {} } } as never, meId: 7 })
  setAppStateSilent({ starsBalance: 0 })

  list = vi.fn<() => Promise<Auth[]>>(async() => [auth(0), auth(2)])
  const managers = {
    sessions: { list, terminate: vi.fn(), terminateOthers: vi.fn() },
    langPack: { getLanguages: vi.fn(async() => []) },
  } as unknown as Managers

  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = installSidebarLeft(managers, columnEl)
})

afterEach(async() => {
  host.destroy()
  await settle()
  document.body.replaceChildren()
  useChatsStore.setState({ me: null, meId: null })
  setAppStateSilent({ starsBalance: null })
  vi.restoreAllMocks()
})

const open = () => host.openTab(AppSettingsTab)

const titleOf = (row: HTMLElement) => row.querySelector<HTMLElement>('.row-title')!.firstChild!.textContent
/** Правая часть строки заголовка (`Row.Title titleRight`, вторичная — `titleRightSecondary`). */
const rightOf = (row: HTMLElement) => row.querySelector<HTMLElement>('.row-title-right.row-title-right-secondary')?.textContent
const iconOf = (row: HTMLElement) => row.querySelector('.row-icon')!.textContent
const mainRows = (tab: SliderSuperTab) =>
  [...tab.scrollable.container.querySelectorAll<HTMLElement>('.profile-buttons > .row')]
/** Секции корня по порядку: первая — строки `.profile-buttons`, вторая — Premium. */
const sectionRows = (tab: SliderSuperTab, index: number) => {
  const section = tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-content')[index]
  return [...section.querySelectorAll<HTMLElement>('.row')]
}
function rowByTitle(tab: SliderSuperTab, title: string) {
  const found = [...tab.scrollable.container.querySelectorAll<HTMLElement>('.row')].find((r) => titleOf(r) === title)
  if(!found) throw new Error('нет строки ' + title)
  return found
}

describe('корень настроек — состав tweb', () => {
  it('основная секция: семь подвкладок, «Устройства», «Язык», «Горячие клавиши» — ключами и иконками tweb', async() => {
    const tab = await open()
    const rows = mainRows(tab)
    expect(rows.map(titleOf)).toEqual([
      lang['AccountSettings.Notifications'],
      lang.DataSettings,
      lang['AccountSettings.PrivacyAndSecurity'],
      lang['Telegram.GeneralSettingsViewController'],
      lang['AccountSettings.Filters'],
      lang.StickersName,
      lang['AccountSettings.SpeakersAndCamera'],
      lang.Devices,
      lang['AccountSettings.Language'],
      lang['KeyboardShortcuts.Title'],
    ])
    expect(rows.map(iconOf)).toEqual([
      'bell_filled', 'data_filled', 'key_filled', 'general_filled', 'limit_folders_filled',
      'reactions_filled', 'speaker_filled', 'devices_filled', 'web_filled', 'keyboard_filled',
    ].map((name) => getIconContent(name as Parameters<typeof getIconContent>[0])))
    expect(rows.every((r) => r.classList.contains('row-clickable'))).toBe(true)
  })

  it('Premium-секция: «Telegram Premium» и «Отправить подарок»; «Мои звёзды» — только при балансе, справа баланс', async() => {
    const tab = await open()
    expect(sectionRows(tab, 1).map(titleOf)).toEqual([lang['Premium.Boarding.Title'], lang['Chat.Menu.SendGift']])

    setAppStateSilent({ starsBalance: 42 })
    await pause(0)
    const rows = sectionRows(tab, 1)
    expect(rows.map(titleOf)).toEqual([lang['Premium.Boarding.Title'], lang.MenuTelegramStars, lang['Chat.Menu.SendGift']])
    expect(rightOf(rows[1])).toBe('42')
  })

  it('своей карточки телефона/имени и «Ночного режима» нет — вместо них свой PeerProfile (isDialog: false)', async() => {
    const tab = await open()
    const content = tab.scrollable.container
    expect([...content.querySelectorAll('.row')].map((r) => titleOf(r as HTMLElement)))
      .not.toEqual(expect.arrayContaining([lang.Phone, lang.Username]))
    expect(content.querySelector('.profile-content')).not.toBeNull()
    // PeerProfile — ПЕРВЫМ, до секций (tweb :376-377)
    expect(content.querySelector('.profile-content')!.parentElement!.firstElementChild!.classList.contains('profile-content')).toBe(true)

    expect(profile.props).toMatchObject({ peerId: 7, isDialog: false })
    expect(profile.props!.setCollapsedOn).toBe(tab.container)
    expect(profile.props!.scrollable).toBe(tab.scrollable.container)
    const [instance] = avatars.instances
    expect(profile.props!.avatarsContainer).toBe((instance as unknown as { container: HTMLElement }).container)
    // сворачивание — по самой вкладке, аватар своего пира ждётся до въезда (:367)
    expect(instance.options.setCollapsedOn).toBe(tab.container)
    expect(instance.setPeer).toHaveBeenCalledWith(7)
  })
})

describe('корень настроек — шапка', () => {
  it('вкладка settings-container, заголовок «Settings», в шапке ⋮ с edit / qr / logout (danger)', async() => {
    const tab = await open()
    expect(tab.container.classList.contains('settings-container')).toBe(true)
    expect(tab.title.textContent).toBe(lang.Settings)

    const toggle = tab.header.querySelector<HTMLElement>(':scope > .btn-menu-toggle')!
    expect(toggle).not.toBeNull()
    expect(tab.header.lastElementChild).toBe(toggle)

    toggle.click()
    await vi.waitFor(() => expect(document.querySelector('.btn-menu')?.classList.contains('active')).toBe(true))
    const items = [...document.querySelectorAll<HTMLElement>('.btn-menu .btn-menu-item')]
    expect(items.map((i) => i.querySelector('.btn-menu-item-text')!.textContent)).toEqual([lang['EditAccount.Title'], lang['QRCode.Title'], lang['EditAccount.Logout']])
    expect(items[2].classList.contains('danger')).toBe(true)

    items[1].click()
    expect(popups.showMyQrCodePopup).toHaveBeenCalledTimes(1)
  })
})

describe('корень настроек — строки открывают вкладки тем же слайдером', () => {
  it.each([
    [lang['AccountSettings.Notifications'], AppNotificationsTab],
    [lang.DataSettings, AppDataAndStorageTab],
    [lang['AccountSettings.PrivacyAndSecurity'], AppPrivacyAndSecurityTab],
    [lang['Telegram.GeneralSettingsViewController'], AppGeneralSettingsTab],
    [lang['AccountSettings.Filters'], AppChatFoldersTab],
    [lang.StickersName, AppStickersAndEmojiTab],
    [lang['AccountSettings.SpeakersAndCamera'], AppSpeakersAndCameraTab],
    [lang['AccountSettings.Language'], AppLanguageTab],
    [lang['KeyboardShortcuts.Title'], AppKeyboardShortcutsTab],
  ] as const)('«%s»', async(title, ctor) => {
    const tab = await open()
    const opened = vi.fn(async() => {})
    const createTab = vi.spyOn(host.slider, 'createTab').mockReturnValue({ open: opened } as never)

    rowByTitle(tab, title).click()
    await pause(0)

    expect(createTab).toHaveBeenCalledTimes(1)
    expect(createTab.mock.calls[0][0]).toBe(ctor)
    expect(opened).toHaveBeenCalledTimes(1)
  })

  it('«Папки» получают предзагрузку заставки (`getInitArgs`, tweb makeSubTabConfig)', async() => {
    const tab = await open()
    const opened = vi.fn(async() => {})
    vi.spyOn(host.slider, 'createTab').mockReturnValue({ open: opened } as never)

    rowByTitle(tab, lang['AccountSettings.Filters']).click()
    await pause(0)
    expect(opened.mock.calls[0]).toEqual([{ animationData: expect.any(Promise) }])
  })

  it('Premium и «Отправить подарок» зовут мосты попапов 2C', async() => {
    const tab = await open()
    rowByTitle(tab, lang['Premium.Boarding.Title']).click()
    rowByTitle(tab, lang['Chat.Menu.SendGift']).click()
    expect(popups.showPremiumPopup).toHaveBeenCalledTimes(1)
    expect(popups.showSendGiftPicker).toHaveBeenCalledTimes(1)
  })
})

describe('корень настроек — «Устройства»', () => {
  it('счётчик доезжает после въезда; клик отдаёт вкладке ТОТ ЖЕ список, её destroy перечитывает', async() => {
    const tab = await open()
    await pause(0)
    const devices = rowByTitle(tab, lang.Devices)
    expect(rightOf(devices)).toBe('2')
    expect(list).toHaveBeenCalledTimes(1)

    devices.click()
    const sessions = await vi.waitFor(() => {
      const history = host.slider.getHistory()
      const top = history[history.length - 1]
      if(!(top instanceof AppActiveSessionsTab)) throw new Error('вкладка не открыта')
      return top
    })
    // список не перезапрашивался — вкладка получила готовый (tweb :354-383)
    expect(list).toHaveBeenCalledTimes(1)
    expect(sessions.payload.authorizations).toHaveLength(2)

    list.mockResolvedValueOnce([auth(0)])
    sessions.close()
    await settle()
    expect(list).toHaveBeenCalledTimes(2)
    expect(rightOf(devices)).toBe('1')
  })
})

describe('корень настроек — владение', () => {
  it('закрытая вкладка снимает свой остров: шапка профиля отпущена, кнопка ⋮ ушла из шапки', async() => {
    const tab = await open()
    const [instance] = avatars.instances
    const toggle = tab.header.querySelector(':scope > .btn-menu-toggle')!
    expect(instance.cleanup).not.toHaveBeenCalled()

    tab.close()
    await settle()

    expect(tab.container.isConnected).toBe(false)
    expect(instance.cleanup).toHaveBeenCalledTimes(1)
    expect(toggle.isConnected).toBe(false)
  })
})
