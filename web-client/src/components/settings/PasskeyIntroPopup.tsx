// PasskeyIntroPopup — попап «Защита Вашего аккаунта» (tweb showPasskeyPopup →
// showFeatureDetailsPopup): rlottie-ключ, три ряда преимуществ и кнопки
// «Создать ключ доступа» / «Пропустить». ВРЕМЕННО до 2C-10: открывается только
// мостом `showPasskeyPopup` (`sidebarLeft/settingsPopups.tsx`); регистрация —
// портированный `createPasskey` (`popups/passkey.ts`, тост успеха/ошибки там),
// при ошибке попап остаётся открытым, как tweb `popups/passkey.tsx:47-55`.
import { useState } from 'react'
import type { Passkey } from '@layer'
import { createPortal } from 'react-dom'
import TgIcon from '../TgIcon'
import Text from '../../shared/ui/Text'
import LottieSticker from '../LottieSticker'
import classNames from '../../shared/lib/classNames'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { isWebAuthnSupported } from '../../core/webauthnBrowser'
import { createPasskey } from '../popups/passkey'
import { usePopupTransition } from './kit'
import s from './PasskeyIntroPopup.module.scss'

// Ряды 1:1 из tweb popups/passkey.tsx (Passkey.Row1..Row3).
const ROWS = [
  { icon: 'key', title: 'Passkey.Row1.Title', subtitle: 'Passkey.Row1.Subtitle' },
  { icon: 'faceid', title: 'Passkey.Row2.Title', subtitle: 'Passkey.Row2.Subtitle' },
  { icon: 'lock', title: 'Passkey.Row3.Title', subtitle: 'Passkey.Row3.Subtitle' },
] as const

export default function PasskeyIntroPopup({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (passkey: Passkey) => void
}) {
  const t = useT()
  const managers = useManagers()
  const { mounted, cls } = usePopupTransition(open)
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (busy) return
    setBusy(true)
    try {
      onCreated(await createPasskey(managers))
    } catch {
      // тост об ошибке показал `createPasskey`; попап остаётся
    } finally {
      setBusy(false)
    }
  }

  if (!mounted) return null

  return createPortal(
    <div className={classNames('popup', cls, s.overlay)} onClick={onClose}>
      <div className={classNames('popup-container', s.dialog)} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <div className={s.close} onClick={onClose}>
          <TgIcon name="close" size={24} />
        </div>

        <div className={s.sticker}>
          {/* 'key' — реальное имя вендорного `LottieAssetName` (tweb
              `popups/passkey.tsx:39` — `sticker: {name: 'key', ...}`); Этап 0
              локальной карты `ASSETS` уже нет, имя больше не проходит через
              капитализированный алиас `Key`. */}
          <LottieSticker name="key" size={120} />
        </div>
        <Text size={24} weight={700} color="var(--primary-text-color)" className={s.title}>
          {t('Passkey.Title')}
        </Text>
        <Text size={16} color="var(--primary-text-color)" className={s.subtitle}>
          {t('Passkey.Subtitle')}
        </Text>

        {ROWS.map((r) => (
          <div key={r.icon} className={s.row}>
            <TgIcon name={r.icon} size={24} className={s.rowIcon} />
            <Text size={16} weight={600} color="var(--primary-text-color)">
              {t(r.title)}
            </Text>
            <Text size={16} color="var(--secondary-text-color)" style={{ marginTop: 1, lineHeight: 1.3125 }}>
              {t(r.subtitle)}
            </Text>
          </div>
        ))}

        <div className={s.footer}>
          {isWebAuthnSupported() ? (
            <>
              <div className={classNames(s.button, busy ? s.disabled : '')} onClick={() => void create()}>
                {t('Privacy.Passkey.Create')}
              </div>
              <div className={classNames(s.button, s.secondary)} onClick={onClose}>
                {t('YourEmailSkip')}
              </div>
            </>
          ) : (
            <div className={classNames(s.button, s.secondary)} onClick={onClose}>
              {t('Passkey.Unsupported')}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
