// Горячие клавиши композера: ↑ на пустом инпуте — правка последнего своего
// сообщения; Ctrl/Cmd+↑ — ответ на предыдущее; ↑ на НЕпустом инпуте не триггерит
// правку; Ctrl/Cmd+K — ссылка на выделение (prompt → applyMarkup 'text_link').
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { VoiceRecorder } from '../core/hooks/useVoiceRecorder'

// Композер тянет StickerMedia → lottie-web, который при импорте лезет в canvas
// (в happy-dom его нет) — мокаем, как в StickerMedia.test.
vi.mock('lottie-web', () => ({ default: { loadAnimation: vi.fn() } }))

// applyMarkup замокан — проверяем, что Ctrl+K зовёт его с типом text_link.
vi.mock('../core/markdown', async (orig) => {
  const actual = await orig<typeof import('../core/markdown')>()
  return { ...actual, apply: vi.fn() }
})
import { apply as applyMarkup } from '../core/markdown'
import Composer from './Composer'

const rec = { recording: false, paused: false, secs: 0, bars: [] as number[] } as unknown as VoiceRecorder

function renderComposer(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const onEditLast = vi.fn()
  const onReplyPrev = vi.fn()
  render(
    <Composer
      reply={null}
      editing={null}
      rec={rec}
      onSend={vi.fn()}
      onTyping={vi.fn()}
      onCancelReply={vi.fn()}
      onCancelEdit={vi.fn()}
      onOpenAttach={vi.fn()}
      onEditLast={onEditLast}
      onReplyPrev={onReplyPrev}
      {...props}
    />,
  )
  const editor = screen.getByRole('textbox')
  return { onEditLast, onReplyPrev, editor }
}

describe('Composer — стрелка вверх', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it('↑ на пустом инпуте → onEditLast', () => {
    const { onEditLast, editor } = renderComposer()
    fireEvent.keyDown(editor, { key: 'ArrowUp' })
    expect(onEditLast).toHaveBeenCalledTimes(1)
  })

  it('Ctrl/Cmd+↑ → onReplyPrev (не onEditLast)', () => {
    const { onEditLast, onReplyPrev, editor } = renderComposer()
    fireEvent.keyDown(editor, { key: 'ArrowUp', metaKey: true })
    expect(onReplyPrev).toHaveBeenCalledTimes(1)
    expect(onEditLast).not.toHaveBeenCalled()
  })

  it('↑ на НЕпустом инпуте не триггерит правку', () => {
    const { onEditLast, editor } = renderComposer()
    editor.textContent = 'привет'
    fireEvent.input(editor)
    fireEvent.keyDown(editor, { key: 'ArrowUp' })
    expect(onEditLast).not.toHaveBeenCalled()
  })
})

describe('Composer — Ctrl/Cmd+K ссылка', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it('с выделением: prompt → applyMarkup text_link с URL', () => {
    // happy-dom не определяет window.prompt — подставляем свой.
    const promptSpy = vi.fn().mockReturnValue('example.com')
    window.prompt = promptSpy
    const { editor } = renderComposer()
    editor.textContent = 'текст ссылки'
    fireEvent.input(editor)
    // Выделяем содержимое инпута, чтобы Ctrl+K сработал (text_link по выделению).
    const range = document.createRange()
    range.selectNodeContents(editor)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    fireEvent.keyDown(editor, { key: 'k', code: 'KeyK', metaKey: true })
    expect(promptSpy).toHaveBeenCalledTimes(1)
    expect(applyMarkup).toHaveBeenCalledWith(editor, 'text_link', 'https://example.com')
  })

  it('без выделения: prompt не зовётся', () => {
    const promptSpy = vi.fn().mockReturnValue('x')
    window.prompt = promptSpy
    const { editor } = renderComposer()
    window.getSelection()?.removeAllRanges()
    fireEvent.keyDown(editor, { key: 'k', code: 'KeyK', metaKey: true })
    expect(promptSpy).not.toHaveBeenCalled()
  })
})
