/** @jsxImportSource solid-js */
import { describe, expect, it, vi } from 'vitest'
import { mountSolid } from './mountSolid.solid'

describe('mountSolid', () => {
  it('монтирует компонент в переданный узел и отдаёт ему пропы', () => {
    const host = document.createElement('div')
    const dispose = mountSolid(host, (p: { name: string }) => <i>{p.name}</i>, { name: 'Дн' })

    expect(host.querySelector('i')?.textContent).toBe('Дн')
    dispose()
  })

  it('dispose очищает хост: владелец снимает то, что создал', () => {
    const host = document.createElement('div')
    const dispose = mountSolid(host, () => <i>x</i>, {})
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
})
