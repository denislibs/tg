// src/components/messages/SecretMediaBubble.tsx
// Медиа-бабл секретного чата (E2E). В отличие от RealMediaBubble сервер хранит
// ТОЛЬКО ciphertext, поэтому прямой src=mediaContentUrl(id) не годится: байты
// нужно скачать, расшифровать ключом файла (secretMedia.key/iv) и показать через
// blob-objectURL. Ключ+iv приезжают внутри зашифрованного payload сообщения.
//
// Отправитель уже держит plaintext локально (localUrl) — тогда fetch/decrypt не
// нужен, показываем локальное превью. objectURL освобождаем на размонтировании.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import Text from '../../shared/ui/Text'
import classNames from '../../shared/lib/classNames'
import TgIcon from '../TgIcon'
import { decryptMedia } from '../../core/secret/crypto'
import { mediaContentUrl, primeMediaToken } from '../../core/mediaUrl'
import type { SecretMedia } from '../../core/models'
import type { MsgStatus } from '../../data'
import s from './RealMediaBubble.module.scss'

// Экран медиа (tweb mediaSizes.regular) — тот же бокс, что у RealMediaBubble.
const BOX_W = 320
const BOX_H = 420

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`
  if (n >= 1024) return `${Math.max(1, Math.round(n / 1024))} КБ`
  return `${n} Б`
}

function Ticks({ status, color }: { status?: MsgStatus; color: string }) {
  if (!status) return null
  if (status === 'sending') return <TgIcon name="sending" size={16} color={color} />
  if (status === 'error') return <TgIcon name="sendingerror" size={16} color="#ff595a" />
  return <TgIcon name={status === 'read' ? 'checks' : 'check'} size={16} color={color} />
}

// Скачивает ciphertext авторизованным media-URL, расшифровывает и отдаёт objectURL.
// localUrl (у отправителя) — короткий путь без сети. Освобождает URL при cleanup.
function useSecretMediaUrl(sm: SecretMedia, localUrl?: string): { url?: string; error: boolean } {
  const [url, setUrl] = useState<string | undefined>(localUrl)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (localUrl) { setUrl(localUrl); return }
    let cancelled = false
    let objectUrl: string | null = null
    setError(false)
    setUrl(undefined)
    void (async () => {
      try {
        await primeMediaToken() // media-токен primed → синхронный URL с токеном
        const res = await fetch(mediaContentUrl(sm.mediaId))
        if (!res.ok) throw new Error(`secret media ${res.status}`)
        const cipher = await res.arrayBuffer()
        const buf = await decryptMedia(cipher, sm.keyB64, sm.ivB64)
        if (cancelled) return
        objectUrl = URL.createObjectURL(new Blob([buf], { type: sm.mime }))
        setUrl(objectUrl)
      } catch {
        if (!cancelled) setError(true)
      }
    })()
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [sm.mediaId, sm.keyB64, sm.ivB64, sm.mime, localUrl])
  return { url, error }
}

interface Props {
  secretMedia: SecretMedia
  out: boolean
  time?: string
  status?: MsgStatus
  tickColor: string
  /** локальное превью у отправителя (plaintext) — без fetch/decrypt */
  localUrl?: string
  radius?: string
}

export default function SecretMediaBubble({ secretMedia, out, time, status, tickColor, localUrl, radius }: Props) {
  const { url, error } = useSecretMediaUrl(secretMedia, localUrl)
  const kind = secretMedia.mediaType
  const isImage = kind === 'photo' || (kind !== 'document' && secretMedia.mime.startsWith('image/'))
  const isVideo = kind === 'video' || (kind !== 'document' && secretMedia.mime.startsWith('video/'))

  const timeCluster: ReactNode = time ? (
    <div className={s.timeCluster}>
      <Text size={12} color={out ? tickColor : 'var(--tg-textFaint)'} style={{ fontVariantNumeric: 'tabular-nums' }}>{time}</Text>
      {out && <Ticks status={status} color={tickColor} />}
    </div>
  ) : null

  // ---- Фото / видео ----
  // secretMedia не несёт размеров (их нет в payload), поэтому изображение рисуем
  // в потоке (не absolute, как .img в RealMediaBubble): контейнер растёт под
  // натуральный размер, ограниченный боксом. Пока грузим/дешифруем — плейсхолдер.
  if (isImage || isVideo) {
    const mediaStyle: React.CSSProperties = { display: 'block', maxWidth: '100%', maxHeight: BOX_H, width: 'auto', height: 'auto', borderRadius: radius }
    return (
      <div className={s.media} style={{ maxWidth: BOX_W, borderRadius: radius }}>
        {!url && (
          <div style={{ position: 'relative', width: 240, height: 180 }}>
            {!error
              ? <div className={s.shimmerWrap}><div className={s.shimmer} /></div>
              : <div className={s.play}><div className={s.playDisc}><TgIcon name="info" size={28} color="#fff" /></div></div>}
          </div>
        )}
        {url && isImage && (
          <img src={url} alt="" decoding="async" style={mediaStyle} />
        )}
        {url && isVideo && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={url} controls playsInline style={mediaStyle} />
        )}
        {time && (
          <div className={s.timeBadge}>
            <Text size={12} color="#fff" style={{ fontVariantNumeric: 'tabular-nums' }}>{time}</Text>
            {out && <Ticks status={status} color="#fff" />}
          </div>
        )}
      </div>
    )
  }

  // ---- Документ / файл ----
  const name = secretMedia.name || `media-${secretMedia.mediaId}`
  const rawExt = name.includes('.') ? (name.split('.').pop() || '').split(' ')[0].toLowerCase() : ''
  const ext = (rawExt || 'file').slice(0, 6)
  const sub = secretMedia.size ? fmtSize(secretMedia.size) : ''
  return (
    <a
      className={classNames(s.fileRow, s.doc, s.docRow)}
      href={error ? undefined : url}
      download={name}
      data-out={out || undefined}
      style={{ '--doc-color': DOC_EXT_COLORS[ext] ?? 'var(--tg-accent)' } as React.CSSProperties}
    >
      <div className={s.docIco}>
        <span className={s.docExt}>{ext}</span>
        <span className={s.docDl}>
          <TgIcon name={url ? 'download' : 'sending'} size={26} color="#fff" />
        </span>
      </div>
      <div className={s.fileBody}>
        <Text noWrap size={16} weight={700} color="var(--m-primary)">{name}</Text>
        <div className={s.fileSub}>
          <Text size={14} color="var(--m-secondary)">{error ? 'ошибка расшифровки' : sub}</Text>
          {timeCluster}
        </div>
      </div>
    </a>
  )
}

// Цвета расширений (tweb _document.scss .ext-*) — как в RealMediaBubble.
const DOC_EXT_COLORS: Record<string, string> = {
  pdf: '#DF3F40',
  zip: '#FB8C00',
  apk: '#43A047',
}
