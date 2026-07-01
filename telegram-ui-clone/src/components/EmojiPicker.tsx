import { useEffect, useMemo, useRef, useState } from 'react'
import Text from '../shared/ui/Text'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon, { type IconName } from './TgIcon'
import { EASE } from '../motion'
import { useT } from '../i18n'
import classNames from '../shared/lib/classNames'
import { CATEGORIES, SKIN, TONES, NAMES, DEFAULT_FREQUENT, QUICK_CHIPS } from './emoji/emojiData'
import Emoji from './emoji/Emoji'
import s from './EmojiPicker.module.scss'

// tgico glyph name per category. У категории `symbols` нет точного tgico-аналога
// (в MUI это был EmojiSymbolsRounded) — берём близкий по смыслу `language`.
// ЗАМЕТКА: если появится подходящий символьный глиф — заменить 'symbols'.
const CAT_ICON: Record<string, IconName> = {
  recent: 'recent',
  smileys: 'smile',
  animals: 'animals',
  food: 'eats',
  activity: 'sport',
  travel: 'car',
  objects: 'lamp',
  symbols: 'language',
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

export default function EmojiPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void
  onClose: () => void
}) {
  const t = useT()
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

  const emojiCell = (raw: string, key: string, toneable = true) => {
    const e = toneable ? applyTone(raw) : raw
    return (
      <div key={key} onClick={() => pickEmoji(e)} className={s.cell}>
        <Emoji e={e} size={30} />
      </div>
    )
  }

  return (
    <motion.div
      className={s.root}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      {/* category nav */}
      <div className={s.catNav}>
        <div className={s.catStrip}>
          {cats.map((c) => {
            const icon = CAT_ICON[c.key]
            const on = activeCat === c.key
            return (
              <div
                key={c.key}
                onClick={() => scrollToCat(c.key)}
                className={classNames(s.catBtn, on ? s.catBtnOn : '')}
              >
                <TgIcon name={icon} size={20} />
              </div>
            )
          })}
        </div>
        {/* skin tone */}
        <div className={s.toneWrap}>
          <div onClick={() => setToneOpen((o) => !o)} className={s.toneBtn}>
            {'✋' + TONES[tone]}
          </div>
          <AnimatePresence>
            {toneOpen && (
              <motion.div
                className={s.tonePop}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15, ease: EASE }}
              >
                {TONES.map((tn, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      setTone(i)
                      setToneOpen(false)
                    }}
                    className={s.toneItem}
                  >
                    {'✋' + tn}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* search + quick chips (always visible) */}
      <div className={s.searchRow}>
        <div className={s.searchBox} style={{ flex: query ? 1 : '0 1 auto' }}>
          <TgIcon name="search" size={20} color="var(--tg-textFaint)" />
          <input
            className={s.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search Emoji')}
          />
        </div>
        {!query && (
          <div className={s.chips}>
            {QUICK_CHIPS.map((c) => (
              <div key={c.e} onClick={() => setQuery(c.q)} className={s.chip}>
                <Emoji e={c.e} size={22} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div ref={scrollRef} onScroll={onScroll} className={s.content}>
        {query.trim() ? (
          results.length ? (
            <div className={s.grid}>{results.map((e, i) => emojiCell(e, `r-${e}-${i}`, false))}</div>
          ) : (
            <Text color="var(--tg-textSecondary)" size={14} style={{ textAlign: 'center', marginTop: '32px' }}>
              {t('No emoji found.')}
            </Text>
          )
        ) : (
          cats.map((c) => (
            <div key={c.key} ref={(el: HTMLDivElement | null) => (sectionRefs.current[c.key] = el)} className={s.section}>
              <Text size={14} weight={500} color="var(--tg-textFaint)" style={{ paddingLeft: '6px', paddingRight: '6px', paddingTop: '8px', paddingBottom: '8px' }}>
                {t(c.label)}
              </Text>
              <div className={s.grid}>{c.emojis.map((e, i) => emojiCell(e, `${c.key}-${i}`, c.key !== 'recent'))}</div>
            </div>
          ))
        )}
      </div>

      {/* Bottom bar: emoji indicator centered, backspace right */}
      <div className={s.footer}>
        <div className={s.footerIndicator}>
          <TgIcon name="smile" size={24} />
        </div>
        <div onClick={() => onPick('\b')} className={s.footerBackspace}>
          <TgIcon name="deleteleft" size={24} />
        </div>
      </div>
    </motion.div>
  )
}
