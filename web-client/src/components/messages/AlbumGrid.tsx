// AlbumGrid — грид медиагруппы (tweb wrapAlbum + prepareAlbum поверх порта
// tdesktop Layouter). В режиме выделения каждый элемент несёт свой
// кружок-чекбокс и тогглится отдельно (tweb grouped-item).
import { useMemo, useState, type ReactNode } from 'react'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import Checkbox from '../../shared/ui/Checkbox'
import RadialProgress from '../RadialProgress'
import { Layouter, RectPart } from '../../core/dom/groupedLayout'
import { mediaSizes } from '../../core/dom/mediaSizes'
import classNames from '../../shared/lib/classNames'
import { mediaContentUrl, mediaThumbUrl, hasMediaToken, useMediaTokenVersion } from '../../core/mediaUrl'
import { useUploadsStore } from '../../stores/uploadsStore'
import { fmtDur } from '../../core/hooks/useVoiceRecorder'
import type { ConvMsg } from '../../data'
import type { ChatAutoDownload } from '../../core/hooks/useChatAutoDownload'
import s from './AlbumGrid.module.scss'

// Размеры грида — tweb wrappers/album.ts:56-60: maxWidth = mediaSizes.album
// (420 десктоп / 340 узкий экран), minWidth 100, spacing 1.
const MIN_W = 100
const SPACING = 1

// Углы элемента — tweb prepareAlbum.ts:42-58: наружные скругления берутся от
// радиусов бабла минус spacing, внутренние остаются прямыми.
function cornerRadii(sides: number): Record<string, string> {
  const r: Record<string, string> = {}
  const has = (p: number) => (sides & p) !== 0
  if (has(RectPart.Left) && has(RectPart.Top)) r.borderStartStartRadius = `calc(var(--border-start-start-radius) - ${SPACING}px)`
  if (has(RectPart.Left) && has(RectPart.Bottom)) r.borderEndStartRadius = `calc(var(--border-end-start-radius) - ${SPACING}px)`
  if (has(RectPart.Right) && has(RectPart.Top)) r.borderStartEndRadius = `calc(var(--border-start-end-radius) - ${SPACING}px)`
  if (has(RectPart.Right) && has(RectPart.Bottom)) r.borderEndEndRadius = `calc(var(--border-end-end-radius) - ${SPACING}px)`
  return r
}

export default function AlbumGrid({
  items, selecting, selectedKey, time, onToggle, onOpen, autoDownload,
}: {
  items: ConvMsg[]
  selecting: boolean
  /** csv id выбранных элементов альбома (стабильный prop для memo) */
  selectedKey?: string
  /** время бейджем поверх грида (bubbleParts/Time, режим floating) — когда нет подписи */
  time?: ReactNode
  onToggle: (id: number) => void
  onOpen?: (mediaId: number, el: HTMLElement) => void
  autoDownload?: ChatAutoDownload
}) {
  useMediaTokenVersion()
  const tokenReady = hasMediaToken()
  const [forced, setForced] = useState(false)
  const selected = useMemo(() => new Set((selectedKey ?? '').split(',').filter(Boolean).map(Number)), [selectedKey])
  // Прогресс аплоада по элементам альбома (кольцо на каждом, пока грузится)
  const uploads = useUploadsStore((s) => s.byId)

  const layout = useMemo(() => {
    const sizes = items.map((m) => ({
      w: m.mediaWidth || 100,
      h: m.mediaHeight || 100,
    }))
    const album = mediaSizes().album
    return new Layouter(sizes, album.width, MIN_W, SPACING, album.height || undefined).layout()
  }, [items])

  // Габариты контейнера — по крайним элементам (tweb prepareAlbum)
  const width = useMemo(() => Math.max(...layout.map((l) => l.geometry.x + l.geometry.width)), [layout])
  const height = useMemo(() => Math.max(...layout.map((l) => l.geometry.y + l.geometry.height)), [layout])

  return (
    <div className={classNames('attachment', 'media-container', 'no-background')} style={{ width, height }}>
      {items.map((m, i) => {
        const g = layout[i].geometry
        const isVideo = m.type === 'video'
        const uploadProgress = m.clientId ? uploads[m.clientId] : undefined
        const blocked = !forced && !m.localUrl && !!autoDownload && (isVideo ? autoDownload.video === 0 : autoDownload.photo === 0)
        const lqip = m.mediaBlur ? `url("data:image/jpeg;base64,${m.mediaBlur}")` : undefined
        const src = m.localUrl
          ? m.localUrl
          : !tokenReady || blocked || m.mediaId == null
            ? ''
            : m.mediaHasThumb ? mediaThumbUrl(m.mediaId) : mediaContentUrl(m.mediaId)
        const isSel = m.id != null && selected.has(m.id)
        return (
          <div
            key={m.id ?? m.clientId ?? i}
            // is-selected + forwards — как tweb SetTransition в
            // updateElementSelection (selection.ts:498-503): от `.forwards`
            // зависит сжатие медиа (scale .883333, _chatBubble.scss:962-971).
            className={classNames('album-item', 'grouped-item', isSel ? 'is-selected forwards' : '', s.item)}
            style={{
              left: `${(g.x / width) * 100}%`,
              top: `${(g.y / height) * 100}%`,
              width: `${(g.width / width) * 100}%`,
              height: `${(g.height / height) * 100}%`,
              backgroundImage: lqip,
              ...cornerRadii(layout[i].sides),
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (blocked) { setForced(true); return }
              if (selecting) { if (m.id != null) onToggle(m.id); return }
              if (m.mediaId != null) onOpen?.(m.mediaId, e.currentTarget)
            }}
          >
            {/* Чекбокс элемента — тот же label.bubble-select-checkbox, что и у
                бабла (tweb selection.ts:342-344 prepend на .grouped-item);
                правый верхний угол задаёт партиал (_chatBubble.scss:939-943). */}
            {selecting && m.id != null && <Checkbox className="bubble-select-checkbox" checked={isSel} />}
            {src && <img className={classNames('album-item-media', s.img)} src={src} alt="" loading="lazy" decoding="async" />}
            {uploadProgress != null ? (
              <div className={s.play}>
                <RadialProgress progress={uploadProgress} size={44} />
              </div>
            ) : (isVideo || blocked) && (
              <div className={s.play}>
                <div className={s.playDisc}>
                  <TgIcon name={blocked ? 'download' : 'play'} size={26} color="#fff" />
                </div>
              </div>
            )}
            {isVideo && !!m.mediaDuration && (
              <div className={s.durBadge}>
                <Text size={11.5} color="#fff" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDur(m.mediaDuration)}</Text>
              </div>
            )}
          </div>
        )
      })}
      {time}
    </div>
  )
}
