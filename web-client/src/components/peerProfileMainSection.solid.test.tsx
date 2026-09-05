/** @jsxImportSource solid-js */
/**
 * Тесты строк `MainSection` (`peerProfile.solid.tsx`, Task 4 плана
 * `docs/superpowers/plans/2026-09-05-profile-card-solid.md`, «Задача 4»):
 * Phone/Username(+QR)/Bio/Link/Birthday/Notifications.
 *
 * Отдельный файл от `peerProfile.solid.test.tsx` (Task 2, каркас) и
 * `peerProfileNameStatus.solid.test.tsx` (Task 3, имя/статус) — свой,
 * более широкий набор моков: `core/profilePhoneCache` (телефон — ОТДЕЛЬНОЕ
 * зеркало, не поле `peer`, см. докблок `Phone` в `peerProfile.solid.tsx`),
 * `client/bootstrap` (`startClient().managers.groups.setMute`),
 * `helpers/clipboard`/`./toast` (копирование и тосты — спаи, а не реальный
 * буфер обмена/DOM-всплывашка).
 *
 * `Row.Icon` не несёт класса с именем иконки (`tgico row-icon` — общие для
 * всех) — строка под тестом ищется по ГЛИФУ иконки (`glyph(name)`, тот же
 * символ, который `IconTsx` кладёт текстом), не по угаданному классу.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import { createSignal } from 'solid-js'
import { glyph, type IconName } from '../core/tgico-icons'

const peerSignal = createSignal<unknown>(undefined)
const fullPeerSignal = createSignal<unknown>(undefined)
vi.mock('../stores/peers.solid', () => ({ usePeer: () => peerSignal[0] }))
vi.mock('../stores/fullPeers.solid', () => ({ useFullPeer: () => fullPeerSignal[0] }))

let meId: number | null = 1
let dialogs: { peerId: number; notify_settings?: unknown }[] = []
const chatsSubs = new Set<() => void>()
vi.mock('../stores/chatsStore', () => ({
  useChatsStore: {
    getState: () => ({ meId, dialogs }),
    subscribe: (cb: () => void) => {
      chatsSubs.add(cb)
      return () => chatsSubs.delete(cb)
    },
  },
}))
function bumpDialogs() {
  chatsSubs.forEach((f) => f())
}

const phoneMirror = new Map<number, string>()
let phoneVersion = 0
const phoneSubs = new Set<() => void>()
vi.mock('../core/profilePhoneCache', () => ({
  cachedProfilePhone: (id: number) => phoneMirror.get(id),
  subscribeProfilePhoneMirror: (cb: () => void) => {
    phoneSubs.add(cb)
    return () => phoneSubs.delete(cb)
  },
  profilePhoneMirrorVersion: () => phoneVersion,
}))
function setPhone(id: number, phone: string | undefined) {
  if (phone === undefined) phoneMirror.delete(id)
  else phoneMirror.set(id, phone)
  phoneVersion++
  phoneSubs.forEach((f) => f())
}

const setMuteSpy = vi.fn()
vi.mock('../client/bootstrap', () => ({
  startClient: () => ({ managers: { groups: { setMute: setMuteSpy } } }),
}))

const copyTextToClipboardSpy = vi.fn()
vi.mock('../helpers/clipboard', () => ({ copyTextToClipboard: (t: string) => copyTextToClipboardSpy(t) }))

const toastNewSpy = vi.fn()
vi.mock('./toast', () => ({ toastNew: (o: unknown) => toastNewSpy(o) }))

const { default: PeerProfile } = await import('./peerProfile.solid')

let dispose: (() => void) | undefined
const el = () => document.createElement('div')

function mount(props: Record<string, unknown>) {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <PeerProfile {...(props as Parameters<typeof PeerProfile>[0])} />, host)
  return host
}

/** Строка под тестом — по глифу её `Row.Icon`, а не по угаданному классу. */
function rowByIcon(host: HTMLElement, icon: IconName): HTMLElement | null {
  const g = glyph(icon)
  const span = Array.from(host.querySelectorAll<HTMLElement>('.row-icon')).find((s) => s.textContent === g)
  return (span?.closest('.row') as HTMLElement | null) ?? null
}

