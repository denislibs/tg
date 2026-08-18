// SearchView — глобальный поиск в сайдбаре (tweb AppSearchSuper).
// Таб «Чаты»: секции «Чаты» (свои диалоги) → «Глобальный поиск» (публичная
// директория) → «Сообщения» (полнотекст по всем чатам); пустой запрос —
// «Недавние». Табы Медиа/Ссылки/Файлы/Музыка/Голосовые — глобальный
// searchGlobal с фильтром типа (tweb inputMessagesFilter*).
import { useEffect, useState } from 'react'
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
import { useGlobalSearch, type SearchFilter } from '../core/hooks/useGlobalSearch'
import { useSearchStore } from '../stores/searchStore'
import { useAppStateKey, useAppStateStore, setAppState } from '../stores/appState'
import { useChatsStore } from '../stores/chatsStore'
import { useAudioStore, type AudioTrack } from '../stores/audioStore'
import { markMediaPlayed } from '../core/mediaRead'
import { getDocumentFromMessage, getMediaFromMessage, hasServerThumb } from '../core/media/messageMedia'
import MediaGridThumb from './MediaGridThumb'
import { friendlyMsgTime } from '../core/format/friendlyTime'
import { gradientFor, mediaLabel } from '../core/dialogToChat'
import { EXT_COLORS, extOf, firstUrl, fmtDur, fmtSize, hostOf } from '../core/format/sharedMediaFmt'
import { useLang, useT } from '../i18n'
import { Tabs, TabSlide } from '../shared/ui/Tabs'
import s from './SearchView.module.scss'

const TABS = ['Chats', 'Channels', 'Media', 'Links', 'Files', 'Music', 'Voice'] as const
// порядок вкладок для TabSlide — по нему считается направление слайда
const TAB_ORDER = TABS.map((_, i) => i)
const TAB_FILTER: Partial<Record<number, 'media' | 'links' | 'files' | 'music' | 'voice'>> = {
  2: 'media', 3: 'links', 4: 'files', 5: 'music', 6: 'voice',
}

// ── недавние запросы (tweb `recentSearch` в State, cap 20) ──────────────────
// Живут в AppState, а не в localStorage: State поднимается одним батчем до
// первого рендера и синхронизируется между вкладками зеркалом из воркера.
// Отдельное хранилище дублировало бы ключ схемы и обходило обе эти механики.
const RECENT_CAP = 20

