// src/components/messages/bubbleParts/primitives.tsx
// Общие примитивы баблов: галочки статуса, таймер самоуничтожения, геометрия
// радиусов и «хвост» бабла. Используются медиа- и rich-баблами (bubbleParts/*).
import { useEffect, useState } from 'react'
import Text from '../../../shared/ui/Text'
import TgIcon from '../../TgIcon'
import type { ConvMsg, MsgStatus } from '../../../data'
import s from '../MessageBubbles.module.scss'

/** Общие пропсы простого бабла (media/file). */
export interface Ctx {
  m: ConvMsg
  out: boolean
  firstInGroup: boolean
  lastInGroup: boolean
}

// Тик статуса (tweb .time-sending-status): глиф крупнее текста времени —
// font-size calc(--messages-text-size + 3px) = 19px у tweb; берём 18 (SVG).
// Цвет передаёт вызывающий (tweb --message-status-color ≈ цвету времени, muted).
export function Ticks({ status, color, size = 16 }: { status?: MsgStatus; color: string; size?: number }) {
  if (!status) return null
  if (status === 'sending') return <TgIcon name="sending" size={size} color={color} />
  if (status === 'error') return <TgIcon name="sendingerror" size={size} color="#ff595a" />
  return <TgIcon name={status === 'read' ? 'checks' : 'check'} size={size} color={color} />
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
// с исходным TTL. После прочтения сервер ставит destructAt — тикаем обратный отсчёт.
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
 * Хвостик в нижнем углу последнего бабла группы — точный путь из tweb
 * `#message-tail-filled`. Цвет — как у бабла; host-бабл должен быть
 * `position: relative` и не обрезать overflow.
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
