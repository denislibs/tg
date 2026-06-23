import { useState } from 'react'
import { Box, InputBase, Typography, useTheme } from '@mui/material'
import LockOutlined from '@mui/icons-material/LockOutlined'
import { useT } from '../../i18n'
import { SettingsScreen, Section, Row, useCardBg } from './kit'

type Step = 'intro' | 'password' | 'confirm' | 'hint' | 'email' | 'enabled'

export default function TwoStepVerification({ onBack }: { onBack: () => void }) {
  const tg = useTheme().tg
  const t = useT()
  const cardBg = useCardBg()
  const [step, setStep] = useState<Step>('intro')
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')

  const btn = (label: string, onClick: () => void, disabled = false) => (
    <Box
      onClick={disabled ? undefined : onClick}
      sx={{
        mx: 2.5,
        mt: 3,
        height: 50,
        borderRadius: '12px',
        background: tg.accent,
        color: '#fff',
        fontSize: 15,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {t(label)}
    </Box>
  )

  const hero = (text: string) => (
    <Box sx={{ textAlign: 'center', px: 4, pt: 3 }}>
      <Box
        sx={{
          width: 96,
          height: 96,
          borderRadius: '50%',
          background: tg.accentGradient,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mx: 'auto',
          mb: 2,
        }}
      >
        <LockOutlined sx={{ fontSize: 46, color: '#fff' }} />
      </Box>
      <Typography sx={{ fontSize: 15, color: tg.textSecondary, lineHeight: 1.5 }}>{t(text)}</Typography>
    </Box>
  )

  const passField = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <Box sx={{ mx: 1.25, mt: 2, borderRadius: '16px', background: cardBg }}>
      <Box sx={{ px: 2, py: 1.25, mx: 0.5 }}>
        <InputBase
          autoFocus
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t(placeholder)}
          sx={{ width: '100%', fontSize: 16, color: tg.textPrimary, '& input::placeholder': { color: tg.textFaint, opacity: 1 } }}
        />
      </Box>
    </Box>
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
          <Typography sx={{ px: 3, pt: 1, fontSize: 13.5, color: '#ff595a' }}>
            {t('Passwords don’t match.')}
          </Typography>
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
      <Box sx={{ mt: 2 }}>
        <Section>
          <Row label="Change Password" accent onClick={() => setStep('password')} />
          <Row label="Set Recovery Email" accent onClick={() => setStep('email')} />
          <Row label="Turn Password Off" danger onClick={() => { setPwd(''); setConfirm(''); setStep('intro') }} />
        </Section>
      </Box>
    </SettingsScreen>
  )
}
