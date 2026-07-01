import { useState } from 'react'
import { Box, useTheme } from '@mui/material'
import TgIcon from '../TgIcon'
import Text from '../../shared/ui/Text'
import type { ReactNode } from 'react'
import { useT } from '../../i18n'
import { SettingsScreen, Section, Row } from './kit'

interface Sess {
  id: string
  icon: ReactNode
  app: string
  device: string
  loc: string
  last: string
}

const OTHERS: Sess[] = [
  { id: 's1', icon: <TgIcon name="devices" size={26} />, app: 'Telegram iOS 10.2', device: 'iPhone 15 Pro', loc: 'Almaty, Kazakhstan', last: '2 hours ago' },
  { id: 's2', icon: <TgIcon name="devices" size={26} />, app: 'Telegram Desktop', device: 'Windows 11', loc: 'Astana, Kazakhstan', last: 'Jun 18' },
  { id: 's3', icon: <TgIcon name="devices" size={26} />, app: 'Telegram Android', device: 'Pixel 8', loc: 'Almaty, Kazakhstan', last: 'Jun 12' },
]

export default function ActiveSessions({ onBack }: { onBack: () => void }) {
  const tg = useTheme().tg
  const t = useT()
  const [others, setOthers] = useState(OTHERS)

  const sessionRow = (s: Sess, current?: boolean) => (
    <Box key={s.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, px: 2, py: 1.15, mx: 0.5 }}>
      <Box sx={{ color: tg.accent, display: 'flex', mt: 0.25, '& svg': { fontSize: 26 } }}>{s.icon}</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Text size={16} color={tg.textPrimary} style={{ flex: 1 }}>{s.app}</Text>
          {current ? (
            <Text size={13.5} color="#4dcd5e">{t('online')}</Text>
          ) : (
            <TgIcon
              name="close"
              size={20}
              color={tg.textFaint}
              onClick={() => setOthers((o) => o.filter((x) => x.id !== s.id))}
              style={{ cursor: 'pointer' }}
            />
          )}
        </Box>
        <Text size={14} color={tg.textSecondary}>{s.device}</Text>
        <Text size={13.5} color={tg.textFaint}>
          {s.loc} · {current ? t('online') : s.last}
        </Text>
      </Box>
    </Box>
  )

  return (
    <SettingsScreen title="Active Sessions" onBack={onBack}>
      <Section caption="This device">
        {sessionRow(
          { id: 'cur', icon: <TgIcon name="devices" size={26} />, app: 'Telegram Web', device: 'Chrome · macOS', loc: 'Almaty, Kazakhstan', last: '' },
          true,
        )}
      </Section>

      {others.length > 0 && (
        <Box sx={{ mx: 1.25, mb: 1.5 }}>
          <Row
            label="Terminate All Other Sessions"
            danger
            onClick={() => setOthers([])}
          />
        </Box>
      )}

      {others.length > 0 ? (
        <Section caption="Active sessions">{others.map((s) => sessionRow(s))}</Section>
      ) : (
        <Text size={14} color={tg.textSecondary} style={{ paddingLeft: '24px', paddingRight: '24px' }}>
          {t('No other active sessions.')}
        </Text>
      )}
    </SettingsScreen>
  )
}
