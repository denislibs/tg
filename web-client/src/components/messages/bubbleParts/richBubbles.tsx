// src/components/messages/bubbleParts/richBubbles.tsx
// «Богатые» баблы: превью ссылки (+Instant View), блок проверки фактов, лог звонка,
// гео-локация (статичная/live) и контакт.
import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import Text from '../../../shared/ui/Text'
import classNames from '../../../shared/lib/classNames'
import Avatar from '../../../shared/ui/Avatar'
import Spinner from '../../../shared/ui/Spinner'
import TgIcon from '../../TgIcon'
import RichText from '../../RichText'
import InstantView from '../../InstantView'
import { peerColor } from '../../peerColor'
import { useT } from '../../../i18n'
import { useManagers } from '../../../core/hooks/useManagers'
import { useLiveShareStore } from '../../../stores/liveShareStore'
import { stopLiveShare } from '../../../core/liveShareEngine'
import type { IVArticle } from '../../../core/managers/ivManager'
import type { ConvMsg } from '../../../data'
import { BubbleTail, bubbleRadius } from './primitives'
import s from '../MessageBubbles.module.scss'

/** link preview card (rendered inside a text bubble) */
export function WebPagePreview({
  wp,
  out,
  linkColor,
}: {
  wp: NonNullable<ConvMsg['webPage']>
  out: boolean
  linkColor: string
}) {
  const t = useT()
  const managers = useManagers()
  const accent = out ? '#fff' : linkColor
  const [ivLoading, setIvLoading] = useState(false)
  const [ivArticle, setIvArticle] = useState<IVArticle | null>(null)
  // Кнопка ленивая: серверного флага «есть IV» нет — показываем всегда при наличии
  // ссылки; клик → лоадер → 422/ошибка → просто открыть в новой вкладке.
  const openIV = async (e: ReactMouseEvent) => {
    e.stopPropagation()
    if (!wp.url || ivLoading) return
    setIvLoading(true)
    try {
      setIvArticle(await managers.iv.article(wp.url))
    } catch {
      window.open(wp.url, '_blank', 'noopener')
    } finally {
      setIvLoading(false)
    }
  }
  return (
    <div className={s.webpage} data-out={out || undefined} style={{ borderLeft: `3px solid ${accent}` }}>
      {wp.imageUrl && (
        <img className={s.webPhoto} src={wp.imageUrl} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" />
      )}
      <Text size={14} weight={600} color={accent}>
        {wp.siteName}
      </Text>
      <Text size={14.5} weight={600} color="var(--wp-title)">
        {wp.title}
      </Text>
      {wp.description && (
        <Text size={14} color="var(--wp-desc)" style={{ lineHeight: 1.35 }}>
          {wp.description}
        </Text>
      )}
      {wp.gradient && (
        <div className={s.webImg} style={{ background: wp.gradient }}>
          {wp.emoji && <Text size={56} style={{ zIndex: 1 }}>{wp.emoji}</Text>}
        </div>
      )}
      {wp.url && (
        <button type="button" className={s.ivButton} style={{ color: accent }} onClick={openIV}>
          {ivLoading ? <Spinner size={16} thickness={2} /> : <>⚡ {t('Instant View')}</>}
        </button>
      )}
      {ivArticle && wp.url && (
        <InstantView url={wp.url} article={ivArticle} onClose={() => setIvArticle(null)} />
      )}
    </div>
  )
}

/**
 * Блок «Проверка фактов» в бабле (tweb factCheck WebPageBox): акцентная полоса,
 * заголовок, текст через RichText (НЕ raw HTML) и футер. Длинный текст сворачивается
 * до «Показать больше» (эвристика по длине, tweb setLinesLimit).
 */
