// src/components/messages/SendMediaPopup.tsx
// Compose-before-send dialog (port of tweb popups/newMedia.ts): preview the
// picked files, add a caption, toggle "as media" vs "as file", then send. The
// parent owns the actual upload/send (onSend).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, IconButton, InputBase, Typography, useTheme } from '@mui/material'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import { EASE, DUR } from '../../motion'
import { useT } from '../../i18n'

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
  const tg = useTheme().tg
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
    <Box
      onClick={onClose}
      sx={{ position: 'fixed', inset: 0, zIndex: 2200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}
    >
      <Box
        onClick={(e) => e.stopPropagation()}
        component={motion.div}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: DUR.in, ease: EASE }}
        sx={{ width: 'min(420px, calc(100vw - 32px))', maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: tg.menuBg, borderRadius: '14px', boxShadow: tg.menuShadow, overflow: 'hidden' }}
      >
        {/* header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 1 }}>
          <IconButton size="small" onClick={onClose} sx={{ color: tg.textPrimary }}><TgIcon name="close" /></IconButton>
          <Typography sx={{ flex: 1, fontSize: 18, fontWeight: 600, color: tg.textPrimary }}>{title}</Typography>
          {anyMedia && (
            <Box sx={{ position: 'relative' }}>
              <IconButton size="small" onClick={() => setMenuOpen((v) => !v)} sx={{ color: tg.textPrimary }}><TgIcon name="more" /></IconButton>
              {menuOpen && (
                <Box sx={{ position: 'absolute', right: 0, top: '100%', mt: 0.5, minWidth: 220, py: 0.75, borderRadius: '12px', background: tg.menuBg, boxShadow: tg.menuShadow, zIndex: 1 }}>
                  <MenuItem icon={<TgIcon name="image" size={20} />} label={t('Send as media')} active={!asFile} onClick={() => { setAsFile(false); setMenuOpen(false) }} tg={tg} />
                  <MenuItem icon={<TgIcon name="document" size={20} />} label={t('Send as file')} active={asFile} onClick={() => { setAsFile(true); setMenuOpen(false) }} tg={tg} />
                </Box>
              )}
            </Box>
          )}
        </Box>

        {/* previews */}
        <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1, display: 'flex', flexDirection: 'column', gap: 1, alignItems: showAsMedia ? 'center' : 'stretch' }}>
          {files.map((f, i) => {
            if (showAsMedia && f.type.startsWith('image/')) {
              return <Box key={i} component="img" src={urls[i]} sx={{ maxWidth: '100%', maxHeight: 360, borderRadius: '10px', objectFit: 'contain' }} />
            }
            if (showAsMedia && f.type.startsWith('video/')) {
              return <Box key={i} component="video" src={urls[i]} controls sx={{ maxWidth: '100%', maxHeight: 360, borderRadius: '10px' }} />
            }
            // file row (documents, audio, or "as file" mode)
            const ext = (f.name.split('.').pop() || '').slice(0, 4).toUpperCase()
            return (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: 1, borderRadius: '10px', background: tg.hover }}>
                <Box sx={{ width: 44, height: 44, flexShrink: 0, borderRadius: '50%', background: tg.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{ext || <TgIcon name="document" />}</Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: 14.5, fontWeight: 600, color: tg.textPrimary }}>{f.name}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: tg.textSecondary }}>{fmtSize(f.size)}</Typography>
                </Box>
              </Box>
            )
          })}
        </Box>

        {/* caption + send */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1.25, borderTop: `1px solid ${tg.hover}` }}>
          <InputBase
            inputRef={inputRef}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder={t('Add a caption…')}
            sx={{ flex: 1, fontSize: 16, color: tg.textPrimary, '& input::placeholder': { color: tg.textFaint, opacity: 1 } }}
          />
          <Box component={motion.div} whileTap={{ scale: 0.92 }} onClick={send} sx={{ width: 48, height: 40, flexShrink: 0, borderRadius: '20px', background: tg.accentGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer' }}>
            <TgIcon name="send" />
          </Box>
        </Box>
      </Box>
    </Box>,
    document.body,
  )
}

function MenuItem({ icon, label, active, onClick, tg }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; tg: { hover: string; accent: string; textPrimary: string; textSecondary: string } }) {
  return (
    <Box onClick={onClick} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 0.75, mx: 0.5, borderRadius: '8px', cursor: 'pointer', '&:hover': { background: tg.hover } }}>
      <Box sx={{ display: 'flex', color: active ? tg.accent : tg.textSecondary, '& svg': { fontSize: 20 } }}>{icon}</Box>
      <Typography sx={{ fontSize: 15, color: active ? tg.accent : tg.textPrimary }}>{label}</Typography>
    </Box>
  )
}
