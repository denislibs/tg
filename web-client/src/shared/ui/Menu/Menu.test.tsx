// `corner` — единственный источник угла роста панели (класс tweb, `_button.scss:228-262`
// выставляет из него `--transform-origin-x/y`). Инлайновый `transform-origin` в `style` —
// отсебятина и был убран у всех вызывающих; здесь держим два инварианта, которые эту
// правку и мотивировали:
//   1. панель реально получает переданный класс-угол (а не теряет его при сборке classNames);
//   2. `cornerFrom` — хелпер для рантайм-флипа у края экрана (ChatListItem,
//      снесённое React-меню сообщения) — переводит origin в класс строго по соответствию из
//      `_button.scss:228-262` (инверсия «класс → origin»).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import Menu, { cornerFrom } from './Menu'
import { initHotkeys } from '../../../core/hotkeys'

afterEach(cleanup)

describe('cornerFrom — origin → класс-угол (инверсия _button.scss:228-262)', () => {
  it('top left → bottom-right', () => {
    expect(cornerFrom('top', 'left')).toBe('bottom-right')
  })
  it('top right → bottom-left', () => {
    expect(cornerFrom('top', 'right')).toBe('bottom-left')
  })
  it('bottom left → top-right', () => {
    expect(cornerFrom('bottom', 'left')).toBe('top-right')
  })
  it('bottom right → top-left', () => {
    expect(cornerFrom('bottom', 'right')).toBe('top-left')
  })
})

describe('Menu — проп corner', () => {
  it('вешает переданный класс-угол на панель', () => {
    render(
      <Menu open onClose={() => {}} corner="bottom-right">
        <div>item</div>
      </Menu>,
    )
    const panel = document.querySelector('.btn-menu')!
    expect(panel).not.toBeNull()
    expect(panel.classList.contains('bottom-right')).toBe(true)
  })

  it('без corner класса-угла на панели нет', () => {
    render(
      <Menu open onClose={() => {}}>
        <div>item</div>
      </Menu>,
    )
    const panel = document.querySelector('.btn-menu')!
    const cornerClasses = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center-left', 'center-right']
    for (const c of cornerClasses) expect(panel.classList.contains(c)).toBe(false)
  })
})

// Конец закрытия панель ловит по transitionend. У контекстного меню
// (`has-items-wrapper`) сама панель перехода не имеет вовсе — `_button.scss:149`
// ставит ей `transition: unset !important`, а анимируются только внутренние
// обёртки `.btn-menu-transition`. Без второй ветки такое меню размонтировалось
// не по концу анимации, а по фолбэк-таймеру 300 мс.
describe('Menu — конец закрытия', () => {
  function Host({ open, onExitComplete }: { open: boolean; onExitComplete: () => void }) {
    return (
      <Menu open={open} onClose={() => {}} onExitComplete={onExitComplete}>
        <div className="btn-menu-transition">
          <div className="btn-menu-item">x</div>
        </div>
      </Menu>
    )
  }

  it('переход анимируемого ребёнка завершает закрытие', () => {
    const done = vi.fn()
    const { rerender } = render(<Host open onExitComplete={done} />)
    rerender(<Host open={false} onExitComplete={done} />)

    const child = document.querySelector('.btn-menu-transition')!
    child.dispatchEvent(new Event('transitionend', { bubbles: true }))

    expect(done).toHaveBeenCalled()
  })

  it('переход самой панели тоже завершает закрытие', () => {
    const done = vi.fn()
    const { rerender } = render(<Host open onExitComplete={done} />)
    rerender(<Host open={false} onExitComplete={done} />)

    document.querySelector('.btn-menu')!.dispatchEvent(new Event('transitionend', { bubbles: true }))

    expect(done).toHaveBeenCalled()
  })
})

// Открытое меню — ВЕРХНИЙ слой, и Esc обязан снять именно его. У tweb это один
// навигационный элемент: `open()` кладёт его в стек
// (`overlayClickHandler.ts:74-81`), а `onKeyDown` снимает ПОСЛЕДНИЙ
// (`appNavigationController.ts:216-222`). У нас `Menu` в стеке не значился
// вовсе, поэтому Escape проваливался в `escFallback` — «закрыть открытый чат»:
// на стенде один Escape при открытом аккаунт-меню закрывал ЧАТ, а меню
// оставалось висеть вместе с бэкдропом на весь экран (z-index 2000), то есть
// приложение переставало принимать клики.
describe('Menu — закрытие по Esc (верхний слой)', () => {
  it('Escape закрывает меню и НЕ доходит до фолбэка «закрыть чат»', async () => {
    const escFallback = vi.fn()
    initHotkeys({ escFallback })
    const onClose = vi.fn()
    render(<Menu open onClose={onClose}><div>item</div></Menu>)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    // Фолбэк в `core/hotkeys` отложен на тик (уступает легаси-оверлеям со своим
    // keydown), поэтому его отсутствие проверяем после макрозадачи, а не сразу.
    await new Promise((r) => setTimeout(r, 0))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(escFallback).not.toHaveBeenCalled()
  })

  it('контроль: без открытого меню тот же Escape доходит до фолбэка', async () => {
    const escFallback = vi.fn()
    initHotkeys({ escFallback })
    const onClose = vi.fn()
    render(<Menu open={false} onClose={onClose}><div>item</div></Menu>)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))

    expect(onClose).not.toHaveBeenCalled()
    expect(escFallback).toHaveBeenCalledTimes(1)
  })
})
