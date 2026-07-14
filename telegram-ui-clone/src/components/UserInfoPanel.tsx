import { useEffect, useState } from 'react'
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
import { useManagers } from '../core/hooks/useManagers'
import { useLang } from '../i18n'
import { friendlyMsgTime } from '../core/friendlyTime'
import { mediaThumbUrl } from '../core/mediaUrl'
import type { Message } from '../core/models'
import MediaLightbox, { type LightboxItem } from './messages/MediaLightbox'
import s from './UserInfoPanel.module.scss'
import useMediaQuery from '../shared/lib/useMediaQuery'


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
          {/* isRealChat из useGroupInfo — только группы/каналы; для шаред-медиа
              реальность чата определяем по numeric id (private тоже подходит) */}
          <SharedMedia tab={tab} onTab={setTab} chatId={sharedMediaChatId(chat.id)} />
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
// (media → files → links → music → voice); данные — реальная история чата
// (GET /chats/{id}/media?filter=...), загружается при первом открытии таба.
const SHARED_TABS = ['Media', 'Files', 'Links', 'Music', 'Voice'] as const

// numeric id реального чата (private/группа/канал) либо null для драфтов
function sharedMediaChatId(id: string): number | null {
  const n = Number(id)
  return Number.isFinite(n) && String(n) === id ? n : null
}
const TAB_FILTER: Record<string, 'media' | 'files' | 'links' | 'music' | 'voice'> = {
  Media: 'media', Files: 'files', Links: 'links', Music: 'music', Voice: 'voice',
}

const fmtDur = (sec?: number) => sec == null ? '' : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
function fmtSize(b?: number): string {
  if (b == null) return ''
  if (b >= 1 << 20) return `${(b / (1 << 20)).toFixed(1)} МБ`
  if (b >= 1 << 10) return `${Math.max(1, Math.round(b / (1 << 10)))} КБ`
  return `${b} Б`
}
const EXT_COLORS: Record<string, string> = {
  pdf: '#e5322e', doc: '#4285f4', docx: '#4285f4', xls: '#00a884', xlsx: '#00a884',
  zip: '#8774e1', rar: '#8774e1', png: '#f2994a', jpg: '#f2994a', jpeg: '#f2994a', mp4: '#642bc6',
}
const extOf = (name?: string) => (name?.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '')
const firstUrl = (text: string) => text.match(/https?:\/\/[^\s]+/)?.[0] ?? ''
const hostOf = (url: string) => { try { return new URL(url).hostname } catch { return url } }

