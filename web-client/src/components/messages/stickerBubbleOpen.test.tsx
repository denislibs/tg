// Клик по стикеру в бабле открывает попап его набора (tweb wrapSticker →
// showStickersPopup): ConvMsg несёт только mediaId, набор резолвит бэк (GET
// /stickers/by-media/{mediaID}, StickerRealBubble в MessageContent.tsx).
// Мок менеджеров/StickerMedia — по образцу StickerSetModal.test.tsx.
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MessageRow, { type FeedFns, type MessageRowProps } from './MessageRow'
import type { ConvMsg } from '../../data'

const set = { id: 7, slug: 'utyaduck', title: 'Duck', kind: 'sticker' as const, count: 1 }
// Один стикер в наборе — цель клика ВНУТРИ попапа (тест «отправляет и закрывает»).
const setStickers = [{ id: 55, setId: 7, mediaId: 555, emoji: '🦆', position: 0, width: 100, height: 100, mime: 'image/webp', thumb: '' }]
const setByMediaId = vi.fn()

vi.mock('../StickerMedia', () => ({
  default: ({ mediaId }: { mediaId: number }) => <div data-testid="sticker" data-media={mediaId} />,
}))
vi.mock('../../core/hooks/useManagers', () => ({
  useManagers: () => ({
    stickers: {
      setByMediaId,
      // StickerSetModal, открывшись, сам грузит набор по slug.
      setBySlug: async () => ({ set, stickers: setStickers }),
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

  // Ревью Task 10 (important): tweb PopupStickers.onStickersClick отправляет
  // стикер вне зависимости от точки входа — тот же путь, что и у попапа из
  // поиска (StickerSetModal.test.tsx: «клик по стикеру шлёт его через
  // onPickSticker и закрывает попап»). feedFns.sendSticker — проводка в
  // Chat.tsx до sendSticker/slowmodeMarkSent композера.
  it('клик по стикеру ВНУТРИ попапа, открытого из бабла, отправляет его и закрывает попап', async () => {
    const sendSticker = vi.fn()
    setByMediaId.mockResolvedValueOnce(set)
    renderRow({ feedFns: { ...feedFns, sendSticker } as unknown as FeedFns })

    fireEvent.click(screen.getByTestId('sticker'))
    await waitFor(() => expect(screen.getByText('Duck')).toBeTruthy())

    // сетка попапа кликабельна — без is-read-only, когда есть onPickSticker
    expect(document.querySelector('.sticker-set-stickers')!.classList.contains('is-read-only')).toBe(false)
    fireEvent.click(document.querySelector('.sticker-set-sticker')!)

    expect(sendSticker).toHaveBeenCalledTimes(1)
    expect(sendSticker.mock.calls[0][0]).toMatchObject({ id: 55, mediaId: 555, emoji: '🦆' })
    // попап закрылся — заголовок набора ушёл из DOM
    await waitFor(() => expect(screen.queryByText('Duck')).toBeNull())
  })

  it('без права слать (sendSticker=undefined) сетка попапа read-only', async () => {
    setByMediaId.mockResolvedValueOnce(set)
    renderRow()

    fireEvent.click(screen.getByTestId('sticker'))
    await waitFor(() => expect(screen.getByText('Duck')).toBeTruthy())

    expect(document.querySelector('.sticker-set-stickers')!.classList.contains('is-read-only')).toBe(true)
  })
})
