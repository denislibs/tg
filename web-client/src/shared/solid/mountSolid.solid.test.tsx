/** @jsxImportSource solid-js */
import { describe, expect, it, vi } from 'vitest'
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
})
