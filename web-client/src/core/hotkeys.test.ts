import { describe, it, expect, vi, afterEach } from 'vitest'
import { initHotkeys } from './hotkeys'
import appNavigationController from './navigation/appNavigationController'

function press(key: string, opts: KeyboardEventInit = {}, target: EventTarget = window) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts })
  target.dispatchEvent(e)
  return e
}

let deactivate: (() => void) | null = null
afterEach(() => {
  deactivate?.()
  deactivate = null
  // Контроллер — модульный синглтон: недоснятые записи достались бы соседу.
  appNavigationController.spliceItems(0, Infinity)
  document.body.replaceChildren()
})

/**
 * Esc-СТЕКА ЗДЕСЬ БОЛЬШЕ НЕТ (#108), а с задачей chat-navigation-im-3 не стало
 * и `escFallback` — второго, параллельного пути «Esc закрывает чат». В
 * оригинале (tweb `appNavigationController.ts:217-224`) у Esc вообще нет
 * отдельной ветки для чата: он берёт ВЕРХНЮЮ запись стека и делает
 * `back(item.type)`. Задачи 1-2 завели записи `im`/`chat` так, что они лежат
 * на стеке контроллера ВСЕГДА, пока чат открыт (`core/navigation/chatHistory.ts`),
 * поэтому у `hotkeys.ts` предмета для собственной ветки Esc не осталось —
 * контроллер сам гасит событие в фазе ЗАХВАТА (`cancelEvent`,
 * `appNavigationController.ts:294-301`) ДО того, как оно доходит сюда.
 *
 * Тесты гоняют настоящий контроллер (синглтон), а не имитацию порядка: именно
 * их сцепка и есть предмет.
 */
describe('Esc: только контроллер навигации, своей ветки в hotkeys.ts нет', () => {
  it('открытая запись навигации (например, попап) забирает Esc', () => {
    deactivate = initHotkeys({})
    const onPop = vi.fn()
    const item = appNavigationController.pushItem({ type: 'popup', onPop })

    const e = press('Escape')

    expect(onPop).toHaveBeenCalledTimes(1)
    expect(e.defaultPrevented).toBe(true) // контроллер погасил событие в захвате

    appNavigationController.removeItem(item)
  })

  it('запись `im` (открытый чат) закрывается тем же Esc, что и любая другая запись', () => {
    deactivate = initHotkeys({})
    const onPop = vi.fn()
    const item = appNavigationController.pushItem({ type: 'im', onPop })

    press('Escape')

    expect(onPop).toHaveBeenCalledTimes(1)

    appNavigationController.removeItem(item)
  })

  it('пустой стек записей — Esc ничего не делает: hotkeys.ts не заводит свой таймер/фолбэк', () => {
    vi.useFakeTimers()
    try {
      deactivate = initHotkeys({})
      press('Escape')
      // Раньше ветка Esc в hotkeys.ts безусловно ставила setTimeout под
      // отложенный escFallback — даже без переданного колбэка. Теперь у Esc
      // здесь нет вообще никакой ветки: таймеров быть не должно.
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('гейт текстовых полей', () => {
  it('Ctrl+F поиск: срабатывает и со страницы, и из инпута (Telegram)', () => {
    const focusSearch = vi.fn()
    deactivate = initHotkeys({ focusSearch })
    const input = document.createElement('input')
    document.body.appendChild(input)
    // В отличие от буквенных хоткеев, поиск разрешён из инпута (как в tweb).
    press('f', { code: 'KeyF', ctrlKey: true }, input)
    expect(focusSearch).toHaveBeenCalledTimes(1)
    press('f', { code: 'KeyF', ctrlKey: true }, document.body)
    expect(focusSearch).toHaveBeenCalledTimes(2)
  })

  it('Ctrl+Shift+M из textarea не срабатывает, со страницы — срабатывает', () => {
    const muteChat = vi.fn()
    deactivate = initHotkeys({ muteChat })
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    press('M', { code: 'KeyM', ctrlKey: true, shiftKey: true }, ta)
    expect(muteChat).not.toHaveBeenCalled()
    press('M', { code: 'KeyM', ctrlKey: true, shiftKey: true }, document.body)
    expect(muteChat).toHaveBeenCalledTimes(1)
  })

  it('Esc срабатывает и из инпута', () => {
    deactivate = initHotkeys({})
    const onPop = vi.fn()
    const item = appNavigationController.pushItem({ type: 'popup', onPop })
    const input = document.createElement('input')
    document.body.appendChild(input)
    press('Escape', {}, input)
    expect(onPop).toHaveBeenCalledTimes(1)
    appNavigationController.removeItem(item)
  })

  it('Ctrl+F без mod или с Alt — не срабатывает', () => {
    const focusSearch = vi.fn()
    deactivate = initHotkeys({ focusSearch })
    press('f', { code: 'KeyF' }, document.body)
    press('f', { code: 'KeyF', ctrlKey: true, altKey: true }, document.body)
    expect(focusSearch).not.toHaveBeenCalled()
  })
})

describe('избранное и навигация по чатам', () => {
  it('Cmd/Ctrl+0 → openSaved, в т.ч. из инпута', () => {
    const openSaved = vi.fn()
    deactivate = initHotkeys({ openSaved })
    const input = document.createElement('input')
    document.body.appendChild(input)
    press('0', { code: 'Digit0', metaKey: true }, input)
    expect(openSaved).toHaveBeenCalledTimes(1)
    press('0', { code: 'Digit0', ctrlKey: true }, document.body)
    expect(openSaved).toHaveBeenCalledTimes(2)
  })

  it('Alt+↓ / Alt+↑ → nextChat / prevChat со страницы', () => {
    const nextChat = vi.fn()
    const prevChat = vi.fn()
    deactivate = initHotkeys({ nextChat, prevChat })
    press('ArrowDown', { altKey: true }, document.body)
    press('ArrowUp', { altKey: true }, document.body)
    expect(nextChat).toHaveBeenCalledTimes(1)
    expect(prevChat).toHaveBeenCalledTimes(1)
  })

  it('Alt+стрелки в инпуте не переключают чат (там навигация по словам)', () => {
    const nextChat = vi.fn()
    const prevChat = vi.fn()
    deactivate = initHotkeys({ nextChat, prevChat })
    const input = document.createElement('input')
    document.body.appendChild(input)
    press('ArrowDown', { altKey: true }, input)
    press('ArrowUp', { altKey: true }, input)
    expect(nextChat).not.toHaveBeenCalled()
    expect(prevChat).not.toHaveBeenCalled()
  })
})
