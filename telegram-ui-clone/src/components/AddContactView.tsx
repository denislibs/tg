// src/components/AddContactView.tsx
// The "Add contact" screen (tweb editContact.tsx, isNew branch). Docks as a side
// panel next to the conversation — same container behaviour as UserInfoPanel: a
// 404px sticky column on wide screens (the chat shrinks beside it), a full-height
// card overlay on narrow ones. Inside: a big avatar + the peer's original name, a
// card with name/last-name/note fields and a "number hidden" phone row, a "show my
// phone" checkbox, and a floating ✓ that POSTs to /contacts. Russian copy is
// hardcoded (the app renders Russian; sibling panels do the same).
import { useState } from 'react'
import { Box, InputAdornment, TextField, useMediaQuery, useTheme } from '@mui/material'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import { motion } from 'framer-motion'
import { EASE, DUR } from '../motion'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import { useAvatarSrc } from './useAvatarSrc'
import { useManagers } from '../core/hooks/useManagers'
import type { Chat } from '../data'

// Split a display name into a first/last seed (everything after the first token is
// the last name) — mirrors tweb prefilling first/last from the user's profile name.
function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/)
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') }
}

export default function AddContactView({
  chat,
  onClose,
  onAdded,
}: {
  chat: Chat
  onClose: () => void
  onAdded?: () => void
}) {
  const managers = useManagers()
  const theme = useTheme()
  const tg = theme.tg
  const narrow = useMediaQuery('(max-width:900px)')
  const cardBg = theme.palette.mode === 'dark' ? '#2b2b2b' : '#ffffff'
  const seed = splitName(chat.name)
  const [first, setFirst] = useState(seed.first)
  const [last, setLast] = useState(seed.last)
  const [note, setNote] = useState('')
  const [sharePhone, setSharePhone] = useState(true)
  const [saving, setSaving] = useState(false)
  const avatarSrc = useAvatarSrc(chat.avatarUrl)
  const displayFirst = first.trim() || chat.name

  const canSave = !!chat.peerId && first.trim().length > 0 && !saving

  const submit = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await managers.contacts.add({
        contactId: chat.peerId!,
        firstName: first.trim(),
        lastName: last.trim(),
        note: note.trim(),
        sharePhone,
      })
      onAdded?.()
      onClose()
    } catch {
      setSaving(false)
    }
  }

  const fieldSx = {
    '& .MuiOutlinedInput-root': {
      borderRadius: '12px',
      color: tg.textPrimary,
      fontSize: 16,
      background: cardBg,
      '& fieldset': { borderColor: tg.divider },
      '&:hover fieldset': { borderColor: tg.textFaint },
      '&.Mui-focused fieldset': { borderColor: tg.accent, borderWidth: '1.5px' },
    },
    '& .MuiOutlinedInput-input': { padding: '14px 14px' },
    '& .MuiInputLabel-root': { color: tg.textSecondary },
    '& .MuiInputLabel-root.Mui-focused': { color: tg.accent },
  }

  return (
    <motion.div
      initial={narrow ? { opacity: 0 } : { width: 0, opacity: 0 }}
      animate={narrow ? { opacity: 1 } : { width: 404, opacity: 1 }}
      exit={narrow ? { opacity: 0 } : { width: 0, opacity: 0 }}
      transition={{ duration: DUR.in, ease: EASE }}
      style={
        narrow
          ? { position: 'fixed', inset: 0, zIndex: 1900 }
          : {
              overflow: 'hidden',
              flexShrink: 0,
              position: 'sticky',
              top: '16px',
              alignSelf: 'flex-start',
              height: 'calc(100vh - 32px)',
              zIndex: 15,
            }
      }
    >
      {narrow && (
        <Box onClick={onClose} sx={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} />
      )}
      <Box
        component={motion.div}
        {...(narrow
          ? { initial: { x: '100%' }, animate: { x: '0%' }, transition: { duration: DUR.in, ease: EASE } }
          : {})}
        sx={
          narrow
            ? {
                position: 'absolute',
                top: '16px',
                right: '16px',
                bottom: '16px',
                width: 'min(380px, calc(100vw - 32px))',
                background: tg.sidebarBg,
                borderRadius: '18px',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }
            : {
                width: 380,
                height: '100%',
                ml: '8px',
                mr: '16px',
                background: tg.sidebarBg,
                borderRadius: '18px',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
              }
        }
      >
        {/* Header — back + title */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1.5, flexShrink: 0 }}>
          <IconButton onClick={onClose} color={tg.textSecondary}>
            <TgIcon name="back" />
          </IconButton>
          <Text size={19} weight={600} color={tg.textPrimary}>Добавить контакт</Text>
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', pb: 12 }}>
          {/* Avatar + original name */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 1, mb: 3 }}>
            <Avatar background={chat.avatar} text={chat.avatarText ?? chat.name[0]} src={avatarSrc} size="profile" />
            <Text size={22} weight={600} color={tg.textPrimary} style={{ marginTop: '16px' }}>{chat.name}</Text>
            <Text size={14} color={tg.textSecondary} style={{ marginTop: '2px' }}>исходное имя</Text>
          </Box>

          {/* Fields card */}
          <Box sx={{ mx: 1.25, mb: 1.5, p: 2, borderRadius: '16px', background: cardBg }}>
            <TextField
              fullWidth
              label="Имя (обязательно)"
              variant="outlined"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              autoFocus
              sx={{ ...fieldSx, mb: 2 }}
            />
            <TextField
              fullWidth
              label="Фамилия (необязательно)"
              variant="outlined"
              value={last}
              onChange={(e) => setLast(e.target.value)}
              sx={{ ...fieldSx, mb: 2 }}
            />
            <TextField
              fullWidth
              label="Заметка"
              variant="outlined"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              sx={fieldSx}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <TgIcon name="smile" color={tg.textFaint} />
                  </InputAdornment>
                ),
              }}
            />

            {/* Phone "hidden" row */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mt: 2.5, px: 0.5 }}>
              <TgIcon name="phone" size={24} color={tg.textSecondary} style={{ marginTop: 2 }} />
              <Box sx={{ minWidth: 0 }}>
                <Text size={16} weight={600} color={tg.textPrimary}>Номер скрыт</Text>
                <Text size={14} color={tg.textSecondary} style={{ lineHeight: 1.35 }}>
                  Номер телефона будет виден, когда {displayFirst} добавит Вас в контакты.
                </Text>
              </Box>
            </Box>
          </Box>

          {/* Share-phone checkbox (square, left — tweb's CheckboxField) */}
          <Box
            onClick={() => setSharePhone((v) => !v)}
            sx={{
              mx: 1.25,
              px: 2,
              py: 1.5,
              borderRadius: '16px',
              background: cardBg,
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              cursor: 'pointer',
            }}
          >
            <Box
              sx={{
                width: 24,
                height: 24,
                flexShrink: 0,
                borderRadius: '7px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.15s, border-color 0.15s',
                background: sharePhone ? tg.accent : 'transparent',
                border: sharePhone ? `2px solid ${tg.accent}` : `2px solid ${tg.textFaint}`,
              }}
            >
              {sharePhone && <TgIcon name="check" size={18} color="#fff" />}
            </Box>
            <Text size={16} color={tg.textPrimary}>Показать номер телефона</Text>
          </Box>
          <Text size={14} color={tg.textSecondary} style={{ paddingLeft: '20px', paddingRight: '20px', marginTop: '8px' }}>
            Вы можете разрешить {displayFirst} видеть Ваш номер телефона.
          </Text>
        </Box>

        {/* Floating submit */}
        <Box
          component={motion.button}
          whileTap={{ scale: 0.92 }}
          onClick={submit}
          disabled={!canSave}
          sx={{
            position: 'absolute',
            right: 18,
            bottom: 18,
            width: 56,
            height: 56,
            borderRadius: '50%',
            border: 'none',
            background: tg.accent,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: canSave ? 'pointer' : 'default',
            opacity: canSave ? 1 : 0.5,
            boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
            transition: 'opacity 0.2s',
          }}
        >
          <TgIcon name="check" size={28} />
        </Box>
      </Box>
    </motion.div>
  )
}
