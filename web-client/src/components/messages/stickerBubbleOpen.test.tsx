// Клик по стикеру в бабле открывает попап его набора (tweb wrapSticker →
// showStickersPopup): ConvMsg несёт только mediaId, набор резолвит бэк (GET
// /stickers/by-media/{mediaID}, StickerRealBubble в MessageContent.tsx).
// Мок менеджеров/StickerMedia — по образцу StickerSetModal.test.tsx.
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MessageRow, { type FeedFns, type MessageRowProps } from './MessageRow'
import type { ConvMsg } from '../../data'

const set = { id: 7, slug: 'utyaduck', title: 'Duck', kind: 'sticker' as const, count: 1 }
const setByMediaId = vi.fn()

vi.mock('../StickerMedia', () => ({
  default: ({ mediaId }: { mediaId: number }) => <div data-testid="sticker" data-media={mediaId} />,
}))
vi.mock('../../core/hooks/useManagers', () => ({
  useManagers: () => ({
    stickers: {
      setByMediaId,
      // StickerSetModal, открывшись, сам грузит набор по slug.
      setBySlug: async () => ({ set, stickers: [] }),
      mySets: async () => [],
    },
  }),
}))

const msg: ConvMsg = { id: 1, type: 'sticker', mediaId: 100, out: false } as ConvMsg
// toggleSelect — row-level onClick в режиме выделения (см. MessageRow.tsx):
// клик по стикеру там не открывает попап, а бабблится и выбирает ряд.
const feedFns = { toggleSelect: vi.fn() } as unknown as FeedFns

function renderRow(extra: Partial<MessageRowProps> = {}) {
  const props: MessageRowProps = {
    m: msg,
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
    ...extra,
  }
  return render(<MessageRow {...props} />)
}

describe('клик по стикеру в бабле', () => {
  // В проекте нет глобального автоклинапа testing-library — без cleanup()
  // предыдущий рендер остаётся в DOM и ломает getByTestId следующего теста.
  afterEach(cleanup)
  beforeEach(() => {
    setByMediaId.mockClear()
    ;(feedFns.toggleSelect as ReturnType<typeof vi.fn>).mockClear()
  })

  it('зовёт setByMediaId с mediaId стикера и открывает попап с полученным слагом', async () => {
    setByMediaId.mockResolvedValueOnce(set)
    renderRow()

    fireEvent.click(screen.getByTestId('sticker'))

    expect(setByMediaId).toHaveBeenCalledWith(100)
    await waitFor(() => expect(screen.getByText('Duck')).toBeTruthy())
  })

  it('ответ null — попап не открывается', async () => {
    setByMediaId.mockResolvedValueOnce(null)
    renderRow()

    fireEvent.click(screen.getByTestId('sticker'))

    expect(setByMediaId).toHaveBeenCalledWith(100)
    // ждём микротаск .then() в компоненте, после которого попап остался бы не открыт
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText('Duck')).toBeNull()
  })

  it('в режиме выделения клик по стикеру не открывает попап, а бабблится и выбирает ряд', () => {
    renderRow({ selecting: true })

    fireEvent.click(screen.getByTestId('sticker'))

    expect(setByMediaId).not.toHaveBeenCalled()
    expect(feedFns.toggleSelect).toHaveBeenCalledWith(1)
  })
})
