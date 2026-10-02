// Меню `#new-menu` — состав пунктов как у tweb (`sidebarLeft/index.ts:1086-1111`:
// канал, группа, личный чат). «Новый секретный чат» — наш пункт (Отступление В7-1),
// скрыт флагом `SECRET_CHATS_ENABLED` (`config/app.ts`, решение пользователя
// 2026-10-01: фича на паузе).
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ComposeMenu from './ComposeMenu'
import { applyLang } from '@/test/lang'

afterEach(() => {
  cleanup()
})

describe('ComposeMenu', () => {
  it('пункты как у tweb: канал, группа, личный чат — без «Нового секретного чата»', async () => {
    await applyLang('en')
    render(<ComposeMenu open anchor={null} onClose={() => {}} />)
    await act(async () => {})

    expect(screen.getByText('New Channel')).toBeTruthy()
    expect(screen.getByText('New Group')).toBeTruthy()
    expect(screen.getByText('New Private Chat')).toBeTruthy()
    expect(screen.queryByText('New Secret Chat')).toBeNull()
  })
})
