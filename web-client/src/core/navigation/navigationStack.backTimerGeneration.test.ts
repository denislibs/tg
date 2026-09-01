// Дефект (ревью solid-wave-1, финальная находка IMPORTANT-1): предохранитель
// `removeLayer` (setTimeout 500мс, снимающий "занято" истории, если popstate
// от НАШЕГО history.back() почему-то не пришёл) не привязан к породившей его
// конкретной операции — он смотрит только на ГЛОБАЛЬНЫЙ булev `ignorePop`, а
// не на то, что этот флаг мог успеть взвести уже СОВСЕМ ДРУГОЕ закрытие слоя.
//
// Сценарий внахлёст (взят из репорта ревью):
//   t=0    removeLayer(A) → back()#1 (подтвердится на t=20), предохранитель #1
//          планируется на t=0+500=500
//   t=20   popstate от back()#1 приходит НОРМАЛЬНО — ignorePop корректно
//          снят, historyOpSettled() отработал штатно. Предохранитель #1
//          при этом остаётся висеть в очереди таймеров (setTimeout не отменяют).
//   t=499  removeLayer(B) → back()#2 (подтвердится на t=549), взводит СВОЙ
//          ignorePop=true
//   t=500  СТАРЫЙ предохранитель #1 срабатывает. Он видит глобальный
//          ignorePop=true — но это флаг НЕ ЕГО операции, а операции #2,
//          которая всё ещё летит. Без привязки к поколению предохранитель #1
//          гасит ЧУЖОЙ ignorePop и делает лишний historyOpSettled() —
//          очередь истории "расчехляется" ДО того, как реально подтвердится
//          back()#2.
//   t=509  pushHashState('#chat2') (пользователь кликнул другой диалог,
//          пока висит МЁРТВОЕ окно между #1 и #2) — из-за лишнего settle на
//          t=500 эта мутация уходит в браузер НЕМЕДЛЕННО, а не встаёт в
//          очередь до настоящего подтверждения back()#2.
//   t=549  popstate от back()#2 приходит. Раз ignorePop уже (ошибочно) снят
//          на t=500, handlePop принимает этот popstate за ПОЛЬЗОВАТЕЛЬСКИЙ
//          Back: уходит в baseHandler (дефект A — Escape «доезжает» до чата),
//          а сам back()#2 (чья цель была зафиксирована ДО pushHashState на
//          t=509) откатывает location.hash мимо только что применённого
//          '#chat2' (дефект B).
//
// Предложенная и применённая правка — счётчик поколений: `removeLayer`
// присваивает `const gen = ++backGen` в момент своего вызова, а тело
// предохранителя первым делом проверяет `if (backGen !== gen) return` —
// таймер, переживший свою операцию (поколение уже сменилось), не имеет права
// трогать чужой ignorePop/historyBusy вовсе, независимо от текущего значения
// булева флага.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pushLayer, removeLayer, pushHashState, setBaseHandler } from './navigationStack'

/** Тот же приём эмуляции асинхронного `history.back()`, что и в
 *  `navigationStack.overlaySwap.test.ts` (см. докблок там), но с управляемой
 *  извне задержкой на КАЖДЫЙ отдельный вызов `back()` — нужно эмулировать два
 *  независимых закрытия слоёв с разным временем подтверждения. */
function installAsyncBrowserHistory(nextDelayMs: () => number) {
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
    const delay = nextDelayMs()
    setTimeout(() => {
      if (targetIndex < 0 || !entries[targetIndex]) return
      current = targetIndex
      applyUrl(entries[current].url)
      window.dispatchEvent(new PopStateEvent('popstate', { state: entries[current].state }))
    }, delay)
  })

  return {
    restore(): void { pushSpy.mockRestore(); backSpy.mockRestore() },
  }
}