export function FactCheckBox({ fc, out, linkColor }: { fc: NonNullable<ConvMsg['factCheck']>; out: boolean; linkColor: string }) {
  const t = useT()
  const accent = out ? '#fff' : linkColor
  const [expanded, setExpanded] = useState(false)
  const collapsible = (fc.text?.length ?? 0) > 160
  return (
    <div className={s.factCheck} data-out={out || undefined} style={{ borderLeft: `3px solid ${accent}` }}>
      <Text size={14} weight={600} color={accent}>{t('Fact Check')}</Text>
      <div className={classNames(s.factText, collapsible && !expanded ? s.clamped : '')}>
        <Text size={14.5} color="var(--wp-title)" style={{ lineHeight: 1.35 }}>
          <RichText text={fc.text} entities={fc.entities} linkColor={out ? '#fff' : linkColor} />
        </Text>
      </div>
      {collapsible && !expanded && (
        <button type="button" className={s.factMore} style={{ color: accent }} onClick={(e) => { e.stopPropagation(); setExpanded(true) }}>
          {t('Show More')}
        </button>
      )}
      <Text size={12.5} color="var(--wp-desc)" style={{ marginTop: 2 }}>
        {fc.country ? t('This fact check was added by an admin.') + ` (${fc.country})` : t('This fact check was added by an admin.')}
      </Text>
    </div>
  )
}

/**
 * Лог 1:1 звонка (tweb .bubble-call): иконка телефона/камеры, заголовок,
 * стрелка (зелёная — состоялся, красная — нет) + длительность/причина, время + галочки.
 */
export function CallBubble({ m, out, firstInGroup, lastInGroup, time, onClick }: {
  m: ConvMsg
  out: boolean
  firstInGroup: boolean
  lastInGroup: boolean
  time?: ReactNode
  onClick?: () => void
}) {
  const t = useT()
  const call = m.call!
  const title = out
    ? (call.video ? t('Outgoing video call') : t('Outgoing call'))
    : (call.video ? t('Incoming video call') : t('Incoming call'))
  const sub =
    call.duration != null
      ? `${Math.floor(call.duration / 60)}:${String(call.duration % 60).padStart(2, '0')}`
      : call.reason === 'busy' ? t('Busy')
      : call.reason === 'missed' ? t('Missed call')
      : t('Cancelled call')
  return (
    <div
      className={s.callBubble}
      onClick={onClick}
      style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup), cursor: onClick ? 'pointer' : undefined }}
    >
      {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
      <div className={s.callIcon}>
        <TgIcon name={call.video ? 'videocamera' : 'phone'} size={24} color="var(--primary-color)" />
      </div>
      <div className={s.callBody}>
        <Text size={15.5} weight={600} color="var(--primary-text-color)">{title}</Text>
        <div className={s.callSub}>
          <TgIcon
            name="arrow_next"
            size={16}
            color={call.duration != null ? '#4dcd5e' : '#ff595a'}
            style={{ transform: call.duration != null ? 'rotate(135deg)' : 'rotate(-45deg)' }}
          />
          <Text size={13.5} color="var(--b-secondary)">{sub}</Text>
        </div>
      </div>
      {time}
    </div>
  )
}

// ── гео-бабл (tweb wrapGeo: .geo-container 277×195, ссылка на Google Maps) ──
// Статичная карта из OSM-тайлов (в tweb карту отдаёт MTProto webfile, вне Telegram
// недоступен); пин по центру, тап — makeGoogleMapsUrl 1:1.
const GEO_W = 277
const GEO_H = 195
const GEO_ZOOM = 15

