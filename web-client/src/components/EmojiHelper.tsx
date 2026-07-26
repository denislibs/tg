// Полоска эмодзи-подсказок над композером — порт tweb autocomplete-helper /
// emoji-helper (_autocompleteHelper.scss + _chatEmojiHelper.scss): 50px,
// эмодзи 42×42, активный подсвечен accent-фоном, fade 0.2s. Управляется из
// Composer (запрос по слову у каретки, стрелки/Tab/Enter/Escape).
import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import Emoji from './emoji/Emoji'
import classNames from '../shared/lib/classNames'
import s from './EmojiHelper.module.scss'

export default function EmojiHelper({
  emojis,
  activeIdx,
  onPick,
}: {
  emojis: string[]
  activeIdx: number // -1 — навигация «спит» (tweb waitForKey до первой стрелки)
  onPick: (e: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (activeIdx < 0) return
    const el = scrollRef.current?.children[activeIdx] as HTMLElement | undefined
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
  }, [activeIdx])
  return (
    <motion.div
      className={s.helper}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      // не отдавать фокус из contenteditable
      onMouseDown={(e) => e.preventDefault()}
    >
      <div ref={scrollRef} className={s.scroll}>
        {emojis.map((e, i) => (
          <span
            key={e}
            className={classNames(s.item, i === activeIdx ? s.active : '')}
            onClick={() => onPick(e)}
          >
            <Emoji e={e} size={34} />
          </span>
        ))}
      </div>
    </motion.div>
  )
}
