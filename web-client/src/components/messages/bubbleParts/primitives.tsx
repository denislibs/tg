// src/components/messages/bubbleParts/primitives.tsx
// Общие примитивы баблов: галочки статуса, таймер самоуничтожения, геометрия
// радиусов и «хвост» бабла. Используются медиа- и rich-баблами (bubbleParts/*).
import type { ReactNode } from 'react'
import type { ConvMsg } from '../../../data'
import s from '../MessageBubbles.module.scss'

/** Общие пропсы простого бабла (media/file). */
export interface Ctx {
  m: ConvMsg
  out: boolean
  firstInGroup: boolean
  lastInGroup: boolean
  /** узел времени бабла (bubbleParts/Time) — рендерится внутри контейнера */
  time?: ReactNode
  /** ряд реакций: tweb кладёт его ВНУТРЬ тела сообщения (bubbles.ts:9869),
   * и время переезжает в него */
  reactions?: ReactNode
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
