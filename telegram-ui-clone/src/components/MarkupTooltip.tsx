// src/components/MarkupTooltip.tsx
// Floating formatting bar (tweb's MarkupTooltip): appears above a text selection
// inside the composer's contenteditable, with B / I / U / S / monospace / spoiler
// / quote / link. Positioned via the selection's bounding rect and rendered in a
// portal so it isn't clipped by the composer's overflow.
import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTheme } from '@mui/material'
import { motion, AnimatePresence } from 'framer-motion'
import TgIcon from './TgIcon'
import { activeTypes } from '../core/markdown'
import type { EntityType } from '../core/models'
import type { IconName } from '../core/tgico-icons'

const TOOLS: { type: EntityType; icon: IconName; title: string }[] = [
  { type: 'bold', icon: 'bold', title: 'Жирный' },
  { type: 'italic', icon: 'italic', title: 'Курсив' },
  { type: 'underline', icon: 'underline', title: 'Подчёркнутый' },
  { type: 'strikethrough', icon: 'strikethrough', title: 'Зачёркнутый' },
  { type: 'code', icon: 'monospace', title: 'Моноширинный' },
  { type: 'spoiler', icon: 'spoiler', title: 'Спойлер' },
  { type: 'blockquote', icon: 'quote', title: 'Цитата' },
  { type: 'text_link', icon: 'link', title: 'Ссылка' },
]

export default function MarkupTooltip({
  editorRef,
  onApply,
}: {
  editorRef: RefObject<HTMLDivElement | null>
  onApply: (type: EntityType, url?: string) => void
}) {
  const theme = useTheme()
  const tg = theme.tg
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null)
  const [active, setActive] = useState<Set<EntityType>>(new Set())
  const [linkMode, setLinkMode] = useState(false)
  const [linkVal, setLinkVal] = useState('')
  const savedRange = useRef<Range | null>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const refresh = () => {
      const root = editorRef.current
      const sel = window.getSelection()
      if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setPos(null)
        setLinkMode(false)
        return
      }
      const range = sel.getRangeAt(0)
      if (!root.contains(range.commonAncestorContainer)) {
        setPos(null)
        return
      }
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        setPos(null)
        return
      }
      // Sit above the selection with a gap; if there isn't room up top, flip below
      // so the bar never clips off-screen or sits on top of the selected text.
      const GAP = 10
      const BAR_H = 44
      const below = rect.top < BAR_H + GAP + 8
      setPos({
        x: rect.left + rect.width / 2,
        y: below ? rect.bottom + GAP : rect.top - GAP,
        below,
      })
      setActive(activeTypes(root))
    }
    document.addEventListener('selectionchange', refresh)
    return () => document.removeEventListener('selectionchange', refresh)
  }, [editorRef])

  const click = (type: EntityType) => {
    if (type === 'text_link') {
      // remember the selection (opening the input would otherwise lose it)
      const sel = window.getSelection()
      savedRange.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null
      setLinkVal('')
      setLinkMode(true)
      setTimeout(() => linkInputRef.current?.focus(), 0)
      return
    }
    onApply(type)
    // re-read active state after applying
    const root = editorRef.current
    if (root) setActive(activeTypes(root))
  }

  const applyLink = () => {
    const sel = window.getSelection()
    if (savedRange.current && sel) {
      sel.removeAllRanges()
      sel.addRange(savedRange.current)
    }
    const url = linkVal.trim()
    if (url) onApply('text_link', /^https?:\/\//i.test(url) ? url : `https://${url}`)
    setLinkMode(false)
    setPos(null)
  }

  if (!pos) return null

  const surface = theme.palette.mode === 'dark' ? '#2b2b2b' : '#fff'

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="markup-tooltip"
        initial={{ opacity: 0, y: 6, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.94 }}
        transition={{ duration: 0.14 }}
        // keep the selection alive: never let the bar steal focus
        onMouseDown={(e) => e.preventDefault()}
        style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          transform: pos.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          zIndex: 1400,
          display: 'flex',
          alignItems: 'center',
          height: 44,
          padding: '0 4px',
          background: surface,
          borderRadius: 10,
          boxShadow: '0 4px 16px rgba(0,0,0,.28)',
        }}
      >
        {linkMode ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 4px' }}>
            <input
              ref={linkInputRef}
              value={linkVal}
              onChange={(e) => setLinkVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); applyLink() }
                if (e.key === 'Escape') { e.preventDefault(); setLinkMode(false) }
              }}
              placeholder="Введите ссылку…"
              style={{
                width: 260,
                height: 32,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: tg.textPrimary,
                fontSize: 15,
                padding: '0 8px',
              }}
            />
            <button
              onClick={applyLink}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: tg.accent, padding: 6, display: 'inline-flex' }}
            >
              <TgIcon name="check" size={22} />
            </button>
          </div>
        ) : (
          TOOLS.map((tool) => {
            const on = active.has(tool.type)
            return (
              <button
                key={tool.type}
                title={tool.title}
                onClick={() => click(tool.type)}
                style={{
                  width: 32,
                  height: 32,
                  margin: '0 1px',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: on ? tg.accent : 'transparent',
                  color: on ? '#fff' : tg.textSecondary,
                }}
              >
                <TgIcon name={tool.icon} size={20} />
              </button>
            )
          })
        )}
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
