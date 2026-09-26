/**
 * Состав корня настроек — 1:1 с tweb (`sidebarLeft/tabs/settings.tsx`, JSX
 * `Settings` в конце файла, 812502980).
 *
 * У оригинала в корне ДВЕ секции строк:
 *  - основная (`div.profile-buttons`): подвкладки `subTabConfigs` (уведомления,
 *    данные, приватность, общие, папки, стикеры, динамики), затем «Устройства»,
 *    «Язык», «Горячие клавиши». Ни «Ночного режима» (он в бургере, подменю
 *    «Ещё», `sidebarLeft/index.ts` `createMoreSubmenu`), ни выбора эмодзи-статуса
 *    (кнопка `.sidebar-emoji-status` в шапке колонки) здесь нет;
 *  - Premium: «Telegram Premium» — `Row.Title` БЕЗ подзаголовка, «Мои звёзды»
 *    (только при ненулевом балансе, справа — баланс), «TON» (только если есть),
 *    «Отправить подарок».
 *
 * Пин держит именно состав и порядок: строки «Ночной режим» и «Установить
 * эмодзи-статус» стояли у нас в корне годами, а подзаголовок у Premium был нашей
 * выдумкой.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

import type { ReactNode } from 'react'

import type { Managers } from '@/client/bootstrap'
import { ManagersProvider } from '@core/hooks/useManagers'
import { applyLang } from '@/test/lang'
import { useChatsStore } from '../stores/chatsStore'
import { setAppStateSilent } from '../stores/appState'
import Icons, { type IconName } from '@core/tgico-icons'
import SettingsView from './SettingsView'

const managers = {
  peers: { fillMirror: async () => {} },
  media: { downloadMediaURL: async () => undefined },
  sessions: { list: async () => [] },
} as unknown as Managers

const wrapper = ({ children }: { children: ReactNode }) => (
  <ManagersProvider managers={managers}>{children}</ManagersProvider>
)

const titles = (rows: Element[]) => rows.map((r) => r.querySelector('.row-title')!.textContent)
/** Глиф шрифта tgico — символ, а не класс: так его рисует `TgIcon`. */
const glyph = (name: IconName) => String.fromCharCode(parseInt(Icons[name], 16))
const GLYPH_TO_NAME = new Map(Object.keys(Icons).map((name) => [glyph(name as IconName), name]))
const icons = (rows: Element[]) => rows.map((r) => GLYPH_TO_NAME.get(r.querySelector('.row-icon-icon')?.textContent ?? ''))
const allGlyphs = () => Array.from(document.querySelectorAll('.row-icon-icon')).map((n) => n.textContent)

/** Секции экрана со строками-кнопками: основная — `.profile-buttons`, Premium — последняя. */
const mainRows = () => Array.from(document.querySelectorAll('.profile-buttons > .row'))
const premiumRows = () => {
  const sections = Array.from(document.querySelectorAll('.row')).map((r) => r.parentElement!)
  const last = sections[sections.length - 1]
  return Array.from(last.querySelectorAll(':scope > .row'))
}

const renderRoot = async (opts: { premium?: boolean; stars?: number } = {}) => {
  await applyLang('en')
  useChatsStore.setState({
    me: { user: { _: 'user', id: 1, first_name: 'Me', pFlags: { premium: opts.premium || undefined } } } as never,
  })
  setAppStateSilent({ starsBalance: opts.stars ?? 0 })
  render(<SettingsView onBack={() => {}} />, { wrapper })
  await act(async () => {})
}

afterEach(() => {
  cleanup()
  useChatsStore.setState({ me: null })
  setAppStateSilent({ starsBalance: null })
})

describe('корень настроек — состав tweb', () => {
  it('основная секция: подвкладки, «Устройства», «Язык», «Горячие клавиши» — и ничего сверх', async () => {
    await renderRoot()
    const rows = mainRows()
    expect(titles(rows)).toEqual([
      'Notifications and Sounds',
      'Data and Storage',
      'Privacy and Security',
      'General Settings',
      'Chat Folders',
      'Stickers and Emoji',
      'Speakers and Camera',
      'Devices',
      'Language',
      'Keyboard Shortcuts',
    ])
    expect(icons(rows)).toEqual([
      'bell_filled', 'data_filled', 'key_filled', 'general_filled', 'limit_folders_filled',
      'reactions_filled', 'speaker_filled', 'devices_filled', 'web_filled', 'keyboard_filled',
    ])
  })

  it('«Ночного режима» в корне нет — ни строки, ни тумблера', async () => {
    await renderRoot()
    expect(allGlyphs()).not.toContain(glyph('darkmode_filled'))
    expect(document.querySelector('.row-with-toggle')).toBeNull()
    expect(document.body.textContent).not.toContain('Night Mode')
  })

  it('«Установить эмодзи-статус» в корне нет', async () => {
    await renderRoot({ premium: true })
    expect(document.body.textContent).not.toContain('Set Emoji Status')
    expect(allGlyphs()).not.toContain(glyph('emoji_filled'))
  })

  it('Premium: «Telegram Premium» без подзаголовка, затем «Отправить подарок»', async () => {
    await renderRoot()
    const rows = premiumRows()
    expect(titles(rows)).toEqual(['Telegram Premium', 'Send a Gift'])
    expect(icons(rows)).toEqual(['premium_badge', 'gift_filled'])
    expect(rows[0].querySelector('.row-subtitle')).toBeNull()
    expect(rows[0].classList.contains('no-subtitle')).toBe(true)
  })

  it('у подписчика Premium подзаголовка тоже нет', async () => {
    await renderRoot({ premium: true })
    expect(premiumRows()[0].querySelector('.row-subtitle')).toBeNull()
  })

  it('«Мои звёзды» — только при ненулевом балансе, баланс справа, между Premium и подарком', async () => {
    await renderRoot({ stars: 250 })
    const rows = premiumRows()
    expect(titles(rows)).toEqual(['Telegram Premium', 'My Stars', 'Send a Gift'])
    expect(icons(rows)[1]).toBe('star_circle_filled')
    expect(rows[1].querySelector('.row-title-right-secondary')!.textContent).toBe('250')
  })
})
