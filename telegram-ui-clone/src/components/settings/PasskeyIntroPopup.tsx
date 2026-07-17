// PasskeyIntroPopup — попап «Защита Вашего аккаунта» (tweb showPasskeyPopup →
// showFeatureDetailsPopup): rlottie-ключ, три ряда преимуществ и кнопки
// «Создать ключ доступа» / «Пропустить». Показывается по клику на ряд
// «Ключи доступа», пока ключей ещё нет.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import Text from '../../shared/ui/Text'
import LottieSticker from '../LottieSticker'
import classNames from '../../shared/lib/classNames'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { isWebAuthnSupported, createPasskey } from '../../core/webauthnBrowser'
import s from './PasskeyIntroPopup.module.scss'

// Ряды 1:1 из tweb popups/passkey.tsx (Passkey.Row1..Row3).
const ROWS = [
  { icon: 'key', title: 'Create a Passkey', subtitle: 'Make a passkey to log in easily and safely.' },
  { icon: 'faceid', title: 'Log in with Face ID', subtitle: 'Use Face ID, Touch ID, or your passcode to log in.' },
  { icon: 'lock', title: 'Store Passkey Securely', subtitle: 'Your passkey is safely kept in your iCloud Keychain.' },
] as const

export default function PasskeyIntroPopup({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const t = useT()
  const managers = useManagers()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const { session, options } = await managers.auth.passkeyRegisterBegin()
      const attestation = await createPasskey(options)
      await managers.auth.passkeyRegisterFinish(session, attestation)
      onCreated()
    } catch {
      setError(t('Could not create a passkey.'))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={s.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            className={s.dialog}
            initial={{ scale: 0.92, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <div className={s.close} onClick={onClose}>
              <TgIcon name="close" size={24} />
            </div>

            <div className={s.sticker}>
              <LottieSticker name="Key" size={120} />
            </div>
            <Text size={24} weight={700} color="var(--tg-textPrimary)" className={s.title}>
              {t('Protect your account')}
            </Text>
            <Text size={16} color="var(--tg-textPrimary)" className={s.subtitle}>
              {t('Log in safely and keep your account secure.')}
            </Text>

            {ROWS.map((r) => (
              <div key={r.icon} className={s.row}>
                <TgIcon name={r.icon} size={24} className={s.rowIcon} />
                <Text size={16} weight={600} color="var(--tg-textPrimary)">
                  {t(r.title)}
                </Text>
                <Text size={16} color="var(--tg-textSecondary)" style={{ marginTop: 1, lineHeight: 1.3125 }}>
                  {t(r.subtitle)}
                </Text>
              </div>
            ))}

            {error && (
              <Text size={14} color="#ff595a" className={s.error}>
                {error}
              </Text>
            )}

            <div className={s.footer}>
              {isWebAuthnSupported() ? (
                <>
                  <div className={classNames(s.button, busy ? s.disabled : '')} onClick={() => void create()}>
                    {t('Create Passkey')}
                  </div>
                  <div className={classNames(s.button, s.secondary)} onClick={onClose}>
                    {t('Skip')}
                  </div>
                </>
              ) : (
                <div className={classNames(s.button, s.secondary)} onClick={onClose}>
                  {t('Unsupported')}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
