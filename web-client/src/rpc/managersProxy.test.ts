import { describe, it, expect } from 'vitest'
import { createStore } from 'solid-js/store'
import { SuperMessagePort } from './superMessagePort'
import { createManagers, registerManagers } from './managersProxy'

describe('managers proxy', () => {
  it('routes managers.x.y(args) to the registered manager method', async () => {
    const ch = new MessageChannel()
    const ui = new SuperMessagePort(ch.port1)
    const worker = new SuperMessagePort(ch.port2)
    registerManagers(worker, {
      health: { async check() { return { status: 'ok' } } },
    })
    const managers = createManagers<{ health: { check(): Promise<{ status: string }> } }>(ui)
    await expect(managers.health.check()).resolves.toEqual({ status: 'ok' })
  })

  it('memoizes manager and method proxies (stable identity between accesses)', () => {
    const ch = new MessageChannel()
    const ui = new SuperMessagePort(ch.port1)
    const managers = createManagers<{ health: { check: () => unknown }; auth: Record<string, unknown> }>(ui)
    expect(managers.health).toBe(managers.health)            // тот же прокси менеджера
    expect(managers.health.check).toBe(managers.health.check) // та же функция метода
    expect(managers.health).not.toBe(managers.auth)          // разные менеджеры — разные прокси
  })

  // ── Половина «а» правила символьных ключей ────────────────────────────────
  // Символа на цели нет → `undefined`, а НЕ менеджер/метод. Иначе чужой рантайм
  // принимает ответ за своё служебное значение: `unwrap` Solid-стора спрашивает
  // `value[$RAW]`, получал «менеджера» и подменял им весь объект менеджеров —
  // `managers.auth` в карточке становился `undefined`, экран входа гас.
  it('символ, которого на цели нет, — undefined, а не менеджер/метод', () => {
    const ch = new MessageChannel()
    const ui = new SuperMessagePort(ch.port1)
    const managers = createManagers<Record<string, unknown>>(ui) as Record<PropertyKey, unknown>

    expect(managers[Symbol.for('store-raw')]).toBeUndefined()
    expect((managers.auth as Record<PropertyKey, unknown>)[Symbol.iterator]).toBeUndefined()
  })

  // ── Половина «б» того же правила ──────────────────────────────────────────
  // Символ, который рантайм ПОЛОЖИЛ на цель, обязаны вернуть как есть.
  // Воспроизводим ровно то, что делает Solid-стор (`wrap`/`getNodes`):
  // `Object.defineProperty(handle, symbol, { value })`. Ловушки `defineProperty`
  // у нас нет, поэтому свойство ложится ПРЯМО НА ЦЕЛЬ, а дефолты дескриптора —
  // non-writable + non-configurable. Для таких свойств спецификация требует,
  // чтобы `get` вернул их настоящее значение; ответ `undefined` — нарушение
  // инварианта, движок бросает «TypeError: 'get' on proxy: property … is a
  // read-only and non-configurable data property». Так гас экран входа на
  // сборке index-xXn1WifZ.js.
  it('символ, положенный на цель через defineProperty, отдаётся честно (инвариант прокси)', () => {
    const ch = new MessageChannel()
    const ui = new SuperMessagePort(ch.port1)
    const managers = createManagers<Record<string, unknown>>(ui) as Record<PropertyKey, unknown>
    const auth = managers.auth as Record<PropertyKey, unknown>

    const $node = Symbol('store-node')
    const nodes: object = Object.create(null) as object
    Object.defineProperty(managers, $node, { value: nodes })
    Object.defineProperty(auth, $node, { value: nodes })

    expect(managers[$node]).toBe(nodes) // внешняя ловушка
    expect(auth[$node]).toBe(nodes)     // ловушка менеджера
    expect(managers[$node]).toBe(nodes) // повтор: именно ВТОРОЕ чтение падало в проде
  })

  // ── Хендл непрозрачен для «plain-object» эвристик ─────────────────────────
  // Второй, независимый эшелон защиты: рантайм, который заворачивает «обычные
  // объекты», обязан пропустить хендл ПО ССЫЛКЕ, как инстанс класса или
  // DOM-узел (`HANDLE_PROTO` в `managersProxy.ts`). Тогда стор вообще не лезет
  // внутрь прокси — ни `$RAW`, ни `defineProperty`, — и весь класс проблемы
  // закрыт, а не один символ.
  //
  // Проверяем НАСТОЯЩИМ `createStore`, а не своим пониманием его эвристики:
  // так пин ловит и смену правил в новой версии Solid. Обычный объект рядом —
  // контроль: он-то заворачивается, значит проверка не выродилась.
  it('не выглядит plain-объектом: createStore отдаёт хендл по ссылке', () => {
    const ch = new MessageChannel()
    const ui = new SuperMessagePort(ch.port1)
    const managers = createManagers<Record<string, unknown>>(ui)
    const plain = { a: 1 }

    expect(Object.getPrototypeOf(managers)).not.toBe(Object.prototype)

    const [store] = createStore<{ handle: object; plain: object }>({ handle: managers, plain })
    expect(store.handle).toBe(managers)
    expect(store.plain).not.toBe(plain) // контроль: plain-объект стор заворачивает
  })
})
