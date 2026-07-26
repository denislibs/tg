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
import { supportsVideoEncoding } from '../mediaEditor/videoSupport'
import StarIcon from '../stars/StarIcon'
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
  onSend: (caption: string, asFile: boolean, paidPrice?: number | null) => void
}) {
  const t = useT()
  const [caption, setCaption] = useState('')
  const [asFile, setAsFile] = useState(initialAsFile)
  // Платное медиа (Telegram paid media): цена в звёздах. null — обычное медиа.
  // Доступно только для одиночного фото/видео «как медиа».
  const [paidPrice, setPaidPrice] = useState<number | null>(null)
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
  // Редактирование видео доступно только при поддержке WebCodecs (иначе энкод
  // невозможен) — кнопку edit у видео показываем лишь после успешной проверки.
  const [canEditVideo, setCanEditVideo] = useState(false)
  useEffect(() => { let dead = false; void supportsVideoEncoding().then((ok) => { if (!dead) setCanEditVideo(ok) }); return () => { dead = true } }, [])

  // Object URLs for previews; revoked when files change / on unmount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const urls = useMemo(() => files.map((f) => (isMediaFile(f) ? URL.createObjectURL(f) : '')), [files, rev])
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls])
  useEffect(() => { inputRef.current?.focus() }, [])

  const anyMedia = files.some(isMediaFile)
  const showAsMedia = !asFile && anyMedia
  // Платное медиа поддержано только для одиночного фото/видео «как медиа»
  // (бэкенд хранит цену на сообщение; альбомы/файлы — без цены).
  const onlyPhotoVideo = files.length === 1 && files.every((f) => /^(image|video)\//.test(f.type))
  const canPaid = showAsMedia && onlyPhotoVideo
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
      onExitComplete={() => { if (sending.current) onSend(caption.trim(), asFile, canPaid ? paidPrice : null); else onClose() }}
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
                onClick={() => { setAsFile(true); setPaidPrice(null); setMenuOpen(false) }}
              />
              {canPaid && (
                <MenuItem
                  icon={<StarIcon size={20} />}
                  label={t('Make paid')}
                  right={paidPrice != null ? <TgIcon name="check" size={18} color="var(--tg-accent)" /> : undefined}
                  onClick={() => { setPaidPrice((p) => (p == null ? 10 : null)); setMenuOpen(false) }}
                />
              )}
            </Menu>
          )}
        </>
      ) : undefined}
      footer={
        <div className={s.footerCol}>
          {canPaid && paidPrice != null && (
            <div className={s.paidBar}>
              <StarIcon size={18} />
              <input
                type="number"
                min={1}
                className={s.paidInput}
                value={paidPrice}
                onChange={(e) => setPaidPrice(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                aria-label={t('Price in Stars')}
              />
              <Text size={13} color="var(--tg-textSecondary)">{t('Price in Stars')}</Text>
            </div>
          )}
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
            return (
              <div key={`${i}-${rev}`} className={s.previewWrap}>
                <video className={s.preview} src={urls[i]} controls />
                {canEditVideo && (
                  <IconButton size="small" color="#fff" className={s.editBtn} onClick={() => setEditIdx(i)}>
                    <TgIcon name="edit" size={20} />
                  </IconButton>
                )}
              </div>
            )
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
          onDone={(edited) => {
            // MediaEditor уже собрал File с нужным mime/расширением (image/jpeg
            // или video/mp4, либо исходник без изменений) — кладём по месту.
            files[editIdx] = edited
            setRev((r) => r + 1)
            setEditIdx(null)
          }}
        />
      )}
    </Popup>
  )
}
