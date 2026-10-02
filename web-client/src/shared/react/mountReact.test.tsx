import { describe, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { useManagers } from '@core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'
import { mountReact } from './mountReact'

const managers = { marker: 'm' } as unknown as Managers

describe('mountReact', () => {
  it('рендерит синхронно: DOM острова есть сразу после вызова', () => {
    const host = document.createElement('div')
    const island = mountReact(host, (p: { name: string }) => <i>{p.name}</i>, { name: 'Дн' }, managers)

    expect(host.querySelector('i')?.textContent).toBe('Дн')
    island.unmount()
  })

  it('отдаёт острову managers через ManagersProvider', () => {
    const host = document.createElement('div')
    const Probe = () => <i>{(useManagers() as unknown as { marker: string }).marker}</i>
    const island = mountReact(host, Probe, {}, managers)

    expect(host.querySelector('i')?.textContent).toBe('m')
    island.unmount()
  })

  it('update(patch) мёржит поля и не пересоздаёт дерево', () => {
    const host = document.createElement('div')
    let mounts = 0
    const Probe = (p: { name: string; count: number }) => {
      const [id] = useState(() => ++mounts)
      return <i>{p.name}:{p.count}:{id}</i>
    }
    const island = mountReact(host, Probe, { name: 'Дн', count: 1 }, managers)
    const first = host.querySelector('i')?.textContent

    island.update({ count: 2 })

    // StrictMode в dev зовёт инициализатор дважды — сверяем, что id не сменился
    const id = first!.split(':')[2]
    expect(host.querySelector('i')?.textContent).toBe(`Дн:2:${id}`)
    island.unmount()
  })

  it('unmount снимает узлы и эффекты; повторный unmount и update после него — пустые ходы', () => {
    const host = document.createElement('div')
    const cleanup = vi.fn()
    const Probe = () => {
      useEffect(() => cleanup, [])
      return <i>x</i>
    }
    const island = mountReact(host, Probe, {}, managers)
    const before = cleanup.mock.calls.length

    island.unmount()
    island.unmount()
    island.update({})

    expect(host.innerHTML).toBe('')
    expect(cleanup.mock.calls.length).toBe(before + 1)
  })

  it('падение острова не выходит наружу — корень гаснет', () => {
    const host = document.createElement('div')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Boom = () => {
      throw new Error('бабах')
    }

    expect(() => mountReact(host, Boom, {}, managers)).not.toThrow()
    expect(host.innerHTML).toBe('')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
