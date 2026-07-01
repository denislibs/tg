import Text from '../../shared/ui/Text'
import classNames from '../../shared/lib/classNames'
import TgIcon from '../TgIcon'
import type { ConvMsg, MsgStatus } from '../../data'
import { useTimeFormatter } from '../../settings'
import s from './MessageBubbles.module.scss'

export function Ticks({ status, color }: { status?: MsgStatus; color: string }) {
  if (!status) return null
  return <TgIcon name={status === 'read' ? 'checks' : 'check'} size={16} color={color} />
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
