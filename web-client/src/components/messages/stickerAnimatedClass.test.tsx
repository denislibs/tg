// Класс `sticker-animated` на бабле выводится в MessageRow из mime файла
// (`isLottieMime(m.mediaMime)`), а не приходит готовым флагом: bubbleClasses.test
// подаёт `animatedSticker` уже посчитанным, поэтому саму деривацию не держит.
// Без этого пина возврат детекта к старому mime ('application/json') снимал
// класс со ВСЕХ .tgs-баблов — а .tgs у нас все залитые анимированные стикеры —
// и не красил ни одного теста.
import { render, cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MessageRow, { type FeedFns, type MessageRowProps } from './MessageRow'
import type { ConvMsg } from '../../data'

vi.mock('../StickerMedia', () => ({
  default: ({ mediaId }: { mediaId: number }) => <div data-testid="sticker" data-media={mediaId} />,
}))
vi.mock('../../core/hooks/useManagers', () => ({
  useManagers: () => ({ stickers: { setByMediaId: vi.fn().mockResolvedValue(null) } }),
}))

const feedFns = { toggleSelect: vi.fn() } as unknown as FeedFns

function renderSticker(mediaMime: string) {
  const m = { id: 1, type: 'sticker', mediaId: 100, mediaMime, out: false } as ConvMsg
  const props: MessageRowProps = {
    m,
    out: false,
    firstInGroup: true,
    lastInGroup: true,
    selecting: false,
    isSelected: false,
    isHighlighted: false,
    showName: false,
    isChannel: false,
    isFirstUnread: false,
    canSeeReactionList: true,
    feedFns,
  }
  render(<MessageRow {...props} />)
  return screen.getByTestId('sticker').closest('.bubble')!
}

describe('MessageRow — деривация sticker-animated из mime стикера', () => {
  afterEach(cleanup)

  it('.tgs (application/x-tgsticker) — бабл помечен sticker-animated', () => {
    expect(renderSticker('application/x-tgsticker').classList.contains('sticker-animated')).toBe(true)
  })

  it('несжатый lottie-json — тоже sticker-animated', () => {
    expect(renderSticker('application/json').classList.contains('sticker-animated')).toBe(true)
  })

  it('статичный webp — без sticker-animated', () => {
    expect(renderSticker('image/webp').classList.contains('sticker-animated')).toBe(false)
  })
})
