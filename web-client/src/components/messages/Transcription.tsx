// Транскрибация голосового/видео-кружка (Telegram transcribeAudio, tweb audio.ts
// ~185-236). Реального движка speech-to-text у нас нет — бэк возвращает
// детерминированный стаб; UI (кнопка, обводка-анимация загрузки, разворачиваемый
// блок текста) — 1:1 по tweb.
import { useCallback, useState } from 'react'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import classNames from '../../shared/lib/classNames'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import s from './Transcription.module.scss'

// useTranscription — состояние расшифровки одного сообщения: развёрнут ли блок,
// идёт ли загрузка, готовый текст (из кэша сообщения или полученный по клику).
export function useTranscription(chatId: number | undefined, msgId: number | undefined, transcription: string | undefined) {
  const managers = useManagers()
  const [expanded, setExpanded] = useState(false)
  const [pending, setPending] = useState(false)
  const [fetched, setFetched] = useState<string | null>(null)
  // Кэш сообщения (после reload/патча) приоритетнее локально полученного.
  const text = transcription ?? fetched ?? null
  // Доступно только для реального (не оптимистичного) сообщения.
  const available = chatId != null && msgId != null && msgId > 0

  const toggle = useCallback(() => {
    if (!available || pending) return
    if (text != null) {
      setExpanded((e) => !e) // уже есть текст — просто свернуть/развернуть
      return
    }
    setPending(true)
    managers.messages
      .transcribe(chatId!, msgId!)
      .then((r) => {
        setFetched(r.text)
        setExpanded(true)
      })
      .catch(() => {})
      .finally(() => setPending(false))
  }, [available, pending, text, managers, chatId, msgId])

  return { available, expanded, pending, text, toggle }
}

// TranscribeButton — кнопка «расшифровать» (иконка transcribe/up справа) с
// SVG-обводкой, анимирующейся во время загрузки (tweb .audio-to-text-button).
export function TranscribeButton({
  expanded,
  pending,
  onClick,
  className,
  color,
}: {
  expanded: boolean
  pending: boolean
  onClick: () => void
  className?: string
  color?: string
}) {
  const t = useT()
  return (
    <div
      className={classNames(s.button, className ?? '')}
      role="button"
      aria-label={expanded ? t('Hide Transcription') : t('Transcribe Voice Message')}
      title={expanded ? t('Hide Transcription') : t('Transcribe Voice Message')}
      style={color ? { color } : undefined}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <TgIcon name={expanded ? 'up' : 'transcribe'} size={19} />
      {pending && (
        <span className={s.loader}>
          <svg className={s.outline} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 24">
            <rect
              className={s.outlineRect}
              fill="transparent"
              strokeWidth={3}
              strokeLinejoin="round"
              rx={6}
              ry={6}
              stroke="currentColor"
              width={32}
              height={24}
            />
          </svg>
        </span>
      )}
    </div>
  )
}

// TranscribedText — блок расшифрованного текста под баблом (tweb
// .audio-transcribed-text). Текст — обычной React-нодой, не raw HTML.
export function TranscribedText({ text, color }: { text: string; color?: string }) {
  return (
    <div className={s.text}>
      <Text size={14.5} color={color} style={{ lineHeight: 1.35, whiteSpace: 'pre-wrap' }}>
        {text}
      </Text>
    </div>
  )
}
