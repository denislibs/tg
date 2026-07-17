// TwoStepVerification — облачный пароль (tweb sidebarLeft/tabs/2fa): реальный
// флоу поверх GET/POST/DELETE /me/password. При включённом пароле раздел
// открывается через ввод текущего (tweb AppTwoStepVerificationEnterPasswordTab);
// далее — смена пароля, почта для восстановления, отключение.
import { useEffect, useState } from 'react'
import Text from '../../shared/ui/Text'
import Button from '../../shared/ui/Button'
import Input from '../../shared/ui/Input'
import TgIcon from '../TgIcon'
import IconButton from '../../shared/ui/IconButton'
import PasswordMonkey from '../PasswordMonkey'
import Popup from '../../shared/ui/Popup'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import type { PasswordState } from '../../core/managers/authManager'
import { SettingsScreen, Section, Row } from './kit'
import s from './TwoStepVerification.module.scss'

type Step = 'loading' | 'intro' | 'unlock' | 'main' | 'password' | 'confirm' | 'hint' | 'email' | 'done'

export default function TwoStepVerification({ onBack }: { onBack: () => void }) {
  const t = useT()
  const managers = useManagers()
  const [state, setState] = useState<PasswordState>({ enabled: false, hint: '', email: '' })
  const [step, setStep] = useState<Step>('loading')
  const [current, setCurrent] = useState('') // проверенный текущий пароль
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [hint, setHint] = useState('')
  const [email, setEmail] = useState('')
  const [emailOnly, setEmailOnly] = useState(false) // шаг email без смены пароля
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)

  useEffect(() => {
    let alive = true
    void managers.auth.passwordState().then((st) => {
      if (!alive) return
      setState(st)
      setStep(st.enabled ? 'unlock' : 'intro')
    }).catch(() => setStep('intro'))
    return () => { alive = false }
  }, [managers])

  const reload = async () => {
    const st = await managers.auth.passwordState().catch(() => null)
    if (st) setState(st)
    return st
  }

  const btn = (label: string, onClick: () => void, disabled = false) => (
    <div className={s.btnWrap}>
      <Button fullWidth disabled={disabled || busy} onClick={onClick}>{t(label)}</Button>
    </div>
  )

  const hero = (text: string) => (
    <div className={s.hero}>
      <div className={s.heroIcon}>
        <TgIcon name="lock" size={46} color="#fff" />
      </div>
      <Text size={15} color="var(--tg-textSecondary)" style={{ lineHeight: 1.5 }}>{t(text)}</Text>
    </div>
  )

  // Поле пароля с «глазком»: монки наверху подглядывает при показе (tweb).
  const monkeyField = (value: string, onChange: (v: string) => void, label: string, onEnter?: () => void) => (
    <>
      <PasswordMonkey peeking={showPw} size={140} />
      <div className={s.field} style={{ position: 'relative' }}>
        <Input
          autoFocus
          type={showPw ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          label={t(label)}
        />
        <div style={{ position: 'absolute', right: 10, top: 8 }}>
          <IconButton size="small" color="var(--tg-textFaint)" onClick={() => setShowPw((v) => !v)} aria-label="toggle password">
            <TgIcon name={showPw ? 'eye2' : 'eye1'} size={22} />
          </IconButton>
        </div>
      </div>
      {onEnter && <span style={{ display: 'none' }} />}
    </>
  )

  const fail = (msg: string) => { setError(t(msg)); setBusy(false) }

  // Отправка нового пароля/подсказки/почты (и первичная установка, и смена).
  const submit = async (recoveryEmail: string) => {
    setBusy(true); setError('')
    try {
      await managers.auth.setPassword({
        currentPassword: current,
        newPassword: emailOnly ? '' : pwd,
        hint: emailOnly ? state.hint : hint,
        email: recoveryEmail,
      })
      await reload()
      setStep('done')
    } catch {
      fail('Something went wrong. Try again.')
      return
    }
    setBusy(false)
  }

  if (step === 'loading') {
    return <SettingsScreen title="Two-Step Verification" onBack={onBack}><div /></SettingsScreen>
  }

  if (step === 'intro')
    return (
      <SettingsScreen title="Two-Step Verification" onBack={onBack}>
        {hero('You can set a password that will be required when you log in on a new device in addition to the code you get in the SMS.')}
        {btn('Set Password', () => { setPwd(''); setConfirm(''); setHint(''); setEmail(''); setEmailOnly(false); setStep('password') })}
      </SettingsScreen>
    )

  // Вход в настройки включённого пароля — сначала текущий пароль (tweb).
  if (step === 'unlock')
    return (
      <SettingsScreen title="Two-Step Verification" onBack={onBack}>
        {monkeyField(pwd, setPwd, state.hint ? `${t('Password')} (${state.hint})` : 'Please enter your current password')}
        {error && <Text size={13.5} color="#ff595a" className={s.err}>{error}</Text>}
        {btn('Next', () => {
          setBusy(true); setError('')
          managers.auth.verifyPassword(pwd)
            .then(() => { setCurrent(pwd); setPwd(''); setBusy(false); setStep('main') })
            .catch(() => fail('Invalid password'))
        }, !pwd)}
      </SettingsScreen>
    )

  if (step === 'main')
    return (
      <SettingsScreen title="Two-Step Verification" onBack={onBack}>
        {hero('You have enabled Two-Step Verification. You\'ll need the password you set up here when you log in to your Telegram account.')}
        <div style={{ marginTop: 16 }}>
          <Section>
            <Row icon={<TgIcon name="edit" size={24} />} label="Change Password" onClick={() => { setPwd(''); setConfirm(''); setHint(state.hint); setEmailOnly(false); setStep('password') }} />
            <Row
              icon={<TgIcon name="email" size={24} />}
              label={state.email ? 'Change Recovery Email' : 'Set Recovery Email'}
              sublabel={state.email || undefined}
              onClick={() => { setEmail(''); setEmailOnly(true); setStep('email') }}
            />
            <Row icon={<TgIcon name="passwordoff" size={24} />} label="Turn Password Off" danger onClick={() => setConfirmOff(true)} />
          </Section>
        </div>
        {/* tweb TurnPasswordOffQuestion popup */}
        <Popup
          open={confirmOff}
          title={t('Disable password')}
          onClose={() => setConfirmOff(false)}
          action={{
            label: t('Disable'),
            onClick: () => {
              setConfirmOff(false)
              setBusy(true)
              managers.auth.removePassword(current)
                .then(async () => { await reload(); setCurrent(''); setBusy(false); setStep('intro') })
                .catch(() => fail('Invalid password'))
            },
          }}
        >
          <Text size={15} color="var(--tg-textPrimary)" style={{ lineHeight: 1.5 }}>
            {t('Are you sure you want to disable your password?')}
          </Text>
        </Popup>
      </SettingsScreen>
    )

  if (step === 'password')
    return (
      <SettingsScreen title={state.enabled ? 'Change Password' : 'Set a Password'} onBack={() => setStep(state.enabled ? 'main' : 'intro')}>
        {monkeyField(pwd, setPwd, 'Enter a password')}
        {btn('Continue', () => { setError(''); setStep('confirm') }, !pwd)}
      </SettingsScreen>
    )

  if (step === 'confirm')
    return (
      <SettingsScreen title="Re-enter your password" onBack={() => setStep('password')}>
        {monkeyField(confirm, setConfirm, 'Re-enter your password')}
        {confirm && confirm !== pwd && (
          <Text size={13.5} color="#ff595a" className={s.err}>{t('Passwords don’t match.')}</Text>
        )}
        {btn('Continue', () => setStep('hint'), !confirm || confirm !== pwd)}
      </SettingsScreen>
    )

  if (step === 'hint')
    return (
      <SettingsScreen title="Password Hint" onBack={() => setStep('confirm')}>
        <div className={s.hero}>
          <Text size={44} style={{ lineHeight: 1 }}>💡</Text>
        </div>
        <Input autoFocus value={hint} onChange={setHint} label={t('Hint (optional)')} wrapClassName={s.field} />
        {hint && hint === pwd && (
          <Text size={13.5} color="#ff595a" className={s.err}>{t('Hint must be different from your password.')}</Text>
        )}
        {btn('Continue', () => { setError(''); setStep('email') }, hint === pwd && hint !== '')}
      </SettingsScreen>
    )

  if (step === 'email')
    return (
      <SettingsScreen title="Recovery Email" onBack={() => setStep(emailOnly ? 'main' : 'hint')}>
        <div className={s.hero}>
          <Text size={44} style={{ lineHeight: 1 }}>💌</Text>
          <Text size={15} color="var(--tg-textSecondary)" style={{ lineHeight: 1.5, marginTop: 8 }}>
            {t('Add a recovery email to restore access if you forget your password.')}
          </Text>
        </div>
        <Input autoFocus type="email" value={email} onChange={setEmail} label={t('Recovery email')} wrapClassName={s.field} />
        {error && <Text size={13.5} color="#ff595a" className={s.err}>{error}</Text>}
        {btn(emailOnly ? 'Save' : 'Continue', () => void submit(email.trim()), emailOnly && !email.trim())}
        {!emailOnly && (
          <div className={s.btnWrap} onClick={() => !busy && void submit('')} style={{ textAlign: 'center', cursor: 'pointer' }}>
            <Text size={15} weight={600} color="var(--tg-accent)">{t('Skip')}</Text>
          </div>
        )}
      </SettingsScreen>
    )

  // done — tweb TwoStepVerificationPasswordSet 🥳
  return (
    <SettingsScreen title="Two-Step Verification" onBack={onBack}>
      <div className={s.hero}>
        <Text size={44} style={{ lineHeight: 1 }}>🥳</Text>
        <Text size={17} weight={600} color="var(--tg-textPrimary)" style={{ marginTop: 12 }}>
          {t('Password Set!')}
        </Text>
        <Text size={15} color="var(--tg-textSecondary)" style={{ lineHeight: 1.5, marginTop: 8 }}>
          {t('This password will be required when you log in on a new device in addition to the code you get via SMS.')}
        </Text>
      </div>
      {btn('Return to Settings', () => { setCurrent(''); setStep(state.enabled ? 'unlock' : 'intro'); onBack() })}
    </SettingsScreen>
  )
}
