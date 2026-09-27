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
import { useLockStore } from '../stores/lockStore'
import { isMyPasscode, unlockWithPasscode } from '@lib/passcode/actions'
import { invokePasscode } from '../client/passcodeClient'
import s from './PasscodeLockScreen.module.scss'

const MAX_ATTEMPTS = 5 // tweb passcodeLockScreen.tsx MAX_ATTEMPTS
const ATTEMPTS_TIMEOUT_MS = 60_000 // tweb MAX_ATTEMPTS_TIMEOUT_SEC

export default function PasscodeLockScreen({ onUnlock }: { onUnlock: () => void }) {
  const t = useT()
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
    try {
      if (await isMyPasscode(value)) {
        await unlockWithPasscode(value)
        onUnlock()
      } else {
        failedAttempt(MAX_ATTEMPTS, ATTEMPTS_TIMEOUT_MS)
        setError(t('PasscodeLock.WrongPasscodeShort'))
        setValue('')
      }
    } catch {
      // tweb `catch{ store.isError = true }` (passcodeLockScreen.tsx:172-174)
      setError(t('PasscodeLock.WrongPasscodeShort'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={s.overlay}>
      <div className={s.card}>
        <PasswordMonkey peeking={show} size={140} />
        <Text size={20} weight={600} color="var(--primary-text-color)" style={{ textAlign: 'center', marginTop: 4 }}>
          {t('PasscodeLock.EnterYourPasscode')}
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
            placeholder={t('PasscodeLock.Title')}
          />
          <IconButton size="small" color="var(--secondary-text-color)" onClick={() => setShow((v) => !v)} aria-label="toggle passcode">
            <TgIcon name={show ? 'eye2_filled' : 'eye1_filled'} size={22} />
          </IconButton>
        </div>
        {waitLeft > 0 ? (
          <Text size={13.5} color="#ff595a" style={{ textAlign: 'center' }}>
            {t('PasscodeLock.TooManyAttempts')} ({waitLeft})
          </Text>
        ) : (
          error && <Text size={13.5} color="#ff595a" style={{ textAlign: 'center' }}>{error}</Text>
        )}
        <div className={s.btn}>
          <Button fullWidth uppercase disabled={!value || busy || waitLeft > 0} onClick={() => void proceed()}>
            {t('PasscodeLock.Proceed')}
          </Button>
        </div>
        <Text size={13.5} color="var(--secondary-text-color)" style={{ textAlign: 'center', lineHeight: 1.5 }}>
          {t('PasscodeLock.ForgotPasscode.Text')}{' '}
          <span className={s.logout} onClick={() => setLogoutOpen(true)}>{t('EditAccount.Logout')}</span>
        </Text>
      </div>

      <Popup
        open={logoutOpen}
        title={t('EditAccount.Logout')}
        onClose={() => setLogoutOpen(false)}
        action={{
          label: t('EditAccount.Logout'),
          onClick: () => {
            // tweb `invokeVoid('forceLogout')`: воркер стирает хранилища и сам
            // рассылает `reload` (client/passcodeClient.ts).
            invokePasscode({ method: 'forceLogout' }).catch(() => {})
          },
        }}
      >
        <Text size={15} color="var(--primary-text-color)" style={{ lineHeight: 1.5 }}>
          {t('PasscodeLock.Logout.Text')}
        </Text>
      </Popup>
    </div>
  )
}