export function GeoBubble({ m, out, lastInGroup, radius, time }: {
  m: ConvMsg
  out: boolean
  lastInGroup: boolean
  radius: string
  time?: ReactNode
}) {
  const managers = useManagers()
  const geo = m.geo!
  const { lat, lng } = geo
  const isVenue = !!geo.title
  const isLive = geo.livePeriod != null && geo.livePeriod > 0

  // Тикающие «сейчас» — только для live-локации (отсчёт + «обновлено N назад»).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isLive) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [isLive])

  const startMs = m.createdAt ? Date.parse(m.createdAt) : Date.now()
  const expiry = startMs + (geo.livePeriod ?? 0) * 1000
  const expired = isLive && (geo.liveStopped || now >= expiry)
  const activeShare = useLiveShareStore((st) => (m.chatId != null ? st.active[m.chatId] : undefined))
  const sharingByMe = out && isLive && !expired && activeShare?.msgId === m.id
  const remainMin = Math.max(0, Math.round((expiry - now) / 60000))
  const updatedAgoMin = geo.editedAt ? Math.max(0, Math.floor((now - Date.parse(geo.editedAt)) / 60000)) : 0

  const T = 256
  const n = 2 ** GEO_ZOOM
  const latR = (lat * Math.PI) / 180
  const px = ((lng + 180) / 360) * n * T - GEO_W / 2
  const py = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n * T - GEO_H / 2
  const tiles: { tx: number; ty: number; left: number; top: number }[] = []
  for (let tx = Math.floor(px / T); tx * T < px + GEO_W; tx++) {
    for (let ty = Math.floor(py / T); ty * T < py + GEO_H; ty++) {
      tiles.push({ tx, ty, left: tx * T - px, top: ty * T - py })
    }
  }
  return (
    <div className={s.geoWrap}>
      {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
      <a
        className={s.geoContainer}
        style={{ borderRadius: (isVenue || isLive) ? `${radius.split(' ')[0]} ${radius.split(' ')[0]} 0 0` : radius }}
        href={`https://maps.google.com/maps?q=${lat},${lng}`}
        target="_blank"
        rel="noreferrer"
      >
        {tiles.map((t) => (
          <img
            key={`${t.tx}:${t.ty}`}
            className={s.geoTile}
            src={`https://tile.openstreetmap.org/${GEO_ZOOM}/${t.tx}/${t.ty}.png`}
            style={{ left: t.left, top: t.top }}
            alt=""
            loading="lazy"
          />
        ))}
        <span className={s.geoPin} style={isLive && geo.heading != null ? { transform: `translate(-50%, -86%) rotate(${geo.heading}deg)` } : undefined}>
          <TgIcon name={isLive ? 'livelocation' : 'location'} size={38} color={expired ? '#9e9e9e' : '#e53935'} />
        </span>
        {isLive && !expired && <span className={s.geoLiveBadge}>LIVE</span>}
        {time}
      </a>

      {isVenue && !isLive && (
        <div className={s.geoFooter}>
          <Text size={15} weight={600} color="var(--b-primary)" noWrap>{geo.title}</Text>
          {geo.address && <Text size={13.5} color="var(--b-secondary)" noWrap>{geo.address}</Text>}
        </div>
      )}

      {isLive && (
        <div className={s.geoFooter}>
          {expired ? (
            <Text size={13.5} color="var(--b-secondary)">Трансляция окончена</Text>
          ) : (
            <>
              <div className={s.geoLiveRow}>
                <Text size={15} weight={600} color="var(--b-primary)">Трансляция геопозиции</Text>
                {sharingByMe && (
                  <span
                    className={s.geoStop}
                    onClick={(e) => { e.preventDefault(); if (m.chatId != null) stopLiveShare(managers, m.chatId) }}
                  >
                    Остановить
                  </span>
                )}
              </div>
              <Text size={13} color="var(--b-secondary)">
                {(updatedAgoMin <= 0 ? 'обновлено только что' : `обновлено ${updatedAgoMin} мин назад`) + ` · осталось ~${remainMin} мин`}
              </Text>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── бабл контакта (tweb .bubble.contact-message: аватар 54 + имя + телефон) ──
export function ContactBubble({ m, out, firstInGroup, lastInGroup, time, onOpen }: {
  m: ConvMsg
  out: boolean
  firstInGroup: boolean
  lastInGroup: boolean
  time?: ReactNode
  /** клик по контакту — открыть чат/профиль (tweb contactDiv.dataset.peerId) */
  onOpen?: () => void
}) {
  const c = m.contact!
  const initials = (c.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className={s.contactBubble} style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}>
      {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
      <div className={s.contactRow} onClick={onOpen} style={{ cursor: onOpen ? 'pointer' : 'default' }}>
        <Avatar background={peerColor(c.name || String(c.userId))} text={initials} size={54} />
        <div className={s.contactDetails}>
          <Text size={16} weight={700} color="var(--b-text)" noWrap>{c.name || `#${c.userId}`}</Text>
          <Text size={14} color="var(--b-secondary)" noWrap>{c.phone ? `+${c.phone.replace(/^\+/, '')}` : ''}</Text>
        </div>
      </div>
      {time}
    </div>
  )
}
