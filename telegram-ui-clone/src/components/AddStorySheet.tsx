import { useState } from 'react'
import { Box, TextField, useTheme } from '@mui/material'
import IconButton from '../shared/ui/IconButton'
import { motion } from 'framer-motion'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import Text from '../shared/ui/Text'
import { useChatsStore } from '../stores/chatsStore'
import { gradientFor } from '../core/dialogToChat'

export type StoryPrivacy = 'everyone' | 'contacts' | 'selected'

const PRIVACY_OPTIONS: { key: StoryPrivacy; label: string }[] = [
  { key: 'everyone', label: 'Все' },
  { key: 'contacts', label: 'Контакты' },
  { key: 'selected', label: 'Выбранные' },
]

/**
 * Caption + privacy sheet shown after a story media file is picked + uploaded.
 * Reuses the app's slide-in panel pattern (mirrors NewGroupFlow / UserInfoPanel's
 * RightsEditor): an absolute-positioned motion panel over the sidebar with a
 * back header, a rounded card body and a confirm FAB.
 */
export default function AddStorySheet({
  onBack,
  onPublish,
}: {
  onBack: () => void
  onPublish: (args: { caption: string; privacy: StoryPrivacy; allowIds: number[] }) => void | Promise<void>
}) {
  const theme = useTheme()
  const tg = theme.tg
  const mode = theme.palette.mode
  const cardBg = mode === 'dark' ? '#2b2b2b' : '#ffffff'

  const dialogs = useChatsStore((s) => s.dialogs)
  // private peers only — the contact pool for the "Выбранные" audience
  const contacts = dialogs
    .filter((d) => d.type === 'private' && d.peer)
    .map((d) => d.peer!)

  const [caption, setCaption] = useState('')
  const [privacy, setPrivacy] = useState<StoryPrivacy>('contacts')
  const [allow, setAllow] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)

  const toggleContact = (id: number) =>
    setAllow((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const publish = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onPublish({
        caption: caption.trim(),
        privacy,
        allowIds: privacy === 'selected' ? [...allow] : [],
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 42,
        background: tg.sidebarBg,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 1.25 }}>
        <IconButton onClick={onBack} aria-label="Назад" color={tg.textSecondary}>
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color={tg.textPrimary}>
          Новая история
        </Text>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', pb: 12 }}>
        {/* Caption */}
        <Box sx={{ m: 1.5, px: 2.5, py: 3, borderRadius: '18px', background: cardBg }}>
          <TextField
            autoFocus
            fullWidth
            multiline
            maxRows={4}
            label="Подпись"
            variant="outlined"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '14px',
                color: tg.textPrimary,
                fontSize: 16,
                '& fieldset': { borderColor: tg.divider },
                '&:hover fieldset': { borderColor: tg.textFaint },
                '&.Mui-focused fieldset': { borderColor: tg.accent, borderWidth: '1.5px' },
              },
              '& .MuiInputLabel-root': { color: tg.textSecondary, fontSize: 16 },
              '& .MuiInputLabel-root.Mui-focused': { color: tg.accent },
            }}
          />
        </Box>

        {/* Privacy selector (segmented buttons) */}
        <Box sx={{ mx: 1.5 }}>
          <Text size={14} weight={600} color={tg.accent} style={{ paddingLeft: '12px', paddingRight: '12px', paddingBottom: '4px' }}>
            Кто может видеть
          </Text>
          <Box
            role="radiogroup"
            aria-label="Кто может видеть историю"
            sx={{ display: 'flex', gap: 1, p: 0.5, borderRadius: '16px', background: cardBg }}
          >
            {PRIVACY_OPTIONS.map((opt) => {
              const active = privacy === opt.key
              return (
                <Box
                  key={opt.key}
                  role="radio"
                  aria-checked={active}
                  tabIndex={0}
                  onClick={() => setPrivacy(opt.key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setPrivacy(opt.key)
                    }
                  }}
                  sx={{
                    flex: 1,
                    textAlign: 'center',
                    py: 1.1,
                    borderRadius: '12px',
                    cursor: 'pointer',
                    fontSize: 15,
                    fontWeight: 500,
                    color: active ? '#fff' : tg.textPrimary,
                    background: active ? tg.accentGradient : 'transparent',
                    transition: 'background .18s ease, color .18s ease',
                    '&:hover': { background: active ? tg.accentGradient : tg.hover },
                  }}
                >
                  {opt.label}
                </Box>
              )
            })}
          </Box>
        </Box>

        {/* Contact picker for the "Выбранные" audience */}
        {privacy === 'selected' && (
          <Box sx={{ mx: 1.5, mt: 1.5 }}>
            <Text size={14} weight={600} color={tg.accent} style={{ paddingLeft: '12px', paddingRight: '12px', paddingBottom: '4px' }}>
              Контакты
            </Text>
            <Box sx={{ borderRadius: '16px', background: cardBg, py: 0.5 }}>
              {contacts.length === 0 && (
                <Text size={15} color={tg.textSecondary} style={{ paddingLeft: '16px', paddingRight: '16px', paddingTop: '12px', paddingBottom: '12px' }}>
                  Нет контактов
                </Text>
              )}
              {contacts.map((c) => {
                const checked = allow.has(c.id)
                return (
                  <Box
                    key={c.id}
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={c.displayName}
                    tabIndex={0}
                    onClick={() => toggleContact(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleContact(c.id)
                      }
                    }}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      px: 1.5,
                      py: 1,
                      mx: 0.5,
                      borderRadius: '12px',
                      cursor: 'pointer',
                      '&:hover': { background: tg.hover },
                    }}
                  >
                    <Avatar
                      background={gradientFor(c.id)}
                      text={c.displayName.charAt(0).toUpperCase()}
                      size="sm"
                    />
                    <Text noWrap size={16} color={tg.textPrimary} style={{ flex: 1 }}>
                      {c.displayName}
                    </Text>
                    <Box
                      sx={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: checked ? tg.accent : 'transparent',
                        border: checked ? 'none' : `2px solid ${tg.textFaint}`,
                        color: '#fff',
                        transition: 'background .15s ease, border-color .15s ease',
                      }}
                    >
                      {checked && <TgIcon name="check" size={16} />}
                    </Box>
                  </Box>
                )
              })}
            </Box>
          </Box>
        )}
      </Box>

      {/* Publish FAB */}
      <Box
        component={motion.div}
        onClick={publish}
        role="button"
        aria-label="Опубликовать"
        aria-disabled={busy}
        whileHover={{ scale: busy ? 1 : 1.06 }}
        whileTap={{ scale: busy ? 1 : 0.92 }}
        sx={{
          position: 'absolute',
          right: 20,
          bottom: 20,
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: tg.accentGradient,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.5 : 1,
          transition: 'opacity .2s ease',
        }}
      >
        <TgIcon name="check" />
      </Box>
    </motion.div>
  )
}
