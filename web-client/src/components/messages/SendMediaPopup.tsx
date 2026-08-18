// src/components/messages/SendMediaPopup.tsx
// Compose-before-send dialog (port of tweb popups/newMedia.ts) на общем Popup:
// превью выбранных файлов, подпись, «как медиа / как файл» в меню «⋮», отправка.
// The parent owns the actual upload/send (onSend).
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Text from '../../shared/ui/Text'
import IconButton from '../../shared/ui/IconButton'
import Popup from '../../shared/ui/Popup'
import Menu, { MenuItem } from '../../shared/ui/Menu'
import TgIcon from '../TgIcon'
// MediaEditor грузится лениво — только когда открывают редактор конкретного вложения
const MediaEditor = lazy(() => import('../mediaEditor/MediaEditor'))
import { supportsVideoEncoding } from '../mediaEditor/videoSupport'
import StarIcon from '../stars/StarIcon'
import { getMiddleware } from '@helpers/middleware'
import wrapMediaSpoiler from '@components/wrappers/mediaSpoiler'
import { THUMB_TYPE_STRIPPED, type MyPhoto } from '@core/media/messageMedia'
import { useT } from '../../i18n'
import s from './SendMediaPopup.module.scss'

// «Медиа» для меню «как медиа / как файл» и заголовка — аудио тоже медиа,
const isMediaFile = (f: File) => /^(image|video|audio)\//.test(f.type)
// …но превью в попапе рисуется только для фото/видео: у аудио его нет.
const hasPreview = (f: File) => /^(image|video)\//.test(f.type)

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`
  if (n >= 1024) return `${Math.max(1, Math.round(n / 1024))} КБ`
  return `${n} Б`
}

/**
 * Порт tweb `applyMediaSpoiler` (popups/newMedia.ts:592-607) в части подготовки
 * подложки: превью ужимается в бокс 40×40 и кодируется в JPEG качества 0.2 —
 * это и есть те самые `photoStrippedSize.bytes`, которые в оригинале уезжают с
 * сообщением. Отдаём base64 без префикса — ровно то, что ждёт `wrapMediaSpoiler`.
 */
const STRIPPED_BOX = 40
async function makeStrippedThumb(url: string, kind: 'image' | 'video'): Promise<string | undefined> {
  try {
    const media: HTMLImageElement | HTMLVideoElement = kind === 'image' ? new Image() : document.createElement('video')
    const natural = await new Promise<{ w: number; h: number } | null>((resolve) => {
      const done = () => resolve(
        kind === 'image'
          ? { w: (media as HTMLImageElement).naturalWidth, h: (media as HTMLImageElement).naturalHeight }
          : { w: (media as HTMLVideoElement).videoWidth, h: (media as HTMLVideoElement).videoHeight },
      )
      media.addEventListener(kind === 'image' ? 'load' : 'loadeddata', done, { once: true })
      media.addEventListener('error', () => resolve(null), { once: true })
      media.src = url
    })
    if (!natural?.w || !natural.h) return undefined

    const scale = Math.min(STRIPPED_BOX / natural.w, STRIPPED_BOX / natural.h, 1)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(natural.w * scale))
    canvas.height = Math.max(1, Math.round(natural.h * scale))
    const context = canvas.getContext('2d')
    if (!context) return undefined
    context.drawImage(media, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.2).split(',')[1] || undefined
  } catch {
    // нет canvas (headless/тест) либо превью не декодировалось — спойлера в
    // попапе не будет, но флаг отправки от этого не зависит
    return undefined
  }
}

/**
 * Живой спойлер поверх превью в попапе — tweb накрывает превью настоящим
 * `wrapMediaSpoiler`, а не «серым квадратиком»: отправитель видит ровно то, что
 * увидит получатель. Хост-узел пустой для React, всё его содержимое императивно
 * ставит и снимает враппер.
 */
function SpoilerCover({ url, kind }: { url: string; kind: 'image' | 'video' }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host || !url) return

    const helper = getMiddleware()
    const middleware = helper.get()
    let container: HTMLElement | undefined

    void (async () => {
      const strippedThumb = await makeStrippedThumb(url, kind)
      if (!strippedThumb || !middleware()) return

      // Псевдо-фото с единственной stripped-ступенью — ровно то, что собирает
      // оригинал в этом же месте (`popups/newMedia.ts:600-620`): врапперу нужно
      // вложение, а не готовая строка превью, и ступень он достаёт сам.
      // Полей транспорта (`access_hash`, `date`, `dc_id`, `file_reference`) у
      // нас нет — предмета для них не существует.
      const photo: MyPhoto = {
        _: 'photo',
        id: 0,
        sizes: [{ _: 'photoStrippedSize', type: THUMB_TYPE_STRIPPED, bytes: strippedThumb }],
      }

      const box = host.getBoundingClientRect()
      container = await wrapMediaSpoiler({
        media: photo,
        width: box.width || host.offsetWidth,
        height: box.height || host.offsetHeight,
        middleware,
        animationGroup: 'NEW-MEDIA',
      })
      if (!container || !middleware()) return
      host.append(container)
    })()

    return () => {
      container?.remove()
      helper.destroy()
    }
  }, [url, kind])

  return <div ref={hostRef} className={s.spoilerCover} />
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
  /** `spoilers[i]` — i-й файл уходит скрытым под спойлером (tweb sendFile({spoiler})) */
  onSend: (caption: string, asFile: boolean, paidPrice?: number | null, spoilers?: boolean[]) => void
}) {
  const t = useT()
  const [caption, setCaption] = useState('')
  const [asFile, setAsFile] = useState(initialAsFile)
  // Платное медиа (Telegram paid media): цена в звёздах. null — обычное медиа.
  // Доступно только для одиночного фото/видео «как медиа».
  const [paidPrice, setPaidPrice] = useState<number | null>(null)
  // Скрытые спойлером вложения — по индексу в `files` (tweb держит признак на
  // самом SendFileParams: `item.mediaSpoiler`).
  const [spoilers, setSpoilers] = useState<ReadonlySet<number>>(() => new Set<number>())
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
  const urls = useMemo(() => files.map((f) => (hasPreview(f) ? URL.createObjectURL(f) : '')), [files, rev])
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls])
  useEffect(() => { inputRef.current?.focus() }, [])

  const anyMedia = files.some(isMediaFile)
  const showAsMedia = !asFile && anyMedia
  // Платное медиа поддержано только для одиночного фото/видео «как медиа»
  // (бэкенд хранит цену на сообщение; альбомы/файлы — без цены).
  const onlyPhotoVideo = files.length === 1 && files.every(hasPreview)
  const canPaid = showAsMedia && onlyPhotoVideo
  const allImages = files.every((f) => f.type.startsWith('image/'))
  const allVideos = files.every((f) => f.type.startsWith('video/'))
  const kind: 'photo' | 'video' | 'media' | 'file' = asFile || !anyMedia
    ? 'file'
    : allImages ? 'photo' : allVideos ? 'video' : 'media'
  const title = `${t('Send')} ${files.length} ${titleWord(files.length, kind)}`

  // Спойлер применим только к фото/видео «как медиа» — tweb берёт
  // `partition().media`, куда аудио не попадает (popups/newMedia.ts:759-767).
  const spoilerableIdx = useMemo(
    () => files.map((f, i) => (hasPreview(f) ? i : -1)).filter((i) => i >= 0),
    [files],
  )

  /** Порт tweb `canToggleSpoilers` (popups/newMedia.ts:721-742). */
  const canToggleSpoilers = (toggle: boolean, single: boolean) => {
    if (paidPrice != null) return false // tweb: willSendPaidMedia()

    let good = showAsMedia && spoilerableIdx.length > 0
    if (single && good) {
      good = spoilerableIdx.length === 1
    }

    if (good) {
      const withSpoilers = spoilerableIdx.filter((i) => spoilers.has(i))
      good = single ? true : spoilerableIdx.length > 1
      if (good) {
        good = toggle
          ? spoilerableIdx.length !== withSpoilers.length
          : spoilerableIdx.length === withSpoilers.length
      }
    }

    return good
  }

  /** Порт tweb `changeSpoilers` (popups/newMedia.ts:759-767). */
  const changeSpoilers = (toggle: boolean) => {
    setSpoilers(toggle ? new Set(spoilerableIdx) : new Set<number>())
    setMenuOpen(false)
  }

  const toggleSpoiler = (index: number) => {
    setSpoilers((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const send = () => { sending.current = true; setOpen(false) }

  return (
    <Popup
      open={open}
      title={title}
      width={420}
      onClose={() => setOpen(false)}
      onExitComplete={() => {
        if (sending.current) {
          onSend(caption.trim(), asFile, canPaid ? paidPrice : null, files.map((_, i) => spoilers.has(i)))
        } else onClose()
      }}
      headerRight={anyMedia ? (
        <>
          <IconButton
            size="small"
            color="var(--primary-text-color)"
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
              corner="bottom-left"
              style={{ top: menuPos.top, right: menuPos.right }}
            >
              <MenuItem
                icon={<TgIcon name="image" size={20} />}
                label={t('Send as media')}
                right={!asFile ? <TgIcon name="check" size={18} color="var(--primary-color)" /> : undefined}
                onClick={() => { setAsFile(false); setMenuOpen(false) }}
              />
              <MenuItem
                icon={<TgIcon name="document" size={20} />}
                label={t('Send as file')}
                right={asFile ? <TgIcon name="check" size={18} color="var(--primary-color)" /> : undefined}
                onClick={() => { setAsFile(true); setPaidPrice(null); setMenuOpen(false) }}
              />
              {canPaid && (
                <MenuItem
                  icon={<StarIcon size={20} />}
                  label={t('Make paid')}
                  right={paidPrice != null ? <TgIcon name="check" size={18} color="var(--primary-color)" /> : undefined}
                  onClick={() => { setPaidPrice((p) => (p == null ? 10 : null)); setMenuOpen(false) }}
                />
              )}
              {/* Четыре пункта спойлера — как в tweb (popups/newMedia.ts:284-304):
                  одиночный/все × включить/выключить, взаимоисключающие по verify */}
              {canToggleSpoilers(true, true) && (
                <MenuItem
                  icon={<TgIcon name="mediaspoiler" size={20} />}
                  label={t('Hide with spoiler')}
                  onClick={() => changeSpoilers(true)}
                />
              )}
              {canToggleSpoilers(true, false) && (
                <MenuItem
                  icon={<TgIcon name="mediaspoiler" size={20} />}
                  label={t('Hide all with spoilers')}
                  onClick={() => changeSpoilers(true)}
                />
              )}
              {canToggleSpoilers(false, true) && (
                <MenuItem
                  icon={<TgIcon name="mediaspoileroff" size={20} />}
                  label={t('Remove spoiler')}
                  onClick={() => changeSpoilers(false)}
                />
              )}
              {canToggleSpoilers(false, false) && (
                <MenuItem
                  icon={<TgIcon name="mediaspoileroff" size={20} />}
                  label={t('Remove all spoilers')}
                  onClick={() => changeSpoilers(false)}
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
              <Text size={13} color="var(--secondary-text-color)">{t('Price in Stars')}</Text>
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
            <div className={s.send} onClick={send}>
              <TgIcon name="send" />
            </div>
          </div>
        </div>
      }
    >
      <div className={s.previews}>
        {files.map((f, i) => {
          // Кнопка-переключатель спойлера на самом превью — tweb
          // `spoiler-toggle` (popups/newMedia.ts:1427-1437): две иконки,
          // состояние в data-toggled.
          const spoilerToggle = paidPrice == null ? (
            <IconButton
              size="small"
              color="#fff"
              className={`${s.spoilerBtn} spoiler-toggle`}
              data-toggled={spoilers.has(i) ? 'true' : undefined}
              aria-label={spoilers.has(i) ? t('Remove spoiler') : t('Hide with spoiler')}
              onClick={() => toggleSpoiler(i)}
            >
              <TgIcon name={spoilers.has(i) ? 'mediaspoileroff' : 'mediaspoiler'} size={20} />
            </IconButton>
          ) : null

          if (showAsMedia && f.type.startsWith('image/')) {
            return (
              <div key={`${i}-${rev}`} className={s.previewWrap}>
                <img className={`${s.preview} ${s.previewImg}`} src={urls[i]} alt="" />
                {spoilers.has(i) && <SpoilerCover url={urls[i]} kind="image" />}
                {spoilerToggle}
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
                {spoilers.has(i) && <SpoilerCover url={urls[i]} kind="video" />}
                {spoilerToggle}
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
                <Text noWrap size={14.5} weight={600} color="var(--primary-text-color)">{f.name}</Text>
                <Text size={12.5} color="var(--secondary-text-color)">{fmtSize(f.size)}</Text>
              </div>
            </div>
          )
        })}
      </div>

      {editIdx != null && files[editIdx] && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}
    </Popup>
  )
}
