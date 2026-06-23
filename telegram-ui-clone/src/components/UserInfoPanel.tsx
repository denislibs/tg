import { useState } from 'react'
import { Box, IconButton, Typography, useMediaQuery, useTheme } from '@mui/material'
import TgSwitch from './TgSwitch'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE, DUR } from '../motion'
import CloseRounded from '@mui/icons-material/CloseRounded'
import EditRounded from '@mui/icons-material/EditRounded'
import AlternateEmailRounded from '@mui/icons-material/AlternateEmailRounded'
import LinkRounded from '@mui/icons-material/LinkRounded'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import QrCode2Rounded from '@mui/icons-material/QrCode2Rounded'
import NotificationsNoneRounded from '@mui/icons-material/NotificationsNoneRounded'
import PersonAddRounded from '@mui/icons-material/PersonAddRounded'
import Avatar from './Avatar'
import EditView from './EditView'
import type { Chat } from '../data'
import { useT } from '../i18n'

const tileGradients = [
  'linear-gradient(135deg,#3a2b5e,#120d20)',
  'linear-gradient(135deg,#5b7bd6,#2a3a6e)',
  'linear-gradient(135deg,#caa98c,#7a5c44)',
  'linear-gradient(135deg,#2c3e50,#4ca1af)',
  'linear-gradient(135deg,#642b73,#c6426e)',
  'linear-gradient(135deg,#11998e,#38ef7d)',
]