afterEach(() => {
  dispose?.()
  dispose = undefined
  meId = 1
  dialogs = []
  chatsSubs.clear()
  phoneMirror.clear()
  phoneVersion = 0
  phoneSubs.clear()
  peerSignal[1](undefined)
  fullPeerSignal[1](undefined)
  setMuteSpy.mockClear()
  copyTextToClipboardSpy.mockClear()
  toastNewSpy.mockClear()
})

describe('Phone (tweb :633-691)', () => {
  it('показывается: чужой пользователь + телефон в profilePhoneCache, отформатирован', () => {
    peerSignal[1]({ _: 'user', id: 7 })
    setPhone(7, '+79261234567')
    const h = mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    const row = rowByIcon(h, 'phone')
    expect(row).not.toBeNull()
    expect(row!.querySelector('.row-title')!.textContent).toBe('+7 926 123 4567')
  })

  it('не показывается: телефона в зеркале нет', () => {
    peerSignal[1]({ _: 'user', id: 7 })
    const h = mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    expect(rowByIcon(h, 'phone')).toBeNull()
  })

  it('не показывается: свой диалог (peerId===meId, isDialog) — !canBeDetailed()', () => {
    meId = 42
    peerSignal[1]({ _: 'user', id: 42 })
    setPhone(42, '+79261234567')
    const h = mount({ peerId: 42, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    expect(rowByIcon(h, 'phone')).toBeNull()
  })

  it('не показывается: пир не пользователь (канал/группа)', () => {
    peerSignal[1]({ _: 'channel', id: 7, pFlags: { broadcast: true } })
    setPhone(-7, '+79261234567')
    const h = mount({ peerId: -7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    expect(rowByIcon(h, 'phone')).toBeNull()
  })

  it('клик копирует ЦИФРЫ (без пробелов группировки) и зовёт toastNew(PhoneCopied)', () => {
    peerSignal[1]({ _: 'user', id: 7 })
    setPhone(7, '+79261234567')
    const h = mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    rowByIcon(h, 'phone')!.click()
    expect(copyTextToClipboardSpy).toHaveBeenCalledWith('+79261234567')
    expect(toastNewSpy).toHaveBeenCalledWith({ langPackKey: 'PhoneCopied' })
  })
})

describe('Username (tweb :693-732) + QrButton (tweb :734-747)', () => {
  it('показывается: чужой пользователь с username', () => {
    peerSignal[1]({ _: 'user', id: 7, username: 'durov' })
    const h = mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    const row = rowByIcon(h, 'username')
    expect(row).not.toBeNull()
    expect(row!.querySelector('.row-title')!.textContent).toBe('durov')
  })

  it('не показывается: username не задан', () => {
    peerSignal[1]({ _: 'user', id: 7 })
    const h = mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    expect(rowByIcon(h, 'username')).toBeNull()
  })

  it('не показывается: свой диалог — !canBeDetailed()', () => {
    meId = 42
    peerSignal[1]({ _: 'user', id: 42, username: 'me' })
    const h = mount({ peerId: 42, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    expect(rowByIcon(h, 'username')).toBeNull()
  })

  it('клик копирует «@username» и зовёт toastNew(UsernameCopied)', () => {
    peerSignal[1]({ _: 'user', id: 7, username: 'durov' })
    const h = mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    rowByIcon(h, 'username')!.click()
    expect(copyTextToClipboardSpy).toHaveBeenCalledWith('@durov')
    expect(toastNewSpy).toHaveBeenCalledWith({ langPackKey: 'UsernameCopied' })
  })

  it('QR-кнопка есть у ЧУЖОГО пира и зовёт onOpenQrCode с url/label', () => {
    const onOpenQrCode = vi.fn()
    peerSignal[1]({ _: 'user', id: 7, username: 'durov' })
    const h = mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el(), onOpenQrCode })
    const row = rowByIcon(h, 'username')!
    const qr = row.querySelector('button.qr') as HTMLElement
    expect(qr).not.toBeNull()
    qr.click()
    expect(onOpenQrCode).toHaveBeenCalledWith({ url: `${location.origin}/@durov`, label: '@durov' })
  })

  it('QR-кнопки НЕТ у СВОЕГО username (peerId === meId), даже если строка видна', () => {
    // canBeDetailed() гейтит саму строку Username при peerId===meId&&isDialog,
    // поэтому проверяем QrButton у isDialog=false (строка видна, meId тот же).
    meId = 42
    peerSignal[1]({ _: 'user', id: 42, username: 'me' })
    const h = mount({ peerId: 42, isDialog: false, scrollable: el(), setCollapsedOn: el() })
    const row = rowByIcon(h, 'username')!
    expect(row.querySelector('.row-title')!.textContent).toBe('me')
    expect(row.querySelector('button.qr')).toBeNull()
  })
})

describe('Bio (tweb :895-967)', () => {
  it('показывается: about пользователя', () => {
    peerSignal[1]({ _: 'user', id: 7 })
    fullPeerSignal[1]({ _: 'userFull', id: 7, about: 'Hello world' })
    const h = mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    const row = rowByIcon(h, 'info')!
    expect(row.querySelector('.row-title')!.textContent).toBe('Hello world')
  })

  it('показывается: about канала (то же поле схемы, без ветвления по типу пира)', () => {
    peerSignal[1]({ _: 'channel', id: 7, pFlags: { broadcast: true } })
    fullPeerSignal[1]({ _: 'channelFull', id: 7, about: 'Channel description' })
    const h = mount({ peerId: -7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    const row = rowByIcon(h, 'info')!
    expect(row.querySelector('.row-title')!.textContent).toBe('Channel description')
  })

  it('не показывается: about пустой/нет', () => {
    peerSignal[1]({ _: 'user', id: 7 })
    fullPeerSignal[1]({ _: 'userFull', id: 7 })
    const h = mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    expect(rowByIcon(h, 'info')).toBeNull()
  })

  it('НЕ гейтится canBeDetailed() — свой bio в «Избранном» показывается, если есть (прав оригинал)', () => {
    meId = 42
    peerSignal[1]({ _: 'user', id: 42 })
    fullPeerSignal[1]({ _: 'userFull', id: 42, about: 'My own bio' })
    const h = mount({ peerId: 42, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    const row = rowByIcon(h, 'info')!
    expect(row.querySelector('.row-title')!.textContent).toBe('My own bio')
  })

  it('клик копирует about и зовёт toastNew(BioCopied)', () => {
    peerSignal[1]({ _: 'user', id: 7 })
    fullPeerSignal[1]({ _: 'userFull', id: 7, about: 'Hello world' })
    const h = mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    rowByIcon(h, 'info')!.click()
    expect(copyTextToClipboardSpy).toHaveBeenCalledWith('Hello world')
    expect(toastNewSpy).toHaveBeenCalledWith({ langPackKey: 'BioCopied' })
  })
})

describe('Link (tweb :969-1036, только ветка публичного username)', () => {
  it('показывается: канал/группа с username', () => {
    peerSignal[1]({ _: 'channel', id: 100, pFlags: { megagroup: true }, username: 'mygroup' })
    const h = mount({ peerId: -100, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    const row = rowByIcon(h, 'link')!
    expect(row.querySelector('.row-title')!.textContent).toBe(`${location.host}/@mygroup`)
  })

  it('не показывается: username не задан', () => {
    peerSignal[1]({ _: 'channel', id: 100, pFlags: { megagroup: true } })
    const h = mount({ peerId: -100, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    expect(rowByIcon(h, 'link')).toBeNull()
  })

  it('не показывается: пир — пользователь (эта ветвь только для чата/канала)', () => {
    peerSignal[1]({ _: 'user', id: 7, username: 'durov' })
    const h = mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    expect(rowByIcon(h, 'link')).toBeNull()
  })

  it('клик копирует полный URL и зовёт toastNew(LinkCopied)', () => {
    peerSignal[1]({ _: 'channel', id: 100, pFlags: { megagroup: true }, username: 'mygroup' })
    const h = mount({ peerId: -100, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    rowByIcon(h, 'link')!.click()
    expect(copyTextToClipboardSpy).toHaveBeenCalledWith(`${location.origin}/@mygroup`)
    expect(toastNewSpy).toHaveBeenCalledWith({ langPackKey: 'LinkCopied' })
  })

  it('QR-кнопка зовёт onOpenQrCode с полным url/label', () => {
    const onOpenQrCode = vi.fn()
    peerSignal[1]({ _: 'channel', id: 100, pFlags: { megagroup: true }, username: 'mygroup' })
    const h = mount({ peerId: -100, isDialog: true, scrollable: el(), setCollapsedOn: el(), onOpenQrCode })
    const row = rowByIcon(h, 'link')!
    ;(row.querySelector('button.qr') as HTMLElement).click()
    expect(onOpenQrCode).toHaveBeenCalledWith({
      url: `${location.origin}/@mygroup`,
      label: `${location.host}/@mygroup`,
    })
  })
})

describe('Birthday (tweb :749-831)', () => {
  it('показывается: fullPeer.birthday есть', () => {
    peerSignal[1]({ _: 'user', id: 7 })
    fullPeerSignal[1]({ _: 'userFull', id: 7, birthday: { _: 'birthday', day: 1, month: 1, year: 2000 } })
    const h = mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    expect(rowByIcon(h, 'gift')).not.toBeNull()
  })

  it('не показывается: birthday нет', () => {
    peerSignal[1]({ _: 'user', id: 7 })
    fullPeerSignal[1]({ _: 'userFull', id: 7 })
    const h = mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    expect(rowByIcon(h, 'gift')).toBeNull()
  })

  it('клик копирует отформатированную дату (тост не портирован — нет ключа TextCopied)', () => {
    peerSignal[1]({ _: 'user', id: 7 })
    fullPeerSignal[1]({ _: 'userFull', id: 7, birthday: { _: 'birthday', day: 1, month: 1, year: 2000 } })
    const h = mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    const row = rowByIcon(h, 'gift')!
    const title = row.querySelector('.row-title')!.textContent
    row.click()
    expect(copyTextToClipboardSpy).toHaveBeenCalledWith(title)
    expect(toastNewSpy).not.toHaveBeenCalled()
  })
})

describe('Notifications (tweb :1175-1218)', () => {
  it('показывается: чужой пир (peerId !== meId)', () => {
    meId = 1
    peerSignal[1]({ _: 'user', id: 7 })
    const h = mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    expect(rowByIcon(h, 'unmute')).not.toBeNull()
  })

  it('не показывается: свой диалог (peerId === meId)', () => {
    meId = 42
    peerSignal[1]({ _: 'user', id: 42 })
    const h = mount({ peerId: 42, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    expect(rowByIcon(h, 'unmute')).toBeNull()
  })

  it('чекбокс отражает !muted (dialogs.notify_settings)', () => {
    meId = 1
    peerSignal[1]({ _: 'user', id: 7 })
    dialogs = [{ peerId: 7, notify_settings: { _: 'peerNotifySettings', silent: true } }]
    const h = mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    const row = rowByIcon(h, 'unmute')!
    expect(row.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false) // muted → !muted=false
  })

  it('переключение зовёт managers.groups.setMute с ИНВЕРТИРОВАННЫМ checked', () => {
    meId = 1
    peerSignal[1]({ _: 'user', id: 7 })
    dialogs = [{ peerId: 7, notify_settings: { _: 'peerNotifySettings' } }] // не замьючен
    const h = mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    const row = rowByIcon(h, 'unmute')!
    const input = row.querySelector<HTMLInputElement>('input[type=checkbox]')!
    expect(input.checked).toBe(true) // !muted = true

    input.checked = false
    input.dispatchEvent(new Event('change'))

    expect(setMuteSpy).toHaveBeenCalledWith(7, true) // checked=false → mute=true
  })

  it('живая подписка: смена dialogs через chatsStore.subscribe пересчитывает чекбокс', () => {
    meId = 1
    peerSignal[1]({ _: 'user', id: 7 })
    dialogs = [{ peerId: 7, notify_settings: { _: 'peerNotifySettings' } }]
    const h = mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    const row = rowByIcon(h, 'unmute')!
    expect(row.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true)

    dialogs = [{ peerId: 7, notify_settings: { _: 'peerNotifySettings', silent: true } }]
    bumpDialogs()

    expect(row.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false)
  })
})
