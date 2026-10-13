/** @jsxImportSource solid-js */
/**
 * Вкладка «Уведомления и звуки» (`notifications.solid.tsx`, порт tweb
 * `sidebarLeft/tabs/notifications.tsx`, 812502980) — пилот плана волны 2D.
 *
 * Вкладка гоняется НАСТОЯЩАЯ — `AppNotificationsTab` из `solidJsTabs/tabs.ts`,
 * открытая через колоночный слайдер (`sidebarLeft/index.ts`) тем же путём, что строка корня
 * настроек: под пином и объявление вкладки, и её содержимое, и уборка острова
 * на закрытии. Стабы — только границы: разрешение браузера (`Notification`),
 * воркер (`managers.notify`), push-подписка и звук (побочки вне вкладки),
 * геометрия (happy-dom её не считает).
 *
 * Предмет — отличия таблицы пилота (план 2D, задача 6), видимые в DOM:
 *  • подпись секции — ВНЕ карточки (ребёнок `-container`, не `.sidebar-left-section`);
 *  • без разрешения строки веб-уведомлений `is-fake-disabled`, тумблеры сняты,
 *    клик просит разрешение; «Enable Notifications» — кнопка, не строка;
 *  • тумблер переключается ровно один раз — и по тексту строки, и по полю;
 *  • запись идёт в zustand через мост `useAppSettings`;
 *  • типы чатов пишутся на закрытии вкладки и только если изменились.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type SliderSuperTab from '@components/sliderTab'
import lang from '@/lang'
import { useSettingsStore, DEFAULTS } from '@/settings'
import { useNotifyStore } from '@/stores/notifyStore'
import type { InputNotifySettings, NotifySettings, NotifyTypeKey } from '@core/managers/notifyManager'
import { MUTE_UNTIL_FOREVER } from '@core/dialogs/notifySettings'
import rootScope from '@lib/rootScope'
import { registerStoreProjection } from '@/client/realtime/storeProjection'
import { AppNotificationsTab } from '@components/solidJsTabs/tabs'
import { installSidebarLeft, type InstalledSidebarLeft } from '@/test/sidebarLeft'
import { installSpecLabelActivation } from '@/test/specLabelActivation'

const support = vi.hoisted(() => ({ value: true }))
vi.mock('@environment/notificationSupport', () => ({
  get default() { return support.value },
}))

const toastNew = vi.hoisted(() => vi.fn())
vi.mock('@components/toast', async(importOriginal) => ({
  ...(await importOriginal<object>()),
  toastNew,
}))

const onPushConditionsChange = vi.hoisted(() => vi.fn(async() => {}))
vi.mock('@/client/pushSetup', () => ({ onPushConditionsChange }))

const testSound = vi.hoisted(() => vi.fn())
vi.mock('@core/audio/sounds', async(importOriginal) => ({
  ...(await importOriginal<object>()),
  testSound,
}))

const SERVER: NotifySettings = {
  notifyUsers: { _: 'peerNotifySettings', mute_until: 0, show_previews: true },
  notifyChats: { _: 'peerNotifySettings', mute_until: 0, show_previews: true },
  notifyBroadcasts: { _: 'peerNotifySettings', mute_until: 0, show_previews: true },
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let host: InstalledSidebarLeft
let uninstallLabelActivation: () => void
let update: ReturnType<typeof vi.fn>
let requestPermission: ReturnType<typeof vi.fn>

function stubPermission(permission: NotificationPermission, answer: NotificationPermission = permission) {
  requestPermission = vi.fn(async() => answer)
  vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission, requestPermission }))
}

beforeAll(() => registerStoreProjection({} as unknown as Managers))

beforeEach(() => {
  uninstallLabelActivation = installSpecLabelActivation()
  support.value = true
  stubPermission('default')
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)

  useSettingsStore.getState().update({ notifyDesktop: true, notifyPush: true, notifySound: true, notifyVolume: 0.5, sentMessageSound: true })
  useNotifyStore.getState().set(structuredClone(SERVER))

  update = vi.fn(async(_key: NotifyTypeKey, _settings: InputNotifySettings) => {})
  const managers = { notify: { updateNotifySettings: update, getNotifySettings: async(key: NotifyTypeKey) => SERVER[key] } } as unknown as Managers

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
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  toastNew.mockClear()
  onPushConditionsChange.mockClear()
  testSound.mockClear()
})

const open = () => host.openTab(AppNotificationsTab)

/** Контейнер секции по английскому тексту её имени. */
function section(tab: SliderSuperTab, name: string) {
  const el = [...tab.scrollable.container.querySelectorAll('.sidebar-left-section-container')]
    .find((c) => c.querySelector('.sidebar-left-section-name')?.textContent === name)
  if(!el) throw new Error('no section ' + name)
  return el as HTMLElement
}

