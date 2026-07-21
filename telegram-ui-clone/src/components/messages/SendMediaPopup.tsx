// src/components/messages/SendMediaPopup.tsx
// Compose-before-send dialog (port of tweb popups/newMedia.ts) на общем Popup:
// превью выбранных файлов, подпись, «как медиа / как файл» в меню «⋮», отправка.
// The parent owns the actual upload/send (onSend).
import { useEffect, useMemo, useRef, useState } from 'react'
import Text from '../../shared/ui/Text'
import IconButton from '../../shared/ui/IconButton'
import Popup from '../../shared/ui/Popup'
import Menu, { MenuItem } from '../../shared/ui/Menu'
import { motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import MediaEditor from '../mediaEditor/MediaEditor'
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
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  // exit-анимация Popup: отправка/закрытие гасят open, onSend/onClose — из
  // onExitComplete (владелец размонтирует уже невидимый диалог)
  const [open, setOpen] = useState(true)
  const sending = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Медиа-редактор поверх попапа: индекс редактируемого изображения. После
  // «Готово» File заменяется ПО МЕСТУ в массиве files — его же читает владелец
  // (useChatSend.sendPendingMedia), поэтому правка видна при отправке без
  // дополнительного канала наверх; rev форсирует пересоздание превью-URL.
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [rev, setRev] = useState(0)

  // Object URLs for previews; revoked when files change / on unmount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const urls = useMemo(() => files.map((f) => (isMediaFile(f) ? URL.createObjectURL(f) : '')), [files, rev])
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

  const send = () => { sending.current = true; setOpen(false) }

  return (
    <Popup
      open={open}
      title={title}
      width={420}
      onClose={() => setOpen(false)}
      onExitComplete={() => { if (sending.current) onSend(caption.trim(), asFile); else onClose() }}
      headerRight={anyMedia ? (
        <>
          <IconButton
            size="small"
            color="var(--tg-textPrimary)"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
              setMenuOpen(true)
            }}
          >
            <TgIcon name="more" />
          </IconButton>
          {menuPos && (
            <Menu
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              onExitComplete={() => setMenuPos(null)}
              zIndex={4100}
              style={{ top: menuPos.top, right: menuPos.right, transformOrigin: 'top right' }}
            >
              <MenuItem
                icon={<TgIcon name="image" size={20} />}
                label={t('Send as media')}
                right={!asFile ? <TgIcon name="check" size={18} color="var(--tg-accent)" /> : undefined}
                onClick={() => { setAsFile(false); setMenuOpen(false) }}
              />
              <MenuItem
                icon={<TgIcon name="document" size={20} />}
                label={t('Send as file')}
                right={asFile ? <TgIcon name="check" size={18} color="var(--tg-accent)" /> : undefined}
                onClick={() => { setAsFile(true); setMenuOpen(false) }}
              />
            </Menu>
          )}
        </>
      ) : undefined}
      footer={
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
      }
    >
      <div className={s.previews} data-media={showAsMedia || undefined}>
        {files.map((f, i) => {
          if (showAsMedia && f.type.startsWith('image/')) {
            return (
              <div key={`${i}-${rev}`} className={s.previewWrap}>
                <img className={`${s.preview} ${s.previewImg}`} src={urls[i]} alt="" />
                <IconButton size="small" color="#fff" className={s.editBtn} onClick={() => setEditIdx(i)}>
                  <TgIcon name="edit" size={20} />
                </IconButton>
              </div>
            )
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

      {editIdx != null && files[editIdx] && (
        <MediaEditor
          file={files[editIdx]}
          onCancel={() => setEditIdx(null)}
          onDone={(blob) => {
            const old = files[editIdx]
            const name = /\.\w+$/.test(old.name) ? old.name.replace(/\.\w+$/, '.jpg') : `${old.name}.jpg`
            files[editIdx] = new File([blob], name, { type: 'image/jpeg' })
            setRev((r) => r + 1)
            setEditIdx(null)
          }}
        />
      )}
    </Popup>
  )
}
