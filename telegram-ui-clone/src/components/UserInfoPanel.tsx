import { useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import TgSwitch from './TgSwitch'
import { Tabs } from '../shared/ui/Tabs'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE, DUR, slideInRight } from '../motion'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import { useAvatarSrc } from './useAvatarSrc'
import EditView from './EditView'
import { Section, Row } from './settings/kit'
import classNames from '../shared/lib/classNames'
import type { Chat, OpenPeer } from '../data'
import { useT } from '../i18n'
import { useGroupInfo, RIGHTS, roleLabel, type RealMember } from '../core/hooks/useGroupInfo'
import s from './UserInfoPanel.module.scss'
import useMediaQuery from '../shared/lib/useMediaQuery'


// --- Моки шаред-медиа (пока нет реального API истории по типам контента).
// Структура секции — 1:1 tweb sharedMedia.tsx: табы media/files/links/music/voice.
const mockMedia: { gradient: string; emoji: string; duration?: string }[] = [
  { gradient: 'linear-gradient(135deg,#3a2b5e,#120d20)', emoji: '🌃', duration: '0:21' },
  { gradient: 'linear-gradient(135deg,#5b7bd6,#2a3a6e)', emoji: '🏔️' },
  { gradient: 'linear-gradient(135deg,#caa98c,#7a5c44)', emoji: '🐕', duration: '0:19' },
  { gradient: 'linear-gradient(135deg,#2c3e50,#4ca1af)', emoji: '🌊' },
  { gradient: 'linear-gradient(135deg,#642b73,#c6426e)', emoji: '🌸' },
  { gradient: 'linear-gradient(135deg,#11998e,#38ef7d)', emoji: '🌿' },
  { gradient: 'linear-gradient(135deg,#f2994a,#f2c94c)', emoji: '🌅', duration: '1:02' },
  { gradient: 'linear-gradient(135deg,#4b6cb7,#182848)', emoji: '🌌' },
  { gradient: 'linear-gradient(135deg,#8e2de2,#4a00e0)', emoji: '🎆' },
]
const mockFiles = [
  { name: 'Отчёт за июнь.pdf', meta: '2,4 МБ · 28 июн', ext: 'PDF', color: '#e5322e' },
  { name: 'Смета_ремонт.xlsx', meta: '184 КБ · 25 июн', ext: 'XLS', color: '#00a884' },
  { name: 'Договор аренды.docx', meta: '96 КБ · 19 июн', ext: 'DOC', color: '#4285f4' },
  { name: 'backup_photos.zip', meta: '48,2 МБ · 11 июн', ext: 'ZIP', color: '#8774e1' },
]
const mockLinks = [
  { title: 'Telegram Web', url: 'web.telegram.org/k', gradient: 'linear-gradient(135deg,#2aabee,#229ed9)' },
  { title: 'tweb — Telegram Web K source', url: 'github.com/morethanwords/tweb', gradient: 'linear-gradient(135deg,#24292e,#57606a)' },
  { title: 'MDN Web Docs', url: 'developer.mozilla.org', gradient: 'linear-gradient(135deg,#8e2de2,#4a00e0)' },
]
const mockMusic = [
  { title: 'Shape of My Heart', artist: 'Sting', duration: '4:38' },
  { title: 'Кукушка', artist: 'Кино', duration: '6:40' },
  { title: 'Bohemian Rhapsody', artist: 'Queen', duration: '5:55' },
]
// высоты волноформы голосового (просто фиксированный узор)
const VOICE_WAVE = [0.3, 0.5, 0.9, 0.6, 1, 0.7, 0.4, 0.8, 0.5, 0.9, 0.35, 0.6, 0.75, 0.4, 0.55]
const mockVoice = [
  { duration: '0:42', meta: '28 июн' },
  { duration: '1:17', meta: '25 июн' },
  { duration: '0:08', meta: '19 июн' },
]