/** Строка по английскому тексту её заголовка. */
function row(tab: SliderSuperTab, title: string) {
  const el = [...tab.scrollable.container.querySelectorAll('.row')]
    .find((r) => r.querySelector('.row-title')?.textContent === title)
  if(!el) throw new Error('no row ' + title)
  return el as HTMLElement
}

const input = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[type="checkbox"]')!
const titleOf = (el: HTMLElement) => el.querySelector<HTMLElement>('.row-title')!

describe('вкладка «Уведомления» — без разрешения браузера', () => {
  it('строки веб-уведомлений is-fake-disabled, тумблеры сняты при notifyDesktop/notifyPush = true', async() => {
    const tab = await open()
    const web = section(tab, lang['Notifications.Web'])
    const rows = [...web.querySelectorAll<HTMLElement>('.row')]

    // «All Accounts» не портирован (О-1) — строк ровно две.
    expect(rows.map((r) => titleOf(r).textContent)).toEqual([lang['Notifications.Show'], lang['Notifications.Offline']])
    for(const r of rows) {
      expect(r.classList.contains('is-fake-disabled')).toBe(true)
      expect(input(r).checked).toBe(false)
    }
  })

  it('клик по строке просит разрешение ровно один раз и не трогает настройку', async() => {
    const tab = await open()
    titleOf(row(tab, lang['Notifications.Show'])).click()
    await pause(0)

    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(useSettingsStore.getState().notifyDesktop).toBe(true)
    expect(input(row(tab, lang['Notifications.Show'])).checked).toBe(false)
  })

  it('«Enable Notifications» — кнопка btn-primary primary btn-transparent с иконкой, внутри карточки', async() => {
    const tab = await open()
    const web = section(tab, lang['Notifications.Web'])
    const button = web.querySelector<HTMLButtonElement>('.sidebar-left-section-content > button.btn-primary.primary.btn-transparent')!

    expect(button).not.toBeNull()
    expect(button.querySelector('.tgico.button-icon')).not.toBeNull()
    expect(button.querySelector('.i18n')!.textContent).toBe(lang['Notifications.Enable'])
    expect(web.querySelector('.row .tgico')).toBeNull()
  })

  it('подпись Notifications.Default — под карточкой: ребёнок -container, не .sidebar-left-section', async() => {
    const tab = await open()
    const web = section(tab, lang['Notifications.Web'])
    const caption = web.querySelector<HTMLElement>('.sidebar-left-section-caption')!

    expect(caption.textContent).toBe(lang['Notifications.Default'])
    expect(caption.parentElement).toBe(web)
    expect(caption.closest('.sidebar-left-section')).toBeNull()
  })

  it('выдали разрешение — строки ожили, кнопки и подписи нет, push-условия пересчитаны', async() => {
    stubPermission('default', 'granted')
    const tab = await open()
    section(tab, lang['Notifications.Web']).querySelector<HTMLButtonElement>('button')!.click()
    await pause(0)

    const web = section(tab, lang['Notifications.Web'])
    expect(web.querySelector('.is-fake-disabled')).toBeNull()
    expect(web.querySelector('button')).toBeNull()
    expect(web.querySelector('.sidebar-left-section-caption')).toBeNull()
    expect(input(row(tab, lang['Notifications.Show'])).checked).toBe(true)
    expect(onPushConditionsChange).toHaveBeenCalledTimes(1)
  })

  it('отказ в разрешении — тост Notifications.Restricted', async() => {
    stubPermission('default', 'denied')
    const tab = await open()
    section(tab, lang['Notifications.Web']).querySelector<HTMLButtonElement>('button')!.click()

    await vi.waitFor(() => expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'Notifications.Restricted' }))
    expect(onPushConditionsChange).not.toHaveBeenCalled()
  })

  it('без Notification API — тост, а не молчание (tweb 72c50bfef)', async() => {
    support.value = false
    const tab = await open()
    section(tab, lang['Notifications.Web']).querySelector<HTMLButtonElement>('button')!.click()

    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'Notifications.Restricted' })
    expect(requestPermission).not.toHaveBeenCalled()
  })
})

