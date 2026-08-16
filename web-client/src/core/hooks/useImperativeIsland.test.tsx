// Пины на границу владения React → vanilla. Каждый случай здесь — то, что до
// хука писалось руками в каждом мосте и разъезжалось: уборка досыпанных узлов,
// StrictMode-удвоение, момент запуска относительно пейнта, протухание middleware.
import { StrictMode, useEffect, useRef, useState, type ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import type { Middleware } from '@helpers/middleware'
import { useImperativeIsland, type ImperativeIslandOptions } from './useImperativeIsland'

function Host({
  setup,
  deps = [],
  options,
  onEffect,
}: {
  setup: (container: HTMLElement, ctx: { middleware: Middleware; host: HTMLElement }) => void | VoidFunction
  deps?: unknown[]
  options?: ImperativeIslandOptions
  onEffect?: () => void
}) {
  const ref = useImperativeIsland(setup, deps, options)
  useEffect(() => { onEffect?.() })
  return <div data-testid="host" ref={ref} />
}

const host = (c: HTMLElement) => c.querySelector('[data-testid="host"]') as HTMLElement

describe('useImperativeIsland', () => {
  it('mode:"host" отдаёт сам React-узел', () => {
    const setup = vi.fn()
    const { container } = render(<Host setup={setup} />)
    expect(setup).toHaveBeenCalledTimes(1)
    expect(setup.mock.calls[0][0]).toBe(host(container))
  })

  it('mode:"own" отдаёт одноразовый контейнер внутри узла', () => {
    const setup = vi.fn((c: HTMLElement) => { c.appendChild(document.createElement('span')) })
    const { container } = render(<Host setup={setup} options={{ mode: 'own', className: 'island' }} />)

    const island = host(container).firstElementChild!
    expect(island.className).toBe('island')
    expect(setup.mock.calls[0][0]).toBe(island)
    expect(island.querySelector('span')).not.toBeNull()
  })

  it('размонтирование сносит одноразовый контейнер вместе с досыпанным', () => {
    const { container, rerender } = render(
      <Show><Host setup={(c) => { c.appendChild(document.createElement('span')) }} options={{ mode: 'own' }} /></Show>,
    )
    expect(container.querySelectorAll('span')).toHaveLength(1)

    rerender(<Show visible={false}><Host setup={() => {}} options={{ mode: 'own' }} /></Show>)
    expect(container.querySelectorAll('span')).toHaveLength(0)
  })

  it('strays убирает узлы, досыпанные в host (случай .sticky_sentinel)', () => {
    const setup = (c: HTMLElement) => {
      const section = document.createElement('div')
      section.appendChild(Object.assign(document.createElement('div'), { className: 'sticky_sentinel' }))
      c.appendChild(section)
    }
    const { container, rerender } = render(
      <Show><Host setup={setup} options={{ strays: '.sticky_sentinel' }} /></Show>,
    )
    expect(container.querySelectorAll('.sticky_sentinel')).toHaveLength(1)

    rerender(<Show visible={false}><Host setup={setup} options={{ strays: '.sticky_sentinel' }} /></Show>)
    expect(container.querySelectorAll('.sticky_sentinel')).toHaveLength(0)
  })

  it('ререндер родителя не трогает то, что положил остров', () => {
    const setup = vi.fn((c: HTMLElement) => { c.appendChild(document.createElement('span')) })
    const { container, rerender } = render(<Host setup={setup} />)

    rerender(<Host setup={setup} />)
    rerender(<Host setup={setup} />)

    expect(setup).toHaveBeenCalledTimes(1)
    expect(host(container).querySelectorAll('span')).toHaveLength(1)
  })

  it('смена deps пересоздаёт остров, смена самой функции — нет', () => {
    const dispose = vi.fn()
    const setup = vi.fn(() => dispose)
    const { rerender } = render(<Host setup={setup} deps={[1]} />)

    // новая инлайновая стрелка при тех же deps
    rerender(<Host setup={vi.fn(() => dispose)} deps={[1]} />)
    expect(setup).toHaveBeenCalledTimes(1)
    expect(dispose).not.toHaveBeenCalled()

    rerender(<Host setup={setup} deps={[2]} />)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(setup).toHaveBeenCalledTimes(2)
  })

  it('запускается до пейнта — раньше useEffect того же компонента', () => {
    const order: string[] = []
    render(<Host setup={() => { order.push('island') }} onEffect={() => order.push('effect')} />)
    expect(order).toEqual(['island', 'effect'])
  })

  it('middleware протухает на teardown', () => {
    let middleware: Middleware | null = null
    const { rerender } = render(
      <Show><Host setup={(_c, ctx) => { middleware = ctx.middleware }} /></Show>,
    )
    expect(middleware!()).toBe(true)

    rerender(<Show visible={false}><Host setup={() => {}} /></Show>)
    expect(middleware!()).toBe(false)
  })

  it('StrictMode не оставляет второй контейнер', () => {
    const { container } = render(
      <StrictMode><Host setup={(c) => { c.appendChild(document.createElement('span')) }} options={{ mode: 'own' }} /></StrictMode>,
    )
    expect(host(container).children).toHaveLength(1)
    expect(host(container).querySelectorAll('span')).toHaveLength(1)
  })

  it('упавший setup не оставляет пустой контейнер', () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const boom = () => { throw new Error('boom') }

    expect(() => render(<Host setup={boom} options={{ mode: 'own' }} />, { container: mount }))
      .toThrow('boom')
    expect(mount.querySelectorAll('div > div')).toHaveLength(0)

    mount.remove()
  })

  it('поднимается на чужом ref и гаснет на размонтировании', () => {
    const dispose = vi.fn()
    const setup = vi.fn((_c: HTMLElement) => dispose)
    function External({ step }: { step: number }) {
      const boxRef = useRef<HTMLDivElement>(null)
      useImperativeIsland(setup, [step], { host: boxRef, strays: '.stray' })
      return <div data-testid="host" ref={boxRef} />
    }
    const { container, rerender } = render(<Show><External step={1} /></Show>)
    expect(setup).toHaveBeenCalledTimes(1)
    expect(setup.mock.calls[0][0]).toBe(host(container))

    rerender(<Show><External step={2} /></Show>)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(setup).toHaveBeenCalledTimes(2)

    rerender(<Show visible={false}><External step={2} /></Show>)
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it('смена узла переносит остров на новый', async () => {
    const dispose = vi.fn()
    const setup = vi.fn((_c: HTMLElement) => dispose)
    function Swapper() {
      const [second, setSecond] = useState(false)
      const ref = useImperativeIsland(setup, [])
      return second
        ? <section data-testid="host" ref={ref} onClick={() => setSecond(false)} />
        : <div data-testid="host" ref={ref} onClick={() => setSecond(true)} />
    }
    const { container } = render(<Swapper />)
    expect(setup).toHaveBeenCalledTimes(1)

    await act(async () => { host(container).click() })
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(setup).toHaveBeenCalledTimes(2)
    expect(setup.mock.calls[1][0]).toBe(host(container))
  })
})

function Show({ visible = true, children }: { visible?: boolean; children: ReactNode }) {
  return <>{visible ? children : null}</>
}