export default function UserInfoPanel({ chat, onClose, onOpenPeer }: { chat: Chat; onClose: () => void; onOpenPeer?: (peer: OpenPeer) => void }) {
  const t = useT()
  const narrow = useMediaQuery('(max-width:900px)')
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
      // Узкий режим: обёртка статична — анимацию (заезд справа) играет сама панель.
      initial={narrow ? false : { width: 0, opacity: 0 }}
      animate={narrow ? {} : { width: 404, opacity: 1 }}
      exit={narrow ? {} : { width: 0, opacity: 0 }}
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
      <motion.div
        {...(narrow
          ? {
              initial: { x: '100%' },
              animate: { x: '0%' },
              exit: { x: '100%' },
              transition: { duration: DUR.in, ease: EASE },
            }
          : {})}
        className={classNames(s.panel, narrow ? s.panelNarrow : s.panelWide)}
      >
        {/* Header */}
        <div className={s.header}>
          <IconButton onClick={onClose} color="var(--tg-textSecondary)">
            <TgIcon name="close" />
          </IconButton>
          <Text size={19} weight={600} color="var(--tg-textPrimary)" style={{ flex: 1 }}>
            {t(title)}
          </Text>
          {(isGroup || isChannel) && (
            <IconButton onClick={() => setEditing(true)} color="var(--tg-textSecondary)">
              <TgIcon name="edit" />
            </IconButton>
          )}
        </div>

        <div className={s.body}>
          {/* Avatar + name */}
          <div className={s.avatarBlock}>
            <Avatar background={chat.avatar} text={chat.avatarText} emoji={chat.avatarEmoji} src={headerAvatarSrc} size="profile" />
            <Text size={21} weight={600} color="var(--tg-textPrimary)" style={{ marginTop: '8px', textAlign: 'center', paddingLeft: '16px', paddingRight: '16px' }}>
              {chat.name}
            </Text>
            <Text size={14} color="var(--tg-textSecondary)">{chat.status}</Text>
          </div>

          {/* Info card — те же секции, что в настройках (settings/kit Section+Row) */}
          <Section>
            {isChannel ? (
              <div className={s.channelRow}>
                <TgIcon name="info" size={24} color="var(--tg-textSecondary)" style={{ marginTop: 4 }} />
                <div className={s.grow}>
                  <Text size={15.5} color="var(--tg-textPrimary)" style={{ marginBottom: linkText ? '12px' : 0 }}>
                    {chat.description ?? t('Channel description.')}
                  </Text>
                  {linkText?.map((l) => (
                    <div key={l.label} style={{ marginBottom: '10px' }}>
                      <Text size={15.5} color="var(--tg-textPrimary)">{l.label}:</Text>
                      <Text size={15.5} color="var(--tg-link)" style={{ wordBreak: 'break-all' }}>
                        {l.value}
                      </Text>
                    </div>
                  ))}
                  <Text size={13.5} color="var(--tg-textSecondary)">{t('Info')}</Text>
                </div>
              </div>
            ) : isGroup ? (
              <Row
                icon={<TgIcon name="link" size={24} />}
                label={`t.me/+${chat.id}9yJiODEy`}
                sublabel={t('Link')}
                translate={false}
              />
            ) : (
              <>
                {/* Порядок строк — как в tweb peerProfile MainSection: Phone → Username → Bio.
                    Телефон и bio — моки, пока бэк их не отдаёт. */}
                <Row
                  icon={<TgIcon name="phone" size={24} />}
                  label="+7 999 000 11 22"
                  sublabel={t('Phone')}
                  translate={false}
                />
                <Row
                  icon={<TgIcon name="mention" size={24} />}
                  label={chat.username ?? chat.name.toLowerCase()}
                  sublabel={t('Username')}
                  translate={false}
                />
                <Row
                  icon={<TgIcon name="info" size={24} />}
                  label={chat.description ?? 'Люблю музыку, книги и путешествия'}
                  sublabel={t('Bio')}
                  translate={false}
                />
              </>
            )}
          </Section>

          {/* Уведомления — отдельная карточка (как Night Mode в настройках) */}
          <Section>
            <Row
              icon={<TgIcon name="unmute" size={24} />}
              label="Notifications"
              toggle
              checked={notif}
              onClick={() => setNotif((v) => !v)}
            />
          </Section>

          {/* Channel discussions: admin (creator/CHANGE_INFO) toggle / enabled state */}
          {isRealChat && isChannel && canManageDiscussion && (
            <div className={s.section}>
              <Text size={14} weight={600} color="var(--tg-accent)" className={s.sectionTitle}>
                Обсуждения
              </Text>
              <div className={s.cardPlain}>
                {discussionChatId > 0 ? (
                  <div className={s.enabledRow}>
                    <Text size={16} color="var(--tg-textPrimary)" style={{ flex: 1 }}>Обсуждения включены</Text>
                    <TgIcon name="check" size={22} color="var(--tg-accent)" />
                  </div>
                ) : (
                  <div className={s.actionWrap}>
                    <motion.div
                      whileTap={{ scale: 0.98 }}
                      onClick={() => void enableDiscussion()}
                      className={s.actionBtn}
                      style={{ opacity: enablingDiscussion ? 0.6 : 1 }}
                    >
                      Включить обсуждения
                    </motion.div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Real group/channel: members/subscribers list (loaded from groups.members) */}
          {isRealChat && realMembers && (
            <div className={s.section}>
              <Text size={14} weight={600} color="var(--tg-accent)" className={s.sectionTitle}>
                {isChannel ? 'Подписчики' : 'Участники'}
              </Text>
              <div className={s.cardPlain}>
                {realMembers.map((mem) => {
                  const openChat = () =>
                    onOpenPeer?.({ id: mem.userId, displayName: mem.displayName, username: mem.username, avatarUrl: mem.avatarUrl })
                  return (
                    <div key={mem.userId} className={s.memberRow}>
                      {/* avatar + name → open a private chat with this member */}
                      <div onClick={openChat} className={s.memberTap}>
                        <Avatar background="var(--tg-accent)" text={mem.displayName[0]?.toUpperCase()} src={mem.avatarUrl} size="md" />
                        <div className={s.grow}>
                          <Text noWrap size={16} color="var(--tg-textPrimary)">{mem.displayName}</Text>
                          <Text size={13.5} color={mem.online ? 'var(--tg-accent)' : 'var(--tg-textSecondary)'}>
                            {mem.online ? t('online') : t('last seen recently')}
                          </Text>
                        </div>
                      </div>
                      {/* role label → admin rights editor (creator/admins only) */}
                      <span
                        onClick={canManageAdmins ? () => setEditMember(mem) : undefined}
                        className={classNames(s.roleLabel, canManageAdmins ? s.roleClickable : '')}
                      >
                        {roleLabel(mem.role, isChannel)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Real group/channel: invite links (admins with INVITE_USERS / creator) */}
          {isRealChat && canInvite && (
            <div className={s.section}>
              <Text size={14} weight={600} color="var(--tg-accent)" className={s.sectionTitle}>
                Пригласительные ссылки
              </Text>
              <div className={s.cardPlain}>
                <div className={s.inviteRow}>
                  <Text size={16} color="var(--tg-textPrimary)" style={{ flex: 1 }}>Запрашивать одобрение</Text>
                  <TgSwitch checked={requireApproval} onClick={() => setRequireApproval((v) => !v)} />
                </div>
                {inviteLinks.map((link) => {
                  const fullUrl = `${location.origin}/join/${link.token}`
                  return (
                    <div key={link.token} className={s.inviteRow}>
                      <TgIcon name="link" size={24} color="var(--tg-textSecondary)" style={{ flexShrink: 0 }} />
                      <div className={s.grow}>
                        <Text size={15} color="var(--tg-link)" style={{ wordBreak: 'break-all' }}>{fullUrl}</Text>
                        {copiedToken === link.token ? (
                          <Text size={12.5} color="var(--tg-accent)">Скопировано</Text>
                        ) : (
                          link.requiresApproval && (
                            <Text size={12.5} color="var(--tg-textSecondary)">по заявке</Text>
                          )
                        )}
                      </div>
                      <IconButton onClick={() => copyInvite(link.token)} color={copiedToken === link.token ? 'var(--tg-accent)' : 'var(--tg-textSecondary)'} style={{ flexShrink: 0 }}>
                        <TgIcon name="copy" size={20} />
                      </IconButton>
                    </div>
                  )
                })}
                <div className={s.actionWrap}>
                  <motion.div
                    whileTap={{ scale: 0.98 }}
                    onClick={() => void createInvite()}
                    className={s.actionBtn}
                    style={{ opacity: creatingInvite ? 0.6 : 1 }}
                  >
                    <TgIcon name="adduser" size={22} />
                    Создать ссылку
                  </motion.div>
                </div>
              </div>
            </div>
          )}

          {/* Real group/channel: pending join requests (admins with INVITE_USERS / creator) */}
          {isRealChat && canInvite && joinRequests.length > 0 && (
            <div className={s.section}>
              <Text size={14} weight={600} color="var(--tg-accent)" className={s.sectionTitle}>
                Заявки на вступление
              </Text>
              <div className={s.cardPlain}>
                {joinRequests.map((req) => (
                  <div key={req.userId} className={s.requestRow}>
                    <Avatar background="var(--tg-accent)" text={req.displayName[0]?.toUpperCase()} size="md" />
                    <div className={s.grow}>
                      <Text noWrap size={16} color="var(--tg-textPrimary)">{req.displayName}</Text>
                    </div>
                    <IconButton
                      aria-label={`Одобрить заявку: ${req.displayName}`}
                      onClick={() => void approveJoinRequest(req.userId)}
                      color="var(--tg-accent)"
                      style={{ flexShrink: 0 }}
                    >
                      <TgIcon name="check" size={22} />
                    </IconButton>
                    <IconButton
                      aria-label={`Отклонить заявку: ${req.displayName}`}
                      onClick={() => void declineJoinRequest(req.userId)}
                      color="#ff595a"
                      style={{ flexShrink: 0 }}
                    >
                      <TgIcon name="close" size={22} />
                    </IconButton>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Shared media: табы Медиа/Файлы/Ссылки/Музыка/Голосовые (tweb sharedMedia).
              Контент пока моковый — реального API истории по типам ещё нет. */}
          <SharedMedia tab={tab} onTab={setTab} />
        </div>

        {/* Group add-member FAB */}
        {isGroup && (
          <motion.div
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.92 }}
            className={s.fab}
          >
            <TgIcon name="adduser" />
          </motion.div>
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
              onBack={() => setEditMember(null)}
              onSave={(bitmask) => saveRights(editMember.userId, bitmask)}
              onRemove={() => removeRights(editMember.userId)}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}

// Табы шаред-медиа профиля. Набор и порядок — из tweb sharedMedia.tsx
// (media → files → links → music → voice); контент — моки на наших примитивах.
const SHARED_TABS = ['Media', 'Files', 'Links', 'Music', 'Voice'] as const

function SharedMedia({ tab, onTab }: { tab: string; onTab: (v: string) => void }) {
  const t = useT()
  return (
    <>
      {/* Тот же framed-таб-ряд, что и у папок в списке чатов (FolderTabs) */}
      <div className={s.tabsWrap}>
        <Tabs value={tab} onChange={(v) => onTab(v as string)}>
          <Tabs.List framed>
            {SHARED_TABS.map((name) => (
              <Tabs.Tab key={name} value={name}>
                {t(name)}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
      </div>

      {tab === 'Media' && (
        <div className={s.mediaGrid}>
          {mockMedia.map((m, i) => (
            <div
              key={i}
              className={s.mediaTile}
              style={{ background: m.gradient, borderRadius: i === 0 ? '8px 0 0 0' : i === 2 ? '0 8px 0 0' : 0 }}
            >
              <span className={s.tileEmoji}>{m.emoji}</span>
              {m.duration && <span className={s.tileDuration}>{m.duration}</span>}
            </div>
          ))}
        </div>
      )}

      {tab === 'Files' && (
        <div className={s.mediaList}>
          {mockFiles.map((f) => (
            <div key={f.name} className={s.mediaRow}>
              <div className={s.rowSquare} style={{ background: f.color }}>{f.ext}</div>
              <div className={s.grow}>
                <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">{f.name}</Text>
                <Text size={13.5} color="var(--tg-textSecondary)">{f.meta}</Text>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'Links' && (
        <div className={s.mediaList}>
          {mockLinks.map((l) => (
            <div key={l.url} className={s.mediaRow}>
              <div className={s.rowSquare} style={{ background: l.gradient }}>
                <TgIcon name="link" size={22} color="#fff" />
              </div>
              <div className={s.grow}>
                <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">{l.title}</Text>
                <Text noWrap size={13.5} color="var(--tg-link)">{l.url}</Text>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'Music' && (
        <div className={s.mediaList}>
          {mockMusic.map((a) => (
            <div key={a.title} className={s.mediaRow}>
              <div className={s.rowPlay}>
                <TgIcon name="play" size={22} color="#fff" />
              </div>
              <div className={s.grow}>
                <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">{a.title}</Text>
                <Text noWrap size={13.5} color="var(--tg-textSecondary)">{a.artist} · {a.duration}</Text>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'Voice' && (
        <div className={s.mediaList}>
          {mockVoice.map((v, i) => (
            <div key={i} className={s.mediaRow}>
              <div className={s.rowPlay}>
                <TgIcon name="play" size={22} color="#fff" />
              </div>
              <div className={s.grow}>
                <div className={s.voiceWave}>
                  {VOICE_WAVE.map((h, wi) => (
                    <span key={wi} className={s.voiceWaveBar} style={{ height: `${Math.round(4 + h * 14)}px` }} />
                  ))}
                </div>
                <Text size={13.5} color="var(--tg-textSecondary)">{v.duration} · {v.meta}</Text>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
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
  onBack,
  onSave,
  onRemove,
}: {
  member: RealMember
  onBack: () => void
  onSave: (bitmask: number) => void | Promise<void>
  onRemove: () => void | Promise<void>
}) {
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
      className={s.rights}
    >
      <div className={s.rightsHeader}>
        <IconButton onClick={onBack} color="var(--tg-textSecondary)">
          <TgIcon name="back" />
        </IconButton>
        <Text noWrap size={19} weight={600} color="var(--tg-textPrimary)" style={{ flex: 1 }}>
          {member.displayName}
        </Text>
      </div>

      <div className={s.body}>
        <div className={s.section} style={{ marginTop: 0 }}>
          <Text size={14} weight={600} color="var(--tg-accent)" className={s.sectionTitle}>
            Права администратора
          </Text>
          <div className={s.cardPlain}>
            {RIGHTS.map((r) => (
              <div key={r.bit} onClick={() => toggle(r.bit)} className={s.rightRow}>
                <Text size={16} color="var(--tg-textPrimary)" style={{ flex: 1 }}>{r.label}</Text>
                <TgSwitch checked={(bits & r.bit) !== 0} />
              </div>
            ))}
          </div>
        </div>

        <div className={s.section} style={{ marginTop: 12 }}>
          <motion.div
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
            className={s.saveBtn}
            style={{ opacity: saving ? 0.6 : 1 }}
          >
            Сохранить
          </motion.div>
          {isAdmin && (
            <div
              onClick={async () => {
                if (saving) return
                setSaving(true)
                try {
                  await onRemove()
                } finally {
                  setSaving(false)
                }
              }}
              className={s.removeBtn}
            >
              Снять права
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
