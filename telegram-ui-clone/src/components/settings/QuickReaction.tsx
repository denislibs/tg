import { useState } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { useT } from '../../i18n'
import { SettingsScreen, useCardBg } from './kit'

const EMOJIS = ['👍', '❤️', '🔥', '🥰', '👏', '😁', '🤔', '🎉', '😱', '👎', '💯', '🙏']

export default function QuickReaction({ onBack }: { onBack: () => void }) {
  const tg = useTheme().tg
  const t = useT()
  const cardBg = useCardBg()
  const [picked, setPicked] = useState('👍')

  return (
    <SettingsScreen title="Quick Reaction" onBack={onBack}>
      <Box sx={{ textAlign: 'center', pt: 3, pb: 1 }}>
        <Box sx={{ fontSize: 72, lineHeight: 1 }}>{picked}</Box>
        <Typography sx={{ fontSize: 14, color: tg.textSecondary, mt: 1, px: 5 }}>
          {t('Double-tap a message to send this reaction quickly.')}
        </Typography>
      </Box>
      <Box
        sx={{
          mx: 1.25,
          mt: 1,
          borderRadius: '16px',
          background: cardBg,
          p: 1.5,
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          gap: 1,
        }}
      >
        {EMOJIS.map((e) => (
          <Box
            key={e}
            onClick={() => setPicked(e)}
            sx={{
              aspectRatio: '1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 30,
              borderRadius: '12px',
              cursor: 'pointer',
              background: e === picked ? tg.hover : 'transparent',
              outline: e === picked ? `2px solid ${tg.accent}` : 'none',
              '&:hover': { background: tg.hover },
            }}
          >
            {e}
          </Box>
        ))}
      </Box>
    </SettingsScreen>
  )
}
