import { useState } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import TgIcon from '../TgIcon'
import Avatar from '../../shared/ui/Avatar'
import { useT } from '../../i18n'
import { SettingsScreen, Section, Row, useCardBg } from './kit'

interface Blocked {
  id: string
  name: string
  hint: string
  bg: string
  letter: string
}

const INITIAL: Blocked[] = [
  { id: 'b1', name: 'Spam Bot', hint: '@spam_bot', bg: 'linear-gradient(135deg,#9aa0a6,#5f6368)', letter: 'S' },
  { id: 'b2', name: 'Unknown', hint: '+7 700 000 11 22', bg: 'linear-gradient(135deg,#ff8a5b,#ff6a3d)', letter: 'U' },
  { id: 'b3', name: 'Crypto Promo', hint: '@get_rich_now', bg: 'linear-gradient(135deg,#43cea2,#185a9d)', letter: 'C' },
]

export default function BlockedUsers({ onBack }: { onBack: () => void }) {
  const tg = useTheme().tg
  const t = useT()
  const cardBg = useCardBg()
  const [list, setList] = useState(INITIAL)

  return (
    <SettingsScreen title="Blocked Users" onBack={onBack}>
      <Section footer="Blocked users can't send you messages or see your profile.">
        <Row icon={<TgIcon name="restrict" size={24} />} label="Block User" accent onClick={() => {}} />
      </Section>

      {list.length > 0 ? (
        <Box sx={{ mx: 1.25, borderRadius: '16px', background: cardBg, py: 0.5 }}>
          {list.map((b) => (
            <Box key={b.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, mx: 0.5 }}>
              <Avatar background={b.bg} text={b.letter} size={46} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: 16, color: tg.textPrimary }}>{b.name}</Typography>
                <Typography noWrap sx={{ fontSize: 13.5, color: tg.textSecondary }}>{b.hint}</Typography>
              </Box>
              <TgIcon
                name="close"
                size={20}
                color={tg.textFaint}
                onClick={() => setList((l) => l.filter((x) => x.id !== b.id))}
                style={{ cursor: 'pointer' }}
              />
            </Box>
          ))}
        </Box>
      ) : (
        <Typography sx={{ px: 3, fontSize: 14, color: tg.textSecondary }}>
          {t("You haven't blocked anyone.")}
        </Typography>
      )}
    </SettingsScreen>
  )
}
