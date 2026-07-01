import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import SidebarSection from '../shared/ui/SidebarSection'
import { useAvatarSrc } from './useAvatarSrc'
import VerifiedBadge from './VerifiedBadge'
import type { Chat, OpenPeer } from '../data'
import type { SearchResult } from '../core/managers/channelsManager'
import { useT } from '../i18n'
import { Tabs } from '../shared/ui/Tabs'
import s from './SearchView.module.scss'

const TABS = ['Chats', 'Channels', 'Apps', 'Posts', 'Media', 'Links', 'Files', 'Music']

// ── mock result data ────────────────────────────────────────────────
// Avatar gradient palette (mirrors dialogToChat) — used for real search rows.
const GRADIENTS = [
  'linear-gradient(135deg,#42e695,#3bb2b8)',
  'linear-gradient(135deg,#f7971e,#ffd200)',
  'linear-gradient(135deg,#6a11cb,#2575fc)',
  'linear-gradient(135deg,#ff5f6d,#ffc371)',
  'linear-gradient(135deg,#5b86e5,#36d1dc)',
  'linear-gradient(135deg,#f857a6,#ff5858)',
  'linear-gradient(135deg,#9a7ff0,#6f8df5)',
  'linear-gradient(135deg,#11998e,#38ef7d)',
]
const avatarBg = (id: number) => GRADIENTS[Math.abs(id) % GRADIENTS.length]
const channelsList = [
  { name: 'Привет, не хочешь сход…', sub: '58 918 subscribers', bg: 'linear-gradient(135deg,#f7d44c,#e8b321)', t: 'П' },
  { name: 'Привет, Москва!', sub: '77 875 subscribers', bg: '#ffffff', t: 'M', tc: '#e0322a' },
  { name: 'Привет, Аутлет!', sub: '45 657 subscribers', bg: 'linear-gradient(135deg,#1f2a1f,#0a0a0a)', t: '%', tc: '#5cc85e', verified: true },
  { name: 'полина и ее мандёж', sub: '50 747 subscribers', bg: 'linear-gradient(135deg,#8a8a8a,#444)', t: 'п' },
  { name: 'Privet-Rostov.ru — ново…', sub: '179 874 subscribers', bg: 'linear-gradient(135deg,#3a4fd6,#d6324f)', t: 'P', verified: true },
  { name: 'RAGNAROCK PRIVET', sub: '218 527 subscribers', bg: 'linear-gradient(135deg,#2a2a2a,#000)', t: '✦' },
  { name: 'Привет, Москва+', sub: '42 826 subscribers', bg: '#ffffff', t: 'M', tc: '#3a6fd6' },
]
const popularApps = [
  { name: 'DUCK × MY × DUCK', sub: '1 011 819 users', bg: 'linear-gradient(135deg,#1a1a1a,#000)', t: '🦆', verified: true },
  { name: 'Boinkers', sub: '569 418 users', bg: 'linear-gradient(135deg,#f7c948,#e8a020)', t: '🤖', verified: true },
  { name: 'Gorilla Case', sub: '402 680 users', bg: 'linear-gradient(135deg,#3a6fd6,#1a3a8a)', t: '🦍' },
  { name: 'VIRUS GAME BOT', sub: '211 059 users', bg: 'linear-gradient(135deg,#5cc85e,#2a8a2c)', t: '🦠' },
  { name: 'Тюряга', sub: '84 009 users', bg: 'linear-gradient(135deg,#8a7a6a,#4a3a2a)', t: '😠' },
  { name: 'BitQuest', sub: '78 254 users', bg: 'linear-gradient(135deg,#1a2a3a,#0a1520)', t: '🎮' },
  { name: 'ChatGPT 5 | Gemini 3 | Na…', sub: '2 930 484 users', bg: 'linear-gradient(135deg,#ff5fa2,#7b6cf0)', t: '✨' },
  { name: 'Frog Case', sub: '283 601 users', bg: 'linear-gradient(135deg,#7bdc4c,#3a9a2c)', t: '🐸' },
  { name: 'Rolls', sub: '98 013 users', bg: 'linear-gradient(135deg,#1a1a1a,#000)', t: '🎧' },
  { name: 'Spin the Bottle 🍾', sub: '94 683 users', bg: 'linear-gradient(135deg,#c98a3a,#8a5a1a)', t: '🍾' },
]
const links = [
  { name: 'citadélle', date: 'Feb 14', t: 'C', bg: 'linear-gradient(135deg,#9a7ff0,#6f8df5)', body: '«лучше уже не будет» — мой первый обзор не на секс-игрушку, а на бренд', link: 'https://t.me/krierr_f22/2544', from: 'Секспедиция' },
  { name: 'pinkypunk.ru', date: '03/23/2023', t: 'P', bg: 'linear-gradient(135deg,#9a7ff0,#6f8df5)', body: 'Ну.. привет. Мы родом из недр Тик-Тока, и до последнего не хотели появляться в ТГ.', link: 'https://pinkypunk.ru/?utm_source=telegram', from: 'Секспедиция' },
]

