// src/components/messages/bubbleParts/Time.tsx
//
// Время сообщения — единый компонент для ВСЕХ типов баблов, порт tweb
// `MessageRender.setTime()` (components/chat/messageRender.ts:344-392).
//
// tweb собирает массив частей (pinned, «изменено», просмотры, автор поста,
// эффект, само время) и рендерит его ДВАЖДЫ внутри одного `<span class="time">`:
// первый набор — скрытая распорка в потоке, второй — в `<div class="time-inner">`,
// прибитом абсолютом к нижне-правому углу. Тик статуса tweb добавляет prepend-ом
// в оба (bubbles.ts:6382-6407), а CSS `order: 5` уводит его в конец строки.
//
// Режимы размещения — те же, что у tweb:
//   inline   — в потоке текста (`float: right`), tweb bubbles.ts:7630
//   block    — своей строкой, tweb `.time.is-block` (RTL / блочный контент)
//   floating — пилюлей поверх медиа без подписи, tweb `.time.is-floating` (:9272)
//   corner   — в углу контейнерного бабла (voice/audio/document/poll/contact/call),
//              tweb `.audio .time` (:8624-8631 + _chatBubble.scss:1630-1651)
//   plain    — без абсолютов: время едет trailing-ом в ряд реакций
//              (tweb appendBubbleTime → reactionsElement, bubbles.ts:9852-9855)
import { useEffect, useState, type ReactNode } from 'react'
import TgIcon from '../../TgIcon'
import classNames from '../../../shared/lib/classNames'
import { fmtViews } from '../../../core/format/fmtViews'
import { useTimeFormatter } from '../../../settings'
import { useT } from '../../../i18n'
import { playEmojiEffect, type EmojiEffectKind } from '../../../core/effects/emojiEffects'
import type { MsgStatus } from '../../../data'
import s from './Time.module.scss'

/** Режим размещения времени внутри бабла (см. шапку файла). */
export type TimeMode = 'inline' | 'block' | 'nofloat' | 'floating' | 'corner' | 'plain'

/**
 * tweb `clearfix()` (bubbles.ts:7631) — пустой узел сразу за временем, который
 * схлопывает его float, чтобы блок сообщения учёл высоту распорки.
 */
export function TimeClearfix() {
  return <span className={classNames('clearfix', s.clearfix)} />
}

/** Подвариант `corner` — значения смещения зависят от типа контейнера (tweb). */
// 'container' — позиционирует сам контейнер правилами tweb (.audio .time,
// .document .time): используется там, где бабл уже на структуре tweb.
export type TimeCorner = 'default' | 'audio' | 'poll' | 'container'

/**
 * Рендер времени с выбором режима на стороне бабла: форму (пилюля поверх медиа
 * либо угол контейнера) знает только сам бабл, а данные времени — вызывающий.
 */
export type RenderTime = (mode: TimeMode, corner?: TimeCorner, justMedia?: boolean) => ReactNode

// Эмодзи-глиф вида эффекта (наш аналог Telegram message effects).
const EFFECT_EMOJI: Record<EmojiEffectKind, string> = {
  fireworks: '🎆', confetti: '🎉', hearts: '❤️', thumbs: '👍', poop: '💩', cake: '🎂',
}

// Остаток TTL секретного сообщения в короткой форме: «5с» / «1м» / «1ч» / «1д» / «1нед».
function fmtTtlRemain(sec: number): string {
  if (sec < 60) return `${sec}с`
  if (sec < 3600) return `${Math.ceil(sec / 60)}м`
  if (sec < 86400) return `${Math.ceil(sec / 3600)}ч`
  if (sec < 604800) return `${Math.ceil(sec / 86400)}д`
  return `${Math.ceil(sec / 604800)}нед`
}

/**
 * Состояние таймера самоуничтожения секретного сообщения. Пока получатель не
 * прочитал — `destructAt` не задан: показываем «взведённый» глиф с исходным TTL.
 * После прочтения сервер ставит `destructAt` — тикаем обратный отсчёт. Расчёт
 * вынесен в хук, потому что содержимое времени рендерится дважды (распорка +
 * видимая копия) и второй интервал был бы лишним.
 */
function useSecretTtl(
  destructAt?: string | null,
  ttlSeconds?: number | null,
): { armed: true } | { armed: false; label: string } | null {
  const running = destructAt != null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])

  if (running) {
    const remainSec = Math.floor((Date.parse(destructAt) - now) / 1000)
    if (remainSec <= 0) return null // ноль — прячем (delete_message приедет следом)
    return { armed: false, label: fmtTtlRemain(remainSec) }
  }
  return ttlSeconds && ttlSeconds > 0 ? { armed: true } : null
}