describe('navigationStack — предохранитель removeLayer обязан быть привязан к своей операции (IMPORTANT-1, финальное ревью solid-wave-1)', () => {
  afterEach(() => {
    document.body.replaceChildren()
    vi.useRealTimers()
  })

  it('два закрытия слоёв внахлёст (второе — за 1мс до 500мс-предохранителя первого): чужая очередь не распускается, popstate второй операции не улетает в baseHandler, отложенный pushHashState не откатывается', () => {
    vi.useFakeTimers()
    let baseHandlerCalls = 0
    setBaseHandler(() => { baseHandlerCalls++ })
    const delays = [20, 50] // back()#1 подтвердится на t=20, back()#2 — на t=549 (499+50)
    const asyncHistory = installAsyncBrowserHistory(() => delays.shift()!)

    pushHashState('#chat1')

    // Первое закрытие: подтверждается штатно на t=20, но его предохранитель
    // (t=0+500=500) остаётся тикать дальше — setTimeout никто не отменяет.
    const layerA = pushLayer(() => {})
    removeLayer(layerA)
    vi.advanceTimersByTime(20)

    // Второй слой открывается уже ПОСЛЕ штатного подтверждения первого.
    const layerB = pushLayer(() => {})

    // t=499 (20 уже прошло, добираем 479): закрываем ВТОРОЙ слой ЗА 1мс до
    // срабатывания предохранителя ПЕРВОГО — окно гонки из репорта ревью.
    vi.advanceTimersByTime(479)
    removeLayer(layerB)

    // t=500: старый предохранитель #1 срабатывает.
    vi.advanceTimersByTime(1)

    // t=509: пользователь кликает другой диалог, пока back()#2 ещё летит —
    // эта мутация обязана встать в очередь и применится ПОСЛЕ подтверждения
    // back()#2, а не улететь в браузер немедленно из-за чужого settle.
    vi.advanceTimersByTime(9)
    pushHashState('#chat2')

    // t=549: приходит НАСТОЯЩИЙ popstate от back()#2.
    vi.advanceTimersByTime(40)

    // ДЕФЕКТ A: popstate от НАШЕГО же back()#2 не должен приниматься за
    // пользовательский Back и уходить в базовый слой (чат).
    expect(baseHandlerCalls).toBe(0)
    // ДЕФЕКТ B: pushHashState('#chat2'), отправленный, пока back()#2 летел,
    // обязан пережить его подтверждение, а не быть откаченным задним числом.
    expect(location.hash).toBe('#chat2')

    asyncHistory.restore()
  })

  // ── ПИН ЗАДАЧИ #105 (пункт 1) ─────────────────────────────────────────────
  //
  // Предохранитель гасил ОБЩИЙ флаг `ignorePop`, а тот отвечал сразу на два
  // вопроса: «съесть ли следующий popstate» и «свободна ли очередь». Отсюда
  // дефект: если наш СОБСТВЕННЫЙ `back()` подтверждался дольше 500мс — а он
  // асинхронный и на слабой машине с забитым главным потоком это обычное дело,
  // — предохранитель гасил флаг, и пришедший ПОЗЖЕ popstate этой же операции
  // попадал в ветку «настоящий Back пользователя»: снимался лишний слой либо
  // Back уходил в базовый слой и закрывал чат.
  //
  // Разведено на токен (`pendingBacks`) и очередь (`historyBusy`):
  // предохранитель распускает только очередь, токен снимает только свой
  // popstate. Проверяется ИМЕННО этот исход, а не то, что таймер существует.
  it('МЕДЛЕННЫЙ back() (подтверждение позже предохранителя): поздний popstate всё равно съеден — лишний слой не снимается и чат не закрывается', () => {
    vi.useFakeTimers()
    let baseHandlerCalls = 0
    setBaseHandler(() => { baseHandlerCalls++ })
    // Одно закрытие, подтверждение на t=800 — ЗА предохранителем (500).
    const asyncHistory = installAsyncBrowserHistory(() => 800)

    pushHashState('#chat1')

    let popped = 0
    const under = pushLayer(() => { popped++ })  // слой ПОД закрываемым
    const top = pushLayer(() => { popped++ })
    removeLayer(top)

    // t=500: предохранитель срабатывает — очередь распускается, это его работа.
    vi.advanceTimersByTime(500)
    // t=800: приходит НАСТОЯЩИЙ popstate от нашего же back().
    vi.advanceTimersByTime(300)

    // Он обязан быть съеден: слой под закрытым не трогали, до базового слоя
    // (навигация чата) дело не дошло.
    expect(popped).toBe(0)
    expect(baseHandlerCalls).toBe(0)

    // А стек цел: настоящий Back после этого снимает ИМЕННО нижний слой.
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
    expect(popped).toBe(1)
    removeLayer(under)

    asyncHistory.restore()
  })
})
