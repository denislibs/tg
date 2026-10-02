/** @jsxImportSource solid-js */
// Пины плашки-подсказки над списком чатов — порт tweb
// `sidebarLeft/{pendingSuggestion,pendingSuggestionItem,notificationsSuggestion}.tsx`
// (812502980), задача 2-5 волны 7
// (`docs/superpowers/plans/2026-09-30-wave-7-shell-sidebars.md`).
//
// Две части: (1) сам корень `renderPendingSuggestion` в голом узле — когда вид
// «включите уведомления» доступен, что делают клик и крестик, свёрнутая колонка;
// (2) корень на своём месте — в `.chatlist-overlay` владельца списка
// (`lib/appDialogsManager.ts`, tweb `appDialogsManager.ts:1384-1388`), высота
// оверлея — в `--chatlist-overlay-height` (`:601-604`).
//
// Web Notifications API и Web Animations в happy-dom нет: `Notification`
// подставляется глобалом, наличие API — моком `environment/notificationSupport`
// (у оригинала это константа на загрузке модуля), `element.animate` — заглушкой
// с уже завершённым `finished`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const support = vi.hoisted(() => ({ value: true }))
vi.mock('@environment/notificationSupport', () => ({
  get default() { return support.value },
}))
const toastNew = vi.hoisted(() => vi.fn())
vi.mock('@components/toast', () => ({ toastNew }))
const onPushConditionsChange = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/client/pushSetup', () => ({ onPushConditionsChange }))

import '@/test/lang'
import { useSettingsStore } from '@/settings'
import { useIsSidebarCollapsed } from '@stores/foldersSidebar.solid'
import { resetPeerMirror } from '@core/peerCache'
import { renderPendingSuggestion } from './pendingSuggestion.solid'
import styles from './pendingSuggestion.module.scss'
import {
  FakeResizeObserver, installFrames, mountOwner, resetStores, settle, uninstallFrames, type Mounted,
} from '@/lib/appDialogsManager.testkit'

let permission: NotificationPermission
const requestPermission = vi.fn<() => Promise<NotificationPermission>>()
let animate: ReturnType<typeof vi.fn>

let host: HTMLDivElement
let dispose: (() => void) | undefined

