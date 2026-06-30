import { useState } from 'react'
import { Box, IconButton, Typography, useMediaQuery, useTheme } from '@mui/material'
import TgSwitch from './TgSwitch'
import { Tabs } from './Tabs'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE, DUR, slideInRight } from '../motion'
import TgIcon from './TgIcon'
import Avatar from './Avatar'
import { useAvatarSrc } from './useAvatarSrc'
import EditView from './EditView'
import type { Chat, OpenPeer } from '../data'
import { useT } from '../i18n'
import { useGroupInfo, RIGHTS, roleLabel, type RealMember } from '../core/hooks/useGroupInfo'

const tileGradients = [
  'linear-gradient(135deg,#3a2b5e,#120d20)',
  'linear-gradient(135deg,#5b7bd6,#2a3a6e)',
  'linear-gradient(135deg,#caa98c,#7a5c44)',
  'linear-gradient(135deg,#2c3e50,#4ca1af)',
  'linear-gradient(135deg,#642b73,#c6426e)',
  'linear-gradient(135deg,#11998e,#38ef7d)',
]

export default function UserInfoPanel({ chat, onClose, onOpenPeer }: { chat: Chat; onClose: () => void; onOpenPeer?: (peer: OpenPeer) => void }) {
  const theme = useTheme()
  const tg = theme.tg
  const t = useT()
  const mode = theme.palette.mode
  const narrow = useMediaQuery('(max-width:900px)')
  const cardBg = mode === 'dark' ? '#2b2b2b' : '#ffffff'
  const [tab, setTab] = useState('Media')
  const [editing, setEditing] = useState(false)
  const [notif, setNotif] = useState(true)
  const headerAvatarSrc = useAvatarSrc(chat.avatarUrl)

  const {
    isRealChat,
    isChannel,
    isGroup,
    realMembers,
    canManageAdmins,
    canInvite,
    canManageDiscussion,
    discussionChatId,
    enablingDiscussion,
    inviteLinks,
    requireApproval,
    setRequireApproval,
    creatingInvite,
    copiedToken,
    joinRequests,
    editMember,
    setEditMember,
    approveJoinRequest,
    declineJoinRequest,
    saveRights,
    removeRights,
    enableDiscussion,
    createInvite,
    copyInvite,
  } = useGroupInfo(chat)

  const title = isChannel ? 'Channel Info' : isGroup ? 'Group Info' : 'User Info'

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
            <TgIcon name="close" />
          </IconButton>
          <Typography sx={{ flex: 1, fontSize: 19, fontWeight: 600, color: tg.textPrimary }}>
            {t(title)}
          </Typography>
          {(isGroup || isChannel) && (
            <IconButton onClick={() => setEditing(true)} sx={{ color: tg.textSecondary }}>
              <TgIcon name="edit" />
            </IconButton>
          )}
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', pb: 3 }}>
          {/* Avatar + name */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, pt: 1, pb: 2.5 }}>
            <Avatar background={chat.avatar} text={chat.avatarText} emoji={chat.avatarEmoji} src={headerAvatarSrc} size={120} />
            <Typography sx={{ fontSize: 21, fontWeight: 600, color: tg.textPrimary, mt: 1, textAlign: 'center', px: 2 }}>
              {chat.name}
            </Typography>
            <Typography sx={{ fontSize: 14, color: tg.textSecondary }}>{chat.status}</Typography>
          </Box>

          {/* Info card */}
          <Box sx={{ mx: 1.5, mb: 1.5, borderRadius: '16px', background: cardBg, py: 0.5 }}>
            {isChannel ? (
              <Box sx={{ display: 'flex', gap: 2, px: 2, py: 1.25 }}>
                <TgIcon name="info" size={24} color={tg.textSecondary} style={{ marginTop: 4 }} />
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
                <TgIcon name="link" size={24} color={tg.textSecondary} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 16, color: tg.textPrimary, wordBreak: 'break-all' }}>
                    t.me/+{chat.id}9yJiODEy
                  </Typography>
                  <Typography sx={{ fontSize: 13.5, color: tg.textSecondary }}>{t('Link')}</Typography>
                </Box>
                <TgIcon name="qr" size={22} color={tg.textSecondary} />
              </Box>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1, mx: 0.5, borderRadius: '12px', cursor: 'pointer', '&:hover': { background: tg.hover } }}>
                <TgIcon name="mention" size={24} color={tg.textSecondary} />
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: 16, color: tg.textPrimary }}>
                    {chat.username ?? chat.name.toLowerCase()}
                  </Typography>
                  <Typography sx={{ fontSize: 13.5, color: tg.textSecondary }}>{t('Username')}</Typography>
                </Box>
                <TgIcon name="qr" size={22} color={tg.textSecondary} />
              </Box>
            )}

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 0.5, mx: 0.5, borderRadius: '12px' }}>
              <TgIcon name="unmute" size={24} color={tg.textSecondary} />
              <Typography sx={{ flex: 1, fontSize: 16, color: tg.textPrimary }}>{t('Notifications')}</Typography>
              <TgSwitch checked={notif} onClick={() => setNotif((v) => !v)} />
            </Box>
          </Box>

          {/* Channel: tabs + media grid */}
          {isChannel && (
            <>
              <Tabs value={tab} onChange={(v) => setTab(v as string)} order={['Media', 'Gifts', 'Saved', 'Links']}>
                <Tabs.List>
                  {['Media', 'Gifts', 'Saved', 'Links'].map((tabName) => (
                    <Tabs.Tab key={tabName} value={tabName}>
                      {t(tabName)}
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs>
              <Box sx={{ mx: 1.5, mt: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '3px' }}>
                {tileGradients.map((g, i) => (
                  <Box key={i} sx={{ aspectRatio: '1 / 1', background: g, borderRadius: i < 3 ? (i === 0 ? '8px 0 0 0' : i === 2 ? '0 8px 0 0' : 0) : 0 }} />
                ))}
              </Box>
            </>
          )}

          {/* Channel discussions: admin (creator/CHANGE_INFO) toggle / enabled state */}
          {isRealChat && isChannel && canManageDiscussion && (
            <Box sx={{ mx: 1.5, mt: 1 }}>
              <Typography sx={{ px: 1.5, pb: 0.5, fontSize: 14, fontWeight: 600, color: tg.accent }}>
                Обсуждения
              </Typography>
              <Box sx={{ borderRadius: '16px', background: cardBg, py: 0.75 }}>
                {discussionChatId > 0 ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1, mx: 0.5, borderRadius: '12px' }}>
                    <Typography sx={{ flex: 1, fontSize: 16, color: tg.textPrimary }}>Обсуждения включены</Typography>
                    <TgIcon name="check" size={22} color={tg.accent} />
                  </Box>
                ) : (
                  <Box sx={{ px: 1.5, py: 0.5 }}>
                    <Box
                      component={motion.div}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => void enableDiscussion()}
                      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, py: 1, borderRadius: '12px', color: tg.accent, fontSize: 16, fontWeight: 600, cursor: 'pointer', opacity: enablingDiscussion ? 0.6 : 1, '&:hover': { background: tg.hover } }}
                    >
                      Включить обсуждения
                    </Box>
                  </Box>
                )}
              </Box>
            </Box>
          )}

          {/* Real group/channel: members/subscribers list (loaded from groups.members) */}
          {isRealChat && realMembers && (
            <Box sx={{ mx: 1.5 }}>
              <Typography sx={{ px: 1.5, pb: 0.5, fontSize: 14, fontWeight: 600, color: tg.accent }}>
                {isChannel ? 'Подписчики' : 'Участники'}
              </Typography>
              <Box sx={{ borderRadius: '16px', background: cardBg, py: 0.75 }}>
                {realMembers.map((mem) => {
                  const openChat = () =>
                    onOpenPeer?.({ id: mem.userId, displayName: mem.displayName, username: mem.username, avatarUrl: mem.avatarUrl })
                  return (
                    <Box
                      key={mem.userId}
                      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 0.75, mx: 0.5, borderRadius: '12px' }}
                    >
                      {/* avatar + name → open a private chat with this member */}
                      <Box
                        onClick={openChat}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0, cursor: 'pointer', borderRadius: '12px', '&:hover': { background: tg.hover } }}
                      >
                        <Avatar background={tg.accent} text={mem.displayName[0]?.toUpperCase()} src={mem.avatarUrl} size={44} />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography noWrap sx={{ fontSize: 16, color: tg.textPrimary }}>{mem.displayName}</Typography>
                          <Typography sx={{ fontSize: 13.5, color: mem.online ? tg.accent : tg.textSecondary }}>
                            {mem.online ? t('online') : t('last seen recently')}
                          </Typography>
                        </Box>
                      </Box>
                      {/* role label → admin rights editor (creator/admins only) */}
                      <Typography
                        onClick={canManageAdmins ? () => setEditMember(mem) : undefined}
                        sx={{ fontSize: 13.5, color: tg.textSecondary, cursor: canManageAdmins ? 'pointer' : 'default', px: canManageAdmins ? 0.5 : 0, borderRadius: '8px', '&:hover': canManageAdmins ? { background: tg.hover } : undefined }}
                      >
                        {roleLabel(mem.role, isChannel)}
                      </Typography>
                    </Box>
                  )
                })}
              </Box>
            </Box>
          )}

          {/* Real group/channel: invite links (admins with INVITE_USERS / creator) */}
          {isRealChat && canInvite && (
            <Box sx={{ mx: 1.5, mt: 1 }}>
              <Typography sx={{ px: 1.5, pb: 0.5, fontSize: 14, fontWeight: 600, color: tg.accent }}>
                Пригласительные ссылки
              </Typography>
              <Box sx={{ borderRadius: '16px', background: cardBg, py: 0.75 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 0.75, mx: 0.5, borderRadius: '12px' }}>
                  <Typography sx={{ flex: 1, fontSize: 16, color: tg.textPrimary }}>Запрашивать одобрение</Typography>
                  <TgSwitch checked={requireApproval} onClick={() => setRequireApproval((v) => !v)} />
                </Box>
                {inviteLinks.map((link) => {
                  const fullUrl = `${location.origin}/join/${link.token}`
                  return (
                    <Box key={link.token} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 0.75, mx: 0.5, borderRadius: '12px' }}>
                      <TgIcon name="link" size={24} color={tg.textSecondary} style={{ flexShrink: 0 }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: 15, color: tg.link, wordBreak: 'break-all' }}>{fullUrl}</Typography>
                        {copiedToken === link.token ? (
                          <Typography sx={{ fontSize: 12.5, color: tg.accent }}>Скопировано</Typography>
                        ) : (
                          link.requiresApproval && (
                            <Typography sx={{ fontSize: 12.5, color: tg.textSecondary }}>по заявке</Typography>
                          )
                        )}
                      </Box>
                      <IconButton onClick={() => copyInvite(link.token)} sx={{ color: copiedToken === link.token ? tg.accent : tg.textSecondary, flexShrink: 0 }}>
                        <TgIcon name="copy" size={20} />
                      </IconButton>
                    </Box>
                  )
                })}
                <Box sx={{ px: 1.5, pt: 0.5 }}>
                  <Box
                    component={motion.div}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => void createInvite()}
                    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, py: 1, borderRadius: '12px', color: tg.accent, fontSize: 16, fontWeight: 600, cursor: 'pointer', opacity: creatingInvite ? 0.6 : 1, '&:hover': { background: tg.hover } }}
                  >
                    <TgIcon name="adduser" size={22} />
                    Создать ссылку
                  </Box>
                </Box>
              </Box>
            </Box>
          )}

          {/* Real group/channel: pending join requests (admins with INVITE_USERS / creator) */}
          {isRealChat && canInvite && joinRequests.length > 0 && (
            <Box sx={{ mx: 1.5, mt: 1 }}>
              <Typography sx={{ px: 1.5, pb: 0.5, fontSize: 14, fontWeight: 600, color: tg.accent }}>
                Заявки на вступление
              </Typography>
              <Box sx={{ borderRadius: '16px', background: cardBg, py: 0.75 }}>
                {joinRequests.map((req) => (
                  <Box
                    key={req.userId}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 0.75, mx: 0.5, borderRadius: '12px' }}
                  >
                    <Avatar background={tg.accent} text={req.displayName[0]?.toUpperCase()} size={44} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography noWrap sx={{ fontSize: 16, color: tg.textPrimary }}>{req.displayName}</Typography>
                    </Box>
                    <IconButton
                      aria-label={`Одобрить заявку: ${req.displayName}`}
                      onClick={() => void approveJoinRequest(req.userId)}
                      sx={{ color: tg.accent, flexShrink: 0 }}
                    >
                      <TgIcon name="check" size={22} />
                    </IconButton>
                    <IconButton
                      aria-label={`Отклонить заявку: ${req.displayName}`}
                      onClick={() => void declineJoinRequest(req.userId)}
                      sx={{ color: '#ff595a', flexShrink: 0 }}
                    >
                      <TgIcon name="close" size={22} />
                    </IconButton>
                  </Box>
                ))}
              </Box>
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
            <TgIcon name="adduser" />
          </Box>
        )}

        {/* Edit screen overlay */}
        <AnimatePresence>
          {editing && <EditView chat={chat} onBack={() => setEditing(false)} />}
        </AnimatePresence>

        {/* Admin-rights editor overlay (slide-in sub-view, mirrors tweb userPermissions) */}
        <AnimatePresence>
          {editMember && (
            <RightsEditor
              key={editMember.userId}
              member={editMember}
              cardBg={cardBg}
              onBack={() => setEditMember(null)}
              onSave={(bitmask) => saveRights(editMember.userId, bitmask)}
              onRemove={() => removeRights(editMember.userId)}
            />
          )}
        </AnimatePresence>
      </Box>
    </motion.div>
  )
}