export default function UserInfoPanel({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const theme = useTheme()
  const tg = theme.tg
  const t = useT()
  const mode = theme.palette.mode
  const narrow = useMediaQuery('(max-width:900px)')
  const cardBg = mode === 'dark' ? '#2b2b2b' : '#ffffff'
  const [tab, setTab] = useState('Media')
  const [editing, setEditing] = useState(false)
  const [notif, setNotif] = useState(true)

  const isChannel = chat.type === 'channel'
  const isGroup = chat.type === 'group'
  const title = isChannel ? 'Channel Info' : isGroup ? 'Group Info' : 'User Info'

  // group members (owner + unique senders)
  const seen = new Set<string>()
  const members = [{ name: 'Дн', status: 'online', role: 'owner', bg: 'linear-gradient(135deg,#ff8a5b,#ff6a3d)' }]
  chat.messages?.forEach((m) => {
    if (m.sender && !seen.has(m.sender)) {
      seen.add(m.sender)
      members.push({ name: m.sender, status: 'last seen recently', role: '', bg: m.senderColor ?? tg.accent })
    }
  })

  const linkText = chat.links?.length ? chat.links : null

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
        <Box
          onClick={onClose}
          sx={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }}
        />
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
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1.5 }}>
          <IconButton onClick={onClose} sx={{ color: tg.textSecondary }}>
            <CloseRounded />
          </IconButton>
          <Typography sx={{ flex: 1, fontSize: 19, fontWeight: 600, color: tg.textPrimary }}>
            {t(title)}
          </Typography>
          {(isGroup || isChannel) && (
            <IconButton onClick={() => setEditing(true)} sx={{ color: tg.textSecondary }}>
              <EditRounded />
            </IconButton>
          )}
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', pb: 3 }}>
          {/* Avatar + name */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, pt: 1, pb: 2.5 }}>
            <Avatar background={chat.avatar} text={chat.avatarText} emoji={chat.avatarEmoji} size={120} />
            <Typography sx={{ fontSize: 21, fontWeight: 600, color: tg.textPrimary, mt: 1, textAlign: 'center', px: 2 }}>
              {chat.name}
            </Typography>
            <Typography sx={{ fontSize: 14, color: tg.textSecondary }}>{chat.status}</Typography>
          </Box>

          {/* Info card */}
          <Box sx={{ mx: 1.5, mb: 1.5, borderRadius: '16px', background: cardBg, py: 0.5 }}>
            {isChannel ? (
              <Box sx={{ display: 'flex', gap: 2, px: 2, py: 1.25 }}>
                <InfoOutlined sx={{ color: tg.textSecondary, fontSize: 24, mt: 0.5 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 15.5, color: tg.textPrimary, mb: linkText ? 1.5 : 0 }}>
                    {chat.description ?? t('Channel description.')}
                  </Typography>
                  {linkText?.map((l) => (
                    <Box key={l.label} sx={{ mb: 1.25 }}>
                      <Typography sx={{ fontSize: 15.5, color: tg.textPrimary }}>{l.label}:</Typography>
                      <Typography sx={{ fontSize: 15.5, color: tg.link, wordBreak: 'break-all' }}>
                        {l.value}
                      </Typography>
                    </Box>
                  ))}
                  <Typography sx={{ fontSize: 13.5, color: tg.textSecondary }}>{t('Info')}</Typography>
                </Box>
              </Box>
            ) : isGroup ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1, mx: 0.5, borderRadius: '12px', cursor: 'pointer', '&:hover': { background: tg.hover } }}>
                <LinkRounded sx={{ color: tg.textSecondary, fontSize: 24 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 16, color: tg.textPrimary, wordBreak: 'break-all' }}>
                    t.me/+{chat.id}9yJiODEy
                  </Typography>
                  <Typography sx={{ fontSize: 13.5, color: tg.textSecondary }}>{t('Link')}</Typography>
                </Box>
                <QrCode2Rounded sx={{ color: tg.textSecondary, fontSize: 22 }} />
              </Box>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1, mx: 0.5, borderRadius: '12px', cursor: 'pointer', '&:hover': { background: tg.hover } }}>
                <AlternateEmailRounded sx={{ color: tg.textSecondary, fontSize: 24 }} />
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: 16, color: tg.textPrimary }}>
                    {chat.username ?? chat.name.toLowerCase()}
                  </Typography>
                  <Typography sx={{ fontSize: 13.5, color: tg.textSecondary }}>{t('Username')}</Typography>
                </Box>
                <QrCode2Rounded sx={{ color: tg.textSecondary, fontSize: 22 }} />
              </Box>
            )}

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 0.5, mx: 0.5, borderRadius: '12px' }}>
              <NotificationsNoneRounded sx={{ color: tg.textSecondary, fontSize: 24 }} />
              <Typography sx={{ flex: 1, fontSize: 16, color: tg.textPrimary }}>{t('Notifications')}</Typography>
              <TgSwitch checked={notif} onClick={() => setNotif((v) => !v)} />
            </Box>
          </Box>

          {/* Channel: tabs + media grid */}
          {isChannel && (
            <>
              <Box sx={{ mx: 1.5, mt: 0.5, p: 0.5, borderRadius: '14px', background: cardBg, display: 'flex', gap: 0.5, overflowX: 'auto', '&::-webkit-scrollbar': { display: 'none' } }}>
                {['Media', 'Gifts', 'Saved', 'Links'].map((tabName) => {
                  const active = tabName === tab
                  return (
                    <Box key={tabName} onClick={() => setTab(tabName)} sx={{ position: 'relative', flexShrink: 0, px: 2, py: 0.75, borderRadius: '12px', cursor: 'pointer' }}>
                      {active && (
                        <motion.div layoutId="infoTab" transition={{ type: 'spring', stiffness: 500, damping: 35 }} style={{ position: 'absolute', inset: 0, borderRadius: 12, background: 'rgba(135,116,225,0.22)' }} />
                      )}
                      <Typography sx={{ position: 'relative', zIndex: 1, fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', color: active ? tg.accent : tg.textSecondary }}>
                        {t(tabName)}
                      </Typography>
                    </Box>
                  )
                })}
              </Box>
              <Box sx={{ mx: 1.5, mt: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '3px' }}>
                {tileGradients.map((g, i) => (
                  <Box key={i} sx={{ aspectRatio: '1 / 1', background: g, borderRadius: i < 3 ? (i === 0 ? '8px 0 0 0' : i === 2 ? '0 8px 0 0' : 0) : 0 }} />
                ))}
              </Box>
            </>
          )}

          {/* Group: members */}
          {isGroup && (
            <Box sx={{ mx: 1.5, borderRadius: '16px', background: cardBg, py: 0.75 }}>
              {members.map((mem) => (
                <Box key={mem.name} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 0.75, mx: 0.5, borderRadius: '12px', cursor: 'pointer', '&:hover': { background: tg.hover } }}>
                  <Avatar background={mem.bg} text={mem.name[0]} size={44} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: 16, color: tg.textPrimary }}>{mem.name}</Typography>
                    <Typography sx={{ fontSize: 13.5, color: mem.status === 'online' ? tg.accent : tg.textSecondary }}>
                      {t(mem.status)}
                    </Typography>
                  </Box>
                  {mem.role && <Typography sx={{ fontSize: 13.5, color: tg.textSecondary }}>{t(mem.role)}</Typography>}
                </Box>
              ))}
            </Box>
          )}
        </Box>

        {/* Group add-member FAB */}
        {isGroup && (
          <Box
            component={motion.div}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.92 }}
            sx={{
              position: 'absolute',
              right: 18,
              bottom: 18,
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: tg.accentGradient,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            <PersonAddRounded />
          </Box>
        )}

        {/* Edit screen overlay */}
        <AnimatePresence>
          {editing && <EditView chat={chat} onBack={() => setEditing(false)} />}
        </AnimatePresence>
      </Box>
    </motion.div>
  )
}
