import Text from '../../shared/ui/Text'
import classNames from '../../shared/lib/classNames'
import Avatar from '../../shared/ui/Avatar'
import { peerColor } from '../peerColor'
import TgIcon from '../TgIcon'
import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { useLiveShareStore } from '../../stores/liveShareStore'
import { mediaContentUrl } from '../../core/mediaUrl'
import type { ConvMsg, MsgStatus } from '../../data'
import { useTimeFormatter } from '../../settings'
import s from './MessageBubbles.module.scss'

export function Ticks({ status, color }: { status?: MsgStatus; color: string }) {
  if (!status) return null
  if (status === 'sending') return <TgIcon name="sending" size={16} color={color} />
  if (status === 'error') return <TgIcon name="sendingerror" size={16} color="#ff595a" />
  return <TgIcon name={status === 'read' ? 'checks' : 'check'} size={16} color={color} />
}

// Остаток TTL в короткой форме: «5с» / «1м» / «1ч» / «1д» / «1нед» (как в tweb).
function fmtTtlRemain(s: number): string {
  if (s < 60) return `${s}с`
  if (s < 3600) return `${Math.ceil(s / 60)}м`
  if (s < 86400) return `${Math.ceil(s / 3600)}ч`
  if (s < 604800) return `${Math.ceil(s / 86400)}д`
  return `${Math.ceil(s / 604800)}нед`
}

// Таймер самоуничтожения секретного сообщения (tweb secret-chat self-destruct).
// Пока получатель не прочитал — destructAt не задан: показываем «взведённый» глиф
// с исходным TTL. После прочтения сервер ставит destructAt — тикаем обратный отсчёт
// (тот же приём, что у GeoBubble: useState(now) + setInterval(1000) + cleanup).
// Дошли до нуля — прячем локально (сервер всё равно пришлёт delete_message).
export function SecretTimer({ destructAt, ttlSeconds, color }: {
  destructAt?: string | null
  ttlSeconds?: number | null
  color: string
}) {
  const running = destructAt != null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])

  if (running) {
    const remainSec = Math.floor((Date.parse(destructAt!) - now) / 1000)
    if (remainSec <= 0) return null // ноль — прячем (delete_message приедет следом)
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        <TgIcon name="fire" size={14} color={color} />
        <Text size={12} color={color} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {fmtTtlRemain(remainSec)}
        </Text>
      </span>
    )
  }
  // Ещё не запущен: TTL «взведён», но отсчёт не начался — статичный глиф.
  if (ttlSeconds && ttlSeconds > 0) {
    return <TgIcon name="timer" size={14} color={color} />
  }
  return null
}

// Радиусы бабла — из tweb (_chatVariables.scss).
export const BUBBLE_R_BIG = 15 // $bubble-border-radius-big
export const BUBBLE_R_MED = 5 // $bubble-border-radius-medium

export function bubbleRadius(out: boolean, firstInGroup: boolean, lastInGroup: boolean) {
  const B = BUBBLE_R_BIG
  const m = BUBBLE_R_MED
  const first = firstInGroup ? B : m
  const last = lastInGroup ? 0 : m
  return out ? `${B}px ${first}px ${last}px ${B}px` : `${first}px ${B}px ${B}px ${last}px`
}

/**
 * The little curl at the bottom corner of the last bubble in a group — the exact
 * path from tweb's `#message-tail-filled` symbol. Same colour as the bubble, it
 * sits at the squared bottom corner and curls outward. The host bubble must be
 * `position: relative` and must not clip overflow.
 */
export function BubbleTail({ out, color }: { out: boolean; color: string }) {
  return (
    <svg
      className={s.tail}
      viewBox="0 0 11 20"
      width="11"
      height="20"
      style={{
        [out ? 'right' : 'left']: '-8.4px',
        color,
        transform: out ? 'translateY(1px) scaleX(-1)' : 'translateY(1px)',
      }}
    >
      <g transform="translate(9 -14)" fillRule="evenodd">
        <path
          d="M-6 16h6v17c-.193-2.84-.876-5.767-2.05-8.782-.904-2.325-2.446-4.485-4.625-6.48A1 1 0 01-6 16z"
          transform="matrix(1 0 0 -1 0 49)"
          fill="currentColor"
        />
      </g>
    </svg>
  )
}

interface Ctx {
  m: ConvMsg
  out: boolean
  firstInGroup: boolean
  lastInGroup: boolean
}

/** document / file */
export function DocumentBubble({ m, out, firstInGroup, lastInGroup }: Ctx) {
  const fmtTime = useTimeFormatter()
  const d = m.document
  return (
    <div
      className={classNames(s.fileBubble, s.doc)}
      data-out={out || undefined}
      style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}
    >
      {lastInGroup && <BubbleTail out={out} color="var(--bb-bg)" />}
      <div
        className={s.fileIcon}
        style={{ background: out ? 'rgba(255,255,255,0.22)' : d?.color ?? 'var(--tg-accent)' }}
      >
        <TgIcon name="download" />
      </div>
      <div className={s.fileBody}>
        <Text noWrap size={15} weight={500}>
          {d?.name}
        </Text>
        <div className={s.fileMetaRow}>
          <Text size={13} color="var(--bb-sub)">
            {d?.size} · {d?.ext}
          </Text>
          <div className={s.spacer} />
          <Text size={12} color="var(--bb-meta)">
            {fmtTime(m.time)}
          </Text>
          <Ticks status={m.status} color="var(--bb-tick)" />
        </div>
      </div>
    </div>
  )
}