interface Props {
  query: string
  chats: Chat[]
  onSelect: (id: string) => void
  searchReal?: (q: string) => Promise<SearchResult>
  onJoin?: (username: string) => void
  onOpenPeer?: (peer: OpenPeer) => void
}

const EMPTY_RESULT: SearchResult = { chats: [], users: [] }

// highlight occurrences of the query inside text
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
  const [tab, setTab] = useState(0)
  const dirRef = useRef(0)
  const [results, setResults] = useState<SearchResult>(EMPTY_RESULT)

  // Real global search, debounced ~250ms. Empty query clears the global sections.
  useEffect(() => {
    if (!searchReal) return
    const q = query.trim()
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
  }, [query, searchReal])

  // Map an existing-dialog id for fast "already joined?" lookups.
  const dialogIds = new Set(chats.map((c) => c.id))
  // A search-result chat that matches an open dialog → open it; otherwise join by @username.
  const onResultChat = (id: number, username: string) => {
    const sid = String(id)
    if (dialogIds.has(sid)) onSelect(sid)
    else if (username && onJoin) onJoin(username)
  }
  // A user result: open a conversation (existing dialog reused, else a draft) —
  // the shell decides; no chat is created until a message is sent.
  const onResultUser = (u: { id: number; displayName: string; username: string; avatarUrl: string }) => {
    onOpenPeer?.({ id: u.id, displayName: u.displayName || u.username || `#${u.id}`, username: u.username, avatarUrl: u.avatarUrl })
  }

  const goTab = (i: number) => {
    dirRef.current = i > tab ? 1 : -1
    setTab(i)
  }

  const messages = chats
    .filter((c) => c.type !== 'saved')
    .slice(0, 7)
    .map((c) => ({ id: c.id, name: c.name, avatar: c.avatar, t: c.avatarText, e: c.avatarEmoji, date: c.date, text: 'Привет' }))

  return (
    <div className={s.root}>
      {/* Tabs strip (shared <Tabs> — tweb 1:1), выровнен по краям секций */}
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

      {/* Animated content */}
      <div className={s.content}>
        <AnimatePresence mode="wait" custom={dirRef.current} initial={false}>
          <motion.div
            key={tab}
            className={s.scroll}
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
              {tab === 0 && (
                <>
                  {query.trim() && results.chats.length > 0 && (
                    <SidebarSection title={t('Channels and groups')}>
                      {results.chats.map((c) => (
                        <ResultRow
                          key={`c-${c.id}`}
                          bg={avatarBg(c.id)}
                          t={(c.title || '?').charAt(0).toUpperCase()}
                          title={c.title}
                          subtitle={`@${c.username}, ${c.memberCount} ${t('subscribers')}`}
                          onClick={() => onResultChat(c.id, c.username)}
                        />
                      ))}
                    </SidebarSection>
                  )}
                  {query.trim() && results.users.length > 0 && (
                    <SidebarSection title={t('Global search')}>
                      {results.users.map((u) => (
                        <ResultRow
                          key={`u-${u.id}`}
                          bg={avatarBg(u.id)}
                          src={u.avatarUrl}
                          t={(u.displayName || u.username || '?').charAt(0).toUpperCase()}
                          title={u.displayName || u.username}
                          subtitle={u.username ? `@${u.username}` : ''}
                          onClick={() => onResultUser(u)}
                        />
                      ))}
                    </SidebarSection>
                  )}
                  <SidebarSection title={t('Messages')} action={t('All Chats')}>
                    {messages.map((m) => (
                      <div key={m.id} className={s.row} onClick={() => onSelect(m.id)}>
                        <Avatar background={m.avatar} text={m.t} emoji={m.e} size="lg" />
                        <div className={s.body}>
                          <div className={s.top}>
                            <Text noWrap size={16} weight={600} color="var(--tg-textPrimary)" className={s.titleFlex}>{m.name}</Text>
                            <Text size={13} color="var(--tg-textFaint)">{m.date}</Text>
                          </div>
                          <Text noWrap size={15} color="var(--tg-textPrimary)">
                            <Highlighted text={m.text} q={query} />
                          </Text>
                        </div>
                      </div>
                    ))}
                  </SidebarSection>
                </>
              )}

              {tab === 1 && (
                <SidebarSection>
                  {channelsList.map((c) => (
                    <ResultRow key={c.name} bg={c.bg} t={c.t} tc={c.tc} title={c.name} subtitle={c.sub} verified={c.verified} />
                  ))}
                </SidebarSection>
              )}

              {tab === 2 && (
                <>
                  <SidebarSection title={t('Apps you use')}>
                    <ResultRow bg="linear-gradient(135deg,#2a2a2a,#000)" t="👁" title="Telescope" subtitle="1 554 419 users" />
                  </SidebarSection>
                  <SidebarSection title={t('Popular Apps')}>
                    {popularApps.map((a) => (
                      <ResultRow key={a.name} bg={a.bg} t={a.t} title={a.name} subtitle={a.sub} verified={a.verified} />
                    ))}
                  </SidebarSection>
                </>
              )}

              {tab === 3 && <Empty text={t('Nothing interesting here yet…')} />}

              {tab === 4 && (
                <SidebarSection>
                  {messages.slice(0, 2).map((m) => (
                    <MediaRow key={m.id} m={m} query={query} onSelect={onSelect} />
                  ))}
                </SidebarSection>
              )}

              {tab === 5 && (
                <SidebarSection>
                  {links.map((l) => (
                    <div key={l.name} className={s.rowStatic}>
                      <Avatar background={l.bg} text={l.t} size="md" />
                      <div className={s.body}>
                        <div className={s.top}>
                          <Text noWrap size={16} weight={600} color="var(--tg-textPrimary)" className={s.titleFlex}>{l.name}</Text>
                          <Text size={13} color="var(--tg-textFaint)">{l.date}</Text>
                        </div>
                        <Text size={14.5} color="var(--tg-textSecondary)" style={{ marginTop: '2px' }}>{l.body}</Text>
                        <Text noWrap size={14.5} color="var(--tg-link)" style={{ marginTop: '2px' }}>{l.link}</Text>
                        <Text size={13.5} color="var(--tg-textFaint)" style={{ marginTop: '2px' }}>{l.from}</Text>
                      </div>
                    </div>
                  ))}
                </SidebarSection>
              )}

              {tab === 6 && <Empty text={t('Nothing interesting here yet…')} />}
              {tab === 7 && <Empty text={t('Nothing interesting here yet…')} />}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────────────
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

function MediaRow({ m, query, onSelect }: {
  m: { id: string; name: string; avatar: string; t?: string; e?: string; date: string; text: string }
  query: string
  onSelect: (id: string) => void
}) {
  return (
    <div className={s.row} onClick={() => onSelect(m.id)}>
      <Avatar background={m.avatar} text={m.t} emoji={m.e} size="lg" />
      <div className={s.body}>
        <div className={s.top}>
          <Text noWrap size={16} weight={600} color="var(--tg-textPrimary)" className={s.titleFlex}>{m.name}</Text>
          <Text size={13} color="var(--tg-textFaint)">{m.date}</Text>
        </div>
        <div className={s.mediaLine}>
          <TgIcon name="play" size={18} color="var(--tg-textSecondary)" />
          <Text noWrap size={15} color="var(--tg-textPrimary)">
            <Highlighted text={m.text} q={query} />
          </Text>
        </div>
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
