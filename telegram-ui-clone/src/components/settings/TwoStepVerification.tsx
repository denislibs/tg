import { useState } from 'react'
import TgIcon from '../TgIcon'
import Text from '../../shared/ui/Text'
import Button from '../../shared/ui/Button'
import Input from '../../shared/ui/Input'
import { useT } from '../../i18n'
import { SettingsScreen, Section, Row } from './kit'
import s from './TwoStepVerification.module.scss'

type Step = 'intro' | 'password' | 'confirm' | 'hint' | 'email' | 'enabled'

export default function TwoStepVerification({ onBack }: { onBack: () => void }) {
  const t = useT()
  const [step, setStep] = useState<Step>('intro')
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')

  const btn = (label: string, onClick: () => void, disabled = false) => (
    <div className={s.btnWrap}>
      <Button fullWidth disabled={disabled} onClick={onClick}>{t(label)}</Button>
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

  const passField = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <Input
      autoFocus
      type="password"
      value={value}
      onChange={onChange}
      label={t(placeholder)}
      wrapClassName={s.field}
    />
  )

  if (step === 'intro')
    return (
      <SettingsScreen title="Two-Step Verification" onBack={onBack}>
        {hero('Set an additional password that will be required when you log in on a new device.')}
        {btn('Set Password', () => setStep('password'))}
      </SettingsScreen>
    )

  if (step === 'password')
    return (
      <SettingsScreen title="Set a Password" onBack={() => setStep('intro')}>
        {hero('Create a password to protect your account.')}
        {passField(pwd, setPwd, 'Enter a password')}
        {btn('Next', () => setStep('confirm'), !pwd)}
      </SettingsScreen>
    )

  if (step === 'confirm')
    return (
      <SettingsScreen title="Re-enter Password" onBack={() => setStep('password')}>
        {hero('Please confirm your password.')}
        {passField(confirm, setConfirm, 'Re-enter your password')}
        {confirm && confirm !== pwd && (
          <Text size={13.5} color="#ff595a" style={{ paddingLeft: '24px', paddingRight: '24px', paddingTop: '8px' }}>
            {t('Passwords don’t match.')}
          </Text>
        )}
        {btn('Next', () => setStep('hint'), !confirm || confirm !== pwd)}
      </SettingsScreen>
    )

  if (step === 'hint')
    return (
      <SettingsScreen title="Password Hint" onBack={() => setStep('confirm')}>
        {hero('You can create an optional hint for your password.')}
        {passField('', () => {}, 'Hint (optional)')}
        {btn('Next', () => setStep('email'))}
      </SettingsScreen>
    )

  if (step === 'email')
    return (
      <SettingsScreen title="Recovery Email" onBack={() => setStep('hint')}>
        {hero('Add a recovery email to restore access if you forget your password.')}
        {passField('', () => {}, 'Recovery email (optional)')}
        {btn('Set Password', () => setStep('enabled'))}
      </SettingsScreen>
    )

  // enabled
  return (
    <SettingsScreen title="Two-Step Verification" onBack={onBack}>
      {hero('Your account is protected with a Two-Step Verification password.')}
      <div style={{ marginTop: 16 }}>
        <Section>
          <Row label="Change Password" accent onClick={() => setStep('password')} />
          <Row label="Set Recovery Email" accent onClick={() => setStep('email')} />
          <Row label="Turn Password Off" danger onClick={() => { setPwd(''); setConfirm(''); setStep('intro') }} />
        </Section>
      </div>
    </SettingsScreen>
  )
}
