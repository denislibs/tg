// src/components/messages/SendMediaPopup.tsx
// Compose-before-send dialog (port of tweb popups/newMedia.ts): preview the
// picked files, add a caption, toggle "as media" vs "as file", then send. The
// parent owns the actual upload/send (onSend).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Text from '../../shared/ui/Text'
import IconButton from '../../shared/ui/IconButton'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import { EASE, DUR } from '../../motion'
import { useT } from '../../i18n'
import s from './SendMediaPopup.module.scss'

const isMediaFile = (f: File) => /^(image|video|audio)\//.test(f.type)

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`
  if (n >= 1024) return `${Math.max(1, Math.round(n / 1024))} КБ`
  return `${n} Б`
}

// Russian count word for the title.
function titleWord(n: number, kind: 'photo' | 'video' | 'media' | 'file'): string {
  if (kind === 'photo') return 'фото'
  if (kind === 'video') return 'видео'
  if (kind === 'media') return 'медиа'
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'файл'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'файла'
  return 'файлов'
}

export default function SendMediaPopup({
  files, initialAsFile, onClose, onSend,
}: {
  files: File[]
  initialAsFile: boolean
  onClose: () => void
  onSend: (caption: string, asFile: boolean) => void
}) {
  const t = useT()
  const [caption, setCaption] = useState('')
  const [asFile, setAsFile] = useState(initialAsFile)
  const [menuOpen, setMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Object URLs for previews; revoked on unmount.
  const urls = useMemo(() => files.map((f) => (isMediaFile(f) ? URL.createObjectURL(f) : '')), [files])
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls])
  useEffect(() => { inputRef.current?.focus() }, [])

  const anyMedia = files.some(isMediaFile)
  const showAsMedia = !asFile && anyMedia
  const allImages = files.every((f) => f.type.startsWith('image/'))
  const allVideos = files.every((f) => f.type.startsWith('video/'))
  const kind: 'photo' | 'video' | 'media' | 'file' = asFile || !anyMedia
    ? 'file'
    : allImages ? 'photo' : allVideos ? 'video' : 'media'
  const title = `${t('Send')} ${files.length} ${titleWord(files.length, kind)}`

  const send = () => onSend(caption.trim(), asFile)

  return createPortal(
    <div className={s.overlay} onClick={onClose}>
      <motion.div
        className={s.dialog}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: DUR.in, ease: EASE }}
      >
        {/* header */}
        <div className={s.header}>
          <IconButton size="small" onClick={onClose} color="var(--tg-textPrimary)"><TgIcon name="close" /></IconButton>
          <Text size={18} weight={600} color="var(--tg-textPrimary)" className={s.title}>{title}</Text>
          {anyMedia && (
            <div className={s.moreWrap}>
              <IconButton size="small" onClick={() => setMenuOpen((v) => !v)} color="var(--tg-textPrimary)"><TgIcon name="more" /></IconButton>
              {menuOpen && (
                <div className={s.menu}>
                  <MenuItem icon={<TgIcon name="image" size={20} />} label={t('Send as media')} active={!asFile} onClick={() => { setAsFile(false); setMenuOpen(false) }} />
                  <MenuItem icon={<TgIcon name="document" size={20} />} label={t('Send as file')} active={asFile} onClick={() => { setAsFile(true); setMenuOpen(false) }} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* previews */}
        <div className={s.previews} data-media={showAsMedia || undefined}>
          {files.map((f, i) => {
            if (showAsMedia && f.type.startsWith('image/')) {
              return <img key={i} className={`${s.preview} ${s.previewImg}`} src={urls[i]} alt="" />
            }
            if (showAsMedia && f.type.startsWith('video/')) {
              return <video key={i} className={s.preview} src={urls[i]} controls />
            }
            // file row (documents, audio, or "as file" mode)
            const ext = (f.name.split('.').pop() || '').slice(0, 4).toUpperCase()
            return (
              <div key={i} className={s.fileRow}>
                <div className={s.fileIcon}>{ext || <TgIcon name="document" />}</div>
                <div className={s.fileBody}>
                  <Text noWrap size={14.5} weight={600} color="var(--tg-textPrimary)">{f.name}</Text>
                  <Text size={12.5} color="var(--tg-textSecondary)">{fmtSize(f.size)}</Text>
                </div>
              </div>
            )
          })}
        </div>

        {/* caption + send */}
        <div className={s.footer}>
          <input
            ref={inputRef}
            className={s.caption}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder={t('Add a caption…')}
          />
          <motion.div className={s.send} whileTap={{ scale: 0.92 }} onClick={send}>
            <TgIcon name="send" />
          </motion.div>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}

function MenuItem({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <div className={s.menuItem} data-active={active || undefined} onClick={onClick}>
      <span className={s.menuIcon}>{icon}</span>
      <Text size={15} color="var(--mi-color)">{label}</Text>
    </div>
  )
}