const pushRecent = (id: string) => {
  const cur = useAppStateStore.getState().recentSearch
  setAppState('recentSearch', [id, ...cur.filter((x) => x !== id)].slice(0, RECENT_CAP))
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
  const [tab, setTab] = useState(0)
  const [results, setResults] = useState<SearchResult>(EMPTY_RESULT)
  const recentIds = useAppStateKey('recentSearch')
  const [confirmClear, setConfirmClear] = useState(false)

  const q = query.trim()
  const filter: SearchFilter = TAB_FILTER[tab] ?? ''
  // Глобальный поиск сообщений (список + пагинация) — в ViewModel-хуке.
  const { msgs, onScroll } = useGlobalSearch(q, tab, filter)

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

  const byId = new Map(chats.map((c) => [c.id, c]))
  const openDialog = (id: string) => {
    pushRecent(id)
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
  // Клик по сообщению: открыть чат и прыгнуть к seq (pendingJump потребляет Chat)
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
      title: x.type === 'audio' ? getDocumentFromMessage(x)?.file_name || t('Audio') : title,
      subtitle: friendlyMsgTime(x.createdAt, lang),
      chatId: x.chatId,
      msgId: x.id,
    }))
    playQueue(tracks, list.indexOf(m))
    if (m.senderId !== meId && m.mediaUnread) markMediaPlayed(m.chatId, m.id)
  }

  const goTab = (i: number) => setTab(i)

  // Локальные совпадения по своим диалогам (tweb: contacts + local dialogs)
  const localMatches = q
    ? chats.filter((c) => c.type !== 'saved' && c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 10)
    : []
  const myChannels = chats.filter((c) => c.type === 'channel')
  const recentChats = recentIds.map((id) => byId.get(id)).filter((c): c is Chat => !!c)

  const clearRecent = () => { setAppState('recentSearch', []) }

  // Ряд сообщения: аватар/имя чата + дата + сниппет с подсветкой (tweb setLastMessageN)
  const MsgRow = ({ m }: { m: Message }) => {
    const chat = byId.get(String(m.chatId))
    const snippet = m.text || getDocumentFromMessage(m)?.file_name || mediaLabel(m.type)
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
            <Text noWrap size={16} weight={600} color="var(--primary-text-color)" className={s.titleFlex}>
              {chat?.name ?? `#${m.chatId}`}
            </Text>
            <Text size={13} color="var(--secondary-text-color)">{friendlyMsgTime(m.createdAt, lang)}</Text>
          </div>
          <Text noWrap size={15} color="var(--secondary-text-color)">
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

      {/* Содержимое вкладок — общий <TabSlide> (порт tweb TransitionSlider типа
          `tabs`: оба кадра живут в DOM, инлайновые transform ∓width, переход
          `transform var(--tabs-transition)`; см. shared/ui/Tabs/TabSlide.tsx).
          Скроллер, как и в ChatList, стоит СНАРУЖИ слайдера. */}
      <div className={s.content}>
        <div className={s.scroll} onScroll={onScroll}>
          <TabSlide tab={tab} order={TAB_ORDER}>
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
                          <MediaGridThumb className={s.tileImg} mediaId={m.mediaId} hasThumb={hasServerThumb(getMediaFromMessage(m))} />
                        )}
                        {m.type === 'video' && <span className={s.tileDuration}>{fmtDur(getDocumentFromMessage(m)?.duration)}</span>}
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
                            <Text noWrap size={15.5} weight={500} color="var(--primary-text-color)">{hostOf(url)}</Text>
                            <Text noWrap size={13.5} color="var(--link-color)">{url}</Text>
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
                    {msgs.map((m) => {
                      // tweb wrapDocument: имя, расширение и размер — у САМОГО
                      // документа (`doc.file_name`, `doc.size`), не отдельными
                      // полями сообщения.
                      const doc = getDocumentFromMessage(m)
                      return (
                      <div key={m.id} className={s.row} onClick={() => openMessage(m)}>
                        <div className={s.rowSquare} style={{ background: EXT_COLORS[extOf(doc?.file_name)] ?? 'var(--primary-color)' }}>
                          {extOf(doc?.file_name).toUpperCase().slice(0, 4) || 'FILE'}
                        </div>
                        <div className={s.body}>
                          <Text noWrap size={15.5} weight={500} color="var(--primary-text-color)">
                            <Highlighted text={doc?.file_name || t('Document')} q={q} />
                          </Text>
                          <Text size={13.5} color="var(--secondary-text-color)">
                            {[fmtSize(doc?.size), friendlyMsgTime(m.createdAt, lang)].filter(Boolean).join(' · ')}
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

              {/* Музыка / Голосовые */}
              {(tab === 5 || tab === 6) && msgs != null && (
                msgs.length > 0 ? (
                  <SidebarSection>
                    {msgs.map((m) => {
                      const doc = getDocumentFromMessage(m)
                      const title = tab === 5
                        ? doc?.file_name || t('Audio')
                        : m.type === 'roundVideo' ? t('Video message') : t('Voice message')
                      return (
                        <div key={m.id} className={s.row} onClick={() => playRow(m, title)}>
                          <div className={s.rowPlay}>
                            <PlayPauseGlyph playing={audioPlaying && m.mediaId === curMediaId} size={22} className={s.rowGlyph} />
                          </div>
                          <div className={s.body}>
                            <Text noWrap size={15.5} weight={500} color="var(--primary-text-color)">
                              <Highlighted text={title} q={q} />
                            </Text>
                            <Text size={13.5} color="var(--secondary-text-color)">
                              {[fmtDur(doc?.duration), friendlyMsgTime(m.createdAt, lang)].filter(Boolean).join(' · ')}
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
          </TabSlide>
        </div>
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
      <Avatar background={chat.avatar} src={avatarSrc} preview={chat.avatarPreview} text={chat.avatarText} emoji={chat.avatarEmoji} size="lg" />
      <div className={s.body}>
        <div className={s.top}>
          <Text noWrap size={16} weight={600} color="var(--primary-text-color)">
            {q ? <Highlighted text={chat.name} q={q} /> : chat.name}
          </Text>
          {chat.verified && <VerifiedBadge size={16} color="var(--primary-color)" />}
          {chat.premium && <PremiumBadge size={16} />}
          {chat.emojiStatus && <EmojiStatus emoji={chat.emojiStatus} size={16} />}
        </div>
        <Text noWrap size={14.5} color="var(--secondary-text-color)">
          {chat.status || (chat.username ? `@${chat.username}` : '')}
        </Text>
      </div>
    </div>
  )
}

function ResultRow({ bg, src, t, title, subtitle, verified, onClick }: {
  bg: string
  src?: string
  t: string
  title: string
  subtitle: string
  verified?: boolean
  onClick?: () => void
}) {
  const avatarSrc = useAvatarSrc(src)
  return (
    <div className={s.row} onClick={onClick}>
      <Avatar background={bg} src={avatarSrc} text={t} size="lg" />
      <div className={s.body}>
        <div className={s.top}>
          <Text noWrap size={16} weight={600} color="var(--primary-text-color)">{title}</Text>
          {verified && <VerifiedBadge size={16} color="var(--primary-color)" />}
        </div>
        <Text noWrap size={14.5} color="var(--secondary-text-color)">{subtitle}</Text>
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className={s.empty}>
      <Text size={16} color="var(--secondary-text-color)" style={{ textAlign: 'center', whiteSpace: 'pre-line' }}>
        {text}
      </Text>
    </div>
  )
}
