import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { onCleanup } from 'solid-js'
import SolidIsland from './SolidIsland'

afterEach(cleanup)

// Solid-компонент здесь написан БЕЗ JSX: компонент Solid — это обычная
// функция, возвращающая узел, а файл собирается React-рантаймом (он
// не `*.solid.tsx`), и Solid-JSX в нём не скомпилировался бы.
const Hello = (p: { name: string }) => {
  const el = document.createElement('span')
  el.className = 'hello'
  el.textContent = p.name
  return el
}

describe('SolidIsland', () => {
  it('монтирует Solid-компонент в React-дерево', () => {
    const { container } = render(<SolidIsland component={Hello} props={{ name: 'Дн' }} />)

    expect(container.querySelector('.hello')?.textContent).toBe('Дн')
  })

  it('хост объявлен display:contents — остров не ломает раскладку родителя', () => {
    const { container } = render(<SolidIsland component={Hello} props={{ name: 'x' }} />)

    const host = container.firstElementChild as HTMLElement
    expect(host.style.display).toBe('contents')
  })

  // Узлы в контейнере после unmount() пропадают в любом случае: `hostRef` —
  // обычный React-managed div, и удаление ЕГО из контейнера сносит вместе с
  // ним любых DOM-детей, включая вставленных Solid'ом напрямую, — React делает
  // это сам, независимо от того, вызван ли dispose Solid'а. Поэтому одной
  // проверки «узла `.hello` больше нет в контейнере» недостаточно, чтобы
  // поймать пропавший `return dispose`: она осталась бы зелёной и без него.
  // Ловит именно это `onCleanup` — он регистрируется на текущем владельце
  // Solid и срабатывает РОВНО тогда, когда рантайм реально гасит остров
  // (`render()` → `dispose()`), а не когда React стирает DOM снаружи.
  it('размонтирование гасит остров: узлы сняты и dispose реально вызван', () => {
    let disposed = false
    const HelloWithCleanup = (p: { name: string }) => {
      onCleanup(() => {
        disposed = true
      })
      return Hello(p)
    }

    const { container, unmount } = render(<SolidIsland component={HelloWithCleanup} props={{ name: 'x' }} />)
    expect(container.querySelector('.hello')).not.toBeNull()
    expect(disposed).toBe(false)

    unmount()

    expect(container.querySelector('.hello')).toBeNull()
    expect(disposed).toBe(true)
  })

  // ── ПИН КОНТРАКТА (задача #104, пункт 1) ───────────────────────────────────
  //
  // `component` лежит в зависимостях эффекта, поэтому новая ссылка = новый
  // остров. Инлайн-стрелка от React-родителя даёт новую ссылку на каждый
  // рендер — попап ремоунтился бы сам собой. Контракт «ссылка стабильна»
  // словами в докблоке не держится, поэтому он здесь: тот же компонент остров
  // НЕ пересоздаёт, другой — пересоздаёт.
  it('тот же component между рендерами остров НЕ пересоздаёт', () => {
    let mounts = 0
    let disposes = 0
    const Counted = (p: { name: string }) => {
      mounts++
      onCleanup(() => { disposes++ })
      return Hello(p)
    }

    const view = render(<SolidIsland component={Counted} props={{ name: 'a' }} />)
    expect(mounts).toBe(1)

    // Новый объект пропов на том же компоненте — рендер родителя, не более.
    view.rerender(<SolidIsland component={Counted} props={{ name: 'b' }} />)

    expect(mounts).toBe(1)
    expect(disposes).toBe(0)
  })

  it('другой component остров пересоздаёт — старый гасится, новый монтируется', () => {
    let disposedFirst = false
    const First = (p: { name: string }) => {
      onCleanup(() => { disposedFirst = true })
      return Hello(p)
    }
    const Second = (p: { name: string }) => {
      const el = Hello(p)
      el.className = 'second'
      return el
    }

    const view = render(<SolidIsland component={First} props={{ name: 'a' }} />)
    expect(view.container.querySelector('.hello')).not.toBeNull()

    view.rerender(<SolidIsland component={Second} props={{ name: 'a' }} />)

    expect(disposedFirst).toBe(true)
    expect(view.container.querySelector('.second')).not.toBeNull()
  })
})
