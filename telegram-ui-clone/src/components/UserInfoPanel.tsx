import { useEffect, useRef, useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import TgSwitch from './TgSwitch'
import { Tabs, TabSlide, TabsBar } from '../shared/ui/Tabs'
import QrModal from './QrModal'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE, DUR, slideInRight } from '../motion'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import { useAvatarSrc } from './useAvatarSrc'
import UserAvatar from './UserAvatar'
import { fmtWhen, mediaLabel } from '../core/dialogToChat'
import type { SavedDialog } from '../core/managers/chatsManager'
import EditView from './EditView'
import GroupEditFlow from './group/GroupEditFlow'
import AddMembersScreen from './group/AddMembersScreen'
import { Section, Row } from './settings/kit'
import classNames from '../shared/lib/classNames'
import type { Chat, OpenPeer } from '../data'
import { useT } from '../i18n'
import { useGroupInfo, RIGHTS, roleLabel, type RealMember } from '../core/hooks/useGroupInfo'
import { useMessagesStore } from '../stores/messagesStore'
import { useChatsStore, loadChats } from '../stores/chatsStore'
import { useSecretChatStore } from '../stores/secretChatStore'
import { useAudioStore, type AudioTrack } from '../stores/audioStore'
import { markMediaPlayed } from '../core/mediaRead'
import PlayPauseGlyph from './PlayPauseGlyph'
import { useManagers } from '../core/hooks/useManagers'
import { useLang } from '../i18n'
import { lastSeenLabel } from '../core/presence'
import { friendlyMsgTime } from '../core/friendlyTime'
import { EXT_COLORS, extOf, firstUrl, fmtDur, fmtSize, hostOf } from '../core/sharedMediaFmt'
import { mediaContentUrl, mediaThumbUrl } from '../core/mediaUrl'
import type { Message } from '../core/models'
import MediaLightbox, { type LightboxItem } from './messages/MediaLightbox'
import s from './UserInfoPanel.module.scss'
import useMediaQuery from '../shared/lib/useMediaQuery'
import type { UserProfile } from '../core/managers/privacyManager'
import type { GiftInfo } from '../core/managers/starsManager'
import StarIcon from './stars/StarIcon'
import SendGiftPopup from './stars/SendGiftPopup'
import GiftInfoPopup from './stars/GiftInfoPopup'
import KeyVerificationPopup from './secret/KeyVerificationPopup'

// склонение «N единиц» (счётчики подзаголовков)
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  const word = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many
  return `${n} ${word}`
}

// «N участник(а/ов)» — склонение для подзаголовка профиля группы
function membersLabel(n: number, isChannel: boolean): string {
  if (isChannel) return `${n} подписчиков`
  return plural(n, 'участник', 'участника', 'участников')
}

// «N чат(а/ов)» — подзаголовок «Избранного» (число сохранённых диалогов)
const chatsLabel = (n: number) => plural(n, 'чат', 'чата', 'чатов')

// подпись счётчика активного таба в залитой шапке (tweb sharedMedia.tsx:
// пары type→LangPackKey — Members/MediaFiles/Files/Links/MusicFiles/Voice)
function countLabel(tab: string, n: number, isChannel: boolean): string {
  switch (tab) {
    case 'Members': return membersLabel(n, isChannel)
    case 'Chats': return chatsLabel(n)
    case 'Gifts': return plural(n, 'подарок', 'подарка', 'подарков')
    case 'Media': return plural(n, 'медиафайл', 'медиафайла', 'медиафайлов')
    case 'Files': return plural(n, 'файл', 'файла', 'файлов')
    case 'Links': return plural(n, 'ссылка', 'ссылки', 'ссылок')
    case 'Music': return plural(n, 'аудиофайл', 'аудиофайла', 'аудиофайлов')
    case 'Voice': return plural(n, 'голосовое сообщение', 'голосовых сообщения', 'голосовых сообщений')
    default: return String(n)
  }
}

// высота шапки панели — sticky-отступ табов и порог header-filled (tweb 3.5rem)
const HEADER_H = 56

