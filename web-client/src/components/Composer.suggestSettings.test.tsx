// Гейты подсказок композера настройками «Стикеры и эмодзи» (задача 15 плана 2D):
// `stickersSuggest === 'none'` гасит панель стикеров по эмодзи (tweb
// chat/input.ts:3843), `emojiSuggest === false` — подсказки эмодзи по слову у
// каретки (:3871). Проверяется результат — какой хелпер смонтирован, — а не
// чтение настройки. Сами хелперы застаблены: их предмет (выдача, сетка) здесь
// не проверяется, а `StickersHelper` ходит в менеджеры.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { VoiceRecorder } from '../core/hooks/useVoiceRecorder'
import { DEFAULTS, useSettingsStore } from '../settings'

vi.mock('./StickersHelper', async (orig) => ({
  ...(await orig<typeof import('./StickersHelper')>()),
  default: () => <div data-testid="stickers-helper" />,
}))
vi.mock('./EmojiHelper', () => ({
  default: () => <div data-testid="emoji-helper" />,
}))
import Composer from './Composer'

const rec = { recording: false, paused: false, secs: 0, bars: [] as number[] } as unknown as VoiceRecorder

function renderComposer() {
  render(
    <Composer
      reply={null}
      editing={null}
      forward={null}
      rec={rec}
      onSend={vi.fn()}
      onTyping={vi.fn()}
      onPickSticker={vi.fn()}
      onCancelReply={vi.fn()}
      onCancelEdit={vi.fn()}
      onCancelForward={vi.fn()}
      onForwardOption={vi.fn()}
      onForwardAnother={vi.fn()}
      onOpenAttach={vi.fn()}
    />,
  )
  return screen.getByRole('textbox')
}

/** Набрать текст одним text-node и поставить каретку в его конец. */
function type(editor: HTMLElement, text: string) {
  editor.replaceChildren(document.createTextNode(text))
  const range = document.createRange()
  range.setStart(editor.firstChild!, text.length)
  range.collapse(true)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
  fireEvent.input(editor)
}

beforeEach(() => {
  useSettingsStore.getState().update({ stickersSuggest: DEFAULTS.stickersSuggest, emojiSuggest: DEFAULTS.emojiSuggest })
})
afterEach(cleanup)

describe('Composer — подсказки стикеров по эмодзи (settings.stickers.suggest)', () => {
  it('по умолчанию одиночный эмодзи открывает панель стикеров', () => {
    type(renderComposer(), '🔥')
    expect(screen.queryByTestId('stickers-helper')).not.toBeNull()
  })

  it('«None» — панели нет', () => {
    useSettingsStore.getState().update({ stickersSuggest: 'none' })
    type(renderComposer(), '🔥')
    expect(screen.queryByTestId('stickers-helper')).toBeNull()
  })
})

describe('Composer — подсказки эмодзи по слову (settings.emoji.suggest)', () => {
  it('по умолчанию слово у каретки открывает подсказки эмодзи', () => {
    type(renderComposer(), 'fire')
    expect(screen.queryByTestId('emoji-helper')).not.toBeNull()
  })

  it('тумблер выключен — подсказок нет', () => {
    useSettingsStore.getState().update({ emojiSuggest: false })
    type(renderComposer(), 'fire')
    expect(screen.queryByTestId('emoji-helper')).toBeNull()
  })
})
