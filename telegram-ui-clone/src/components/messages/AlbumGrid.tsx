// AlbumGrid — грид медиагруппы (tweb wrapAlbum + prepareAlbum поверх порта
// tdesktop Layouter). В режиме выделения каждый элемент несёт свой
// кружок-чекбокс и тогглится отдельно (tweb grouped-item).
import { useMemo, useState } from 'react'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import Checkbox from '../../shared/ui/Checkbox'
import { Layouter } from '../../core/dom/groupedLayout'
import { mediaContentUrl, mediaThumbUrl, hasMediaToken, useMediaTokenVersion } from '../../core/mediaUrl'
import { fmtDur } from '../../core/hooks/useVoiceRecorder'
import type { ConvMsg, MsgStatus } from '../../data'
import type { ChatAutoDownload } from '../../core/hooks/useChatAutoDownload'
import s from './AlbumGrid.module.scss'

// Размеры грида — наш медиабокс (tweb mediaSizes.album 420 на десктопе;
// у нас лента с боксом 320×420, minWidth/spacing — из tweb prepareAlbum).
const MAX_W = 320
const MAX_H = 420
const MIN_W = 100
const SPACING = 2

function Ticks({ status, color }: { status?: MsgStatus; color: string }) {
  if (!status) return null
  if (status === 'sending') return <TgIcon name="sending" size={14} color={color} />
  if (status === 'error') return <TgIcon name="sendingerror" size={14} color="#ff595a" />
  return <TgIcon name={status === 'read' ? 'checks' : 'check'} size={14} color={color} />
}

export default function AlbumGrid({
  items, selecting, selectedKey, time, status, out, onToggle, onOpen, autoDownload, radius,
}: {
  items: ConvMsg[]
  selecting: boolean
  /** csv id выбранных элементов альбома (стабильный prop для memo) */
  selectedKey?: string
  /** время+тики бейджем поверх грида (когда нет подписи) */
  time?: string
  status?: MsgStatus
  out: boolean
  onToggle: (id: number) => void
  onOpen?: (mediaId: number, el: HTMLElement) => void
  autoDownload?: ChatAutoDownload
  radius?: string
}) {
  useMediaTokenVersion()
  const tokenReady = hasMediaToken()
  const [forced, setForced] = useState(false)
  const selected = useMemo(() => new Set((selectedKey ?? '').split(',').filter(Boolean).map(Number)), [selectedKey])

  const layout = useMemo(() => {
    const sizes = items.map((m) => ({
      w: m.mediaWidth || 100,
      h: m.mediaHeight || 100,
    }))
    return new Layouter(sizes, MAX_W, MIN_W, SPACING, MAX_H).layout()
  }, [items])

  // Габариты контейнера — по крайним элементам (tweb prepareAlbum)
  const width = useMemo(() => Math.max(...layout.map((l) => l.geometry.x + l.geometry.width)), [layout])
  const height = useMemo(() => Math.max(...layout.map((l) => l.geometry.y + l.geometry.height)), [layout])

  return (
    <div className={s.grid} style={{ width, height, borderRadius: radius }}>
      {items.map((m, i) => {
        const g = layout[i].geometry
        const isVideo = m.type === 'video'
        const blocked = !forced && !!autoDownload && (isVideo ? autoDownload.video === 0 : autoDownload.photo === 0)
        const lqip = m.mediaBlur ? `url("data:image/jpeg;base64,${m.mediaBlur}")` : undefined
        const src = !tokenReady || blocked || m.mediaId == null
          ? ''
          : m.mediaHasThumb ? mediaThumbUrl(m.mediaId) : mediaContentUrl(m.mediaId)
        const isSel = m.id != null && selected.has(m.id)
        return (
          <div
            key={m.id ?? m.clientId ?? i}
            className={s.item}
            style={{
              left: `${(g.x / width) * 100}%`,
              top: `${(g.y / height) * 100}%`,
              width: `${(g.width / width) * 100}%`,
              height: `${(g.height / height) * 100}%`,
              backgroundImage: lqip,
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (blocked) { setForced(true); return }
              if (selecting) { if (m.id != null) onToggle(m.id); return }
              if (m.mediaId != null) onOpen?.(m.mediaId, e.currentTarget)
            }}
          >
            {src && <img className={s.img} src={src} alt="" decoding="async" />}
            {isSel && <div className={s.selectedDim} />}
            {selecting && m.id != null && (
              <div className={s.check}>
                <Checkbox checked={isSel} ring="#fff" size={24} />
              </div>
            )}
            {(isVideo || blocked) && (
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
      {time && (
        <div className={s.timeBadge}>
          <Text size={12} color="#fff" style={{ fontVariantNumeric: 'tabular-nums' }}>{time}</Text>
          {out && <Ticks status={status} color="#fff" />}
        </div>
      )}
    </div>
  )
}
