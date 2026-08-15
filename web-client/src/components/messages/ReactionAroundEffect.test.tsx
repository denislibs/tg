import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReactionAroundEffect from './ReactionAroundEffect'
import type { AvailableReaction } from '../../core/managers/reactionsManager'

// Явная аннотация типом каталога (не литеральный вывод) — иначе TS strict не
// пускает переприсваивание с `aroundMediaId: undefined` ниже (роль реально
// опциональна — см. ReactionIcon.test.tsx с тем же приёмом).
let reactions: AvailableReaction[] = [
  { emoji: '❤', title: 'Red Heart', position: 1, premium: false, inactive: false,
    staticMediaId: 3, centerMediaId: 7, selectMediaId: 9, aroundMediaId: 8 },
]

vi.mock('../StickerMedia', () => ({
  default: ({ mediaId, onComplete }: { mediaId: number; onComplete?: () => void }) => (
    <div data-testid="media" data-media={mediaId} onClick={onComplete} />
  ),
}))
vi.mock('../../core/hooks/useReactions', () => ({ useReactions: () => reactions }))

describe('ReactionAroundEffect', () => {
  beforeEach(() => {
    reactions = [{ ...reactions[0], aroundMediaId: 8 }]
  })
  // Нет глобального автоклинапа testing-library в конфиге этого проекта —
  // без явного cleanup несколько рендер-тестов в одном файле видят DOM друг друга.
  afterEach(cleanup)

  it('проигрывает эффект вокруг', () => {
    render(<ReactionAroundEffect emoji="❤" onDone={() => {}} />)
    // jest-dom (toHaveAttribute) в проекте не установлен — см.
    // ReactionIcon.test.tsx; проверяем тем же getAttribute.
    expect(screen.getByTestId('media').getAttribute('data-media')).toBe('8')
  })

  it('зовёт onDone по завершении анимации', () => {
    const onDone = vi.fn()
    render(<ReactionAroundEffect emoji="❤" onDone={onDone} />)
    fireEvent.click(screen.getByTestId('media'))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('без эффекта ничего не рисует и сразу завершается', () => {
    reactions = [{ ...reactions[0], aroundMediaId: undefined }]
    const onDone = vi.fn()
    render(<ReactionAroundEffect emoji="❤" onDone={onDone} />)
    expect(screen.queryByTestId('media')).toBeNull()
    expect(onDone).toHaveBeenCalledOnce()
  })

  // Ревью R6, Important 1: размонтирование раньше конца анимации (переключили
  // чат, лента реконсилировалась, реакция откатилась по сетевой ошибке) не
  // должно оставлять пару msgId:emoji «зависшей» у вызывающей стороны —
  // StickerMedia.onComplete в этом случае никогда не позовётся сам (его плеер
  // уничтожается ДО завершения), поэтому cleanup обязан позвать onDone за него.
  it('размонтирование ДО завершения анимации всё равно зовёт onDone', () => {
    const onDone = vi.fn()
    const { unmount } = render(<ReactionAroundEffect emoji="❤" onDone={onDone} />)
    expect(onDone).not.toHaveBeenCalled()

    unmount()

    expect(onDone).toHaveBeenCalledOnce()
  })
})