export default function UserInfoPanel({ chat, onClose, onOpenPeer, onChatCreated, canAddMembers }: { chat: Chat; onClose: () => void; onOpenPeer?: (peer: OpenPeer) => void; onChatCreated?: (chatId: number) => void; canAddMembers?: boolean }) {
  const t = useT()
  const narrow = useMediaQuery('(max-width:900px)')
  const managers = useManagers()
  const isSaved = chat.type === 'saved'
  // группы — таб «Участники», избранное — «Чаты» (tweb savedDialogs first), остальные — «Медиа»
  const [tab, setTab] = useState(chat.type === 'group' ? 'Members' : isSaved ? 'Chats' : 'Media')

  // «Избранное»: сохранённые диалоги (группировка по источнику пересылки)
  const [savedDialogs, setSavedDialogs] = useState<SavedDialog[] | null>(null)
  useEffect(() => {
    if (!isSaved) return
    void managers.chats.savedDialogs().then(setSavedDialogs).catch(() => setSavedDialogs([]))
  }, [isSaved, managers])
  const [editing, setEditing] = useState(false)
  const [addingMembers, setAddingMembers] = useState(false)
  const headerAvatarSrc = useAvatarSrc(chat.avatarUrl)

  // Чужой профиль с применённой конфиденциальностью (GET /users/{id}):
  // телефон/bio/день рождения приходят пустыми, если скрыты правилами.
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const peerId = chat.peerId
  useEffect(() => {
    if (isSaved || peerId == null) return
    let alive = true
    void managers.privacy.profile(peerId).then((p) => {
      if (alive) setProfile(p)
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [isSaved, peerId, managers])

  // Тумблер Notifications = per-chat mute (tweb PeerProfile: checked = !muted,
  // переключение — togglePeerMute напрямую, без попапа длительности)
  const numericChatId = Number(chat.id)
  const setDialogMuted = useChatsStore((st) => st.setDialogMuted)
  const dialogMuted = useChatsStore((st) => st.dialogs.find((d) => d.chatId === numericChatId)?.muted)
  const muted = dialogMuted ?? !!chat.muted
  const toggleNotifications = () => {
    const next = !muted
    setDialogMuted(numericChatId, next) // оптимистично
    void managers.groups.setMute(numericChatId, next).catch(() => setDialogMuted(numericChatId, !next))
  }

  // per-chat уведомления (tweb PeerNotifySettings): превью текста + звук.
  const setDialogNotify = useChatsStore((st) => st.setDialogNotify)
  const notifyDialog = useChatsStore((st) => st.dialogs.find((d) => d.chatId === numericChatId))
  const notifyPreview = notifyDialog?.notifyPreview ?? true
  const notifySoundOn = (notifyDialog?.notifySound ?? 'default') !== 'none'
  const toggleNotifyPreview = () => {
    const next = !notifyPreview
    setDialogNotify(numericChatId, { notifyPreview: next })
    void managers.groups.setNotify(numericChatId, { preview: next })
      .catch(() => setDialogNotify(numericChatId, { notifyPreview: !next }))
  }
  const toggleNotifySound = () => {
    const next = notifySoundOn ? 'none' : 'default'
    setDialogNotify(numericChatId, { notifySound: next })
    void managers.groups.setNotify(numericChatId, { sound: next })
      .catch(() => setDialogNotify(numericChatId, { notifySound: notifySoundOn ? 'default' : 'none' }))
  }

  const {
    isRealChat,
    isChannel,
    isGroup,
    realMembers,
    canManageAdmins,
    canInvite,
    canManageDiscussion,
    canManageTopics,
    discussionChatId,
    enablingDiscussion,
    inviteLinks,
    joinRequests,
    editMember,
    setEditMember,
    approveJoinRequest,
    declineJoinRequest,
    saveRights,
    removeRights,
    enableDiscussion,
    refreshMembers,
  } = useGroupInfo(chat)

  const title = isSaved ? 'Saved Messages' : isChannel ? 'Channel Info' : isGroup ? 'Group Info' : 'User Info'

  // ── аватар (tweb peerProfileAvatars): по дефолту свёрнут в круг (collapsed);
  // клик разворачивает в большое фото на всю ширину (unfold), скролл вниз
  // сворачивает обратно ──
  const [expanded, setExpanded] = useState(false)

  // ── скролл-поведение шапки: при скролле до табов шаред-медиа шапка
  // заливается и показывает «имя + счётчик активного таба» (tweb sharedMedia.tsx
  // setIsSharedMedia / TransitionSlider) ──
  const [filled, setFilled] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const tabsBarRef = useRef<HTMLDivElement>(null)
  const onBodyScroll = () => {
    const body = bodyRef.current, bar = tabsBarRef.current
    if (!body || !bar) return
    // скролл вниз сворачивает развёрнутое фото обратно в круг (tweb collapse)
    if (body.scrollTop > 4) setExpanded(false)
    // порог tweb: верх таб-плашки доехал до низа шапки (top <= OFFSET)
    const top = bar.getBoundingClientRect().top - body.getBoundingClientRect().top
    setFilled(top <= HEADER_H + 1)
  }
  // клик по «назад» в залитой шапке — к началу профиля (tweb closeBtn: scrollIntoView profile-content)
  const scrollBackToProfile = () => bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' })

  // счётчики табов шаред-медиа для подзаголовка залитой шапки (tweb onLengthChange)
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({})
  const activeCount = tab === 'Members'
    ? realMembers?.length
    : tab === 'Chats'
      ? savedDialogs?.length
      : tabCounts[tab]

  // Онлайн-статус приватного собеседника — из presence-стора (как в топбаре
  // ChatHeader), а не из статичного chat.status: «в сети» / «был(а) …».
  const [lang] = useLang()
  const peerPresence = useChatsStore((st) => (peerId != null ? st.presence[peerId] : undefined))
  const presenceLabel =
    !isSaved && !isGroup && !isChannel
      ? peerPresence
        ? peerPresence.online
          ? t('online')
          : lastSeenLabel(peerPresence.lastSeen, lang)
        : chat.status
      : null
  const statusOnline = !!peerPresence?.online

  const subtitleText = isSaved
    ? chatsLabel(savedDialogs?.length ?? 0)
    : isRealChat && (isGroup || isChannel) && realMembers
      ? membersLabel(realMembers.length, isChannel)
      : presenceLabel ?? chat.status

  // просмотрщик фото профиля (tweb: клик по аватарке открывает фото)
  const avatarWrapRef = useRef<HTMLDivElement>(null)
  const [avatarView, setAvatarView] = useState<{
    originRect: { top: number; left: number; width: number; height: number }
    originEl: HTMLElement
  } | null>(null)
  // Профиль-галерея (tweb getUserPhotos): при открытии просмотрщика тянем все
  // фото пользователя и листаем их каруселью. Пусто/ошибка → одиночный аватар.
  const [avatarPhotos, setAvatarPhotos] = useState<LightboxItem[] | null>(null)
  const openAvatarViewer = () => {
    const el = avatarWrapRef.current
    if (!el || !headerAvatarSrc) return
    const r = el.getBoundingClientRect()
    setAvatarView({ originRect: { top: r.top, left: r.left, width: r.width, height: r.height }, originEl: el })
    setAvatarPhotos(null)
    if (peerId == null || isSaved) return
    void managers.profile.listPhotos(peerId).then(async (photos) => {
      const items = await Promise.all(photos.map(async (p): Promise<LightboxItem> => {
        const m = p.url.match(/\/media\/(\d+)\/content/)
        const src = m ? await managers.media.contentUrl(Number(m[1])) : p.url
        // Видео-аватар (tweb photo_video): резолвим video_url в токен-URL так же,
        // как still. Заголовок/список чатов остаются на still — это осознанный
        // лимит MVP (playback только в просмотрщике).
        if (p.videoUrl) {
          const vm = p.videoUrl.match(/\/media\/(\d+)\/content/)
          const videoUrl = vm ? await managers.media.contentUrl(Number(vm[1])) : p.videoUrl
          return { src, videoUrl, type: 'video' }
        }
        return { src }
      }))
      if (items.length) setAvatarPhotos(items)
    }).catch(() => {})
  }
  const closeAvatarViewer = () => { setAvatarView(null); setAvatarPhotos(null) }

  // Подарки в профиле (tweb Gifts tab) — только для пользователя (private).
  const meId = useChatsStore((st) => st.meId)
  const isUser = !isSaved && !isGroup && !isChannel && peerId != null

  // Начать секретный чат (tweb btnStartSecretChat): E2E-handshake через
  // managers.secret.start, затем открыть созданный чат в статусе «ожидание».
  const [startingSecret, setStartingSecret] = useState(false)
  const canStartSecret = isUser && peerId !== meId && chat.type === 'private'
  const startSecretChat = async () => {
    if (startingSecret || peerId == null) return
    setStartingSecret(true)
    try {
      const { chatId } = await managers.secret.start(peerId)
      useSecretChatStore.getState().setStatus(chatId, 'awaiting')
      onChatCreated?.(chatId)
    } catch {
      setStartingSecret(false)
    }
  }
  // «Ключ шифрования» (tweb chatEncryptionKey) — только для секретного чата.
  const isSecret = chat.type === 'secret'
  const [keyPopupOpen, setKeyPopupOpen] = useState<boolean | null>(null)
  const [giftPopupOpen, setGiftPopupOpen] = useState(false)
  const [gifts, setGifts] = useState<GiftInfo[]>([])
  const [selectedGift, setSelectedGift] = useState<GiftInfo | null>(null)
  const loadGifts = () => {
    if (!isUser || peerId == null) return
    void managers.stars.profileGifts(peerId).then(setGifts).catch(() => setGifts([]))
  }
  useEffect(() => {
    loadGifts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUser, peerId])

  // Ссылка группы в инфо-карточке: публичный username, иначе первая инвайт-ссылка.
  const inviteUrl = chat.username
    ? `${location.origin}/@${chat.username}`
    : inviteLinks[0]
      ? `${location.origin}/join/${inviteLinks[0].token}`
      : null
  const inviteShort = inviteUrl?.replace(/^https?:\/\//, '') ?? ''
  const [panelLinkCopied, setPanelLinkCopied] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const copyPanelLink = () => {
    if (!inviteUrl) return
    void navigator.clipboard.writeText(inviteUrl)
    setPanelLinkCopied(true)
    setTimeout(() => setPanelLinkCopied(false), 1500)
  }

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
        {/* Шапка: absolute поверх контента. Над фото — прозрачная с белыми
            иконками (tweb .profile-container:not(.header-filled) .sidebar-header
            + .need-white); у табов — заливка, X→назад, «имя + счётчик таба»
            слайд-фейдом (tweb setIsSharedMedia + TransitionSlider slide-fade). */}
        {/* Шапка панели (tweb sidebar-header): X/карандаш; при скролле до табов
            заливается и показывает «имя + счётчик активного таба» слайд-фейдом,
            X→стрелка назад (tweb setIsSharedMedia + TransitionSlider). */}
        <div className={classNames(s.header, filled ? s.headerFilled : '')}>
          <IconButton onClick={filled ? scrollBackToProfile : onClose} color="var(--tg-textSecondary)">
            <TgIcon name={filled ? 'back' : 'close'} />
          </IconButton>
          <div className={s.headerTitles}>
            <AnimatePresence initial={false}>
              {filled && activeCount != null ? (
                <motion.div
                  key="peer"
                  className={s.headerTitleItem}
                  initial={{ y: 14, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 14, opacity: 0 }}
                  transition={{ duration: 0.2, ease: EASE }}
                >
                  <Text noWrap size={16} weight={600} color="var(--tg-textPrimary)">{isSaved ? t('Saved Messages') : chat.name}</Text>
                  <Text noWrap size={13} color="var(--tg-textSecondary)">{countLabel(tab, activeCount, isChannel)}</Text>
                </motion.div>
              ) : (
                <motion.div
                  key="title"
                  className={s.headerTitleItem}
                  initial={{ y: -14, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -14, opacity: 0 }}
                  transition={{ duration: 0.2, ease: EASE }}
                >
                  <Text noWrap size={19} weight={600} color="var(--tg-textPrimary)">{t(title)}</Text>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {(isGroup || isChannel) && (
            <IconButton onClick={() => setEditing(true)} color="var(--tg-textSecondary)">
              <TgIcon name="edit" />
            </IconButton>
          )}
        </div>

        <div ref={bodyRef} className={classNames(s.body, s.bodyPad)} onScroll={onBodyScroll}>
          {/* Аватар: свёрнут в круг по центру (tweb collapsed) → клик разворачивает
              в большое фото на всю ширину (unfold) → клик по нему открывает
              просмотрщик; скролл сворачивает обратно (onBodyScroll). */}
          <AnimatePresence mode="wait" initial={false}>
            {expanded && headerAvatarSrc ? (
              <motion.div
                key="big"
                ref={avatarWrapRef}
                className={s.profileAvatars}
                onClick={openAvatarViewer}
                initial={{ scale: 0.35 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.35 }}
                transition={{ duration: 0.24, ease: EASE }}
              >
                <img className={s.profilePhoto} src={headerAvatarSrc} alt="" draggable={false} />
                <div className={s.avatarsGradient} />
                <div className={classNames(s.avatarsGradient, s.avatarsGradientTop)} />
                <div className={s.avatarsInfo}>
                  <div className={s.profileName}>{chat.name}</div>
                  <div className={s.profileSubtitle}>{subtitleText}</div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="small"
                className={s.avatarBlock}
                initial={{ scale: 1.15 }}
                animate={{ scale: 1 }}
                exit={{ scale: 1.15 }}
                transition={{ duration: 0.2, ease: EASE }}
              >
                <div
                  onClick={() => { if (headerAvatarSrc) setExpanded(true) }}
                  style={{ cursor: headerAvatarSrc ? 'pointer' : 'default', borderRadius: '50%' }}
                >
                  <Avatar background={chat.avatar} text={chat.avatarText} emoji={chat.avatarEmoji} src={headerAvatarSrc} size="profile" />
                </div>
                <Text size={21} weight={600} color="var(--tg-textPrimary)" style={{ marginTop: '8px', textAlign: 'center', paddingLeft: '16px', paddingRight: '16px' }}>
                  {chat.name}
                </Text>
                <Text size={14} color={statusOnline ? 'var(--tg-accent)' : 'var(--tg-textSecondary)'}>
                  {subtitleText}
                </Text>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Info card — те же секции, что в настройках (settings/kit Section+Row).
              В «Избранном» её нет вовсе (tweb: свой профиль без phone/username/bio). */}
          {!isSaved && (
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
              inviteUrl && (
                <div className={s.linkRow} onClick={() => copyPanelLink()}>
                  <TgIcon name="link" size={24} color="var(--tg-textSecondary)" />
                  <div className={s.grow}>
                    <Text size={16} color="var(--tg-textPrimary)" style={{ wordBreak: 'break-all' }}>{inviteShort}</Text>
                    <Text size={13.5} color={panelLinkCopied ? 'var(--tg-accent)' : 'var(--tg-textSecondary)'}>
                      {panelLinkCopied ? t('Link copied to clipboard.') : t('Link')}
                    </Text>
                  </div>
                  <IconButton
                    size="small"
                    color="var(--tg-textSecondary)"
                    onClick={(e) => { e.stopPropagation(); setQrOpen(true) }}
                    aria-label="QR"
                  >
                    <TgIcon name="qr" size={22} />
                  </IconButton>
                </div>
              )
            ) : (
              <>
                {/* Порядок строк — как в tweb peerProfile MainSection: Phone →
                    Username → Bio → Birthday. Данные — GET /users/{id} с уже
                    применённой конфиденциальностью: скрытое сюда не приходит. */}
                {profile?.phone && (
                  <Row
                    icon={<TgIcon name="phone" size={24} />}
                    label={profile.phone}
                    sublabel={t('Phone')}
                    translate={false}
                  />
                )}
                {(profile?.username ?? chat.username) && (
                  <Row
                    icon={<TgIcon name="mention" size={24} />}
                    label={`@${profile?.username ?? chat.username}`}
                    sublabel={t('Username')}
                    translate={false}
                  />
                )}
                {profile?.bio && (
                  <Row
                    icon={<TgIcon name="info" size={24} />}
                    label={profile.bio}
                    sublabel={t('Bio')}
                    translate={false}
                  />
                )}
                {profile?.birthday && (
                  <Row
                    icon={<TgIcon name="gift" size={24} />}
                    label={profile.birthday}
                    sublabel={t('Birthday')}
                    translate={false}
                  />
                )}
              </>
            )}
            <Row
              icon={<TgIcon name="unmute" size={24} />}
              label="Notifications"
              toggle
              checked={!muted}
              onClick={toggleNotifications}
            />
            {!muted && (
              <>
                <Row
                  icon={<TgIcon name="message" size={24} />}
                  label="Message Preview"
                  toggle
                  checked={notifyPreview}
                  onClick={toggleNotifyPreview}
                />
                <Row
                  icon={<TgIcon name={notifySoundOn ? 'volume_up' : 'nosound'} size={24} />}
                  label="Notification Sound"
                  toggle
                  checked={notifySoundOn}
                  onClick={toggleNotifySound}
                />
              </>
            )}
          </Section>
          )}

          {/* Подарить подарок (tweb btnSendGift) — чужому пользователю */}
          {isUser && peerId !== meId && (
            <Section>
              <Row
                icon={<TgIcon name="gift" size={24} />}
                label="Send a Gift"
                accent
                onClick={() => setGiftPopupOpen(true)}
              />
            </Section>
          )}

          {/* Начать секретный чат (tweb btnStartSecretChat) — E2E-чат с собеседником */}
          {canStartSecret && (
            <Section>
              <Row
                icon={<TgIcon name="lock" size={24} />}
                label="Start Secret Chat"
                accent
                onClick={() => { void startSecretChat() }}
              />
            </Section>
          )}

          {/* Ключ шифрования (tweb chatEncryptionKey) — emoji-fingerprint секретного чата */}
          {isSecret && (
            <Section>
              <Row
                icon={<TgIcon name="key" size={24} />}
                label="Encryption Key"
                onClick={() => setKeyPopupOpen(true)}
              />
            </Section>
          )}


          {/* Темы (tweb editChat Topics toggle): группа → форум-топики */}
          {isRealChat && chat.type === 'group' && canManageTopics && (
            <div className={s.section}>
              <Text size={14} weight={600} color="var(--tg-accent)" className={s.sectionTitle}>
                {t('Topics')}
              </Text>
              <div className={s.cardPlain}>
                <div
                  className={s.enabledRow}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    const next = !chat.isForum
                    void managers.groups.setForum(Number(chat.id), next).then(() => loadChats(managers))
                  }}
                >
                  <Text size={16} color="var(--tg-textPrimary)" style={{ flex: 1 }}>{t('Topics')}</Text>
                  <TgSwitch checked={!!chat.isForum} />
                </div>
              </div>
            </div>
          )}

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
          {/* блок не ниже вьюпорта панели — табы всегда доезжают до шапки
              (tweb _searchSuper.scss: min-height var(--super-height)) */}
          <div className={s.sharedWrap}>
          <SharedMedia
            tab={tab}
            onTab={setTab}
            chatId={sharedMediaChatId(chat.id)}
            members={isRealChat && (isGroup || isChannel) ? realMembers ?? [] : undefined}
            savedDialogs={isSaved ? savedDialogs ?? [] : undefined}
            gifts={isUser ? gifts : undefined}
            onOpenGift={setSelectedGift}
            isChannel={isChannel}
            canManageAdmins={canManageAdmins}
            onOpenPeer={onOpenPeer}
            onEditMember={setEditMember}
            navRef={tabsBarRef}
            stickyTop={0}
            onCount={(name, n) => setTabCounts((c) => (c[name] === n ? c : { ...c, [name]: n }))}
          />
          </div>

          {/* просмотрщик фото профиля (tweb openAvatarViewer) */}
          {avatarView && headerAvatarSrc && (
            <MediaLightbox
              items={avatarPhotos ?? [{ src: headerAvatarSrc }]}
              index={0}
              originRect={avatarView.originRect}
              originSrc={headerAvatarSrc}
              originEl={avatarView.originEl}
              onClose={closeAvatarViewer}
            />
          )}

          {/* Подарить подарок / инфо полученного подарка (tweb PopupSendGift /
              PopupStarGiftInfo) */}
          {isUser && peerId != null && (
            <SendGiftPopup
              open={giftPopupOpen}
              onClose={() => setGiftPopupOpen(false)}
              toUserId={peerId}
              toName={chat.name}
              onSent={loadGifts}
            />
          )}
          {selectedGift && (
            <GiftInfoPopup
              gift={selectedGift}
              isOwner={peerId === meId}
              onClose={() => setSelectedGift(null)}
              onChanged={loadGifts}
            />
          )}

          {/* Ключ шифрования секретного чата (tweb chatEncryptionKey) */}
          {isSecret && keyPopupOpen != null && (
            <KeyVerificationPopup
              open={keyPopupOpen}
              onClose={() => setKeyPopupOpen(false)}
              onExitComplete={() => setKeyPopupOpen(null)}
              chatId={numericChatId}
            />
          )}

          {/* QR-код ссылки (иконка в инфо-карточке) — tweb-модалка с темами */}
          {inviteUrl && (
            <QrModal
              open={qrOpen}
              onClose={() => setQrOpen(false)}
              url={inviteUrl}
              label={chat.name}
              avatar={{ src: headerAvatarSrc, background: chat.avatar, text: chat.avatarText }}
            />
          )}
        </div>

        {/* Group add-member FAB (tweb btnAddMembers) */}
        {isGroup && canAddMembers && isRealChat && (
          <motion.div
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.92 }}
            className={s.fab}
            onClick={() => setAddingMembers(true)}
          >
            <TgIcon name="adduser" />
          </motion.div>
        )}

        {/* Edit screen overlay */}
        <AnimatePresence>
          {editing && (isGroup && isRealChat
            ? <GroupEditFlow chatId={Number(chat.id)} chat={chat} onClose={() => setEditing(false)} />
            : <EditView chat={chat} onBack={() => setEditing(false)} />)}
          {addingMembers && isRealChat && (
            <AddMembersScreen
              chatId={Number(chat.id)}
              existingIds={(realMembers ?? []).map((m) => m.userId)}
              onClose={() => setAddingMembers(false)}
              onAdded={() => {
                setAddingMembers(false)
                void refreshMembers()
              }}
            />
          )}
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


function SharedMedia({ tab, onTab, chatId, members, savedDialogs, gifts, onOpenGift, isChannel, canManageAdmins, onOpenPeer, onEditMember, navRef, stickyTop, onCount }: {
  tab: string
  onTab: (v: string) => void
  chatId: number | null
  /** участники для первого таба (только реальные группы/каналы) */
  members?: RealMember[]
  /** «Избранное»: сохранённые диалоги для первого таба «Чаты» */
  savedDialogs?: SavedDialog[]
  /** подарки профиля пользователя (таб «Подарки») */
  gifts?: GiftInfo[]
  onOpenGift?: (g: GiftInfo) => void
  isChannel?: boolean
  canManageAdmins?: boolean
  onOpenPeer?: (peer: OpenPeer) => void
  onEditMember?: (m: RealMember) => void
  /** реф таб-плашки — родитель меряет её позицию при скролле (header-filled) */
  navRef?: React.Ref<HTMLDivElement>
  /** sticky-отступ табов под absolute-шапкой панели */
  stickyTop?: number
  /** счётчик загруженного таба — подзаголовок залитой шапки (tweb onLengthChange) */
  onCount?: (tab: string, n: number) => void
}) {
  const t = useT()
  const [lang] = useLang()
  const managers = useManagers()
  // Глобальный плеер: клик по строке «Музыка»/«Голосовые» ставит очередь из
  // сообщений таба; плеер-плашка выезжает над шапкой чата (NowPlayingBar).
  const meId = useChatsStore((st) => st.meId)
  const playQueue = useAudioStore((st) => st.playQueue)
  const togglePlay = useAudioStore((st) => st.toggle)
  const curMediaId = useAudioStore((st) => st.track?.mediaId)
  const audioPlaying = useAudioStore((st) => st.playing)
  // кэш по фильтру: загружаем таб один раз за открытие панели
  const [byFilter, setByFilter] = useState<Partial<Record<string, Message[]>>>({})
  const filter = TAB_FILTER[tab]

  // Total-счётчики всех медиа-фильтров (tweb searchSuper counts): грузим один
  // лёгкий запрос на фильтр при открытии, чтобы скрывать пустые табы.
  const [totals, setTotals] = useState<Partial<Record<string, number>>>({})
  useEffect(() => {
    if (chatId == null) { setTotals({}); return }
    let alive = true
    void Promise.all(
      SHARED_TABS.map((name) =>
        managers.messages.mediaHistory(chatId, TAB_FILTER[name], 0, 1)
          .then((r) => [TAB_FILTER[name], r.count] as const)
          .catch(() => [TAB_FILTER[name], 0] as const),
      ),
    ).then((pairs) => { if (alive) setTotals(Object.fromEntries(pairs)) })
    return () => { alive = false }
  }, [chatId, managers])

  // Счётчик подарков для залитой шапки (у медиа-табов он приходит из mediaHistory).
  useEffect(() => { if (gifts) onCount?.('Gifts', gifts.length) }, [gifts, onCount])

  // Live: новое сообщение в открытом чате инвалидирует кэш табов — активный
  // таб перезагрузится и свежая отправка (голосовое/фото/…) появится сразу.
  const winLen = useMessagesStore((st) => (chatId != null ? st.byKey[String(chatId)]?.msgs.length ?? 0 : 0))
  useEffect(() => { setByFilter({}) }, [winLen])

  useEffect(() => {
    if (chatId == null || !filter || byFilter[filter]) return
    const forTab = tab
    void managers.messages
      .mediaHistory(chatId, filter)
      .then((r) => {
        setByFilter((d) => ({ ...d, [filter]: r.messages }))
        onCount?.(forTab, r.messages.length)
      })
      .catch(() => setByFilter((d) => ({ ...d, [filter]: [] })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, filter])

  const msgs = byFilter[filter]
  const when = (m: Message) => friendlyMsgTime(m.createdAt, lang)

  // Клик по строке: текущий трек — play/pause, иначе очередь из всего таба
  // с этой позиции; чужое непрослушанное голосовое гасит media_unread.
  const playRow = (m: Message, title: string) => {
    if (m.mediaId == null || chatId == null) return
    if (m.mediaId === curMediaId) {
      togglePlay()
      return
    }
    const list = (msgs ?? []).filter((x) => x.mediaId != null)
    const tracks: AudioTrack[] = list.map((x) => ({
      mediaId: x.mediaId as number,
      title: x.type === 'audio' ? x.mediaName || t('Audio') : title,
      subtitle: when(x),
      chatId,
      msgId: x.id,
    }))
    playQueue(tracks, list.indexOf(m))
    if (m.senderId !== meId && m.mediaUnread) markMediaPlayed(chatId, m.id)
  }

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
    const items: LightboxItem[] = list.map((m) => ({ mediaId: m.mediaId as number, type: m.type, date: when(m), width: m.mediaWidth, height: m.mediaHeight }))
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

  // Порядок табов: Участники/Чаты → Подарки → непустые медиа-табы (tweb:
  // показываются только непустые). Медиа-таб появляется, лишь когда его total
  // загрузился и > 0 — иначе таб-бар мигал бы пустыми на открытии.
  const mediaTabs = SHARED_TABS.filter((name) => (totals[TAB_FILTER[name]] ?? 0) > 0)
  const tabOrder = [
    ...(savedDialogs ? ['Chats'] : members ? ['Members'] : []),
    ...(gifts && gifts.length > 0 ? ['Gifts'] : []),
    ...mediaTabs,
  ]

  // Если активный таб пропал из набора (пустой/скрыт) — переключиться на первый.
  useEffect(() => {
    if (tabOrder.length > 0 && !tabOrder.includes(tab)) onTab(tabOrder[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabOrder.join(), tab])

  // Нечего показывать (пустой профиль без медиа/подарков/участников) — без табов.
  if (tabOrder.length === 0) return null

  return (
    <>
      {/* Тот же framed-таб-ряд, что и у папок в списке чатов; липнет под
          absolute-шапку панели (tweb .search-super-tabs-scrollable: sticky) */}
      <TabsBar mode="sticky" from="var(--tg-sectionBackdrop)" top={stickyTop} barRef={navRef}>
        <div className={s.tabsWrap}>
          <Tabs value={tab} onChange={(v) => onTab(v as string)}>
            <Tabs.List framed>
              {tabOrder.map((name) => (
                <Tabs.Tab key={name} value={name}>
                  {t(name)}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>
        </div>
      </TabsBar>

      {/* контент табов скользит ±100% (tweb TransitionSlider 'tabs') */}
      <TabSlide tab={tab} order={tabOrder}>
      {/* «Избранное» → «Чаты»: сохранённые диалоги по источнику пересылки */}
      {tab === 'Chats' && savedDialogs && (
        <div className={s.cardPlain} style={{ margin: '0 12px' }}>
          {savedDialogs.length === 0 && empty}
          {savedDialogs.map((d) => {
            const isSelf = d.kind === 'self'
            const title = isSelf ? t('My Notes') : d.title
            return (
              <div
                key={`${d.kind}:${d.peerId}`}
                className={s.memberRow}
                onClick={() => {
                  if (isSelf || !onOpenPeer) return
                  if (d.kind === 'user') onOpenPeer({ id: d.peerId, displayName: d.title, avatarUrl: d.photoUrl })
                  else onOpenPeer({ id: 0, displayName: d.title, chatId: d.peerId })
                }}
                style={isSelf ? { cursor: 'default' } : undefined}
              >
                {isSelf ? (
                  <Avatar size="md" background="var(--tg-accentGradient)" emoji="saved" />
                ) : (
                  <UserAvatar id={d.peerId} name={title} avatarUrl={d.photoUrl} />
                )}
                <div className={s.grow}>
                  <div className={s.memberTitleRow}>
                    <Text noWrap size={16} color="var(--tg-textPrimary)">{title}</Text>
                    <span className={s.roleLabel}>{fmtWhen(d.last.at)}</span>
                  </div>
                  <Text noWrap size={14} color="var(--tg-textSecondary)">
                    {d.last.text || mediaLabel(d.last.type)}
                  </Text>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'Members' && members && (
        <div className={s.cardPlain} style={{ margin: '0 12px' }}>
          {members.map((mem) => (
            <div
              key={mem.userId}
              className={s.memberRow}
              onClick={() => onOpenPeer?.({ id: mem.userId, displayName: mem.displayName, username: mem.username, avatarUrl: mem.avatarUrl })}
            >
              <UserAvatar id={mem.userId} name={mem.displayName} avatarUrl={mem.avatarUrl} online={mem.online} />
              <div className={s.grow}>
                {/* роль — на линии заголовка (tweb row-title-right-secondary) */}
                <div className={s.memberTitleRow}>
                  <Text noWrap size={16} color="var(--tg-textPrimary)">{mem.displayName}</Text>
                  <span
                    onClick={canManageAdmins ? (e) => { e.stopPropagation(); onEditMember?.(mem) } : undefined}
                    className={classNames(s.roleLabel, canManageAdmins ? s.roleClickable : '')}
                  >
                    {roleLabel(mem.role, !!isChannel)}
                  </span>
                </div>
                <Text size={14} color="var(--tg-textSecondary)">
                  {mem.online ? t('online') : t('last seen recently')}
                </Text>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Подарки профиля (tweb Gifts tab): сетка полученных подарков */}
      {tab === 'Gifts' && gifts && (
        <div className={s.giftsProfileGrid} style={{ padding: '4px 12px' }}>
          {gifts.map((g) => (
            <div key={g.id} className={s.giftTile} onClick={() => onOpenGift?.(g)}>
              <span className={s.giftTileEmoji}>{g.gift.emoji}</span>
              <span className={s.giftTilePrice}>
                <StarIcon size={12} />
                {g.gift.priceStars}
              </span>
            </div>
          ))}
        </div>
      )}

      {msgs != null && msgs.length === 0 && tab !== 'Gifts' && empty}

      {tab === 'Media' && msgs != null && msgs.length > 0 && (
        <div className={s.mediaGrid}>
          {msgs.map((m, i) => (
            <div key={m.id} className={s.mediaTile} onClick={(e) => openMedia(i, e)}>
              {m.mediaId != null && (
                <img
                  className={s.tileImg}
                  src={mediaThumbUrl(m.mediaId)}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    // превью ещё не сгенерировано → полный контент
                    const img = e.currentTarget
                    if (m.mediaId != null && !img.dataset.fb) {
                      img.dataset.fb = '1'
                      img.src = mediaContentUrl(m.mediaId)
                    }
                  }}
                />
              )}
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
            <div key={m.id} className={s.mediaRow} onClick={() => playRow(m, m.mediaName || t('Audio'))} style={{ cursor: 'pointer' }}>
              <div className={s.rowPlay}>
                <PlayPauseGlyph playing={audioPlaying && m.mediaId === curMediaId} size={22} className={s.rowGlyph} />
              </div>
              <div className={s.grow}>
                <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">{m.mediaName || t('Audio')}</Text>
                <Text noWrap size={13.5} color="var(--tg-textSecondary)">{[fmtDur(m.mediaDuration), when(m)].filter(Boolean).join(' · ')}</Text>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'Voice' && msgs != null && msgs.length > 0 && (
        <div className={s.mediaList}>
          {msgs.map((m) => (
            <div key={m.id} className={s.mediaRow} onClick={() => playRow(m, m.type === 'roundVideo' ? t('Video message') : t('Voice message'))} style={{ cursor: 'pointer' }}>
              <div className={s.rowPlay}>
                <PlayPauseGlyph playing={audioPlaying && m.mediaId === curMediaId} size={22} className={s.rowGlyph} />
              </div>
              <div className={s.grow}>
                <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">{m.type === 'roundVideo' ? t('Video message') : t('Voice message')}</Text>
                <Text size={13.5} color="var(--tg-textSecondary)">{[fmtDur(m.mediaDuration), when(m)].filter(Boolean).join(' · ')}</Text>
              </div>
            </div>
          ))}
        </div>
      )}
      </TabSlide>

      {/* вне TabSlide: transform слайда ломал бы position:fixed лайтбокса */}
      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          originRect={lightbox.originRect}
          originSrc={lightbox.originSrc}
          originEl={lightbox.originEl}
          onClosingStart={() => { lightbox.originEl.style.visibility = '' }}
          onClose={() => { lightbox.originEl.style.visibility = ''; setLightbox(null) }}
        />
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