/** audio / music */
export function AudioBubble({ m, out, firstInGroup, lastInGroup }: Ctx) {
  const fmtTime = useTimeFormatter()
  const a = m.audio
  return (
    <div
      className={classNames(s.fileBubble, s.audio)}
      data-out={out || undefined}
      style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}
    >
      {lastInGroup && <BubbleTail out={out} color="var(--bb-bg)" />}
      <div
        className={classNames(s.fileIcon, s.fileIconAudio)}
        style={{ background: out ? 'rgba(255,255,255,0.22)' : 'var(--tg-accent)' }}
      >
        <TgIcon name="music" />
      </div>
      <div className={s.fileBody}>
        <Text noWrap size={15} weight={500}>
          {a?.title}
        </Text>
        <Text noWrap size={13} color="var(--bb-sub)">
          {a?.artist}
        </Text>
        <div className={s.fileMetaRow} style={{ marginTop: 2 }}>
          <Text size={12} color="var(--bb-meta)">
            {a?.duration}
          </Text>
          <div className={s.spacer} />
          <Text size={12} color="var(--bb-meta)">
            {fmtTime(m.time)}
          </Text>
          <Ticks status={m.status} color="var(--bb-tick)" />
        </div>
      </div>
    </div>
  )
}

/** round video note */
export function RoundVideoBubble({ m, out }: Ctx) {
  const fmtTime = useTimeFormatter()
  return (
    <div className={s.round} data-out={out || undefined}>
      <div className={s.roundInner}>
        <div className={s.roundDisc} style={{ background: m.media?.gradient ?? 'var(--tg-accentGradient)' }}>
          <Text size={72} style={{ userSelect: 'none' }}>{m.media?.emoji ?? '🎥'}</Text>
        </div>
        {/* progress ring */}
        <svg className={s.roundRing} viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="97" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="3" />
          <circle
            cx="100"
            cy="100"
            r="97"
            fill="none"
            stroke="#fff"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 97}
            strokeDashoffset={2 * Math.PI * 97 * 0.7}
          />
        </svg>
        <div className={s.roundDur}>{m.videoDuration ?? '0:08'}</div>
      </div>
      <div className={s.roundMeta}>
        <Text size={12} color="var(--tg-textFaint)">{fmtTime(m.time)}</Text>
        <Ticks status={m.status} color="var(--tg-textFaint)" />
      </div>
    </div>
  )
}

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
  const accent = out ? '#fff' : linkColor
  return (
    <div className={s.webpage} data-out={out || undefined} style={{ borderLeft: `3px solid ${accent}` }}>
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
    </div>
  )
}

/**
 * Лог 1:1 звонка (tweb .bubble-call): иконка телефона/камеры, заголовок
 * «Исходящий/Входящий (видео)звонок», стрелка (зелёная — состоялся, красная —
 * нет) + длительность или причина, время + галочки.
 */
export function CallBubble({ m, out, firstInGroup, lastInGroup, onClick }: { m: ConvMsg; out: boolean; firstInGroup: boolean; lastInGroup: boolean; onClick?: () => void }) {
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
        <TgIcon name={call.video ? 'videocamera' : 'phone'} size={24} color="var(--tg-accent)" />
      </div>
      <div className={s.callBody}>
        <Text size={15.5} weight={600} color="var(--tg-textPrimary)">{title}</Text>
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
      <span className={s.callMeta}>
        <Text size={12.5} color="var(--b-time)">{m.time}</Text>
        {out && <Ticks status={m.status} color="var(--b-tick)" />}
      </span>
    </div>
  )
}

/**
 * Настоящий видео-кружок (tweb wrappers/video.ts, ветка doc.type === 'round'):
 * без клика крутится muted-превью в цикле (как GIF) с иконкой nosound в бейдже;
 * клик — воспроизведение со звуком с начала (бейдж считает остаток, кольцо
 * прогресса бежит по кругу), повторный клик — пауза (кадр замирает). Белая
 * точка в бейдже — media_unread («не просмотрено»), гаснет на первом
 * timeupdate со звуком (tweb readMessages).
 */
