// `--stories-scrolled` — единственный канал, которым ряд историй сообщает списку
// чатов, сколько места под себя занять: `.connection-status-bottom` сдвигается
// на `92px - var(--stories-scrolled)` (_leftSidebar.scss:483-497). Развёрнутый
// ряд обязан держать 0px всё время, пока он развёрнут.
//
// Дефект, который держит этот файл: эффект-сброс на 92px («ряд исчез — верни
// список наверх») имел в deps геттер узла, а Sidebar передаёт его инлайн-
// стрелкой. Любой ре-рендер Sidebar (пришло сообщение, сменился активный чат)
// проигрывал чистку эффекта — отступ схлопывался под развёрнутым рядом, и ряд
// ложился поверх табов папок и первой строки списка.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { useState } from 'react'
import { render, cleanup, act } from '@testing-library/react'
import StoriesRow from './StoriesRow'
import { useStoriesStore } from '../stores/storiesStore'
import { useChatsStore } from '../stores/chatsStore'

/** happy-dom отдаёт нулевые прямоугольники, а без них ряд не рисует ни одного
 *  элемента (itemMovement отбрасывает всё, что «за правым краем»). */
function stubRect(el: HTMLElement, left: number, right: number) {
  el.getBoundingClientRect = () => ({ left, right, width: right - left, top: 0, bottom: 92, height: 92, x: left, y: 0, toJSON: () => ({}) })
}

/** #chatlist-container живёт ВНЕ поддерева ряда — как в Sidebar, где ряд лежит
 *  в .item-main, а переменная пишется в соседний #chatlist-container. */
let scrolledOn: HTMLElement
/** шапка с полем поиска — цель сворачивания (tweb foldInto) */
let input: HTMLElement

beforeEach(() => {
  scrolledOn = document.createElement('div')
  document.body.append(scrolledOn)

  const header = document.createElement('div')
  const inputSearch = document.createElement('div')
  input = document.createElement('input')
  inputSearch.append(input)
  header.append(inputSearch)
  document.body.append(header)
  stubRect(header, 0, 420)
  stubRect(inputSearch, 8, 412)
  stubRect(input, 8, 412)

  useChatsStore.setState({ meId: 1 })
  useStoriesStore.setState({
    groups: [{
      author: { _: 'user', id: 2, first_name: 'Алиса' },
      stories: [{ id: 10, viewed: false }] as never,
    }],
  })
})

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  useStoriesStore.setState({ groups: [] })
})

/**
 * Хост в форме Sidebar: узлы отдаются ИНЛАЙН-стрелками, идентичность которых
 * меняется на каждом рендере (Sidebar.tsx:258-262). `bump` — любой ре-рендер
 * родителя, не относящийся к ряду историй.
 */
function Host({ bumpRef }: { bumpRef: { current: () => void } }) {
  const [, setTick] = useState(0)
  bumpRef.current = () => setTick((t) => t + 1)
  return (
    <StoriesRow
      onOpen={vi.fn()}
      foldInto={() => input}
      setScrolledOn={() => scrolledOn}
      getScrollable={() => null}
      listenWheelOn={() => null}
    />
  )
}

const scrolled = () => scrolledOn.style.getPropertyValue('--stories-scrolled')

function renderRow() {
  const bumpRef = { current: () => {} }
  const r = render(<Host bumpRef={bumpRef} />)
  const unfold = () => act(() => { r.container.querySelector<HTMLElement>('[class*="item"]')!.click() })
  return { ...r, bump: () => act(() => { bumpRef.current() }), unfold }
}

describe('StoriesRow — отступ списка под рядом', () => {
  it('свёрнутый ряд места не занимает', () => {
    renderRow()

    expect(scrolled()).toBe('92px')
  })

  it('развёрнутый ряд отодвигает список на свою высоту', () => {
    const { unfold } = renderRow()

    unfold()

    expect(scrolled()).toBe('0px')
  })

  it('ре-рендер родителя отступ не схлопывает', () => {
    const { unfold, bump } = renderRow()
    unfold()
    expect(scrolled()).toBe('0px')

    bump()

    expect(scrolled()).toBe('0px')
  })

  it('ряд ушёл из дерева — список возвращается наверх', () => {
    const { unfold, unmount } = renderRow()
    unfold()
    expect(scrolled()).toBe('0px')

    unmount()

    expect(scrolled()).toBe('92px')
  })
})
