// Кнопка эмодзи-статуса в шапке колонки — порт tweb `sidebarLeft/index.ts`
// (`statusBtnIcon`, `wrapStatus`, `toggleRightButtons`; 812502980):
// `button.btn-icon.sidebar-emoji-status` без ripple справа от поля поиска, только
// у подписчика Premium. Нет статуса — глиф `star`, есть — сам статус в
// `.sidebar-emoji-status-emoji`. Клик открывает выбор статуса.
//
// Это ЕДИНСТВЕННАЯ точка входа в выбор своего статуса в колонке у оригинала:
// строки «Установить эмодзи-статус» в корне настроек у tweb нет, и, снимая её
// оттуда, мы обязаны держать этот вход — иначе функция стала бы недостижимой.
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import Sidebar from './Sidebar'
import { ManagersProvider } from '../core/hooks/useManagers'
import { useChatsStore } from '../stores/chatsStore'
import { applyLang } from '@/test/lang'
import type { Managers } from '../client/bootstrap'
import Icons from '@core/tgico-icons'

const STAR = String.fromCharCode(parseInt(Icons.star, 16))

// Слой менеджеров — рекурсивный Proxy: любой вызов отдаёт промис (шов с воркером).
const managers = new Proxy({}, {
  get: () => new Proxy({}, { get: () => async () => undefined }),
}) as unknown as Managers

const setMe = (pFlags: { premium?: true }, emoji?: string) => useChatsStore.setState({
  me: { user: { _: 'user', id: 1, first_name: 'Me', pFlags, emoji_status_emoticon: emoji } } as never,
})

const header = () => document.querySelector('.main-search-sidebar-header')!
const statusBtn = () => header().querySelector<HTMLButtonElement>(':scope > .sidebar-emoji-status')

const renderSidebar = async () => {
  await applyLang('en')
  render(
    <ManagersProvider managers={managers}>
      <Sidebar onToggleMode={() => {}} />
    </ManagersProvider>,
  )
  await act(async () => {})
}

afterEach(() => {
  cleanup()
  useChatsStore.setState({ me: null })
})

describe('Sidebar — кнопка эмодзи-статуса в шапке (tweb statusBtnIcon)', () => {
  it('без Premium кнопки нет, поле поиска — последний ребёнок шапки', async () => {
    setMe({})
    await renderSidebar()
    expect(statusBtn()).toBeNull()
    expect(header().classList.contains('is-input-the-last-child')).toBe(true)
  })

  it('у подписчика без статуса — btn-icon без ripple с глифом star, справа от поиска', async () => {
    setMe({ premium: true })
    await renderSidebar()
    const btn = statusBtn()!
    expect(btn).not.toBeNull()
    expect(btn.classList.contains('btn-icon')).toBe(true)
    expect(btn.classList.contains('rp')).toBe(false)
    expect(btn.getAttribute('aria-label')).toBe('Set as Status')
    expect(btn.querySelector('.tgico.button-icon')!.textContent).toBe(STAR)
    expect(btn.previousElementSibling?.classList.contains('input-search')).toBe(true)
    expect(header().classList.contains('is-input-the-last-child')).toBe(false)
  })

  it('есть статус — в кнопке он сам (.sidebar-emoji-status-emoji), а не звезда', async () => {
    setMe({ premium: true }, '🔥')
    await renderSidebar()
    const btn = statusBtn()!
    expect(btn.querySelector('.button-icon')).toBeNull()
    expect(btn.querySelector('.sidebar-emoji-status-emoji')!.textContent).toBe('🔥')
  })

  it('клик открывает выбор статуса', async () => {
    setMe({ premium: true })
    await renderSidebar()
    expect(document.body.textContent).not.toContain('Set Emoji Status')
    fireEvent.click(statusBtn()!)
    await act(async () => {})
    expect(document.body.textContent).toContain('Set Emoji Status')
  })
})
