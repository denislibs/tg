// Клик по стикеру в бабле открывает попап его набора (tweb wrapSticker →
// showStickersPopup). Адрес набора приезжает В САМОМ ДОКУМЕНТЕ
// (`documentAttributeSticker.stickerset` → `doc.stickerSetInput`), поэтому
// открытие СИНХРОННО и в сеть не ходит; прежде на его месте стоял обратный
// поиск `GET /stickers/by-media/{mediaID}`, которого у оригинала нет вовсе.
// Мок менеджеров/StickerMedia — по образцу StickerSetModal.test.tsx.
//
// Попап живёт в глобальном стеке попапов, поэтому в рендер входит PopupHost —
// ровно так же, как в приложении (App монтирует его один раз).
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MessageRow, { type FeedFns, type MessageRowProps } from './MessageRow'
import PopupHost from '../PopupHost'
import { usePopupStore } from '../../stores/popupStore'
import { saveDocument, type MessageMedia } from '../../core/media/messageMedia'
import type { ConvMsg } from '../../data'

const set = { id: 7, slug: 'utyaduck', title: 'Duck', kind: 'sticker' as const, count: 1 }
// Один стикер в наборе — цель клика ВНУТРИ попапа (тест «отправляет и закрывает»).
const setStickers = [{ id: 55, setId: 7, mediaId: 555, emoji: '🦆', position: 0, width: 100, height: 100, mime: 'image/webp', thumb: '' }]
const getStickerSet = vi.fn()

// Стикер приезжает документом; набор — в его атрибуте, как у оригинала.
function stickerMedia(stickerset: { _: 'inputStickerSetID'; id: number } | { _: 'inputStickerSetEmpty' }): MessageMedia {
  return {
    _: 'messageMediaDocument',
    document: saveDocument({
      _: 'document',
      id: 100,
      mime_type: 'image/webp',
      size: 1000,
      attributes: [
        { _: 'documentAttributeSticker', alt: '🦆', stickerset },
        { _: 'documentAttributeImageSize', w: 512, h: 512 },
      ],
    }),
  }
}

vi.mock('../StickerMedia', () => ({
  default: ({ mediaId }: { mediaId: number }) => <div data-testid="sticker" data-media={mediaId} />,
}))
vi.mock('../../core/hooks/useManagers', () => ({
  useManagers: () => ({
    stickers: {
      // StickerSetModal, открывшись, сам грузит набор по адресу из документа.
      getStickerSet,
      mySets: async () => [],
    },
  }),
}))

const msg: ConvMsg = {
  id: 1, type: 'sticker', mediaId: 100, out: false,
  media: stickerMedia({ _: 'inputStickerSetID', id: 7 }),
} as ConvMsg
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
  return render(
    <>
      <MessageRow {...props} />
      <PopupHost />
    </>,
  )
}

describe('клик по стикеру в бабле', () => {
  // В проекте нет глобального автоклинапа testing-library — без cleanup()
  // предыдущий рендер остаётся в DOM и ломает getByTestId следующего теста.
  afterEach(() => {
    cleanup()
    usePopupStore.getState().clear()
  })
  beforeEach(() => {
    getStickerSet.mockReset()
    getStickerSet.mockResolvedValue({ set, stickers: setStickers })
    ;(feedFns.toggleSelect as ReturnType<typeof vi.fn>).mockClear()
  })

  it('открывает попап набора по адресу ИЗ ДОКУМЕНТА, не спрашивая сеть', async () => {
    renderRow()

    fireEvent.click(screen.getByTestId('sticker'))

    // Набор грузит уже сам попап — и адресует его ЧИСЛОМ из документа.
    await waitFor(() => expect(screen.getByText('Duck')).toBeTruthy())
    expect(getStickerSet).toHaveBeenCalledWith({ id: 7 })
  })

  // Стикер без набора (набор удалён либо файл прислан как стикер, но в наборах
  // не числится) — открывать нечего, клика нет вовсе. Прежде на это уходил
  // запрос в сеть, отвечавший 404.
  it('стикер без набора не кликабелен', async () => {
    renderRow({ m: { ...msg, media: stickerMedia({ _: 'inputStickerSetEmpty' }) } as ConvMsg })

    fireEvent.click(screen.getByTestId('sticker'))

    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText('Duck')).toBeNull()
    expect(getStickerSet).not.toHaveBeenCalled()
  })

  it('в режиме выделения клик по стикеру не открывает попап, а бабблится и выбирает ряд', () => {
    renderRow({ selecting: true })

    fireEvent.click(screen.getByTestId('sticker'))

    expect(getStickerSet).not.toHaveBeenCalled()
    expect(feedFns.toggleSelect).toHaveBeenCalledWith(1)
  })

  // Ревью Task 10 (important): tweb PopupStickers.onStickersClick отправляет
  // стикер вне зависимости от точки входа — тот же путь, что и у попапа из
  // поиска (StickerSetModal.test.tsx: «клик по стикеру шлёт его через
  // onPickSticker и закрывает попап»). feedFns.sendSticker — проводка в
  // Chat.tsx до sendSticker/slowmodeMarkSent композера.
  it('клик по стикеру ВНУТРИ попапа, открытого из бабла, отправляет его и закрывает попап', async () => {
    const sendSticker = vi.fn()
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
    renderRow()

    fireEvent.click(screen.getByTestId('sticker'))
    await waitFor(() => expect(screen.getByText('Duck')).toBeTruthy())

    expect(document.querySelector('.sticker-set-stickers')!.classList.contains('is-read-only')).toBe(true)
  })

  // Регрессия: попап рендерился React-потомком кликабельного бабла, а
  // синтетические события портала всплывают по React-дереву — клик по
  // затемнению закрывал попап и тем же событием доходил до onClick бабла,
  // который открывал его заново.
  it('клик по затемнению закрывает попап ОКОНЧАТЕЛЬНО — бабл его не переоткрывает', async () => {
    renderRow()

    fireEvent.click(screen.getByTestId('sticker'))
    await waitFor(() => expect(screen.getByText('Duck')).toBeTruthy())
    expect(getStickerSet).toHaveBeenCalledTimes(1)

    fireEvent.click(document.querySelector('.popup')!)

    await waitFor(() => expect(screen.queryByText('Duck')).toBeNull())
    // бабл не получил клика по затемнению — попап не открылся заново
    expect(getStickerSet).toHaveBeenCalledTimes(1)
  })

  // Тот же корень: правый клик где угодно внутри попапа проваливался в
  // onContextMenu ряда и открывал меню сообщения поверх попапа.
  it('правый клик внутри попапа не доходит до контекстного меню сообщения', async () => {
    const openMsgMenu = vi.fn()
    renderRow({ feedFns: { ...feedFns, openMsgMenu } as unknown as FeedFns })

    fireEvent.click(screen.getByTestId('sticker'))
    await waitFor(() => expect(screen.getByText('Duck')).toBeTruthy())

    fireEvent.contextMenu(document.querySelector('.popup-container')!)

    expect(openMsgMenu).not.toHaveBeenCalled()
  })
})
