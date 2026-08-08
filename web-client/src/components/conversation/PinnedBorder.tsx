// Вертикальный индикатор-стек пинов слева в плашке — порт tweb
// PinnedMessageBorder (src/components/chat/pinnedMessageBorder.ts): SVG clipPath
// режет трек на сегменты (2 → 19px, 3 → 12px, 4+ → 10px, gap 2px), активный
// сегмент — сплошной «mark», остальные — подложка с opacity .4; при >4 пинах
// трек скроллится внутри 40px окна с фейдами сверху/снизу (border-mask).
// index — по треку сверху вниз (0 = верхний/старейший), как в tweb render().
// Классы — tweb (styles/tweb/_chatPinned.scss `.pinned-message-border*`).
import { useId } from 'react'
import classNames from '../../shared/lib/classNames'

const BAR_HEIGHTS = { ONE: 40, TWO: 19, THREE: 12, FOUR: 10, MORE: 10 } as const
const GAP = 2
const WIDTH = 3

const drawRect = (x: number, y: number, width: number, height: number, radius: number) =>
  `M${x},${y + radius}a${radius},${radius},0,0,1,${width},0v${height - 2 * radius}a${radius},${radius},0,0,1,${-width},0Z`

function getBarHeight(count: number): number {
  if (count <= 1) return BAR_HEIGHTS.ONE
  if (count === 2) return BAR_HEIGHTS.TWO
  if (count === 3) return BAR_HEIGHTS.THREE
  if (count === 4) return BAR_HEIGHTS.FOUR
  return BAR_HEIGHTS.MORE
}

function getClipPathD(barHeight: number, count: number): string {
  const radius = 1.5
  if (count === 2) {
    return drawRect(0, 0, WIDTH, barHeight, radius) + drawRect(0, barHeight + GAP * 2, WIDTH, barHeight, radius)
  }
  let d = ''
  for (let i = 0; i < count; ++i) d += drawRect(0, (barHeight + GAP) * i, WIDTH, barHeight, radius)
  return d
}

function getMarkTranslateY(index: number, barHeight: number, count: number): number {
  if (count === 1) return 0
  if (count === 2) return !index ? 0 : barHeight + GAP
  if (count === 3) {
    if (!index) return 0
    if (index === 1) return barHeight + GAP
    return barHeight * 2 + GAP * 2 + 1
  }
  return (barHeight + GAP) * index
}

function getTrackTranslateY(index: number, count: number, barHeight: number, trackHeight: number): number {
  if (count <= 3 || index <= 1) return 0
  if (index >= count - 2) return trackHeight - BAR_HEIGHTS.ONE
  return (index - 2) * barHeight + index * GAP
}

const getTrackHeight = (count: number, barHeight: number) =>
  count <= 3 ? BAR_HEIGHTS.ONE : barHeight * count + GAP * (count - 1)

export default function PinnedBorder({ count, index }: { count: number; index: number }) {
  // useId содержит «:» — вычищаем, иначе clip-path: url(#id) не срезолвится.
  const clipId = 'pinned-border-' + useId().replace(/[^a-zA-Z0-9-]/g, '')

  if (count <= 1) {
    return (
      <div className="pinned-message-border">
        <div className="pinned-message-border-wrapper-1" />
      </div>
    )
  }

  const barHeight = getBarHeight(count)
  const trackHeight = getTrackHeight(count, barHeight)
  const markTranslateY = getMarkTranslateY(index, barHeight, count)
  const trackTranslateY = getTrackTranslateY(index, count, barHeight, trackHeight)
  const maskTop = index > 1
  const maskBottom = index < count - 2

  return (
    <div
      className={classNames(
        'pinned-message-border',
        count > 4 ? 'pinned-message-border-mask' : '',
        maskTop ? 'mask-top' : '',
        maskBottom ? 'mask-bottom' : '',
      )}
    >
      <div
        className="pinned-message-border-wrapper"
        style={{ clipPath: `url(#${clipId})`, width: WIDTH, height: trackHeight, transform: `translateY(-${trackTranslateY}px)` }}
      >
        <svg width={0} height={0}>
          <defs>
            <clipPath id={clipId}>
              <path d={getClipPathD(barHeight, count)} />
            </clipPath>
          </defs>
        </svg>
        <div className="pinned-message-border-mark" style={{ height: barHeight, transform: `translateY(${markTranslateY}px)` }} />
      </div>
    </div>
  )
}
