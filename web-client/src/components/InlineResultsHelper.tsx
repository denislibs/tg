// Панель inline-результатов над композером (tweb InlineHelper, list-режим):
// ряд = эмодзи-превью + заголовок + описание. Навигация стрелками/Enter/Tab из
// Composer; клик/Enter выбирает результат (он отправляется в чат).
import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import classNames from '../shared/lib/classNames'
import type { InlineResult } from '../core/managers/botsManager'
import s from './InlineResultsHelper.module.scss'

export default function InlineResultsHelper({
  results,
  activeIdx,
  onPick,
}: {
  results: InlineResult[]
  activeIdx: number
  onPick: (r: InlineResult) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (activeIdx < 0) return
    const el = scrollRef.current?.children[activeIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
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
        {results.map((r, i) => (
          <div
            key={r.id}
            className={classNames(s.row, i === activeIdx ? s.active : '')}
            onClick={() => onPick(r)}
          >
            <div className={s.preview}>{r.emoji || r.title.charAt(0).toUpperCase()}</div>
            <div className={s.title}>{r.title}</div>
            {r.description && <div className={s.desc}>{r.description}</div>}
          </div>
        ))}
      </div>
    </motion.div>
  )
}
