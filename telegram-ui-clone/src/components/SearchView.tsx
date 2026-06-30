import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from './TgIcon'
import Avatar from './Avatar'
import { useAvatarSrc } from './useAvatarSrc'
import VerifiedBadge from './VerifiedBadge'
import type { Chat, OpenPeer } from '../data'
import type { TgTokens } from '../theme'
import type { SearchResult } from '../core/managers/channelsManager'
import { useT } from '../i18n'
import { Tabs } from './Tabs'

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
function Highlighted({ text, q, color }: { text: string; q: string; color: string }) {
  if (!q.trim()) return <>{text}</>
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <Box component="span" sx={{ color, fontWeight: 600 }}>
        {text.slice(idx, idx + q.length)}
      </Box>
      {text.slice(idx + q.length)}
    </>
  )
}

export default function SearchView({ query, chats, onSelect, searchReal, onJoin, onOpenPeer }: Props) {
  const t = useT()
  const theme = useTheme()
  const tg = theme.tg
  const cardBg = theme.palette.mode === 'dark' ? '#1c1c1c' : '#f0f0f2'
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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tabs strip (shared <Tabs> — tweb 1:1) */}
      <Tabs value={tab} onChange={(v) => goTab(v as number)} order={TABS.map((_, i) => i)}>
        <Tabs.List framed>
          {TABS.map((label, i) => (
            <Tabs.Tab key={label} value={i}>
              {t(label)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      {/* Animated content */}
      <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <AnimatePresence mode="wait" custom={dirRef.current} initial={false}>
          <motion.div
            key={tab}
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
            style={{ position: 'absolute', inset: 0, overflowY: 'auto' }}
          >
            <Box sx={{ pb: 2 }}>
              {tab === 0 && (
                <>
                  {query.trim() && results.chats.length > 0 && (
                    <Section title={t('Channels and groups')} tg={tg} cardBg={cardBg}>
                      {results.chats.map((c) => (
                        <ResultRow
                          key={`c-${c.id}`}
                          bg={avatarBg(c.id)}
                          t={(c.title || '?').charAt(0).toUpperCase()}
                          title={c.title}
                          subtitle={`@${c.username}, ${c.memberCount} ${t('subscribers')}`}
                          tg={tg}
                          onClick={() => onResultChat(c.id, c.username)}
                        />
                      ))}
                    </Section>
                  )}
                  {query.trim() && results.users.length > 0 && (
                    <Section title={t('Global search')} tg={tg} cardBg={cardBg}>
                      {results.users.map((u) => (
                        <ResultRow
                          key={`u-${u.id}`}
                          bg={avatarBg(u.id)}
                          src={u.avatarUrl}
                          t={(u.displayName || u.username || '?').charAt(0).toUpperCase()}
                          title={u.displayName || u.username}
                          subtitle={u.username ? `@${u.username}` : ''}
                          tg={tg}
                          onClick={() => onResultUser(u)}
                        />
                      ))}
                    </Section>
                  )}
                  <Box sx={{ display: 'flex', alignItems: 'center', px: 2.5, pt: 1.5, pb: 0.5 }}>
                    <Typography sx={{ flex: 1, fontSize: 15, fontWeight: 600, color: tg.accent }}>{t('Messages')}</Typography>
                    <Typography sx={{ fontSize: 15, fontWeight: 600, color: tg.accent, cursor: 'pointer' }}>{t('All Chats')}</Typography>
                  </Box>
                  {messages.map((m) => (
                    <Box
                      key={m.id}
                      onClick={() => onSelect(m.id)}
                      sx={{ display: 'flex', gap: 1.5, alignItems: 'center', px: 1.5, py: 0.85, mx: 0.75, borderRadius: '12px', cursor: 'pointer', '&:hover': { background: tg.hover } }}
                    >
                      <Avatar background={m.avatar} text={m.t} emoji={m.e} size={48} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex' }}>
                          <Typography noWrap sx={{ flex: 1, fontSize: 16, fontWeight: 600, color: tg.textPrimary }}>{m.name}</Typography>
                          <Typography sx={{ fontSize: 13, color: tg.textFaint }}>{m.date}</Typography>
                        </Box>
                        <Typography noWrap sx={{ fontSize: 15, color: tg.textPrimary }}>
                          <Highlighted text={m.text} q={query} color={tg.accent} />
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </>
              )}

              {tab === 1 && (
                <Section title="" tg={tg} cardBg={cardBg}>
                  {channelsList.map((c) => (
                    <ResultRow key={c.name} bg={c.bg} t={c.t} tc={c.tc} title={c.name} subtitle={c.sub} verified={c.verified} tg={tg} />
                  ))}
                </Section>
              )}

              {tab === 2 && (
                <>
                  <Section title={t('Apps you use')} tg={tg} cardBg={cardBg}>
                    <ResultRow bg="linear-gradient(135deg,#2a2a2a,#000)" t="👁" title="Telescope" subtitle="1 554 419 users" tg={tg} />
                  </Section>
                  <Section title={t('Popular Apps')} tg={tg} cardBg={cardBg}>
                    {popularApps.map((a) => (
                      <ResultRow key={a.name} bg={a.bg} t={a.t} title={a.name} subtitle={a.sub} verified={a.verified} tg={tg} />
                    ))}
                  </Section>
                </>
              )}

              {tab === 3 && <Empty text={t('Nothing interesting here yet…')} tg={tg} />}

              {tab === 4 && (
                <Section title="" tg={tg} cardBg={cardBg}>
                  {messages.slice(0, 2).map((m) => (
                    <MediaRow key={m.id} m={m} query={query} tg={tg} onSelect={onSelect} />
                  ))}
                </Section>
              )}

              {tab === 5 && (
                <Section title="" tg={tg} cardBg={cardBg}>
                  {links.map((l) => (
                    <Box key={l.name} sx={{ display: 'flex', gap: 1.5, px: 1.5, py: 1, mx: 0.75 }}>
                      <Avatar background={l.bg} text={l.t} size={44} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex' }}>
                          <Typography noWrap sx={{ flex: 1, fontSize: 16, fontWeight: 600, color: tg.textPrimary }}>{l.name}</Typography>
                          <Typography sx={{ fontSize: 13, color: tg.textFaint }}>{l.date}</Typography>
                        </Box>
                        <Typography sx={{ fontSize: 14.5, color: tg.textSecondary, mt: 0.25 }}>{l.body}</Typography>
                        <Typography noWrap sx={{ fontSize: 14.5, color: tg.link, mt: 0.25 }}>{l.link}</Typography>
                        <Typography sx={{ fontSize: 13.5, color: tg.textFaint, mt: 0.25 }}>{l.from}</Typography>
                      </Box>
                    </Box>
                  ))}
                </Section>
              )}

              {tab === 6 && <Empty text={t('Nothing interesting here yet…')} tg={tg} />}
              {tab === 7 && <Empty text={t('Nothing interesting here yet…')} tg={tg} />}
            </Box>
          </motion.div>
        </AnimatePresence>
      </Box>
    </Box>
  )
}

// ── helpers ─────────────────────────────────────────────────────────
function Section({ title, children, tg, cardBg }: { title: string; children: ReactNode; tg: TgTokens; cardBg: string }) {
  return (
    <Box sx={{ mx: 1.25, mt: 1, p: title ? 1.25 : 0.75, borderRadius: '16px', background: cardBg }}>
      {title && (
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: tg.accent, px: 1, pb: 0.5 }}>{title}</Typography>
      )}
      {children}
    </Box>
  )
}

function ResultRow({ bg, src, t, tc, title, subtitle, verified, tg, onClick }: {
  bg: string
  src?: string
  t: string
  tc?: string
  title: string
  subtitle: string
  verified?: boolean
  tg: TgTokens
  onClick?: () => void
}) {
  const avatarSrc = useAvatarSrc(src)
  return (
    <Box onClick={onClick} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1, py: 0.65, borderRadius: '12px', cursor: 'pointer', '&:hover': { background: tg.hover } }}>
      <Avatar background={bg} src={avatarSrc} text={t} size={48} color={tc ?? '#fff'} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography noWrap sx={{ fontSize: 16, fontWeight: 600, color: tg.textPrimary }}>{title}</Typography>
          {verified && <VerifiedBadge size={16} color={tg.accent} />}
        </Box>
        <Typography noWrap sx={{ fontSize: 14.5, color: tg.textSecondary }}>{subtitle}</Typography>
      </Box>
    </Box>
  )
}

function MediaRow({ m, query, tg, onSelect }: {
  m: { id: string; name: string; avatar: string; t?: string; e?: string; date: string; text: string }
  query: string
  tg: TgTokens
  onSelect: (id: string) => void
}) {
  return (
    <Box onClick={() => onSelect(m.id)} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1, py: 0.65, borderRadius: '12px', cursor: 'pointer', '&:hover': { background: tg.hover } }}>
      <Avatar background={m.avatar} text={m.t} emoji={m.e} size={48} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex' }}>
          <Typography noWrap sx={{ flex: 1, fontSize: 16, fontWeight: 600, color: tg.textPrimary }}>{m.name}</Typography>
          <Typography sx={{ fontSize: 13, color: tg.textFaint }}>{m.date}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <TgIcon name="play" size={18} color={tg.textSecondary} />
          <Typography noWrap sx={{ fontSize: 15, color: tg.textPrimary }}>
            <Highlighted text={m.text} q={query} color={tg.accent} />
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}

function Empty({ text, tg }: { text: string; tg: TgTokens }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pt: 14, gap: 0.5 }}>
      <Typography sx={{ fontSize: 16, color: tg.textSecondary, textAlign: 'center', whiteSpace: 'pre-line' }}>
        {text}
      </Typography>
    </Box>
  )
}