export interface TimeProps {
  /** Время сообщения в исходном виде (форматирует useTimeFormatter). */
  time?: string
  /** Статус доставки — тик рисуется только у исходящих (tweb: у себя нет тиков). */
  status?: MsgStatus
  out?: boolean
  /** Сообщение отредактировано — префикс «изменено» (tweb makeEdited). */
  edited?: boolean
  /** Сообщение закреплено — глиф пина ПЕРЕД всем кластером (tweb messageRender.ts:301-303:
   * `args.unshift(Icon('pinnedchat_filled', …))` уже после unshift «изменено»). */
  pinned?: boolean
  /** Просмотры поста канала (tweb .post-views + иконка channelviews). */
  views?: number
  /** Пересылки поста канала (у tweb только в тултипе, у нас — видимый счётчик). */
  forwards?: number
  /** Эффект сообщения — кликабельный глиф повтора (tweb .time-effect). */
  effect?: EmojiEffectKind
  /** Секретное сообщение: таймер самоуничтожения перед временем. */
  destructAt?: string | null
  ttlSeconds?: number | null
  /** Полная дата — title видимой копии (tweb inner.title = getFullDate). */
  title?: string
  mode?: TimeMode
  corner?: TimeCorner
  /** just-media (стикер/большое эмодзи): пилюля вплотную к углу. */
  justMedia?: boolean
  className?: string
}

/**
 * Время + тик статуса. Ставится ВНУТРЬ позиционированного (`position: relative`)
 * контейнера бабла — видимая копия прибивается к его нижне-правому углу.
 */
export default function Time({
  time, status, out, edited, pinned, views, forwards, effect,
  destructAt, ttlSeconds, title, mode = 'inline', corner = 'default', justMedia, className,
}: TimeProps) {
  const fmtTime = useTimeFormatter()
  const t = useT()
  const ttl = useSecretTtl(destructAt, ttlSeconds)

  // Части в порядке tweb (messageRender.ts): тик статуса prepend-ом первым в DOM
  // (визуально уезжает в конец через order:5), затем пин, «изменено», просмотры,
  // пересылки, таймер секретки, эффект и последним — само время.
  const parts = (interactive: boolean): ReactNode => (
    <>
      {out && status && (
        <TgIcon
          name={status === 'sending' ? 'sending' : status === 'error' ? 'sendingerror' : status === 'read' ? 'checks' : 'check'}
          className={classNames('time-sending-status', s.status, status === 'error' ? s.statusError : '')}
          size="calc(var(--messages-text-size) + 3px)"
        />
      )}
      {pinned && <TgIcon name="pinnedchat_filled" className="time-icon time-pinned time-part" size="1.125rem" />}
      {edited && <span className={s.edited}>{t('edited')}</span>}
      {/* truthy как в tweb (messageRender.ts:273): views=0 приходит для не-канальных */}
      {views ? (
        <span className={classNames('post-views', s.views)}>
          {fmtViews(views)}
          <TgIcon name="channelviews" className="time-icon time-part time-icon-views" size="1.125rem" />
        </span>
      ) : null}
      {forwards ? (
        <span className={s.views}>
          {fmtViews(forwards)}
          <TgIcon name="forward" className="time-icon time-part time-icon-views" size="1.125rem" />
        </span>
      ) : null}
      {ttl?.armed ? (
        <TgIcon name="timer" className="time-icon time-part" size="1.125rem" />
      ) : ttl ? (
        <>
          <TgIcon name="fire" className="time-icon time-part" size="1.125rem" />
          {ttl.label}
        </>
      ) : null}
      {effect && (
        <button
          type="button"
          className={s.effectButton}
          tabIndex={interactive ? undefined : -1}
          onClick={interactive ? (e) => {
            e.stopPropagation()
            const r = (e.target as HTMLElement).getBoundingClientRect()
            playEmojiEffect(effect, { x: r.left + r.width / 2, y: r.top + r.height / 2 })
          } : undefined}
          aria-label="Replay message effect"
        >
          {EFFECT_EMOJI[effect]}
        </button>
      )}
      <span className="i18n">{fmtTime(time)}</span>
    </>
  )

  return (
    <span
      className={classNames(
        // базовые имена tweb — по ним работают правила портированных партиалов
        // (.bubble .time, .audio .time, .document .time и т.д.)
        'time',
        mode === 'floating' ? 'is-floating' : '',
        mode === 'block' ? 'is-block' : '',
        s.time,
        mode === 'block' ? s.block : '',
        mode === 'nofloat' ? s.noFloat : '',
        mode === 'floating' ? s.floating : '',
        mode === 'corner' && corner !== 'container' ? s.corner : '',
        mode === 'corner' && corner === 'audio' ? s.cornerAudio : '',
        mode === 'corner' && corner === 'poll' ? s.cornerPoll : '',
        mode === 'plain' ? s.plain : '',
        justMedia ? s.justMedia : '',
        out ? s.out : '',
        className ?? '',
      )}
    >
      {parts(false)}
      <span className={classNames('time-inner', s.inner)} title={title}>
        {parts(true)}
      </span>
    </span>
  )
}
