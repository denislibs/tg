// PasscodeLock — настройки код-пароля (tweb passcodeLock/mainTab):
// UtyanPasscode; не включён — описание + «Включить код-пароль» (два шага
// ввода); включён — «Отключить», «Изменить код-пароль», автоблокировка.
import { useState } from 'react'
import LottieSticker from '../LottieSticker'
import TgIcon from '../TgIcon'
import Text from '../../shared/ui/Text'
import Button from '../../shared/ui/Button'
import IconButton from '../../shared/ui/IconButton'
import Input from '../../shared/ui/Input'
import Popup from '../../shared/ui/Popup'
import { useT } from '../../i18n'
import { useSettingsStore } from '../../settings'
import { enablePasscode, disablePasscode, isMyPasscode, MAX_PASSCODE_LENGTH } from '../../core/passcode'
import { useManagers } from '../../core/hooks/useManagers'
import { useLockStore } from '../../stores/lockStore'
import { SettingsScreen, Section, Row } from './kit'
import s from './TwoStepVerification.module.scss'

type Step = 'main' | 'enter' | 'reenter'

// tweb PasscodeLock.AutoLock: Disabled / 1 / 5 / 10 / 15 / 30 минут.
const AUTO_LOCK_OPTIONS = [0, 1, 5, 10, 15, 30]

export default function PasscodeLock({ onBack }: { onBack: () => void }) {
  const t = useT()
  const managers = useManagers()
  const enabled = useSettingsStore((st) => st.passcodeEnabled)
  const autoLock = useSettingsStore((st) => st.passcodeAutoLockMins)
  const update = useSettingsStore((st) => st.update)
  const [step, setStep] = useState<Step>('main')
  const [changing, setChanging] = useState(false) // смена (нужен текущий код)
  const [current, setCurrent] = useState('')
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [offOpen, setOffOpen] = useState(false)
  const [hintText, setHintText] = useState('')

  const reset = () => { setCurrent(''); setFirst(''); setSecond(''); setError(''); setShow(false) }

  const startEnable = () => { reset(); setChanging(false); setStep('enter') }
  const startChange = () => { reset(); setChanging(true); setStep('enter') }

  const confirm = async () => {
    if (second !== first) {
      setError(t('PasscodeLock.PasscodesDontMatch'))
      return
    }
    if (changing && !(await isMyPasscode(current))) {
      setError(t('PasscodeLock.WrongPasscodeShort'))
      setStep('enter')
      return
    }
    await enablePasscode(first, managers.persist)
    setHintText(t(changing ? 'Your passcode has been changed.' : 'Passcode has been set.'))
    reset()
    setStep('main')
  }

  const passField = (value: string, onChange: (v: string) => void, label: string, onEnter: () => void) => (
    <div className={s.field} style={{ position: 'relative' }}>
      <Input
        autoFocus
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(v) => { if (v.length <= MAX_PASSCODE_LENGTH) { onChange(v); setError('') } }}
        label={t(label)}
        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') onEnter() }}
      />
      <div style={{ position: 'absolute', right: 10, top: 8 }}>
        <IconButton size="small" color="var(--secondary-text-color)" onClick={() => setShow((v) => !v)} aria-label="toggle passcode">
          <TgIcon name={show ? 'eye2' : 'eye1'} size={22} />
        </IconButton>
      </div>
    </div>
  )

  if (step === 'enter')
    return (
      <SettingsScreen title="Passcode" onBack={() => setStep('main')}>
        <LottieSticker name="UtyanPasscode" size={120} />
        {changing && passField(current, setCurrent, 'Enter your passcode', () => {})}
        {passField(first, setFirst, changing ? 'Enter a new passcode' : 'Enter a passcode', () => first && setStep('reenter'))}
        {error && <Text size={13.5} color="#ff595a" className={s.err}>{error}</Text>}
        <div className={s.btnWrap}>
          <Button fullWidth disabled={!first || (changing && !current)} onClick={() => setStep('reenter')}>{t('Login.Next')}</Button>
        </div>
      </SettingsScreen>
    )

  if (step === 'reenter')
    return (
      <SettingsScreen title="Passcode" onBack={() => setStep('enter')}>
        <LottieSticker name="UtyanPasscode" size={120} />
        {passField(second, setSecond, 'Re-enter your passcode', () => void confirm())}
        {error && <Text size={13.5} color="#ff595a" className={s.err}>{error}</Text>}
        <div className={s.btnWrap}>
          <Button fullWidth disabled={!second} onClick={() => void confirm()}>
            {t(changing ? 'Change Passcode' : 'Set Passcode')}
          </Button>
        </div>
      </SettingsScreen>
    )

  return (
    <SettingsScreen title="Passcode" onBack={onBack}>
      <LottieSticker name="UtyanPasscode" size={120} />
      {!enabled ? (
        <>
          <div className={s.hero}>
            <Text size={15} color="var(--secondary-text-color)" style={{ lineHeight: 1.5 }}>
              {t('PasscodeLock.Description')}
            </Text>
          </div>
          <div className={s.btnWrap}>
            <Button fullWidth uppercase onClick={startEnable}>{t('PasscodeLock.TurnOn')}</Button>
          </div>
          <Text size={13.5} color="var(--secondary-text-color)" style={{ padding: '0 24px', lineHeight: 1.5 }}>
            {t('PasscodeLock.ForgotNotice')}
          </Text>
        </>
      ) : (
        <>
          {hintText && (
            <Text size={14} color="var(--primary-color)" style={{ textAlign: 'center', paddingBottom: 8 }}>{hintText}</Text>
          )}
          <Section
            footer="Note: if you forget your passcode, you'll need to log out and log in again."
          >
            <Row icon={<TgIcon name="lockoff" size={24} />} label="Turn Passcode Off" danger onClick={() => setOffOpen(true)} />
            <Row icon={<TgIcon name="key" size={24} />} label="Change Passcode" onClick={startChange} />
          </Section>
          <Section
            caption="Auto-lock"
            footer="Automatically lock the app if you are away for some time."
          >
            {AUTO_LOCK_OPTIONS.map((mins) => (
              <Row
                key={mins}
                label={mins === 0 ? 'Disabled' : `${mins} ${t('Unit.Minutes.Abbr')}`}
                translate={mins === 0}
                selected={autoLock === mins}
                onClick={() => update({ passcodeAutoLockMins: mins })}
              />
            ))}
          </Section>
        </>
      )}

      <Popup
        open={offOpen}
        title={t('PasscodeLock.TurnOff.Title')}
        onClose={() => setOffOpen(false)}
        action={{
          label: t('PasscodeLock.TurnOff'),
          onClick: () => {
            setOffOpen(false)
            void disablePasscode().then(() => {
              useLockStore.getState().unlock()
              setHintText(t('PasscodeLock.PasscodeHasBeenDisabled'))
            })
          },
        }}
      >
        <Text size={15} color="var(--primary-text-color)" style={{ lineHeight: 1.5 }}>
          {t('PasscodeLock.TurnOff.Description')}
        </Text>
      </Popup>
    </SettingsScreen>
  )
}
