// Дефект (боевой стенд, solid-wave-1 задача 4): чат открыт → правый клик по
// сообщению открывает меню → клик «Удалить» ПРОГРАММНО закрывает меню (в
// buttonMenu.ts это `contextMenuController.close()`, вызывается СРАЗУ после
// onClick) и тут же открывает попап подтверждения (PopupElement/PopupPeer) —
// то есть removeLayer(menu) и pushLayer(popup) идут ПОДРЯД, без ожидания
// эффекта первого. Один следующий Escape закрывал не только попап, но и чат
// (location.hash обнулялся), а после этого чат переставал открываться кликом
// по диалогу до перезагрузки страницы.
//
// Причина — гонка history.back()/history.pushState(): history.back()
// асинхронна и фиксирует ЦЕЛЬ перехода (currentIndex-1) В МОМЕНТ ВЫЗОВА, а сам
// переход и popstate происходят позже отдельной задачей. Если между вызовом
// back() и этим переходом успевает пройти pushState() (ровно наш сценарий —
// закрытие меню и открытие попапа идут одно за другим без ожидания), цель
// более раннего back() и открытие нового попапа рассинхронизируются: следующий
// Escape (removeLayer попапа) вычисляет СВОЙ back от уже съехавшей позиции и
// отматывает мимо записи чата. tweb знает про эту гонку буквально
// (appNavigationController.ts::modifyHistoryFromEvent, комментарий "have to
// have this timeout, otherwise browser will eat the event if you do push and
// back together"), но чинит её только на ветке Navigation API — легаси-путь
// (наш единственный, Navigation API мы не портировали) гонку не гасит и там.
//
// Почему СТАРЫЙ тест базы (popupElement.test.ts, «Esc закрывает попап и не
// доходит до фолбэка») был зелёным при живом дефекте: там ОДИН попап без
// предшествующего слоя (нет ни слоя чата, ни закрывающегося перед ним меню) —
// гонки просто неоткуда взяться, а happy-dom к тому же считает history.back()
// ПОЛНОСТЬЮ СИНХРОННО (см. node_modules/happy-dom BrowserFrameNavigator —
// цель перехода вычисляется и popstate диспатчится внутри одного и того же
// вызова), поэтому тест, гоняющий реальный history.back() без эмуляции,
// НИКОГДА не увидит эту гонку — асинхронность нужно эмулировать явно, что и
// делает installAsyncBrowserHistory ниже.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initHotkeys } from '@core/hotkeys'
import OverlayClickHandler from '@helpers/overlayClickHandler'
import PopupElement from '@components/popups/popupElement'
import { setBaseHandler, pushHashState } from './navigationStack'

/**
 * Эмулирует РЕАЛЬНУЮ асинхронность `history.back()`: браузер фиксирует индекс
 * цели перехода в момент вызова, а сам переход (обновление `location` +
 * `popstate`) происходит позже, отдельной задачей — ровно то, чего happy-dom
 * не делает (см. докблок файла). `history.pushState` оставляем синхронным —
 * как в реальном браузере и как уже в happy-dom.
 */
function installAsyncBrowserHistory(delayMs: number) {
  let entries: Array<{ url: string; state: unknown }> = [{ url: location.href, state: history.state }]
  let current = 0
  const realReplaceState = history.replaceState.bind(history)

  function applyUrl(url: string): void {
    const u = new URL(url, location.href)
    realReplaceState(entries[current].state, '', u.pathname + u.search + u.hash)
  }

  const pushSpy = vi.spyOn(history, 'pushState').mockImplementation(((state: unknown, _title: string, url?: string | URL) => {
    const u = url ? new URL(String(url), location.href).href : location.href
    entries = entries.slice(0, current + 1)
    entries.push({ url: u, state })
    current = entries.length - 1
    applyUrl(u)
  }) as typeof history.pushState)

  const backSpy = vi.spyOn(history, 'back').mockImplementation(() => {
    const targetIndex = current - 1 // фиксация ЦЕЛИ — СЕЙЧАС, синхронно с вызовом
    setTimeout(() => {
      if (targetIndex < 0 || !entries[targetIndex]) return
      current = targetIndex
      applyUrl(entries[current].url)
      window.dispatchEvent(new PopStateEvent('popstate', { state: entries[current].state }))
    }, delayMs)
  })

  return {
    restore(): void { pushSpy.mockRestore(); backSpy.mockRestore() },
  }
}

describe('navigationStack — гонка history.back()/pushState() при смене оверлея на другой без ожидания (защита от дефекта живого стенда)', () => {
  afterEach(() => {
    document.body.replaceChildren()
    vi.useRealTimers()
  })

  it('меню закрывается программно и тут же открывается попап (до подтверждения back меню) → Escape по попапу закрывает ТОЛЬКО попап, чат остаётся, навигация после этого жива', () => {
    vi.useFakeTimers()
    let baseHandlerCalls = 0
    setBaseHandler(() => { baseHandlerCalls++ })
    const deactivateHotkeys = initHotkeys({})
    const asyncHistory = installAsyncBrowserHistory(20)

    // Чат открыт — как useUrlSync при selectChat('777001').
    pushHashState('#777001')
    expect(location.hash).toBe('#777001')

    // Правый клик по сообщению — открывается меню (тот же механизм, что
    // contextMenuController: OverlayClickHandler с navigationType='menu').
    const menu = new OverlayClickHandler('menu', true)
    menu.open(document.body)

    // Клик «Удалить»: buttonMenu.ts сначала зовёт onClick (у нас — открытие
    // попапа подтверждения), ПОТОМ закрывает меню. Порядок здесь неважен для
    // самого дефекта — важно, что оба вызова идут подряд, без ожидания between.
    menu.close()
    const popup = new PopupElement('popup-delete-test')
    popup.show()
    expect(document.querySelector('.popup-delete-test.active')).not.toBeNull()

    // Отложенный back() меню наконец подтверждается.
    vi.advanceTimersByTime(30)

    // Escape — единственный обработчик в escStack сейчас: попап. removeLayer
    // попапа планирует СВОЙ history.back() (ещё не подтверждён).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

    // Попап закрылся визуально сразу (анимация ухода — hiding), но back() от
    // Escape ещё не подтверждён — ПОЛЬЗОВАТЕЛЬ ТУТ ЖЕ кликает по диалогу.
    expect(document.querySelector('.popup-delete-test')!.classList.contains('hiding')).toBe(true)
    pushHashState('#888002')

    // Теперь подтверждается отложенный back() попапа (плюс запас на
    // предохранитель очереди — 500мс).
    vi.advanceTimersByTime(600)

    // ДЕФЕКТ A: один Escape не должен закрывать чат — до базового
    // (закрывающего чат) слоя popstate дойти не должен был вовсе.
    expect(baseHandlerCalls).toBe(0)
    // ДЕФЕКТ B: клик по диалогу СРАЗУ после Escape обязан долететь — hash не
    // должен быть переписан задним числом «зависшим» back() попапа.
    expect(location.hash).toBe('#888002')

    asyncHistory.restore()
    deactivateHotkeys()
  })
})
