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
import { commandThenReload } from '../core/accountTransition'
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
      setError(t('PasscodeLock.WrongPasscodeShort'))
      setValue('')
    }
    setBusy(false)
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
            <TgIcon name={show ? 'eye2' : 'eye1'} size={22} />
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
            // Четвёртый инициатор перехода — и единственный, кому кадр
            // rt:logging_out не поможет: под локом насос `smp.on`
            // (`realtimeBridge.startRealtime`) не зарегистрирован, он гейтится
            // `runWhenUnlocked`, так что событие сюда не долетает по
            // построению. Перезагрузку делаем сами, при любом исходе команды
            // (см. докблок commandThenReload): при отказе `.then` не
            // исполнялся и пользователь оставался запертым на экране пасскода.
            void commandThenReload(managers.auth.logout())
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
