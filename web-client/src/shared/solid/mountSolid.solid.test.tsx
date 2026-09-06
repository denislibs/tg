/** @jsxImportSource solid-js */
import { describe, expect, it, vi } from 'vitest'
import { onMount } from 'solid-js'
import { createManagers, registerManagers } from '@rpc/managersProxy'
import { SuperMessagePort } from '@rpc/superMessagePort'
import { createStore, unwrap } from 'solid-js/store'
import { mountSolid } from './mountSolid.solid'

describe('mountSolid', () => {
  it('монтирует компонент в переданный узел и отдаёт ему пропы', () => {
    const host = document.createElement('div')
    const { dispose } = mountSolid(host, (p: { name: string }) => <i>{p.name}</i>, { name: 'Дн' })

    expect(host.querySelector('i')?.textContent).toBe('Дн')
    dispose()
  })

  it('dispose очищает хост: владелец снимает то, что создал', () => {
    const host = document.createElement('div')
    const { dispose } = mountSolid(host, () => <i>x</i>, {})
    expect(host.childNodes.length).toBeGreaterThan(0)

    dispose()

    expect(host.innerHTML).toBe('')
  })

  it('падение компонента не выходит наружу — его держит ErrorBoundary', () => {
    const host = document.createElement('div')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Boom = () => {
      throw new Error('бабах')
    }

    // Без обёртки в ErrorBoundary стоковый Solid бросает наружу
    // (dist/solid.js:1005 — `if (!fns) throw error;`), и это утверждение краснеет.
    expect(() => mountSolid(host, Boom, {})).not.toThrow()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  // ── Задача 5.5 (план «карточка профиля на Solid»): живые пропы ────────────
  // Пин на САМУ находку ревью — «единственный способ доставить новое значение
  // уже смонтированному дереву — пересоздать корень» — обязан был перестать
  // быть правдой. Ниже — факт, не гипотеза: `update` меняет то, что видит
  // УЖЕ смонтированный DOM, без второго вызова `mountSolid`.
  it('update(patch) доезжает до уже смонтированного дерева без пересоздания корня', () => {
    const host = document.createElement('div')
    let mounts = 0
    const Probe = (p: { name: string }) => {
      mounts++ // считаем ФАКТИЧЕСКИЕ монтирования компонента, не вызовы mountSolid
      return <i>{p.name}</i>
    }
    const { dispose, update } = mountSolid(host, Probe, { name: 'Дн' })
    expect(mounts).toBe(1)
    expect(host.querySelector('i')?.textContent).toBe('Дн')

    update({ name: 'Ден' })

    expect(host.querySelector('i')?.textContent).toBe('Ден') // значение доехало
    expect(mounts).toBe(1) // корень НЕ пересоздан — компонент не позвался повторно

    dispose()
  })

  // Мутация «в update передали не то поле» обязана краснить здесь же:
  // проверяем, что НЕтронутые поля патча остаются прежними (мелкий мёрж, не
  // замена всего объекта пропов).
  it('update(patch) мёржит только переданные поля, остальные не трогает', () => {
    const host = document.createElement('div')
    const Probe = (p: { name: string; count: number }) => <i>{p.name}:{p.count}</i>
    const { dispose, update } = mountSolid(host, Probe, { name: 'Дн', count: 1 })

    update({ count: 2 })

    expect(host.querySelector('i')?.textContent).toBe('Дн:2')
    dispose()
  })

  // ── Среда пина: та же сборка `solid-js/store`, что и в прод-бандле ────────
  // У пакета три сборки: проксирующие `store.js` (prod) и `dev.js`, и SSR-заглушка
  // `server.js` (условие экспорта `node`), где `createStore` возвращает СЫРОЙ
  // объект без единого прокси. Под заглушкой пин ниже не проверяет ничего —
  // он был бы зелёным на любом коде. Проверяем поведением, а не именем файла.
  it('среда даёт проксирующую сборку solid-js/store, а не SSR-заглушку', () => {
    const [store] = createStore<{ nested: object }>({ nested: {} })
    expect(unwrap(store)).not.toBe(store)
  })

  // ── Пин на регресс «экран входа пуст» (mountSolid + прокси менеджеров) ─────
  // Через мост ездят НЕ только plain-данные: `mountAuthFlow` кладёт в пропы
  // прокси из `createManagers`. Экран входа гас дважды, двумя разными способами,
  // и оба живут ровно в этом шве:
  //
  //  1) Прокси отвечал «менеджером» на ЛЮБОЙ ключ, включая символы. `unwrap`
  //     Solid-стора спрашивает `value[$RAW]`, получал объект и подменял им сам
  //     объект менеджеров: `managers.auth` в карточке становился `undefined`.
  //  2) Прокси отвечал `undefined` на ЛЮБОЙ символ. Тогда `wrap`/`getNodes`
  //     стора кладут на нашу цель `Object.defineProperty(handle, $PROXY|$NODE,
  //     {value})` — non-writable + non-configurable, — и следующее чтение того
  //     же символа падает: «TypeError: 'get' on proxy: property 'Symbol(store-
  //     node)' is a read-only and non-configurable data property…».
  //
  // Отсюда форма пина. НАСТОЯЩИЙ `createManagers` поверх настоящего транспорта,
  // а не литерал-заглушка: заглушка обходит ровно те места, где ломается.
  // И читаем хендл ПОВТОРНО — прежний пин был зелёным на поломке (2) именно
  // потому, что читал один раз: первое чтение символ ОПРЕДЕЛЯЕТ, падает второе.
  //
  // `expect(seen).toBe(managers)` — пин на второй эшелон: хендл не выглядит
  // plain-объектом (`managersProxy.ts`, `HANDLE_PROTO`), поэтому стор отдаёт
  // компоненту РОВНО переданный объект, а не свою обёртку над ним.
  it('прокси менеджеров переживает мост: тот же объект, повторные вызовы доезжают до транспорта', async () => {
    const ch = new MessageChannel()
    const ui = new SuperMessagePort(ch.port1)
    const worker = new SuperMessagePort(ch.port2)
    registerManagers(worker, { auth: { async nearestCountry() { return 'RU' } } })
    type M = { auth: { nearestCountry(): Promise<string> } }
    const managers = createManagers<M>(ui)

    const host = document.createElement('div')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let seen: M | undefined
    const calls: Promise<string>[] = []
    const Probe = (p: { managers: M }) => {
      onMount(() => {
        // Сначала — как `AuthCardsHost`: один раз взять `props.managers` в
        // контекст и дёргать его много раз. Повтор ломается на `Symbol(store-
        // node)` — ровно та ошибка, что пришла с прод-сборки index-xXn1WifZ.js.
        const held = (seen = p.managers)
        calls.push(held.auth.nearestCountry(), held.auth.nearestCountry())
        // Потом — повторное чтение самого пропа: этот путь ломается на
        // `Symbol(solid-proxy)`. Обе ветки инварианта в одном пине.
        calls.push(p.managers.auth.nearestCountry(), p.managers.auth.nearestCountry())
      })
      return <i />
    }
    const { dispose } = mountSolid(host, Probe, { managers })

    // Остров не упал на границе: ни TypeError про символ, ни обращение к
    // `undefined.nearestCountry` после подмены объекта менеджеров.
    expect(spy).not.toHaveBeenCalled()
    expect(seen).toBe(managers)
    await expect(Promise.all(calls)).resolves.toEqual(['RU', 'RU', 'RU', 'RU'])

    spy.mockRestore()
    dispose()
    ui.dispose()
    worker.dispose()
  })
})
