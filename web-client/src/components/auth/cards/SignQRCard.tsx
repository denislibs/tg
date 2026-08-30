// SignQRCard — вход по QR-коду (порт карточки tweb `pages/cards/SignQRCard.tsx`).
// Ротация токена и опрос подтверждения живут в карточке: она размонтируется на
// переходе, и таймеры снимаются вместе с ней (tweb делает то же в onCleanup).
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../../../i18n'
import { useManagers } from '../../../core/hooks/useManagers'
import { isWebAuthnSupported, getPasskeyAssertion } from '../../../core/webauthnBrowser'
import GrowHeightReveal from '../../../shared/ui/GrowHeightReveal'
import MediaHeader from '../MediaHeader'
import Preloader from '../Preloader'
import { SecondaryButton } from '../AuthButton'
import QrCode from '../QrCode'
import superFormatter from '../superFormatter'
import s from '../AuthFlow.module.scss'

export interface SignQRCardProps {
  /** «Log in by phone number» → карточка ввода номера */
  onSignIn: () => void
  /** QR подтверждён на телефоне, токен уже сохранён — вход завершён */
  onComplete: () => void
}

// tweb QR_SIZE = 240 — и контейнер, и матрица рисуются в 240 (× devicePixelRatio
// в атрибутах канвы: замер живого tweb — 480×480); до 208 CSS её ужимает
// `.qrCanvas{width/height:100%}` внутри контейнера с padding 16.
const QR_SIZE = 240

export default function SignQRCard({ onSignIn, onComplete }: SignQRCardProps) {
  const t = useT()
  const managers = useManagers()

  const [qrUrl, setQrUrl] = useState('')
  // Пока QR не нарисован, в `._sticker` крутится прелоадер (tweb putPreloader).
  const [painted, setPainted] = useState(false)
  const [preloaderVisible, setPreloaderVisible] = useState(true)
  const qrTokenRef = useRef('')

  useEffect(() => {
    let alive = true
    let rotate: ReturnType<typeof setInterval> | null = null
    let poll: ReturnType<typeof setInterval> | null = null

    const regen = async () => {
      try {
        const token = await managers.auth.qrNew('web')
        if (!alive) return
        qrTokenRef.current = token
        // URL для сканера строим от реального origin. С бэка он больше не едет
        // вовсе: там он выводился из Host-заголовков прокси и мог потерять порт
        // (за nginx → «http://localhost/qr/...»), поэтому ему и не доверяли.
        setQrUrl(`${location.origin}/qr/${token}`)
      } catch {
        /* следующая ротация повторит попытку — прелоадер остаётся на месте */
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

  const onPainted = useCallback(() => setPainted(true), [])

  // Вход по ключу доступа (WebAuthn discoverable credential) — tweb держит эту
  // кнопку на обеих стартовых карточках (signQR и signIn).
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const passkeyLogin = async () => {
    if (passkeyBusy) return
    setPasskeyBusy(true)
    try {
      const { session, options } = await managers.auth.passkeyLoginBegin()
      const assertion = await getPasskeyAssertion(options)
      await managers.auth.passkeyLoginFinish(session, assertion, 'web', 'browser')
      onComplete()
    } catch {
      setPasskeyBusy(false)
    }
  }

  return (
    <div className={`${s.card} ${s.pageSignQR}`}>
      <MediaHeader>
        {/* Подложка QR — тематическая (`--light-filled-primary-color`), radius 16;
            логотип вшит в саму матрицу, оверлея поверх QR в tweb нет. */}
        <MediaHeader.Sticker size={QR_SIZE} className={s.qrContainer}>
          {/* tweb: `putPreloader(stickerHost, true)` до первой отрисовки, затем
              прелоадер уезжает `hide-icon .4s forwards`, а канва въезжает
              `grow-icon .4s forwards`. */}
          {preloaderVisible && (
            <Preloader
              style={painted ? { animation: 'hide-icon .4s forwards' } : undefined}
              onAnimationEnd={() => setPreloaderVisible(false)}
            />
          )}
          {qrUrl && (
            <QrCode className={s.qrCanvas} data={qrUrl} size={QR_SIZE} onPainted={onPainted} />
          )}
        </MediaHeader.Sticker>
        <MediaHeader.Title>
          <span className="i18n">{t('Login.QR.Title')}</span>
        </MediaHeader.Title>
        <MediaHeader.Subtitle secondary>
          <span className="i18n">{t('Login.QR.Subtitle')}</span>
        </MediaHeader.Subtitle>
      </MediaHeader>

      <ol className={s.qrDescription}>
        {/* Вторая подсказка несёт разметку словаря: `**…**` → <b>, ' > ' →
            span.tgico.inline-icon (tweb Login.QR.Help2). */}
        {[
          'Open Telegram on your phone',
          'Go to **Settings** > **Devices** > **Add Device**',
          'Point your phone at this screen to confirm login',
        ].map((key, i) => (
          <li key={key} className={s.qrDescriptionItem}>
            <span className={s.qrDescriptionMarker}>{i + 1}</span>
            <span className="i18n">{superFormatter(t(key))}</span>
          </li>
        ))}
      </ol>

      <SecondaryButton arrow onClick={onSignIn}>
        {t('Login.ByPhone')}
      </SecondaryButton>
      {/* tweb: LanguageChangeButton в такой же GrowHeightReveal стоит между
          «войти по номеру» и passkey — у нас его нет (см. отчёт волны). */}
      <GrowHeightReveal when={isWebAuthnSupported()}>
        <SecondaryButton arrow disabled={passkeyBusy} onClick={() => void passkeyLogin()}>
          {t('Login.ByPasskey')}
        </SecondaryButton>
      </GrowHeightReveal>
    </div>
  )
}
