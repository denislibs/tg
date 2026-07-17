// PasscodeLockScreen — полноэкранная блокировка код-паролем (tweb
// components/passcodeLock/passcodeLockScreen): монки, поле «Введите код-пароль»,
// «Продолжить», 5 попыток → 60 секунд ожидания, внизу — «забыли код-пароль →
// выйти» с подтверждением.
import { useEffect, useState } from 'react'
import Text from '../shared/ui/Text'
import Button from '../shared/ui/Button'
import IconButton from '../shared/ui/IconButton'
import TgIcon from './TgIcon'
import PasswordMonkey from './PasswordMonkey'
import Popup from '../shared/ui/Popup'
import { useT } from '../i18n'
import { useManagers } from '../core/hooks/useManagers'
import { useLockStore } from '../stores/lockStore'
import { isMyPasscode, MAX_ATTEMPTS, ATTEMPTS_TIMEOUT_MS } from '../core/passcode'
import s from './PasscodeLockScreen.module.scss'

export default function PasscodeLockScreen() {
  const t = useT()
  const managers = useManagers()
  const unlock = useLockStore((st) => st.unlock)
  const failedAttempt = useLockStore((st) => st.failedAttempt)
  const retryAt = useLockStore((st) => st.retryAt)
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [, forceTick] = useState(0)

  // тикаем раз в секунду, пока идёт таймаут попыток
  const waitLeft = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))
  useEffect(() => {
    if (!waitLeft) return
    const id = setInterval(() => forceTick((x) => x + 1), 1000)
    return () => clearInterval(id)
  }, [waitLeft])

  const proceed = async () => {
    if (busy || !value || waitLeft > 0) return
    setBusy(true)
    if (await isMyPasscode(value)) {
      unlock()
    } else {
      failedAttempt(MAX_ATTEMPTS, ATTEMPTS_TIMEOUT_MS)
      setError(t('Wrong passcode'))
      setValue('')
    }
    setBusy(false)
  }

  return (
    <div className={s.overlay}>
      <div className={s.card}>
        <PasswordMonkey peeking={show} size={140} />
        <Text size={20} weight={600} color="var(--tg-textPrimary)" style={{ textAlign: 'center', marginTop: 4 }}>
          {t('Enter your passcode')}
        </Text>
        <div className={s.field}>
          <input
            autoFocus
            className={s.input}
            type={show ? 'text' : 'password'}
            value={value}
            disabled={waitLeft > 0}
            onChange={(e) => { setValue(e.target.value); setError('') }}
            onKeyDown={(e) => { if (e.key === 'Enter') void proceed() }}
            placeholder={t('Passcode')}
          />
          <IconButton size="small" color="var(--tg-textFaint)" onClick={() => setShow((v) => !v)} aria-label="toggle passcode">
            <TgIcon name={show ? 'eye2' : 'eye1'} size={22} />
          </IconButton>
        </div>
        {waitLeft > 0 ? (
          <Text size={13.5} color="#ff595a" style={{ textAlign: 'center' }}>
            {t('Too many attempts, please try again later')} ({waitLeft})
          </Text>
        ) : (
          error && <Text size={13.5} color="#ff595a" style={{ textAlign: 'center' }}>{error}</Text>
        )}
        <div className={s.btn}>
          <Button fullWidth uppercase disabled={!value || busy || waitLeft > 0} onClick={() => void proceed()}>
            {t('Proceed')}
          </Button>
        </div>
        <Text size={13.5} color="var(--tg-textSecondary)" style={{ textAlign: 'center', lineHeight: 1.5 }}>
          {t('If you forgot your passcode, you need to log out and log in again.')}{' '}
          <span className={s.logout} onClick={() => setLogoutOpen(true)}>{t('Log Out')}</span>
        </Text>
      </div>

      <Popup
        open={logoutOpen}
        title={t('Log Out')}
        onClose={() => setLogoutOpen(false)}
        action={{
          label: t('Log Out'),
          onClick: () => {
            void managers.auth.logout().then(() => location.reload())
          },
        }}
      >
        <Text size={15} color="var(--tg-textPrimary)" style={{ lineHeight: 1.5 }}>
          {t('Are you sure you want to log out? You will need to sign in again.')}
        </Text>
      </Popup>
    </div>
  )
}
