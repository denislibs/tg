// StickerViewer — оверлей предпросмотра одного стикера (см. useStickerViewer.ts,
// который решает КОГДА он смонтирован и КАКОЙ стикер показывать). Разметка и
// затемнение — порт tweb `src/scss/partials/_stickerViewer.scss`:
//   `.sticker-viewer` — `position: fixed`, `pointer-events: none` (оверлей не
//   перехватывает мышь — весь жест ведёт document-слушатели хука, не сам узел),
//   центрирование flex'ом, затемнение `rgba(0, 0, 0, .6)`.
// Сам рендер стикера — существующий `StickerMedia` (лотти/webm/webp), эмодзи —
// существующий `Emoji` (тот же рендер, что и везде в rich-тексте).
//
// Упрощения против tweb-оригинала (см. также useStickerViewer.ts):
//   — стикер вписан в фиксированный квадрат 360×360 по центру экрана, БЕЗ
//     transform-морфинга из позиции исходной ячейки (`translate()+scale()`,
//     stickerViewer.ts:144-149) — самая заметная, но чисто визуальная деталь,
//     вне периметра Task 1 (там нет требования позиционировать оверлей
//     относительно ячейки);
//   — переключение стикера при движении мыши не анимирует уход старого/приход
//     нового (`is-switching`, stickerViewer.ts:326-349) — новый стикер просто
//     подставляется на место старого;
//   — появление анимируется классом `is-visible` кадром позже маунта (тот же
//     класс/приём, что у tweb SetTransition с `openDuration=200`, длительность
//     — `.2s` в StickerViewer.module.scss), а вот исчезновение — МГНОВЕННОЕ,
//     а не после exit-transition (stickerViewer.ts:364-377): узел просто
//     размонтируется, когда useStickerViewer возвращает `null` по mouseup.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Sticker } from '../../core/managers/stickersManager'
import { usePortalContainer } from '../../core/pip'
import classNames from '../../shared/lib/classNames'
import StickerMedia from '../StickerMedia'
import Emoji from '../emoji/Emoji'
import s from './StickerViewer.module.scss'

// tweb stickerViewer.ts:100 — ветка без эффект-thumb'а и без гифки: `size = 360`.
const SIZE = 360

export default function StickerViewer({ sticker }: { sticker: Sticker }) {
  const container = usePortalContainer()

  // `.is-visible` — кадром позже маунта, иначе классу не от чего анимировать
  // переход (тот же приём, что у Popup.tsx: узел уже в DOM с исходным классом,
  // rAF переключает на конечное состояние).
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  return createPortal(
    <div
      data-testid="sticker-viewer"
      className={classNames('sticker-viewer', s.overlay, visible ? classNames('is-visible', s.visible) : '')}
    >
      <div className={classNames('sticker-viewer-backdrop', s.backdrop)} />
      <div className={classNames('sticker-viewer-transformer', s.transformer)}>
        <div className={classNames('sticker-viewer-sticker', s.sticker)}>
          <StickerMedia doc={sticker} width={SIZE} height={SIZE} autoplay loop group="STICKER-VIEWER" />
        </div>
        <div className={classNames('sticker-viewer-emoji', s.emoji)}>
          <Emoji e={sticker.stickerEmojiRaw ?? ''} size={48} />
        </div>
      </div>
    </div>,
    container,
  )
}