/**
 * Admin-rights editor sub-view. Structure ported from tweb
 * `sidebarRight/tabs/userPermissions.tsx` (a member row + one toggle per right);
 * primitives are the repo's own (TgSwitch + kit-style rows) and it slides in with
 * the shared `slideInRight` animation used across the app.
 */
function RightsEditor({
  member,
  cardBg,
  onBack,
  onSave,
  onRemove,
}: {
  member: RealMember
  cardBg: string
  onBack: () => void
  onSave: (bitmask: number) => void | Promise<void>
  onRemove: () => void | Promise<void>
}) {
  const tg = useTheme().tg
  const isAdmin = member.role === 'creator' || member.role === 'admin'
  const initial = isAdmin ? RIGHTS.reduce((acc, r) => acc | r.bit, 0) : 0
  const [bits, setBits] = useState(initial)
  const [saving, setSaving] = useState(false)

  const toggle = (bit: number) => setBits((b) => (b & bit ? b & ~bit : b | bit))

  return (
    <motion.div
      variants={slideInRight}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 60,
        background: tg.sidebarBg,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 1.25 }}>
        <IconButton onClick={onBack} sx={{ color: tg.textSecondary }}>
          <TgIcon name="back" />
        </IconButton>
        <Typography noWrap sx={{ flex: 1, fontSize: 19, fontWeight: 600, color: tg.textPrimary }}>
          {member.displayName}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', pb: 3 }}>
        <Box sx={{ mx: 1.5 }}>
          <Typography sx={{ px: 1.5, pb: 0.5, fontSize: 14, fontWeight: 600, color: tg.accent }}>
            Права администратора
          </Typography>
          <Box sx={{ borderRadius: '16px', background: cardBg, py: 0.5 }}>
            {RIGHTS.map((r) => (
              <Box
                key={r.bit}
                onClick={() => toggle(r.bit)}
                sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1.15, mx: 0.5, borderRadius: '12px', cursor: 'pointer', '&:hover': { background: tg.hover } }}
              >
                <Typography sx={{ flex: 1, fontSize: 16, color: tg.textPrimary }}>{r.label}</Typography>
                <TgSwitch checked={(bits & r.bit) !== 0} />
              </Box>
            ))}
          </Box>
        </Box>

        <Box sx={{ mx: 1.5, mt: 1.5 }}>
          <Box
            component={motion.div}
            whileTap={{ scale: 0.98 }}
            onClick={async () => {
              if (saving) return
              setSaving(true)
              try {
                await onSave(bits)
              } finally {
                setSaving(false)
              }
            }}
            sx={{ textAlign: 'center', py: 1.25, borderRadius: '14px', background: tg.accentGradient, color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            Сохранить
          </Box>
          {isAdmin && (
            <Box
              onClick={async () => {
                if (saving) return
                setSaving(true)
                try {
                  await onRemove()
                } finally {
                  setSaving(false)
                }
              }}
              sx={{ textAlign: 'center', py: 1.25, mt: 1, fontSize: 16, color: '#ff595a', cursor: 'pointer' }}
            >
              Снять права
            </Box>
          )}
        </Box>
      </Box>
    </motion.div>
  )
}