describe('вкладка «Уведомления» — с разрешением', () => {
  beforeEach(() => stubPermission('granted'))

  it('классов is-fake-disabled и кнопки нет, тумблер отражает notifyDesktop', async() => {
    useSettingsStore.getState().update({ notifyDesktop: false })
    const tab = await open()
    const web = section(tab, lang['Notifications.Web'])

    expect(web.querySelector('.is-fake-disabled')).toBeNull()
    expect(web.querySelector('button')).toBeNull()
    expect(input(row(tab, lang['Notifications.Show'])).checked).toBe(false)
    expect(input(row(tab, lang['Notifications.Offline'])).checked).toBe(true)
  })

  it('клик по ТЕКСТУ строки переключает ровно один раз и пишет в zustand', async() => {
    const tab = await open()
    const r = row(tab, lang['Notifications.Show'])
    const spy = vi.spyOn(useSettingsStore.getState(), 'update')

    titleOf(r).click()

    expect(useSettingsStore.getState().notifyDesktop).toBe(false)
    expect(input(r).checked).toBe(false)
    expect(spy.mock.calls.filter(([patch]) => 'notifyDesktop' in patch)).toHaveLength(1)
  })

  it('клик по ПОЛЮ переключает ровно один раз', async() => {
    const tab = await open()
    const r = row(tab, lang['Notifications.Offline'])

    input(r).click()

    expect(useSettingsStore.getState().notifyPush).toBe(false)
    expect(input(r).checked).toBe(false)
  })

  it('смена настройки снаружи доезжает до тумблера (мост читает zustand)', async() => {
    const tab = await open()
    useSettingsStore.getState().update({ notifyDesktop: false })
    expect(input(row(tab, lang['Notifications.Show'])).checked).toBe(false)
  })
})

describe('вкладка «Уведомления» — звук', () => {
  it('громкость — RangeSettingSelector: процент справа, скраб до 0 выключает звук', async() => {
    const tab = await open()
    const sound = section(tab, lang['Notifications.Sound.Section'])
    const selector = sound.querySelector<HTMLElement>('.sidebar-left-section-content > .range-setting-selector')!

    expect(selector.querySelector('.range-setting-selector-name')!.textContent).toBe(lang['Notifications.Sound.Volume'])
    expect(selector.querySelector('.range-setting-selector-value')!.textContent).toBe('50%')

    const seek = selector.querySelector<HTMLInputElement>('input[type="range"]')!
    seek.value = '0'
    seek.dispatchEvent(new Event('input', { bubbles: true }))

    expect(useSettingsStore.getState().notifyVolume).toBe(0)
    expect(useSettingsStore.getState().notifySound).toBe(false)
    expect(input(row(tab, lang['Notifications.Sound'])).checked).toBe(false)
  })

  it('отпускание ползунка проигрывает тестовый звук с текущей громкостью', async() => {
    const tab = await open()
    const line = section(tab, lang['Notifications.Sound.Section']).querySelector<HTMLElement>('.progress-line')!
    line.getBoundingClientRect = () => ({ left: 0, right: 200, top: 0, bottom: 10, width: 200, height: 10, x: 0, y: 0, toJSON() {} }) as DOMRect

    // `attachGrabListeners` читает `pageX`, а happy-dom его из `clientX` не выводит
    const down = new MouseEvent('mousedown', { bubbles: true, button: 0 })
    Object.defineProperty(down, 'pageX', { value: 150 })
    line.dispatchEvent(down)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))

    expect(testSound).toHaveBeenCalledTimes(1)
    expect(testSound).toHaveBeenCalledWith(useSettingsStore.getState().notifyVolume)
    expect(useSettingsStore.getState().notifyVolume).toBe(0.75)
  })

  it('включение звука при нулевой громкости возвращает громкость по умолчанию', async() => {
    useSettingsStore.getState().update({ notifySound: false, notifyVolume: 0 })
    const tab = await open()

    titleOf(row(tab, lang['Notifications.Sound'])).click()

    expect(useSettingsStore.getState().notifySound).toBe(true)
    expect(useSettingsStore.getState().notifyVolume).toBe(DEFAULTS.notifyVolume)
  })

  it('подпись звука — под карточкой', async() => {
    const tab = await open()
    const sound = section(tab, lang['Notifications.Sound.Section'])
    const caption = sound.querySelector('.sidebar-left-section-caption')!
    expect(caption.textContent).toBe(lang['Notifications.Sound.Caption'])
    expect(caption.parentElement).toBe(sound)
  })
})