/** Отдать микрозадачи: `AnimationList` играет анимацию из `queueMicrotask`. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const mount = () => {
  dispose = renderPendingSuggestion(host)
}
const banner = () => host.querySelector<HTMLElement>('.' + styles.suggestionContainer)

beforeEach(() => {
  support.value = true
  permission = 'default'
  requestPermission.mockReset()
  toastNew.mockReset()
  onPushConditionsChange.mockClear()
  // `permission` — геттером: тест меняет его после заглушки (Object.assign снял бы значение)
  vi.stubGlobal('Notification', Object.defineProperties(function Notification() {}, {
    permission: { get: () => permission },
    requestPermission: { value: requestPermission },
  }))
  animate = vi.fn(() => ({ finished: Promise.resolve() }) as unknown as Animation)
  Element.prototype.animate = animate as unknown as typeof Element.prototype.animate
  useSettingsStore.getState().update({ notifySuggested: false })
  useIsSidebarCollapsed()[1](false)
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  vi.unstubAllGlobals()
  delete (Element.prototype as { animate?: unknown }).animate
  document.body.replaceChildren()
  document.body.className = ''
})

describe('renderPendingSuggestion: вид «включите уведомления» (tweb notificationsSuggestion.tsx:46-55)', () => {
  it('разрешение ещё не спрошено (permission === "default") — плашка строкой, body.has-pending-suggestion', async () => {
    mount()
    await flush()

    const container = banner()!
    expect(container).not.toBeNull()
    const row = container.firstElementChild as HTMLElement
    // дерево tweb: div.row.row-clickable.hover-effect._suggestion._secondary
    for(const cls of ['row', 'row-clickable', 'hover-effect', styles.suggestion, styles.secondary]) {
      expect(row.classList.contains(cls)).toBe(true)
    }
    expect(row.querySelector('button.btn-icon.close')!.classList.contains(styles.close)).toBe(true)
    const title = row.querySelector('.row-title > span.text-bold')!
    expect(title.classList.contains(styles.suggestionTitle)).toBe(true)
    // ключ tweb `Suggestion.Notifications`, `%s` — колокольчик `wrapEmojiText('🔔')` (lang.ts:306)
    expect(title.textContent).toBe('Never miss a message! ')
    expect(title.querySelector('.emoji')!.getAttribute('alt')).toBe('🔔')
    expect(row.querySelector('.row-subtitle > span')!.textContent).toBe('Enable notifications to stay updated.')
    expect(document.body.classList.contains('has-pending-suggestion')).toBe(true)
    // появление — grow-height (`<Animated type="grow-height" appear>`, animations.tsx:20)
    expect(animate).toHaveBeenCalledTimes(1)
    expect(animate.mock.instances[0]).toBe(container)
    expect(animate.mock.calls[0][0]).toEqual([{ height: 0, opacity: 0 }, { height: '0px', opacity: 1 }])
  })

  it('разрешение выдано — плашки нет и класса на body нет', async () => {
    permission = 'granted'
    mount()
    await flush()

    expect(host.innerHTML).toBe('')
    expect(document.body.classList.contains('has-pending-suggestion')).toBe(false)
  })

  it('без Web Notifications API не предлагается (tweb 72c50bfef)', async () => {
    support.value = false
    mount()
    await flush()

    expect(host.childElementCount).toBe(0)
  })

  it('крестик: notifications.suggested запоминается, тост, плашка уходит анимацией и не возвращается после перемонтирования', async () => {
    mount()
    await flush()
    const container = banner()!

    ;(container.querySelector('button.close') as HTMLElement).click()
    expect(useSettingsStore.getState().notifySuggested).toBe(true)
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'Suggestion.Notifications.Dismissed' })
    expect(requestPermission).not.toHaveBeenCalled() // cancelEvent: клик строки не поднялся

    // уход — обратные кейфреймы, узел держится до `finished`
    expect(container.isConnected).toBe(true)
    await flush()
    expect(animate).toHaveBeenCalledTimes(2)
    expect(animate.mock.calls[1][0]).toEqual([{ height: '0px', opacity: 1 }, { height: 0, opacity: 0 }])
    await flush()
    expect(container.isConnected).toBe(false)
    expect(document.body.classList.contains('has-pending-suggestion')).toBe(false)

    dispose!()
    mount()
    await flush()
    expect(host.childElementCount).toBe(0)
  })

  it('клик по строке: выдано — запоминается и пересобирается push-подписка (onPushConditionsChange)', async () => {
    requestPermission.mockResolvedValue('granted')
    mount()
    await flush()

    ;(banner()!.querySelector('.row-clickable') as HTMLElement).click()
    await flush()

    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(useSettingsStore.getState().notifySuggested).toBe(true)
    expect(onPushConditionsChange).toHaveBeenCalledTimes(1)
    expect(toastNew).not.toHaveBeenCalled()
  })

  it('клик по строке: запрещено — как крестик (throw → onDismissed)', async () => {
    requestPermission.mockResolvedValue('denied')
    mount()
    await flush()

    ;(banner()!.querySelector('.row-clickable') as HTMLElement).click()
    await flush()

    expect(useSettingsStore.getState().notifySuggested).toBe(true)
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'Suggestion.Notifications.Dismissed' })
    expect(onPushConditionsChange).not.toHaveBeenCalled()
  })

  it('клик без API закрывает плашку, а не зовёт requestPermission (tweb 72c50bfef)', async () => {
    mount()
    await flush()
    support.value = false

    ;(banner()!.querySelector('.row-clickable') as HTMLElement).click()

    expect(requestPermission).not.toHaveBeenCalled()
    expect(useSettingsStore.getState().notifySuggested).toBe(true)
  })

  it('свёрнутая колонка — квадрат с эмодзи вместо строки (useIsSidebarCollapsed)', async () => {
    useIsSidebarCollapsed()[1](true)
    mount()
    await flush()

    const container = banner()!
    expect(container.querySelector('.row')).toBeNull()
    const square = container.firstElementChild as HTMLElement
    expect(square.classList.contains(styles.collapsed)).toBe(true)
    expect(square.classList.contains('hover-effect')).toBe(true)
    expect(Array.from(square.querySelectorAll('.emoji'), (el) => el.getAttribute('alt'))).toEqual(['🔔'])
  })

  it('dispose снимает узлы и body.has-pending-suggestion (расхождение 3)', async () => {
    mount()
    await flush()
    expect(document.body.classList.contains('has-pending-suggestion')).toBe(true)

    dispose!()
    dispose = undefined

    expect(host.childNodes).toHaveLength(0)
    expect(document.body.classList.contains('has-pending-suggestion')).toBe(false)
  })
})

describe('плашка на своём месте — в оверлее владельца списка (tweb appDialogsManager.ts:1384-1388)', () => {
  let mounted: Mounted | undefined

  beforeEach(() => {
    resetStores()
    resetPeerMirror()
    expect(installFrames(), 'очередь fastRaf досталась этому файлу непрокрученной').toBe(true)
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  })

  afterEach(() => {
    mounted?.manager.destroy()
    mounted = undefined
    uninstallFrames()
    resetStores()
    resetPeerMirror()
  })

  it('плашка — первой в .chatlist-overlay, над рядом папок; её высота уходит в --chatlist-overlay-height', async () => {
    mounted = mountOwner()
    await settle()
    const overlay = mounted.host.querySelector<HTMLElement>(':scope > .chatlist-overlay')!

    const first = overlay.firstElementChild as HTMLElement
    expect(first.firstElementChild!.classList.contains(styles.suggestionContainer)).toBe(true)
    expect(first.nextElementSibling!.classList.contains('folders-tabs-gradient-container')).toBe(true)

    // плашка выросла — браузер сообщает новую высоту оверлея
    const observer = FakeResizeObserver.instances.find((instance) => instance.observed.includes(overlay))!
    observer.fire(104)
    expect(mounted.host.style.getPropertyValue('--chatlist-overlay-height')).toBe('104px')
  })

  it('destroy() владельца снимает плашку и body.has-pending-suggestion', async () => {
    mounted = mountOwner()
    await settle()
    expect(document.body.classList.contains('has-pending-suggestion')).toBe(true)

    mounted.manager.destroy()
    mounted = undefined

    expect(document.querySelector('.' + styles.suggestionContainer)).toBeNull()
    expect(document.body.classList.contains('has-pending-suggestion')).toBe(false)
  })
})
