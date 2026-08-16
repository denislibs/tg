// Контекстное меню сообщения обязано рождать ровно то дерево, что и tweb
// (живой дамп — `docs/tweb/dom/dumps/05-context-menu.json`, строят
// `chat/contextMenu.ts::appendReactionsMenu` + `chat/reactionsMenu.ts`):
//
//   div.btn-menu.contextmenu.has-items-wrapper
//     div.btn-menu-reactions-container.btn-menu-reactions-container-horizontal
//        .btn-menu-transition.is-visible
//       div.btn-menu-reactions-bubble.btn-menu-reactions-bubble-big
//       div.btn-menu-reactions
//         div.btn-menu-reactions-reaction > div.btn-menu-reactions-reaction-scale
//         button.btn-icon.btn-menu-reactions-more
//     div.btn-menu-items.btn-menu-transition
//       div.btn-menu-item …
//       hr
//
// Иначе портированный `styles/tweb/_button.scss` промахивается мимо разметки и
// правила молча не применяются: без `has-items-wrapper` фон/тень остаются на
// самой панели и дублируются с `.btn-menu-items`, без `is-visible` партиал
// держит полоску в `opacity: 0 !important`, а без `.btn-menu-items` пункты
// теряют обёртку, на которой висит `pointer-events` (_button.scss:572-579).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import MessageContextMenu, { type MsgMenuItem } from './MessageContextMenu'
import { REACTIONS } from '../../core/reactions'

afterEach(cleanup)

const menu = { x: 100, y: 300, originX: 'left' as const, originY: 'top' as const }

const items: MsgMenuItem[] = [
  { icon: <span />, label: 'Ответить' },
  { icon: <span />, label: 'Удалить', danger: true, separatorDown: true },
]

function open(over: Partial<React.ComponentProps<typeof MessageContextMenu>> = {}) {
  render(
    <MessageContextMenu
      menu={menu}
      items={items}
      onClose={() => {}}
      onExited={() => {}}
      onReaction={() => {}}
      {...over}
    />,
  )
  return document.querySelector<HTMLElement>('.btn-menu')!
}

describe('MessageContextMenu — DOM 1:1 с tweb', () => {
  it('панель несёт contextmenu + has-items-wrapper', () => {
    const panel = open()
    expect(panel).not.toBeNull()
    expect(panel.classList.contains('contextmenu')).toBe(true)
    expect(panel.classList.contains('has-items-wrapper')).toBe(true)
  })

  it('пункты и hr лежат внутри .btn-menu-items.btn-menu-transition', () => {
    const panel = open()
    const wrapper = panel.querySelector<HTMLElement>('.btn-menu-items')!
    expect(wrapper).not.toBeNull()
    expect(wrapper.classList.contains('btn-menu-transition')).toBe(true)
    // пункт — ПРЯМОЙ ребёнок обёртки (своей обёртки у пункта в tweb нет)
    expect(wrapper.querySelectorAll(':scope > .btn-menu-item')).toHaveLength(items.length)
    expect(panel.querySelectorAll('.btn-menu-item')).toHaveLength(items.length)
    expect(wrapper.querySelector(':scope > hr')).not.toBeNull()
  })

  it('полоска реакций — btn-menu-reactions-container с пузырём и ячейками', () => {
    const panel = open()
    const container = panel.querySelector<HTMLElement>('.btn-menu-reactions-container')!
    expect(container).not.toBeNull()
    for (const cls of ['btn-menu-reactions-container-horizontal', 'btn-menu-transition', 'is-visible']) {
      expect(container.classList.contains(cls)).toBe(true)
    }
    // полоска — ПЕРВЫЙ ребёнок панели, обёртка пунктов — второй (порядок tweb:
    // `element.append(container, i)`), от него зависит статическая позиция
    // абсолюта и подъём `margin-top: var(--menu-offset)`
    expect(panel.children[0]).toBe(container)
    expect(panel.children[1]).toBe(panel.querySelector('.btn-menu-items'))

    expect(container.querySelector(':scope > .btn-menu-reactions-bubble.btn-menu-reactions-bubble-big')).not.toBeNull()
    const reactions = container.querySelector<HTMLElement>(':scope > .btn-menu-reactions')!
    expect(reactions).not.toBeNull()

    const cells = reactions.querySelectorAll(':scope > .btn-menu-reactions-reaction')
    expect(cells).toHaveLength(REACTIONS.length)
    // внутри ячейки — обёртка -scale (у tweb в ней два canvas.lottie, у нас <Emoji>)
    for (const cell of cells) {
      expect(cell.querySelector(':scope > .btn-menu-reactions-reaction-scale')).not.toBeNull()
    }
    expect(reactions.querySelector(':scope > button.btn-icon.btn-menu-reactions-more')).not.toBeNull()
  })

  it('клик по ячейке реакции зовёт onReaction с её эмодзи', () => {
    const onReaction = vi.fn()
    const panel = open({ onReaction })
    fireEvent.click(panel.querySelectorAll('.btn-menu-reactions-reaction')[1])
    expect(onReaction).toHaveBeenCalledWith(REACTIONS[1])
  })

  it('без onReaction (мок-чат) полоски нет, обёртка пунктов остаётся', () => {
    const panel = open({ onReaction: undefined })
    expect(panel.querySelector('.btn-menu-reactions-container')).toBeNull()
    expect(panel.querySelector('.btn-menu-items')).not.toBeNull()
  })

  it('клик по пункту доносит до onClick координаты события (перехват на .btn-menu-items)', () => {
    const onClick = vi.fn()
    const panel = open({ items: [{ icon: <span />, label: 'Просмотры', onClick }] })
    fireEvent.click(panel.querySelector('.btn-menu-item')!, { clientX: 42, clientY: 24 })
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick.mock.calls[0][0]).toMatchObject({ clientX: 42, clientY: 24 })
  })
})
