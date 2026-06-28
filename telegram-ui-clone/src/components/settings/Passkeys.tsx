import { useState } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import TgIcon from '../TgIcon'
import { SettingsScreen, Section, Row, useCardBg } from './kit'

interface Key {
  id: string
  name: string
  added: string
}

const INITIAL: Key[] = [
  { id: 'k1', name: 'iCloud Keychain', added: 'Added Jun 10' },
  { id: 'k2', name: 'YubiKey 5C', added: 'Added May 2' },
]

export default function Passkeys({ onBack }: { onBack: () => void }) {
  const tg = useTheme().tg
  const cardBg = useCardBg()
  const [keys, setKeys] = useState(INITIAL)

  return (
    <SettingsScreen title="Passkeys & Login Email" onBack={onBack}>
      <Section caption="Passkeys" footer="Passkeys let you sign in without a password using your device.">
        <Row icon={<TgIcon name="add" size={24} />} label="Add a Passkey" accent onClick={() => {}} />
      </Section>

      {keys.length > 0 && (
        <Box sx={{ mx: 1.25, mb: 1.5, borderRadius: '16px', background: cardBg, py: 0.5 }}>
          {keys.map((k) => (
            <Box key={k.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1, mx: 0.5 }}>
              <TgIcon name="key" size={24} color={tg.accent} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: 16, color: tg.textPrimary }}>{k.name}</Typography>
                <Typography noWrap sx={{ fontSize: 13.5, color: tg.textSecondary }}>{k.added}</Typography>
              </Box>
              <TgIcon
                name="close"
                size={20}
                color={tg.textFaint}
                onClick={() => setKeys((l) => l.filter((x) => x.id !== k.id))}
                style={{ cursor: 'pointer' }}
              />
            </Box>
          ))}
        </Box>
      )}

      <Section caption="Login Email" footer="This email is used to log in if you lose access to your number.">
        <Row label="Email" value="d•••@documentolog.com" onClick={() => {}} />
        <Row label="Change Login Email" accent onClick={() => {}} />
      </Section>
    </SettingsScreen>
  )
}
