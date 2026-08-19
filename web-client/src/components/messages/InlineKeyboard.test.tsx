// Инлайн-клавиатура: что делает кнопка, решает её конструктор `_`, а не наличие
// поля. Пин ветвления — порт `getKeyboardButtonHandler`
// (tweb components/wrappers/keyboardButton.ts:64-300).
//
// До перевода на TL кнопка была `{text, callback?, url?, webapp?}` и разбиралась
// цепочкой `if (b.url) … if (b.webapp) … if (b.callback == null) return`: три
// необязательных поля на одном объекте, где схема даёт три РАЗНЫХ конструктора.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

import InlineKeyboard from './InlineKeyboard'
import { ManagersProvider } from '../../core/hooks/useManagers'
import { useWebAppStore } from '../../core/webapp'
import type { KeyboardButtonRow } from '../../core/markup/replyMarkup'
import type { Managers } from '../../client/bootstrap'

const ROWS: KeyboardButtonRow[] = [
  {
    _: 'keyboardButtonRow',
    buttons: [
      // base64('alert') — `data` в схеме bytes, на проводе фазы 0 base64-строка.
      { _: 'keyboardButtonCallback', text: 'Позвать', data: 'YWxlcnQ=' },
      { _: 'keyboardButtonUrl', text: 'Сайт', url: 'https://telegram.org' },
    ],
  },
  {
    _: 'keyboardButtonRow',
    buttons: [
      { _: 'keyboardButtonWebView', text: 'Мини-апп', url: 'https://example.com/app' },
      // Кнопка reply-клавиатуры под баблом: у оригинала в ветке `default`
      // обработчик появляется, только если сообщения НЕТ. Здесь оно есть.
      { _: 'keyboardButton', text: 'Молчун' },
    ],
  },
]

function renderWithFake() {
  const callback = vi.fn().mockResolvedValue({ text: '', alert: false })
  const managers = { bots: { callback } } as unknown as Managers
  render(
    <ManagersProvider managers={managers}>
      <InlineKeyboard rows={ROWS} peerId={7} botId={42} msgId={100} />
    </ManagersProvider>,
  )
  return { callback }
}

describe('InlineKeyboard — ветвление по конструктору кнопки', () => {
  beforeEach(() => useWebAppStore.setState({ open: false, url: '', botName: '', botId: 0, queryId: '' }))
  afterEach(cleanup)

  it('keyboardButtonCallback шлёт data боту как есть (base64 байтов)', async () => {
    const { callback } = renderWithFake()
    fireEvent.click(screen.getByText('Позвать'))

    await waitFor(() => expect(callback).toHaveBeenCalledTimes(1))
    expect(callback).toHaveBeenCalledWith(42, 7, 'YWxlcnQ=', 100)
  })

  it('keyboardButtonUrl открывает ссылку и не ходит к боту', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { callback } = renderWithFake()
    fireEvent.click(screen.getByText('Сайт'))

    expect(open).toHaveBeenCalledWith('https://telegram.org', '_blank', 'noopener')
    expect(callback).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('keyboardButtonWebView открывает mini-app, а не ссылку', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { callback } = renderWithFake()
    fireEvent.click(screen.getByText('Мини-апп'))

    expect(useWebAppStore.getState()).toMatchObject({ open: true, url: 'https://example.com/app', botName: 'Мини-апп', botId: 42 })
    expect(open).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('keyboardButton под баблом не делает ничего (ветка default оригинала)', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { callback } = renderWithFake()
    fireEvent.click(screen.getByText('Молчун'))

    expect(callback).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    expect(useWebAppStore.getState().open).toBe(false)
    open.mockRestore()
  })
})
