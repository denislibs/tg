import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, InputBase, Typography, useTheme } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import EmojiSymbolsRounded from '@mui/icons-material/EmojiSymbolsRounded'
import TgIcon, { type IconName } from './TgIcon'
import { EASE } from '../motion'
import { useT } from '../i18n'
import { CATEGORIES, SKIN, TONES, NAMES, DEFAULT_FREQUENT, QUICK_CHIPS } from './emoji/emojiData'
import Emoji from './emoji/Emoji'

type Tab = 'emoji' | 'stickers' | 'gifs'

// tgico glyph name per category; `symbols` has no tgico equivalent so it keeps
// the MUI EmojiSymbolsRounded component (rendered specially below).
const CAT_ICON: Record<string, IconName | typeof EmojiSymbolsRounded> = {
  recent: 'recent',
  smileys: 'smile',
  animals: 'animals',
  food: 'eats',
  activity: 'sport',
  travel: 'car',
  objects: 'lamp',
  symbols: EmojiSymbolsRounded,
  flags: 'flag',
}

const RECENT_KEY = 'tg-emoji-recent'
function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
  } catch {
    return []
  }
}

const STICKER_PACKS = [
  { name: 'Cats', emojis: ['😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🐱', '🐈', '🐈‍⬛'] },
  { name: 'Hands', emojis: ['👍', '👎', '👏', '🙌', '🤝', '✌️', '🤟', '🤙', '👊', '✊', '🤛', '🤜'] },
  { name: 'Party', emojis: ['🎉', '🎊', '🥳', '🎂', '🎈', '🎁', '🍾', '🥂', '✨', '💫', '🪅', '🎆'] },
  { name: 'Love', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💕', '💞', '💓', '💗', '💖'] },
]
const GIF_TILES = [
  { g: 'linear-gradient(135deg,#ff6a88,#ff99ac)', h: 100, e: '🐱' },
  { g: 'linear-gradient(135deg,#43cea2,#185a9d)', h: 150, e: '🌊' },
  { g: 'linear-gradient(135deg,#f7971e,#ffd200)', h: 120, e: '😂' },
  { g: 'linear-gradient(135deg,#654ea3,#eaafc8)', h: 140, e: '🎉' },
  { g: 'linear-gradient(135deg,#8a5bff,#5b8dff)', h: 110, e: '🔥' },
  { g: 'linear-gradient(135deg,#2980b9,#6dd5fa)', h: 160, e: '👍' },
  { g: 'linear-gradient(135deg,#ee9ca7,#ffdde1)', h: 130, e: '🥰' },
  { g: 'linear-gradient(135deg,#c471f5,#fa71cd)', h: 120, e: '💃' },
  { g: 'linear-gradient(135deg,#42e695,#3bb2b8)', h: 150, e: '🤩' },
  { g: 'linear-gradient(135deg,#f7971e,#ffd200)', h: 100, e: '🎬' },
]

export default function EmojiPicker({
  onPick,
  onSticker,
  onGif,
  onClose,
}: {
  onPick: (emoji: string) => void
  onSticker?: (emoji: string) => void
  onGif?: (gradient: string) => void
  onClose: () => void
}) {
  const theme = useTheme()
  const tg = theme.tg
  const t = useT()
  const [tab, setTab] = useState<Tab>('emoji')
  const [query, setQuery] = useState('')
  const [tone, setTone] = useState(0)
  const [toneOpen, setToneOpen] = useState(false)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [activeCat, setActiveCat] = useState('recent')

  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const applyTone = (e: string) => (tone > 0 && SKIN.has(e) ? e + TONES[tone] : e)

  const pickEmoji = (e: string) => {
    onPick(e)
    setRecent((prev) => {
      const next = [e, ...prev.filter((x) => x !== e)].slice(0, 32)
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      return next
    })
  }

  // "Frequently used" seed when there's no history yet (Telegram pre-fills it).
  const frequent = recent.length ? recent : DEFAULT_FREQUENT
  const cats = useMemo(
    () => [{ key: 'recent', label: 'Frequently Used', emojis: frequent }, ...CATEGORIES],
    [frequent],
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const out: string[] = []
    for (const c of CATEGORIES)
      for (const e of c.emojis) {
        const kw = NAMES[e]
        if ((kw && kw.includes(q)) || e === q) out.push(e)
      }
    return out
  }, [query])

  const onScroll = () => {
    const sc = scrollRef.current
    if (!sc) return
    const top = sc.scrollTop + 8
    let cur = cats[0]?.key
    for (const c of cats) {
      const el = sectionRefs.current[c.key]
      if (el && el.offsetTop <= top) cur = c.key
    }
    if (cur) setActiveCat(cur)
  }
  const scrollToCat = (key: string) => {
    const el = sectionRefs.current[key]
    const sc = scrollRef.current
    if (el && sc) sc.scrollTo({ top: el.offsetTop - 2, behavior: 'smooth' })
    setActiveCat(key)
  }

  const cellSx = {
    width: '100%',
    height: 42,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
    cursor: 'pointer',
    userSelect: 'none' as const,
    transition: 'background .12s',
    '&:hover': { background: tg.hover },
    '&:active': { background: tg.divider },
  }
  const gridSx = { display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)' }

  const emojiCell = (raw: string, key: string, toneable = true) => {
    const e = toneable ? applyTone(raw) : raw
    return (
      <Box key={key} onClick={() => pickEmoji(e)} sx={cellSx}>
        <Emoji e={e} size={30} />
      </Box>
    )
  }

  return (
    <Box
      component={motion.div}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ duration: 0.2, ease: EASE }}
      sx={{
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        right: 0,
        width: 'min(382px, calc(100vw - 24px))',
        height: 420,
        background: tg.sidebarBg,
        borderRadius: '20px',
        boxShadow: '0 5px 10px 5px rgba(16,35,47,0.14)',
        border: `1px solid ${tg.divider}`,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        transformOrigin: 'bottom right',
        zIndex: 30,
      }}
    >
      {tab === 'emoji' && (
        <>
          {/* category nav */}
          <Box sx={{ display: 'flex', alignItems: 'center', px: 0.5, pt: 0.5 }}>
            <Box sx={{ display: 'flex', flex: 1, overflowX: 'auto', '&::-webkit-scrollbar': { display: 'none' } }}>
              {cats.map((c) => {
                const icon = CAT_ICON[c.key]
                const on = activeCat === c.key
                return (
                  <Box
                    key={c.key}
                    onClick={() => scrollToCat(c.key)}
                    sx={{
                      width: 34,
                      height: 34,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      color: on ? tg.accent : tg.textFaint,
                      background: on ? `${tg.accent}1f` : 'transparent',
                      '&:hover': { background: on ? `${tg.accent}1f` : tg.hover },
                    }}
                  >
                    {typeof icon === 'string' ? (
                      <TgIcon name={icon} size={20} />
                    ) : (
                      (() => {
                        const Icon = icon
                        return <Icon sx={{ fontSize: 20 }} />
                      })()
                    )}
                  </Box>
                )
              })}
            </Box>
            {/* skin tone */}
            <Box sx={{ position: 'relative', flexShrink: 0 }}>
              <Box
                onClick={() => setToneOpen((o) => !o)}
                sx={{ width: 34, height: 34, fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', cursor: 'pointer', '&:hover': { background: tg.hover } }}
              >
                {'✋' + TONES[tone]}
              </Box>
              <AnimatePresence>
                {toneOpen && (
                  <Box
                    component={motion.div}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.15, ease: EASE }}
                    sx={{ position: 'absolute', top: '100%', right: 0, mt: 0.5, display: 'flex', gap: 0.25, p: 0.5, borderRadius: '8px', background: tg.menuBg, boxShadow: tg.menuShadow, zIndex: 5 }}
                  >
                    {TONES.map((tn, i) => (
                      <Box
                        key={i}
                        onClick={() => {
                          setTone(i)
                          setToneOpen(false)
                        }}
                        sx={{ width: 30, height: 30, fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', cursor: 'pointer', '&:hover': { background: tg.hover } }}
                      >
                        {'✋' + tn}
                      </Box>
                    ))}
                  </Box>
                )}
              </AnimatePresence>
            </Box>
          </Box>

          {/* search + quick chips (always visible) */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.75 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                height: 36,
                px: 1.25,
                borderRadius: '18px',
                background: tg.bubble,
                flexShrink: 1,
                minWidth: 0,
                flex: query ? 1 : '0 1 auto',
              }}
            >
              <TgIcon name="search" size={20} color={tg.textFaint} />
              <InputBase
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('Search Emoji')}
                sx={{ flex: 1, fontSize: 15, color: tg.textPrimary, '& input::placeholder': { color: tg.textFaint, opacity: 1 } }}
              />
            </Box>
            {!query && (
              <Box sx={{ display: 'flex', gap: 0.5, overflowX: 'auto', '&::-webkit-scrollbar': { display: 'none' } }}>
                {QUICK_CHIPS.map((c) => (
                  <Box
                    key={c.e}
                    onClick={() => setQuery(c.q)}
                    sx={{ width: 30, height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', cursor: 'pointer', opacity: 0.85, '&:hover': { background: tg.hover, opacity: 1 } }}
                  >
                    <Emoji e={c.e} size={22} />
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </>
      )}

      {/* Content */}
      <Box ref={scrollRef} onScroll={onScroll} sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', px: 0.5, pb: 0.5 }}>
        {tab === 'emoji' ? (
          query.trim() ? (
            results.length ? (
              <Box sx={gridSx}>{results.map((e, i) => emojiCell(e, `r-${e}-${i}`, false))}</Box>
            ) : (
              <Typography sx={{ textAlign: 'center', color: tg.textSecondary, fontSize: 14, mt: 4 }}>
                {t('No emoji found.')}
              </Typography>
            )
          ) : (
            cats.map((c) => (
              <Box key={c.key} ref={(el: HTMLDivElement | null) => (sectionRefs.current[c.key] = el)} sx={{ mb: 0.5 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 500, color: tg.textFaint, px: '6px', py: '8px' }}>
                  {t(c.label)}
                </Typography>
                <Box sx={gridSx}>{c.emojis.map((e, i) => emojiCell(e, `${c.key}-${i}`, c.key !== 'recent'))}</Box>
              </Box>
            ))
          )
        ) : tab === 'stickers' ? (
          STICKER_PACKS.map((p) => (
            <Box key={p.name} sx={{ mb: 0.5 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 500, color: tg.textFaint, px: '6px', py: '8px' }}>
                {p.name}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}>
                {p.emojis.map((e, i) => (
                  <Box
                    key={`${p.name}-${i}`}
                    onClick={() => {
                      onSticker?.(e)
                      onClose()
                    }}
                    sx={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', cursor: 'pointer', '&:hover': { background: tg.hover } }}
                  >
                    <Emoji e={e} size={48} />
                  </Box>
                ))}
              </Box>
            </Box>
          ))
        ) : (
          <Box sx={{ columnCount: 2, columnGap: '4px', px: '2px', pt: '4px' }}>
            {GIF_TILES.map((tile, i) => (
              <Box
                key={i}
                onClick={() => {
                  onGif?.(tile.g)
                  onClose()
                }}
                sx={{ breakInside: 'avoid', mb: '4px', height: tile.h, borderRadius: '8px', background: tile.g, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, cursor: 'pointer' }}
              >
                {tile.e}
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* Bottom tab bar: emoji / stickers / gifs centered, backspace right */}
      <Box
        sx={{
          height: 49,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          position: 'relative',
          borderTop: `1px solid ${tg.divider}`,
        }}
      >
        {([
          ['emoji', <TgIcon name="smile" size={24} />],
          ['stickers', <TgIcon name="enhance" size={24} />],
          ['gifs', <TgIcon name="gifs" size={24} />],
        ] as [Tab, React.ReactNode][]).map(([key, icon]) => {
          const active = key === tab
          return (
            <Box
              key={key}
              onClick={() => {
                setTab(key)
                setQuery('')
              }}
              sx={{
                width: 40,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                cursor: 'pointer',
                color: active ? tg.accent : tg.textSecondary,
                background: active ? `${tg.accent}1f` : 'transparent',
                '&:hover': { background: active ? `${tg.accent}1f` : tg.hover },
              }}
            >
              {icon}
            </Box>
          )
        })}
        <Box
          onClick={() => onPick('\b')}
          sx={{ position: 'absolute', right: 8, width: 40, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', cursor: 'pointer', color: tg.textSecondary, '&:hover': { background: tg.hover } }}
        >
          <TgIcon name="deleteleft" size={24} />
        </Box>
      </Box>
    </Box>
  )
}
