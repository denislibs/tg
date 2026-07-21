// SearchView — глобальный поиск в сайдбаре (tweb AppSearchSuper).
// Таб «Чаты»: секции «Чаты» (свои диалоги) → «Глобальный поиск» (публичная
// директория) → «Сообщения» (полнотекст по всем чатам); пустой запрос —
// «Недавние». Табы Медиа/Ссылки/Файлы/Музыка/Голосовые — глобальный
// searchGlobal с фильтром типа (tweb inputMessagesFilter*).
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Text from '../shared/ui/Text'
import Avatar from '../shared/ui/Avatar'
import SidebarSection from '../shared/ui/SidebarSection'
import { useAvatarSrc } from './useAvatarSrc'
import VerifiedBadge from './VerifiedBadge'
import PremiumBadge from './PremiumBadge'
import EmojiStatus from './EmojiStatus'
import PlayPauseGlyph from './PlayPauseGlyph'
import ConfirmDialog from './settings/ConfirmDialog'
import type { Chat, OpenPeer } from '../data'
import type { SearchResult } from '../core/managers/channelsManager'
import type { Message } from '../core/models'
import { useManagers } from '../core/hooks/useManagers'
import { useSearchStore } from '../stores/searchStore'
import { useChatsStore } from '../stores/chatsStore'
import { useAudioStore, type AudioTrack } from '../stores/audioStore'
import { markMediaPlayed } from '../core/mediaRead'
import { mediaContentUrl, mediaThumbUrl } from '../core/mediaUrl'
import { friendlyMsgTime } from '../core/friendlyTime'
import { gradientFor, mediaLabel } from '../core/dialogToChat'
import { EXT_COLORS, extOf, firstUrl, fmtDur, fmtSize, hostOf } from '../core/sharedMediaFmt'
import { useLang, useT } from '../i18n'
import { Tabs } from '../shared/ui/Tabs'
import s from './SearchView.module.scss'

const TABS = ['Chats', 'Channels', 'Media', 'Links', 'Files', 'Music', 'Voice'] as const
const TAB_FILTER: Partial<Record<number, 'media' | 'links' | 'files' | 'music' | 'voice'>> = {
  2: 'media', 3: 'links', 4: 'files', 5: 'music', 6: 'voice',
}
const PAGE = 30

// ── недавние запросы (tweb recentSearch: peerId[], cap 20, в состоянии клиента) ──
const RECENT_KEY = 'recentSearch'
const loadRecent = (): string[] => {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[] } catch { return [] }
}
const pushRecent = (id: string) => {
  const next = [id, ...loadRecent().filter((x) => x !== id)].slice(0, 20)
  localStorage.setItem(RECENT_KEY, JSON.stringify(next))
}

interface Props {
  query: string
  chats: Chat[]
  onSelect: (id: string) => void
  searchReal?: (q: string) => Promise<SearchResult>
  onJoin?: (username: string) => void
  onOpenPeer?: (peer: OpenPeer) => void
}

const EMPTY_RESULT: SearchResult = { chats: [], users: [] }

// подсветка вхождения запроса (tweb messageEntityHighlight → .text-highlight)
function Highlighted({ text, q }: { text: string; q: string }) {
  if (!q.trim()) return <>{text}</>
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <span className={s.hl}>{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  )
}

