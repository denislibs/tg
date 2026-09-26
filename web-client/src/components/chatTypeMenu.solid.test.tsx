/** @jsxImportSource solid-js */
// Тесты порта tweb `components/chatTypeMenu/index.tsx` (см. шапку файла рядом).
//
// Пины — на DOM, как его снял живой Telegram (дамп
// `docs/tweb/dom/dumps/14-left-03-search-chats.json`, заголовок группы «Messages»):
// `chat-type-menu > span.primary.checkable-button-menu.btn-menu-toggle > span.i18n`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import contextMenuController from '@helpers/contextMenuController'
import { getIconContent } from '@components/icon'
import ChatTypeMenu from './chatTypeMenu.solid'
import styles from './chatTypeMenu.module.scss'

afterEach(() => {
  contextMenuController.close()
  vi.useRealTimers()
  document.body.replaceChildren()
})

function mount(props: Parameters<InstanceType<typeof ChatTypeMenu>['feedProps']>[0]) {
  const el = new ChatTypeMenu()
  el.feedProps(props)
  document.body.append(el)
  return el
}

const trigger = (el: HTMLElement) => el.querySelector<HTMLElement>(':scope > span.checkable-button-menu')!
const openedMenu = () => document.body.querySelector<HTMLElement>(':scope > .btn-menu')

async function open(el: HTMLElement) {
  trigger(el).click()
  await vi.waitFor(() => expect(openedMenu()?.classList.contains('active')).toBe(true))
  return openedMenu()!
}

const items = (menu: HTMLElement) => Array.from(menu.querySelectorAll<HTMLElement>('.btn-menu-item'))
const checked = (menu: HTMLElement) => items(menu)
  .filter((item) => item.querySelector('.btn-menu-item-icon')?.textContent === getIconContent('check'))
  .map((item) => item.textContent?.replace(getIconContent('check'), ''))

describe('ChatTypeMenu: разметка', () => {
  it('триггер — span.primary.checkable-button-menu.btn-menu-toggle с подписью выбранного, как в дампе', () => {
    const el = mount({ selected: 'all' })

    expect(el.tagName).toBe('CHAT-TYPE-MENU')
    const span = trigger(el)
    expect(span).not.toBeNull()
    expect(span.classList.contains('primary')).toBe(true)
    expect(span.classList.contains('btn-menu-toggle')).toBe(true)
    expect(span.classList.contains(styles.ButtonMenu)).toBe(true)
    expect(span.querySelector(':scope > span.i18n')?.textContent).toBe('All Chats')
  })

  it('без selected — «All Chats» (tweb :34)', () => {
    const el = mount({})
    expect(trigger(el).textContent).toBe('All Chats')
  })

  it('hidden ставит класс модуля и снимает его обратно (tweb :56-58)', () => {
    const el = mount({ selected: 'all', hidden: true })
    expect(trigger(el).classList.contains(styles.hidden)).toBe(true)

    el.props.hidden = false
    expect(trigger(el).classList.contains(styles.hidden)).toBe(false)
  })
})

describe('ChatTypeMenu: меню', () => {
  it('клик открывает меню из четырёх пунктов с галочкой у выбранного', async() => {
    const el = mount({ selected: 'users' })
    const menu = await open(el)

    expect(menu.classList.contains('bottom-left')).toBe(true)
    // tweb :64-66 — onOpen снимает bottom
    expect(menu.style.bottom).toBe('unset')
    expect(items(menu).map((item) => item.querySelector('.btn-menu-item-text')?.textContent))
      .toEqual(['All Chats', 'Private Chats', 'Group Chats', 'Channels'])
    expect(checked(menu)).toEqual(['Private Chats'])
    // у остальных — пустой слот иконки (emptyIcon, tweb :37), чтобы подписи стояли в колонку
    const rest = items(menu).filter((item) => !item.textContent?.includes('Private'))
    rest.forEach((item) => {
      const icon = item.querySelector('.btn-menu-item-icon')!
      expect(icon).not.toBeNull()
      expect(icon.textContent).toBe('')
    })
  })

  it('выбор зовёт onChange(type), меняет подпись триггера и props.selected; при следующем открытии галочка переезжает', async() => {
    const onChange = vi.fn()
    const el = mount({ selected: 'all', onChange })

    const menu = await open(el)
    // пункт закрывает меню сам; узел уходит из DOM через 300 мс — их и прокручиваем
    vi.useFakeTimers()
    items(menu)[2].click()

    expect(onChange).toHaveBeenCalledWith('groups')
    expect(el.props.selected).toBe('groups')
    expect(trigger(el).textContent).toBe('Group Chats')
    expect(trigger(el).classList.contains('menu-open')).toBe(false)

    vi.advanceTimersByTime(300)
    vi.useRealTimers()
    expect(menu.isConnected).toBe(false)
    const again = await open(el)
    expect(checked(again)).toEqual(['Group Chats'])
  })

  it('selected, выставленный снаружи (сброс владельцем в all), меняет подпись и галочку', async() => {
    const el = mount({ selected: 'channels' })
    expect(trigger(el).textContent).toBe('Channels')

    el.props.selected = 'all'
    expect(trigger(el).textContent).toBe('All Chats')

    const menu = await open(el)
    expect(checked(menu)).toEqual(['All Chats'])
  })

  it('снятие из документа гасит компонент: узел пуст', () => {
    const el = mount({ selected: 'all' })
    el.remove()
    expect(el.childElementCount).toBe(0)
  })
})
