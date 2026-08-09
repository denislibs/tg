// SignQRCard — вход по QR-коду (порт карточки tweb `pages/cards/SignQRCard.tsx`).
// Ротация токена и опрос подтверждения живут в карточке: она размонтируется на
// переходе, и таймеры снимаются вместе с ней (tweb делает то же в onCleanup).
import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../i18n'
import { useManagers } from '../../../core/hooks/useManagers'
import MediaHeader from '../MediaHeader'
import { SecondaryButton } from '../AuthButton'
import QrCode from '../QrCode'
import s from '../AuthFlow.module.scss'

export interface SignQRCardProps {
  /** «Log in by phone number» → карточка ввода номера */
  onSignIn: () => void
  /** QR подтверждён на телефоне, токен уже сохранён — вход завершён */
  onComplete: () => void
}

// tweb: контейнер 240×240 с padding 16 → рабочая матрица 208×208.
const QR_BOX = 240
const QR_SIZE = QR_BOX - 32

export default function SignQRCard({ onSignIn, onComplete }: SignQRCardProps) {
  const t = useT()
  const managers = useManagers()

  const [qrUrl, setQrUrl] = useState('')
  const [qrError, setQrError] = useState(false)
  const qrTokenRef = useRef('')

  useEffect(() => {
    let alive = true
    let rotate: ReturnType<typeof setInterval> | null = null
    let poll: ReturnType<typeof setInterval> | null = null

    const regen = async () => {
      try {
        const { token } = await managers.auth.qrNew('web')
        if (!alive) return
        qrTokenRef.current = token
        // URL для сканера строим от реального origin: `url` с бэка выводится из
        // Host-заголовков прокси и может потерять порт (за nginx →
        // «http://localhost/qr/...»), поэтому ему не доверяем.
        setQrUrl(`${location.origin}/qr/${token}`)
        setQrError(false)
      } catch {
        if (alive) setQrError(true)
      }
    }
    const tick = async () => {
      const token = qrTokenRef.current
      if (!token) return
      try {
        const r = await managers.auth.qrStatus(token)
        if (!alive) return
        if (r.status === 'confirmed') {
          cleanup()
          onComplete() // токен уже сохранён внутри qrStatus
        } else if (r.status === 'expired') {
          void regen() // крутим свежий код
        }
      } catch {
        /* транзиентная ошибка — продолжаем опрос */
      }
    }
    const cleanup = () => {
      alive = false
      if (rotate) clearInterval(rotate)
      if (poll) clearInterval(poll)
    }

    void regen()
    rotate = setInterval(() => void regen(), 30_000)
    poll = setInterval(() => void tick(), 2_000)
    return cleanup
  }, [managers, onComplete])

  const steps = [
    t('Open Telegram on your phone'),
    t('Go to Settings → Devices → Link Desktop Device'),
    t('Point your phone at this screen to confirm login'),
  ]

  return (
    <div className={`${s.card} ${s.pageSignQR}`}>
      <MediaHeader>
        {/* Подложка QR — тематическая (`--light-filled-primary-color`), radius 16;
            белой карточки и оверлея-логотипа, как было у нас, в tweb нет. */}
        <MediaHeader.Sticker size={QR_BOX} className={s.qrContainer}>
          {qrUrl && !qrError ? (
            <QrCode className={s.qrCanvas} data={qrUrl} size={QR_SIZE} />
          ) : (
            <span className="i18n secondary">{qrError ? t('QR недоступен') : t('Обновление…')}</span>
          )}
        </MediaHeader.Sticker>
        <MediaHeader.Title>
          <span className="i18n">{t('Log in by QR Code')}</span>
        </MediaHeader.Title>
        <MediaHeader.Subtitle secondary>
          <span className="i18n">{t('Scan with Telegram app on your phone')}</span>
        </MediaHeader.Subtitle>
      </MediaHeader>

      <ol className={s.qrDescription}>
        {steps.map((line, i) => (
          <li key={i} className={s.qrDescriptionItem}>
            <span className={s.qrDescriptionMarker}>{i + 1}</span>
            <span className="i18n">{line}</span>
          </li>
        ))}
      </ol>

      <SecondaryButton arrow onClick={onSignIn}>
        {t('Log in by phone Number')}
      </SecondaryButton>
    </div>
  )
}