export function RoundVideoRealBubble({ m, onPlayed, onSoundPlay }: { m: ConvMsg; onPlayed?: () => void; onSoundPlay?: (el: HTMLVideoElement) => void }) {
  const fmtTime = useTimeFormatter()
  const ref = useRef<HTMLVideoElement>(null)
  // preview — muted-loop; sound — со звуком (кольцо+остаток); в sound есть пауза
  const [sound, setSound] = useState(false)
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState(0) // 0..1, только в sound-режиме
  const [left, setLeft] = useState<number | null>(null)
  const reported = useRef(false)
  const dur = m.mediaDuration ?? 0
  const toggle = () => {
    const v = ref.current
    if (!v) return
    if (!sound) {
      // из muted-превью — звук с начала; кружок регистрируется в глобальном
      // плеере (плашка над шапкой, tweb pinned-audio)
      v.muted = false
      v.loop = false
      v.currentTime = 0
      void v.play()
      setSound(true)
      setPaused(false)
      onSoundPlay?.(v)
    } else if (v.paused) {
      void v.play()
      setPaused(false)
      onSoundPlay?.(v) // ре-аттач, если плашку успели закрыть
    } else {
      v.pause()
      setPaused(true)
    }
  }
  // Пауза/резюм могут прийти извне (плашка плеера) — отражаем в состоянии бабла.
  const onPauseEvt = () => { if (sound) setPaused(true) }
  const onPlayEvt = () => { if (sound) setPaused(false) }
  const onTime = () => {
    const v = ref.current
    if (!v || !sound) return
    if (!reported.current && !m.out && m.mediaUnread) {
      reported.current = true
      onPlayed?.()
    }
    const total = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : dur
    if (total > 0) {
      setProgress(v.currentTime / total)
      setLeft(Math.max(0, Math.ceil(total - v.currentTime)))
    }
  }
  const onEnded = () => {
    // досмотрели — назад в muted-loop превью (tweb показывает зацикленный кадр)
    const v = ref.current
    setSound(false)
    setPaused(false)
    setProgress(0)
    setLeft(null)
    if (v) {
      v.muted = true
      v.loop = true
      v.currentTime = 0
      void v.play()
    }
  }
  const fmt = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`
  const badge = sound && left != null ? fmt(left) : fmt(Math.round(dur))
  // nosound в бейдже — пока не идёт воспроизведение со звуком (tweb setIsPaused)
  const noSound = !sound || paused
  const C = 2 * Math.PI * 49
  return (
    <div className={s.roundReal} data-out={m.out || undefined}>
      <div className={s.roundRealDisc} onClick={toggle}>
        <video
          ref={ref}
          className={s.roundRealVideo}
          src={m.mediaId != null ? mediaContentUrl(m.mediaId) : undefined}
          playsInline
          muted
          loop
          autoPlay
          onTimeUpdate={onTime}
          onEnded={onEnded}
          onPause={onPauseEvt}
          onPlay={onPlayEvt}
        />
        {progress > 0 && (
          <svg className={s.roundRealRing} viewBox="0 0 100 100">
            <circle
              cx="50" cy="50" r="49" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - progress)} transform="rotate(-90 50 50)"
            />
          </svg>
        )}
        {/* бейдж (tweb .video-time): остаток/длительность + nosound + точка unread */}
        <div className={s.roundRealBadge}>
          {badge}
          {noSound && <TgIcon name="nosound" size={16} style={{ verticalAlign: '-3px', marginLeft: 2 }} />}
          {m.mediaUnread && <span className={s.roundRealDot} />}
        </div>
        {/* время + галочки — внутри круга снизу (tweb) */}
        <div className={s.roundRealMeta}>
          <Text size={12} color="#fff">{fmtTime(m.time)}</Text>
          {m.out && <Ticks status={m.status} color="#fff" />}
        </div>
      </div>
    </div>
  )
}

// ── гео-бабл (tweb wrapGeo: .geo-container 277×195, ссылка на Google Maps) ──
// Статичная карта собирается из OSM-тайлов (в tweb карту отдаёт MTProto webfile,
// вне Telegram он недоступен); пин по центру, тап — makeGoogleMapsUrl 1:1.
const GEO_W = 277
const GEO_H = 195
const GEO_ZOOM = 15

export function GeoBubble({ m, out, lastInGroup, radius }: {
  m: ConvMsg
  out: boolean
  lastInGroup: boolean
  radius: string
}) {
  const fmtTime = useTimeFormatter()
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
        <span className={s.geoMeta}>
          <Text size={12.5} color="#fff">{fmtTime(m.time)}</Text>
          {m.out && <Ticks status={m.status} color="#fff" />}
        </span>
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
                    onClick={(e) => { e.preventDefault(); if (m.chatId != null) useLiveShareStore.getState().stop(managers, m.chatId) }}
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
export function ContactBubble({ m, out, firstInGroup, lastInGroup, onOpen }: {
  m: ConvMsg
  out: boolean
  firstInGroup: boolean
  lastInGroup: boolean
  /** клик по контакту — открыть чат/профиль (tweb contactDiv.dataset.peerId) */
  onOpen?: () => void
}) {
  const fmtTime = useTimeFormatter()
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
      <div className={s.contactMeta}>
        <Text size={12} color="var(--b-time)">{fmtTime(m.time)}</Text>
        {m.out && <Ticks status={m.status} color="var(--b-tick)" />}
      </div>
    </div>
  )
}