function SharedMedia({ tab, onTab, chatId }: { tab: string; onTab: (v: string) => void; chatId: number | null }) {
  const t = useT()
  const [lang] = useLang()
  const managers = useManagers()
  // кэш по фильтру: загружаем таб один раз за открытие панели
  const [byFilter, setByFilter] = useState<Partial<Record<string, Message[]>>>({})
  const filter = TAB_FILTER[tab]

  useEffect(() => {
    if (chatId == null || byFilter[filter]) return
    void managers.messages
      .mediaHistory(chatId, filter)
      .then((r) => setByFilter((d) => ({ ...d, [filter]: r.messages })))
      .catch(() => setByFilter((d) => ({ ...d, [filter]: [] })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, filter])

  const msgs = byFilter[filter]
  const when = (m: Message) => friendlyMsgTime(m.createdAt, lang)

  // Просмотрщик медиа — тот же MediaLightbox, что в чате (клик по тайлу).
  const [lightbox, setLightbox] = useState<{
    items: LightboxItem[]
    index: number
    originRect: { top: number; left: number; width: number; height: number }
    originSrc?: string
    originEl: HTMLElement
  } | null>(null)
  const openMedia = (index: number, e: React.MouseEvent<HTMLDivElement>) => {
    const list = (msgs ?? []).filter((m) => m.mediaId != null)
    const items: LightboxItem[] = list.map((m) => ({ mediaId: m.mediaId as number, type: m.type, date: when(m) }))
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const img = el.querySelector('img')
    el.style.visibility = 'hidden' // как в чате: оригинал прячется под клоном
    setLightbox({
      items, index,
      originRect: { top: r.top, left: r.left, width: r.width, height: r.height },
      originSrc: img?.currentSrc || img?.src, originEl: el,
    })
  }
  const empty = (
    <Text size={14} color="var(--tg-textSecondary)" style={{ padding: '16px 24px', display: 'block', textAlign: 'center' }}>
      {t('Nothing here yet.')}
    </Text>
  )

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

      {msgs != null && msgs.length === 0 && empty}

      {tab === 'Media' && msgs != null && msgs.length > 0 && (
        <div className={s.mediaGrid}>
          {msgs.map((m, i) => (
            <div
              key={m.id}
              className={s.mediaTile}
              onClick={(e) => openMedia(i, e)}
              style={{ borderRadius: i === 0 ? '8px 0 0 0' : i === 2 ? '0 8px 0 0' : 0, cursor: 'pointer' }}
            >
              {m.mediaId != null && <img className={s.tileImg} src={mediaThumbUrl(m.mediaId)} alt="" loading="lazy" />}
              {m.type === 'video' && <span className={s.tileDuration}>{fmtDur(m.mediaDuration)}</span>}
            </div>
          ))}
        </div>
      )}

      {tab === 'Files' && msgs != null && msgs.length > 0 && (
        <div className={s.mediaList}>
          {msgs.map((m) => (
            <div key={m.id} className={s.mediaRow}>
              <div className={s.rowSquare} style={{ background: EXT_COLORS[extOf(m.mediaName)] ?? 'var(--tg-accent)' }}>
                {extOf(m.mediaName).toUpperCase().slice(0, 4) || 'FILE'}
              </div>
              <div className={s.grow}>
                <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">{m.mediaName || t('Document')}</Text>
                <Text size={13.5} color="var(--tg-textSecondary)">{[fmtSize(m.mediaSize), when(m)].filter(Boolean).join(' · ')}</Text>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'Links' && msgs != null && msgs.length > 0 && (
        <div className={s.mediaList}>
          {msgs.map((m) => {
            const url = firstUrl(m.text)
            return (
              <div key={m.id} className={s.mediaRow} onClick={() => window.open(url, '_blank', 'noopener')} style={{ cursor: 'pointer' }}>
                <div className={s.rowSquare} style={{ background: 'var(--tg-accentGradient)' }}>
                  {hostOf(url).charAt(0).toUpperCase()}
                </div>
                <div className={s.grow}>
                  <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">{hostOf(url)}</Text>
                  <Text noWrap size={13.5} color="var(--tg-link)">{url}</Text>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'Music' && msgs != null && msgs.length > 0 && (
        <div className={s.mediaList}>
          {msgs.map((m) => (
            <div key={m.id} className={s.mediaRow}>
              <div className={s.rowPlay}>
                <TgIcon name="play" size={22} color="#fff" />
              </div>
              <div className={s.grow}>
                <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">{m.mediaName || t('Audio')}</Text>
                <Text noWrap size={13.5} color="var(--tg-textSecondary)">{[fmtDur(m.mediaDuration), when(m)].filter(Boolean).join(' · ')}</Text>
              </div>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          originRect={lightbox.originRect}
          originSrc={lightbox.originSrc}
          onClosingStart={() => { lightbox.originEl.style.visibility = '' }}
          onClose={() => { lightbox.originEl.style.visibility = ''; setLightbox(null) }}
        />
      )}

      {tab === 'Voice' && msgs != null && msgs.length > 0 && (
        <div className={s.mediaList}>
          {msgs.map((m) => (
            <div key={m.id} className={s.mediaRow}>
              <div className={s.rowPlay}>
                <TgIcon name="play" size={22} color="#fff" />
              </div>
              <div className={s.grow}>
                <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">{t('Voice message')}</Text>
                <Text size={13.5} color="var(--tg-textSecondary)">{[fmtDur(m.mediaDuration), when(m)].filter(Boolean).join(' · ')}</Text>
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