export default function SearchView({ query, chats, onSelect, searchReal, onJoin, onOpenPeer }: Props) {
  const t = useT()
  const [lang] = useLang()
  const managers = useManagers()
  const [tab, setTab] = useState(0)
  const dirRef = useRef(0)
  const [results, setResults] = useState<SearchResult>(EMPTY_RESULT)
  // сообщения: таб «Чаты» (filter='') и медиа-табы (filter по типу)
  const [msgs, setMsgs] = useState<Message[] | null>(null)
  const [msgCount, setMsgCount] = useState(0)
  const loadingMore = useRef(false)
  const [recentIds, setRecentIds] = useState<string[]>(loadRecent)
  const [confirmClear, setConfirmClear] = useState(false)

  const q = query.trim()
  const filter: '' | 'media' | 'links' | 'files' | 'music' | 'voice' = TAB_FILTER[tab] ?? ''

  // Директория (публичные чаты + юзеры) — таб «Чаты»/«Каналы», дебаунс 250мс.
  useEffect(() => {
    if (!searchReal || tab > 1) return
    if (!q) {
      setResults(EMPTY_RESULT)
      return
    }
    let alive = true
    const id = window.setTimeout(() => {
      searchReal(q)
        .then((r) => { if (alive) setResults(r) })
        .catch(() => { if (alive) setResults(EMPTY_RESULT) })
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(id)
    }
  }, [q, searchReal, tab])

  // Сообщения: таб «Чаты» ищет по тексту (нужен q); медиа-табы листают тип,
  // q дополнительно сужает. Дебаунс 250мс, смена таба/запроса сбрасывает список.
  useEffect(() => {
    const need = tab === 0 ? q !== '' : filter !== ''
    setMsgs(null)
    setMsgCount(0)
    if (!need) return
    let alive = true
    const id = window.setTimeout(() => {
      managers.messages.searchGlobal(q, filter, 0, PAGE)
        .then((r) => { if (alive) { setMsgs(r.messages); setMsgCount(r.count) } })
        .catch(() => { if (alive) { setMsgs([]); setMsgCount(0) } })
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tab, filter])

  // Подгрузка следующей страницы у нижнего края скролла
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 600) return
    if (loadingMore.current || msgs == null || msgs.length >= msgCount) return
    loadingMore.current = true
    managers.messages.searchGlobal(q, filter, msgs.length, PAGE)
      .then((r) => setMsgs((cur) => [...(cur ?? []), ...r.messages]))
      .catch(() => undefined)
      .finally(() => { loadingMore.current = false })
  }

  const byId = new Map(chats.map((c) => [c.id, c]))
  const openDialog = (id: string) => {
    pushRecent(id)
    setRecentIds(loadRecent())
    onSelect(id)
  }
  // Результат-чат из директории: свой диалог → открыть; чужой → вступить по @username.
  const onResultChat = (id: number, username: string) => {
    const sid = String(id)
    if (byId.has(sid)) openDialog(sid)
    else if (username && onJoin) onJoin(username)
  }
  const onResultUser = (u: { id: number; displayName: string; username: string; avatarUrl: string }) => {
    onOpenPeer?.({ id: u.id, displayName: u.displayName || u.username || `#${u.id}`, username: u.username, avatarUrl: u.avatarUrl })
  }
  // Клик по сообщению: открыть чат и прыгнуть к seq (pendingJump потребляет ConversationView)
  const openMessage = (m: Message) => {
    useSearchStore.getState().setPendingJump(m.chatId, m.seq)
    openDialog(String(m.chatId))
  }

  // Музыка/голосовые: очередь глобального плеера из строк таба (как в панели инфо)
  const meId = useChatsStore((st) => st.meId)
  const playQueue = useAudioStore((st) => st.playQueue)
  const togglePlay = useAudioStore((st) => st.toggle)
  const curMediaId = useAudioStore((st) => st.track?.mediaId)
  const audioPlaying = useAudioStore((st) => st.playing)
  const playRow = (m: Message, title: string) => {
    if (m.mediaId == null) return
    if (m.mediaId === curMediaId) {
      togglePlay()
      return
    }
    const list = (msgs ?? []).filter((x) => x.mediaId != null)
    const tracks: AudioTrack[] = list.map((x) => ({
      mediaId: x.mediaId as number,
      title: x.type === 'audio' ? x.mediaName || t('Audio') : title,
      subtitle: friendlyMsgTime(x.createdAt, lang),
      chatId: x.chatId,
      msgId: x.id,
    }))
    playQueue(tracks, list.indexOf(m))
    if (m.senderId !== meId && m.mediaUnread) markMediaPlayed(m.chatId, m.id)
  }

  const goTab = (i: number) => {
    dirRef.current = i > tab ? 1 : -1
    setTab(i)
  }

  // Локальные совпадения по своим диалогам (tweb: contacts + local dialogs)
  const localMatches = q
    ? chats.filter((c) => c.type !== 'saved' && c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 10)
    : []
  const myChannels = chats.filter((c) => c.type === 'channel')
  const recentChats = recentIds.map((id) => byId.get(id)).filter((c): c is Chat => !!c)

  const clearRecent = () => {
    localStorage.removeItem(RECENT_KEY)
    setRecentIds([])
  }

  // Ряд сообщения: аватар/имя чата + дата + сниппет с подсветкой (tweb setLastMessageN)
  const MsgRow = ({ m }: { m: Message }) => {
    const chat = byId.get(String(m.chatId))
    const snippet = m.text || m.mediaName || mediaLabel(m.type)
    return (
      <div className={s.row} onClick={() => openMessage(m)}>
        <Avatar
          background={chat?.avatar ?? gradientFor(m.chatId)}
          src={chat?.avatarUrl}
          text={chat?.avatarText ?? (chat?.name ?? '?').charAt(0).toUpperCase()}
          emoji={chat?.avatarEmoji}
          size="lg"
        />
        <div className={s.body}>
          <div className={s.top}>
            <Text noWrap size={16} weight={600} color="var(--tg-textPrimary)" className={s.titleFlex}>
              {chat?.name ?? `#${m.chatId}`}
            </Text>
            <Text size={13} color="var(--tg-textFaint)">{friendlyMsgTime(m.createdAt, lang)}</Text>
          </div>
          <Text noWrap size={15} color="var(--tg-textSecondary)">
            <Highlighted text={snippet} q={q} />
          </Text>
        </div>
      </div>
    )
  }

  const emptyState = <Empty text={q ? t('No results') : t('Nothing interesting here yet…')} />

  return (
    <div className={s.root}>
      {/* Полоса табов (общий <Tabs> — tweb 1:1), выровнена по краям секций */}
      <div className={s.tabsWrap}>
        <Tabs value={tab} onChange={(v) => goTab(v as number)} order={TABS.map((_, i) => i)}>
          <Tabs.List framed>
            {TABS.map((label, i) => (
              <Tabs.Tab key={label} value={i}>
                {t(label)}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
      </div>

      {/* Анимированный контент */}
      <div className={s.content}>
        <AnimatePresence mode="wait" custom={dirRef.current} initial={false}>
          <motion.div
            key={tab}
            className={s.scroll}
            onScroll={onScroll}
            custom={dirRef.current}
            variants={{
              enter: (d: number) => ({ x: d >= 0 ? 80 : -80, opacity: 0 }),
              center: { x: 0, opacity: 1 },
              exit: (d: number) => ({ x: d >= 0 ? -80 : 80, opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className={s.pad}>
              {tab === 0 && !q && (
                recentChats.length > 0 ? (
                  <SidebarSection title={t('Recent')} action={t('Clear')} onActionClick={() => setConfirmClear(true)}>
                    {recentChats.map((c) => (
                      <ChatRow key={c.id} chat={c} onClick={() => openDialog(c.id)} />
                    ))}
                  </SidebarSection>
                ) : (
                  emptyState
                )
              )}

              {tab === 0 && q && (
                <>
                  {localMatches.length > 0 && (
                    <SidebarSection title={t('Chats')}>
                      {localMatches.map((c) => (
                        <ChatRow key={c.id} chat={c} q={q} onClick={() => openDialog(c.id)} />
                      ))}
                    </SidebarSection>
                  )}
                  {(results.chats.length > 0 || results.users.length > 0) && (
                    <SidebarSection title={t('Global search')}>
                      {results.chats.map((c) => (
                        <ResultRow
                          key={`c-${c.id}`}
                          bg={gradientFor(c.id)}
                          t={(c.title || '?').charAt(0).toUpperCase()}
                          title={c.title}
                          subtitle={`@${c.username}, ${c.memberCount} ${t(c.type === 'channel' ? 'subscribers' : 'members')}`}
                          onClick={() => onResultChat(c.id, c.username)}
                        />
                      ))}
                      {results.users.map((u) => (
                        <ResultRow
                          key={`u-${u.id}`}
                          bg={gradientFor(u.id)}
                          src={u.avatarUrl}
                          t={(u.displayName || u.username || '?').charAt(0).toUpperCase()}
                          title={u.displayName || u.username}
                          subtitle={u.username ? `@${u.username}` : ''}
                          onClick={() => onResultUser(u)}
                        />
                      ))}
                    </SidebarSection>
                  )}
                  {msgs != null && msgs.length > 0 && (
                    <SidebarSection title={t('Messages')}>
                      {msgs.map((m) => <MsgRow key={m.id} m={m} />)}
                    </SidebarSection>
                  )}
                  {msgs != null && msgs.length === 0 && localMatches.length === 0
                    && results.chats.length === 0 && results.users.length === 0 && emptyState}
                </>
              )}

              {tab === 1 && (
                q ? (
                  results.chats.filter((c) => c.type === 'channel').length > 0 ? (
                    <SidebarSection>
                      {results.chats.filter((c) => c.type === 'channel').map((c) => (
                        <ResultRow
                          key={c.id}
                          bg={gradientFor(c.id)}
                          t={(c.title || '?').charAt(0).toUpperCase()}
                          title={c.title}
                          subtitle={`${c.memberCount} ${t('subscribers')}`}
                          onClick={() => onResultChat(c.id, c.username)}
                        />
                      ))}
                    </SidebarSection>
                  ) : (
                    emptyState
                  )
                ) : myChannels.length > 0 ? (
                  <SidebarSection title={t('My Channels')}>
                    {myChannels.map((c) => (
                      <ChatRow key={c.id} chat={c} onClick={() => openDialog(c.id)} />
                    ))}
                  </SidebarSection>
                ) : (
                  emptyState
                )
              )}

              {/* Медиа — грид 3×N (tweb search-super-content-media) */}
              {tab === 2 && msgs != null && (
                msgs.length > 0 ? (
                  <div className={s.mediaGrid}>
                    {msgs.map((m) => (
                      <div key={m.id} className={s.mediaTile} onClick={() => openMessage(m)}>
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
                ) : (
                  emptyState
                )
              )}

              {/* Ссылки */}
              {tab === 3 && msgs != null && (
                msgs.length > 0 ? (
                  <SidebarSection>
                    {msgs.map((m) => {
                      const url = firstUrl(m.text)
                      return (
                        <div key={m.id} className={s.row} onClick={() => window.open(url, '_blank', 'noopener')}>
                          <div className={s.rowSquare} style={{ background: 'var(--tg-accentGradient)' }}>
                            {hostOf(url).charAt(0).toUpperCase()}
                          </div>
                          <div className={s.body}>
                            <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">{hostOf(url)}</Text>
                            <Text noWrap size={13.5} color="var(--tg-link)">{url}</Text>
                          </div>
                        </div>
                      )
                    })}
                  </SidebarSection>
                ) : (
                  emptyState
                )
              )}

              {/* Файлы */}
              {tab === 4 && msgs != null && (
                msgs.length > 0 ? (
                  <SidebarSection>
                    {msgs.map((m) => (
                      <div key={m.id} className={s.row} onClick={() => openMessage(m)}>
                        <div className={s.rowSquare} style={{ background: EXT_COLORS[extOf(m.mediaName)] ?? 'var(--tg-accent)' }}>
                          {extOf(m.mediaName).toUpperCase().slice(0, 4) || 'FILE'}
                        </div>
                        <div className={s.body}>
                          <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">
                            <Highlighted text={m.mediaName || t('Document')} q={q} />
                          </Text>
                          <Text size={13.5} color="var(--tg-textSecondary)">
                            {[fmtSize(m.mediaSize), friendlyMsgTime(m.createdAt, lang)].filter(Boolean).join(' · ')}
                          </Text>
                        </div>
                      </div>
                    ))}
                  </SidebarSection>
                ) : (
                  emptyState
                )
              )}

              {/* Музыка / Голосовые */}
              {(tab === 5 || tab === 6) && msgs != null && (
                msgs.length > 0 ? (
                  <SidebarSection>
                    {msgs.map((m) => {
                      const title = tab === 5
                        ? m.mediaName || t('Audio')
                        : m.type === 'roundVideo' ? t('Video message') : t('Voice message')
                      return (
                        <div key={m.id} className={s.row} onClick={() => playRow(m, title)}>
                          <div className={s.rowPlay}>
                            <PlayPauseGlyph playing={audioPlaying && m.mediaId === curMediaId} size={22} className={s.rowGlyph} />
                          </div>
                          <div className={s.body}>
                            <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">
                              <Highlighted text={title} q={q} />
                            </Text>
                            <Text size={13.5} color="var(--tg-textSecondary)">
                              {[fmtDur(m.mediaDuration), friendlyMsgTime(m.createdAt, lang)].filter(Boolean).join(' · ')}
                            </Text>
                          </div>
                        </div>
                      )
                    })}
                  </SidebarSection>
                ) : (
                  emptyState
                )
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {confirmClear && (
        <ConfirmDialog
          title={t('Clear')}
          text={t('Are you sure you want to clear your search history?')}
          action={t('Clear')}
          danger
          onConfirm={clearRecent}
          onClose={() => setConfirmClear(false)}
        />
      )}
    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────────────
// Ряд своего диалога (недавние / локальные совпадения / мои каналы)
function ChatRow({ chat, q, onClick }: { chat: Chat; q?: string; onClick: () => void }) {
  const avatarSrc = useAvatarSrc(chat.avatarUrl)
  return (
    <div className={s.row} onClick={onClick}>
      <Avatar background={chat.avatar} src={avatarSrc} text={chat.avatarText} emoji={chat.avatarEmoji} size="lg" />
      <div className={s.body}>
        <div className={s.top}>
          <Text noWrap size={16} weight={600} color="var(--tg-textPrimary)">
            {q ? <Highlighted text={chat.name} q={q} /> : chat.name}
          </Text>
          {chat.verified && <VerifiedBadge size={16} color="var(--tg-accent)" />}
          {chat.premium && <PremiumBadge size={16} />}
          {chat.emojiStatus && <EmojiStatus emoji={chat.emojiStatus} size={16} />}
        </div>
        <Text noWrap size={14.5} color="var(--tg-textSecondary)">
          {chat.status || (chat.username ? `@${chat.username}` : '')}
        </Text>
      </div>
    </div>
  )
}

function ResultRow({ bg, src, t, tc, title, subtitle, verified, onClick }: {
  bg: string
  src?: string
  t: string
  tc?: string
  title: string
  subtitle: string
  verified?: boolean
  onClick?: () => void
}) {
  const avatarSrc = useAvatarSrc(src)
  return (
    <div className={s.row} onClick={onClick}>
      <Avatar background={bg} src={avatarSrc} text={t} size="lg" color={tc ?? '#fff'} />
      <div className={s.body}>
        <div className={s.top}>
          <Text noWrap size={16} weight={600} color="var(--tg-textPrimary)">{title}</Text>
          {verified && <VerifiedBadge size={16} color="var(--tg-accent)" />}
        </div>
        <Text noWrap size={14.5} color="var(--tg-textSecondary)">{subtitle}</Text>
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className={s.empty}>
      <Text size={16} color="var(--tg-textSecondary)" style={{ textAlign: 'center', whiteSpace: 'pre-line' }}>
        {text}
      </Text>
    </div>
  )
}