describe('вкладка «Уведомления» — типы чатов', () => {
  it('секции в порядке tweb и с его именами', async() => {
    const tab = await open()
    const names = [...tab.scrollable.container.querySelectorAll('.sidebar-left-section-name')].map((n) => n.textContent)
    expect(names).toEqual([
      lang['Notifications.Web'],
      lang['Notifications.Sound.Section'],
      lang['Notifications.Sound.Effects'],
      lang.NotificationsPrivateChats,
      lang.NotificationsGroups,
      lang.NotificationsChannels,
    ])
  })

  // tweb notifications.tsx:63-64 — при уходе `mute_until = mute ? MUTE_UNTIL : 0` и
  // `show_previews`, адрес — `inputNotifyUsers` (у нас ключ `notifyUsers`).
  it('переключили «личные чаты» и закрыли вкладку — ровно один updateNotifySettings с mute_until и show_previews', async() => {
    const tab = await open()
    titleOf(row(tab, lang.NotificationsForPrivateChats)).click()
    expect(update).not.toHaveBeenCalled()

    tab.close()
    await pause(400)

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('notifyUsers', { mute_until: MUTE_UNTIL_FOREVER, show_previews: true })
  })

  it('«группы» и «каналы» адресуются своими ключами; включение снимает мьют (mute_until: 0)', async() => {
    useNotifyStore.getState().apply('notifyChats', { _: 'peerNotifySettings', mute_until: MUTE_UNTIL_FOREVER, show_previews: true })
    const tab = await open()
    expect(input(row(tab, lang.NotificationsForGroups)).checked).toBe(false)
    titleOf(row(tab, lang.NotificationsForGroups)).click()
    titleOf(row(tab, lang.NotificationsForChannels)).click()

    tab.close()
    await pause(400)

    expect(update).toHaveBeenCalledWith('notifyChats', { mute_until: 0, show_previews: true })
    expect(update).toHaveBeenCalledWith('notifyBroadcasts', { mute_until: MUTE_UNTIL_FOREVER, show_previews: true })
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('превью: show_previews из настроек типа и его запись на закрытии', async() => {
    useNotifyStore.getState().apply('notifyBroadcasts', { _: 'peerNotifySettings', mute_until: 0, show_previews: false })
    const tab = await open()
    const channels = section(tab, lang.NotificationsChannels)
    const preview = input(channels.querySelectorAll<HTMLElement>('.row')[1])
    expect(preview.checked).toBe(false)

    titleOf(channels.querySelectorAll<HTMLElement>('.row')[1]).click()
    tab.close()
    await pause(400)

    expect(update).toHaveBeenCalledWith('notifyBroadcasts', { mute_until: 0, show_previews: true })
  })

  it('апдейт другого типа не сбрасывает ещё не записанную правку этой секции', async() => {
    const tab = await open()
    titleOf(row(tab, lang.NotificationsForPrivateChats)).click() // личные: выключили, не записано
    expect(input(row(tab, lang.NotificationsForPrivateChats)).checked).toBe(false)

    rootScope.dispatchEventSingle('notify_settings', {
      _: 'updateNotifySettings',
      peer: { _: 'notifyChats' },
      notify_settings: { _: 'peerNotifySettings', mute_until: MUTE_UNTIL_FOREVER, show_previews: true },
    })
    await pause(0)

    expect(input(row(tab, lang.NotificationsForPrivateChats)).checked).toBe(false)
    expect(input(row(tab, lang.NotificationsForGroups)).checked).toBe(false)
    tab.close()
    await pause(400)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('notifyUsers', { mute_until: MUTE_UNTIL_FOREVER, show_previews: true })
  })

  // Событие `notify_settings` с другого устройства (журнал notify_settings) идёт
  // воркер → rootScope → проектор → notifyStore → тумблер открытой вкладки
  // (tweb notifications.tsx:71-83, :167 — подписка на 'notify_settings').
  it('notify_settings с другого устройства переключает тумблер открытой вкладки', async() => {
    const tab = await open()
    expect(input(row(tab, lang.NotificationsForPrivateChats)).checked).toBe(true)

    rootScope.dispatchEventSingle('notify_settings', {
      _: 'updateNotifySettings',
      peer: { _: 'notifyUsers' },
      notify_settings: { _: 'peerNotifySettings', mute_until: MUTE_UNTIL_FOREVER, show_previews: true },
    })
    await pause(0)

    expect(input(row(tab, lang.NotificationsForPrivateChats)).checked).toBe(false)
    // Пришедшее извне состояние не считается правкой: на закрытии записи нет.
    tab.close()
    await pause(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('ничего не меняли — ноль вызовов на закрытии', async() => {
    const tab = await open()
    tab.close()
    await pause(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('переключили и вернули обратно — тоже ноль', async() => {
    const tab = await open()
    const title = titleOf(row(tab, lang.MessagePreview))
    title.click()
    title.click()
    tab.close()
    await pause(400)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('вкладка «Уведомления» — каркас', () => {
  it('шапка — Telegram.NotificationSettingsViewController', async() => {
    const tab = await open()
    expect(tab.container.querySelector('.sidebar-header__title')!.textContent)
      .toBe(lang['Telegram.NotificationSettingsViewController'])
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
