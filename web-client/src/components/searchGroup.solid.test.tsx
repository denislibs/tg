/** @jsxImportSource solid-js */
/**
 * Пины `createSearchGroup` — порт tweb `src/components/searchGroup.tsx`.
 *
 * Эталон разметки — живой дамп `docs/tweb/dom/dumps/14-left-03b-search-chats-query.json`:
 *   div.sidebar-left-section-container.search-group.search-group-contacts
 *     div.sidebar-left-section.search-group-inner
 *       div.sidebar-left-section-content.search-group-content
 *         div.sidebar-left-h2.sidebar-left-section-name > span.i18n "Chats"
 *         ul.chatlist
 * и там же группа «people» (`.search-group-with-scroll`, без заголовка,
 * `div.scrollable.scrollable-x.search-group-scrollable-x > ul.chatlist`).
 *
 * Предмет — видимость: группа рождается скрытой (`hide`) и показывается,
 * только когда в ней есть строки; пустая при `toggle()` ЧИСТИТСЯ (снимает
 * заглушку и строки через `dialogElement.remove()`, гася их middleware).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMiddleware } from '@helpers/middleware'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { useNavigationStore } from '@stores/navigationStore'
import { addDialogNew } from '@lib/appDialogsManager'
import { createSearchGroup } from './searchGroup.solid'

const GROUP: PeerId = -100
const managers = { peers: { fillMirror: async () => {} }, presence: { get: async () => [] } }

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'channel', id: 100, title: 'Группа', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true } },
  ] }])
  useNavigationStore.setState({ selectedId: null, draftPeer: null })
})
afterEach(() => document.body.replaceChildren())

const addRow = (list: HTMLElement) => addDialogNew({
  peerId: GROUP,
  container: list,
  avatarSize: 'abitbigger',
  wrapOptions: { middleware: getMiddleware().get() },
  managers,
})

describe('createSearchGroup: разметка (дамп 14-left-03b)', () => {
  it('секция search-group-<type> > search-group-inner > search-group-content > [заголовок, ul.chatlist]', () => {
    const group = createSearchGroup({ name: 'Recent', type: 'contacts', className: 'search-group-recent', managers })
    const { container } = group
    document.body.append(container)

    for(const cls of ['sidebar-left-section-container', 'search-group', 'search-group-contacts', 'search-group-recent']) {
      expect(container.classList.contains(cls), cls).toBe(true)
    }
    const inner = container.firstElementChild as HTMLElement
    expect(inner.className).toBe('sidebar-left-section search-group-inner')
    const content = inner.firstElementChild as HTMLElement
    expect(content.className).toBe('sidebar-left-section-content search-group-content')

    const [name, list] = Array.from(content.children) as HTMLElement[]
    expect(name.className).toBe('sidebar-left-h2 sidebar-left-section-name')
    expect(name.querySelector('span.i18n')?.textContent).toBe('Recent')
    expect(group.nameEl).toBe(name)
    expect(list).toBe(group.list)
    expect(list.tagName).toBe('UL')
    expect(list.className).toBe('chatlist')
  })

  it('scrollableX: без заголовка, `search-group-with-scroll` и горизонтальный скроллер вокруг списка', () => {
    const group = createSearchGroup({ name: false, type: 'contacts', className: 'search-group-people', scrollableX: true, autonomous: false, managers })
    const { container } = group
    expect(container.classList.contains('search-group-with-scroll')).toBe(true)
    expect(container.querySelector('.sidebar-left-section-name')).toBeNull()

    const content = container.querySelector('.search-group-content')!
    const scroller = content.firstElementChild as HTMLElement
    for(const cls of ['scrollable', 'scrollable-x', 'search-group-scrollable-x']) {
      expect(scroller.classList.contains(cls), cls).toBe(true)
    }
    expect(scroller.lastElementChild).toBe(group.list)
  })
})

describe('createSearchGroup: видимость', () => {
  it('создаётся скрытой; setActive() показывает', () => {
    const group = createSearchGroup({ name: 'Recent', type: 'contacts', managers })
    expect(group.container.classList.contains('hide')).toBe(true)
    group.setActive()
    expect(group.container.classList.contains('hide')).toBe(false)
  })

  it('toggle() показывает группу со строками, а пустую прячет и ЧИСТИТ', () => {
    const group = createSearchGroup({ name: 'Recent', type: 'contacts', managers })
    const row = addRow(group.list)
    group.toggle()
    expect(group.container.classList.contains('hide')).toBe(false)

    const placeholder = document.createElement('div')
    group.addPlaceholder(placeholder)
    expect(placeholder.parentElement).toBe(group.container)
    expect(group.placeholder).toBe(placeholder)

    row.container.remove()
    group.toggle()
    expect(group.container.classList.contains('hide')).toBe(true)
    // clear() снимает заглушку
    expect(placeholder.isConnected || placeholder.parentElement).toBeFalsy()
    expect(group.placeholder).toBeUndefined()
  })

  it('clear() сносит строки через dialogElement.remove() — их middleware гаснет; чужие узлы просто удаляются', () => {
    const group = createSearchGroup({ name: 'Recent', type: 'contacts', managers })
    const row = addRow(group.list)
    const onClean = vi.fn()
    row.middlewareHelper!.get().onClean(onClean)
    const stray = document.createElement('li')
    group.list.append(stray)
    group.setActive()

    group.clear()

    expect(group.list.childElementCount).toBe(0)
    expect(onClean).toHaveBeenCalledTimes(1)
    expect(group.container.classList.contains('hide')).toBe(true)
  })

  it('clearable: false — строки переживают clear(), прячется только группа', () => {
    const group = createSearchGroup({ name: 'Recent', type: 'contacts', clearable: false, managers })
    addRow(group.list)
    group.setActive()
    group.clear()
    expect(group.list.childElementCount).toBe(1)
    expect(group.container.classList.contains('hide')).toBe(true)
  })

  it('после middleware.onClean корень Solid снят — сигналы больше не двигают DOM', () => {
    const helper = getMiddleware()
    const group = createSearchGroup({ name: 'Recent', type: 'contacts', middleware: helper.get(), managers })
    helper.destroy()
    group.setActive()
    expect(group.container.classList.contains('hide')).toBe(true)
  })
})

describe('createSearchGroup: правый слот заголовка', () => {
  it('needShowMoreButton ставит класс-обрезку и «show more»; клик снимает класс и пишет «show less»', () => {
    const group = createSearchGroup({ name: 'Recent', type: 'contacts', managers })
    group.needShowMoreButton('is-short')
    const { container } = group
    // клик Solid делегирован на document — группа должна быть в документе
    document.body.append(container)
    expect(container.classList.contains('is-short')).toBe(true)

    // дамп 14-left-03b: `div.sidebar-left-section-name-right > span.cursor-pointer.hover-underline > span.i18n "show more"`
    const button = container.querySelector<HTMLElement>('.sidebar-left-section-name-right > span.cursor-pointer.hover-underline')!
    expect(button.textContent).toBe('show more')

    button.click()
    expect(container.classList.contains('is-short')).toBe(false)
    expect(container.querySelector('.sidebar-left-section-name-right')!.textContent).toBe('show less')

    container.querySelector<HTMLElement>('.sidebar-left-section-name-right > span')!.click()
    expect(container.classList.contains('is-short')).toBe(true)
  })

  it('по умолчанию обрезка — is-short-5 (tweb :163)', () => {
    const group = createSearchGroup({ name: 'Recent', type: 'contacts', managers })
    group.needShowMoreButton()
    expect(group.container.classList.contains('is-short-5')).toBe(true)
  })

  it('setNameRight кладёт узел в заголовок и вешает клик', () => {
    const group = createSearchGroup({ name: 'Recent', type: 'contacts', managers })
    document.body.append(group.container)
    const onClick = vi.fn()
    const children = document.createElement('b')
    group.setNameRight({ children, onClick })

    const slot = group.nameEl.querySelector('.sidebar-left-section-name-right > span.cursor-pointer.hover-underline')!
    expect(slot.firstElementChild).toBe(children)
    ;(slot as HTMLElement).click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('createSearchGroup: клик по строке', () => {
  it('clickable (по умолчанию) — строка открывает пира и зовёт onFound', () => {
    const onFound = vi.fn()
    const group = createSearchGroup({ name: 'Recent', type: 'contacts', onFound, managers })
    document.body.append(group.container)
    const row = addRow(group.list)

    row.container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))

    expect(onFound).toHaveBeenCalledWith(row.container)
    expect(useNavigationStore.getState().selectedId).toBe(String(GROUP))
    expect(group.list.dataset.autonomous).toBe('1')
  })

  it('clickable: false — список без обработчика', () => {
    const group = createSearchGroup({ name: 'Recent', type: 'contacts', clickable: false, managers })
    document.body.append(group.container)
    const row = addRow(group.list)
    row.container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    expect(useNavigationStore.getState().selectedId).toBeNull()
  })
})
