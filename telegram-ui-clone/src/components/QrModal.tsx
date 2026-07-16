// Модалка «QR-код» — порт tweb popups/myQrCode.tsx (геометрия из iOS
// ChatQrCodeScreen): карточка с обоями выбранной темы, белая карта 300×330
// (r42) с QR 220 и @USERNAME, аватар 100 с белым кольцом нависает на 70%,
// панель [×, «QR-код», луна], карусель тем с эмодзи (пульс по клику),
// «Копировать QR-код» — PNG в буфер (blob пре-печётся, фолбэк — ссылка).
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import type QRCodeStyling from 'qr-code-styling'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import Avatar from '../shared/ui/Avatar'
import TgIcon from './TgIcon'
import classNames from '../shared/lib/classNames'
import { useT } from '../i18n'
import { useSettings } from '../settings'
import { resolvePreset, PRESET_MODE } from '../theme'
import { WALLPAPER_PRESETS } from '../wallpapers'
import patternUrl from '../assets/pattern.svg'
import logoUrl from '../assets/logo_padded.svg'
import s from './QrModal.module.scss'

const EASE: [number, number, number, number] = [0.4, 0, 0.2, 1]
const DUR = 0.15

// tweb ChatQrCodeScreen: QR 220, карта 300×330 r42, аватар 100 (+кольцо 4)
const QR_SIZE = 220
// tweb QR_INK_MAX_LUMINANCE: стопы затемняются, иначе QR не сканируется
const INK_MAX_LUMINANCE = 0.18

// Темы карусели: наши пресеты обоев + эмодзи (tweb: облачные chat-темы)
const QR_THEMES: { emoji: string; presetId: string }[] = [
  { emoji: '🏠', presetId: 'day' },
  { emoji: '🐥', presetId: 'lime' },
  { emoji: '⛄', presetId: 'ice' },
  { emoji: '💎', presetId: 'violet' },
  { emoji: '👨‍🏫', presetId: 'matrix' },
  { emoji: '🌷', presetId: 'rose' },
  { emoji: '💝', presetId: 'candy' },
  { emoji: '🎄', presetId: 'mint' },
]

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')

// tweb darkenToMaxLuminance: масштабирует каналы так, чтобы относительная
// яркость не превышала max — контраст QR на белой карте.
function darkenToMaxLuminance(hex: string, max = INK_MAX_LUMINANCE): string {
  const [r, g, b] = hexToRgb(hex)
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  if (lum <= max) return hex
  const k = max / lum
  return rgbToHex(r * k, g * k, b * k)
}

// ночной вариант обоев: тот же градиент, смешанный с чёрным (tweb blend для tinted)
function nightColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r * 0.38, g * 0.38, b * 0.38)
}

const gradientCss = (colors: readonly string[]) =>
  `linear-gradient(150deg, ${colors.join(', ')})`

export interface QrModalProps {
  open: boolean
  onClose: () => void
  /** что кодировать (https://t.me/... / инвайт-ссылка) */
  url: string
  /** подпись под QR (username с @ или название чата) — рисуется UPPERCASE */
  label: string
  avatar: { src?: string; background?: string; text?: string }
}

export default function QrModal({ open, onClose, url, label, avatar }: QrModalProps) {
  const t = useT()
  const { themeChoice } = useSettings()
  const [themeIdx, setThemeIdx] = useState(0)
  // tweb: дефолт луны — текущая яркость темы приложения
  const [night, setNight] = useState(PRESET_MODE[resolvePreset(themeChoice)] === 'dark')
  const [toast, setToast] = useState('')
  const qrHostRef = useRef<HTMLDivElement>(null)
  const blobRef = useRef<Blob | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emojiRefs = useRef(new Map<number, HTMLSpanElement>())

  const preset = WALLPAPER_PRESETS.find((p) => p.id === QR_THEMES[themeIdx].presetId) ?? WALLPAPER_PRESETS[0]
  const bgColors = useMemo(
    () => (night ? preset.colors.map(nightColor) : [...preset.colors]),
    [preset, night],
  )
  // чернила QR/подписи — затемнённые стопы обоев (tweb darkenInkStops)
  const inkStops = useMemo(() => preset.colors.map((c) => darkenToMaxLuminance(c)), [preset])

  // QR: solid-рендер qr-code-styling c диагональным градиентом чернил и
  // логотипом по центру (tweb paintQrCode: rounded + extra-rounded, ecc L).
  useEffect(() => {
    if (!open) return
    let alive = true
    void import('qr-code-styling').then((mod) => {
      if (!alive || !qrHostRef.current) return
      const Ctor = mod.default
      const qr = new Ctor(qrOptions(url, inkStops, 'svg', QR_SIZE))
      qrHostRef.current.replaceChildren()
      qr.append(qrHostRef.current)
    })
    return () => {
      alive = false
    }
  }, [open, url, inkStops])

  // Пре-печём PNG для копирования (tweb latestBlob: клик должен положить blob
  // в буфер синхронно, иначе Chrome теряет user-activation).
  useEffect(() => {
    if (!open) return
    let alive = true
    void bakeExportBlob({ url, label, avatar, bgColors, inkStops }).then((b) => {
      if (alive) blobRef.current = b
    })
    return () => {
      alive = false
    }
  }, [open, url, label, avatar, bgColors, inkStops])

  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2500)
  }

  const copy = () => {
    const blob = blobRef.current
    if (blob && navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      navigator.clipboard
        .write([new ClipboardItem({ 'image/png': blob })])
        .then(() => showToast(t('QR Code copied to clipboard')))
        .catch(() => copyLink())
    } else {
      copyLink()
    }
  }
  const copyLink = () => {
    navigator.clipboard
      .writeText(url)
      .then(() => showToast(t('Profile link copied to clipboard')))
      .catch(() => undefined)
  }

  // tweb chatThemesPicker: клик по тайлу пульсирует эмодзи (scale 2 → обратно)
  const pickTheme = (idx: number) => {
    setThemeIdx(idx)
    const el = emojiRefs.current.get(idx)
    if (el) {
      el.style.transform = 'scale(2)'
      setTimeout(() => {
        el.style.transform = ''
      }, 250)
    }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="qr-overlay"
          className={s.overlay}
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR, ease: EASE }}
        >
          <motion.div
            className={classNames(s.modal, night ? s.night : '')}
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 48 }}
            animate={{ y: 0 }}
            exit={{ y: 48 }}
            transition={{ duration: DUR, ease: EASE }}
          >
            {/* верхняя секция: обои темы + белая карта с QR + аватар */}
            <div className={s.top} style={{ background: gradientCss(bgColors) }}>
              <div className={s.pattern} style={{ backgroundImage: `url("${patternUrl}")` }} />
              <div className={s.avatarWrap}>
                <Avatar background={avatar.background ?? 'var(--tg-accentGradient)'} text={avatar.text} src={avatar.src} size={100} />
              </div>
              <div className={s.card}>
                <div ref={qrHostRef} className={s.qr} />
                <div
                  className={s.username}
                  style={{ backgroundImage: gradientCss(inkStops) }}
                  data-len={label.length > 15 ? 'long' : label.length > 10 ? 'mid' : undefined}
                >
                  {label.toUpperCase()}
                </div>
              </div>
            </div>

            {/* панель: [×, заголовок, луна] (tweb Header внутри body) */}
            <div className={s.header}>
              <IconButton size="small" onClick={onClose} color="var(--qr-panel-secondary)">
                <TgIcon name="close" size={22} />
              </IconButton>
              <Text size={17} weight={600} className={s.title} color="var(--qr-panel-text)">
                {t('QR Code')}
              </Text>
              <IconButton size="small" onClick={() => setNight((v) => !v)} color="var(--qr-panel-secondary)">
                <TgIcon name={night ? 'darkmode_filled' : 'darkmode'} size={22} />
              </IconButton>
            </div>

            {/* карусель тем (tweb chatThemesPicker) */}
            <div className={s.themes}>
              {QR_THEMES.map((th, i) => {
                const p = WALLPAPER_PRESETS.find((w) => w.id === th.presetId) ?? WALLPAPER_PRESETS[0]
                const colors = night ? p.colors.map(nightColor) : p.colors
                return (
                  <div
                    key={th.presetId}
                    className={classNames(s.tile, i === themeIdx ? s.tileActive : '')}
                    onClick={() => pickTheme(i)}
                  >
                    <div className={s.tileBg} style={{ background: gradientCss(colors) }}>
                      <div className={s.tilePattern} style={{ backgroundImage: `url("${patternUrl}")` }} />
                      <div className={s.bubbleIn} />
                      <div className={s.bubbleOut} />
                      <span
                        ref={(el) => {
                          if (el) emojiRefs.current.set(i, el)
                          else emojiRefs.current.delete(i)
                        }}
                        className={s.tileEmoji}
                      >
                        {th.emoji}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* tweb FooterButton «Copy QR Code» */}
            <div className={s.footer}>
              <button type="button" className={s.copyBtn} onClick={copy}>
                <TgIcon name="copy" size={20} />
                {t('Copy QR Code')}
              </button>
            </div>

            {toast && <div className={s.toast}>{toast}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

// ── QR options (tweb paintQrCode + перекраска градиентом чернил) ──
function qrOptions(data: string, inkStops: string[], type: 'svg' | 'canvas', size: number) {
  const gradient = {
    type: 'linear' as const,
    rotation: Math.PI / 4,
    colorStops: inkStops.map((color, i) => ({ offset: inkStops.length === 1 ? 0 : i / (inkStops.length - 1), color })),
  }
  return {
    width: size,
    height: size,
    type,
    data,
    margin: 0,
    image: logoUrl,
    qrOptions: { errorCorrectionLevel: 'L' as const },
    dotsOptions: { type: 'rounded' as const, gradient },
    cornersSquareOptions: { type: 'extra-rounded' as const, gradient },
    backgroundOptions: { color: 'transparent' },
    imageOptions: { hideBackgroundDots: true, imageSize: 0.4, margin: 0 },
  }
}

// ── Экспорт PNG (tweb EXPORT_LAYOUT 390×844): обои + карта + аватар + QR + подпись ──
async function bakeExportBlob({
  url,
  label,
  avatar,
  bgColors,
  inkStops,
}: {
  url: string
  label: string
  avatar: QrModalProps['avatar']
  bgColors: string[]
  inkStops: string[]
}): Promise<Blob | null> {
  try {
    const W = 390
    const H = 844
    const dpr = 2
    const canvas = document.createElement('canvas')
    canvas.width = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.scale(dpr, dpr)

    // фон-градиент + паттерн
    const grad = ctx.createLinearGradient(0, 0, W, H)
    bgColors.forEach((c, i) => grad.addColorStop(bgColors.length === 1 ? 0 : i / (bgColors.length - 1), c))
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
    const pattern = await loadImage(patternUrl).catch(() => null)
    if (pattern) {
      ctx.globalAlpha = 0.4
      ctx.drawImage(pattern, 0, 0, W, (W / pattern.width) * pattern.height)
      ctx.globalAlpha = 1
    }

    // белая карта 300×330 r42 по центру
    const cardW = 300
    const cardH = 330
    const cardX = (W - cardW) / 2
    const cardY = (H - cardH) / 2
    roundRect(ctx, cardX, cardY, cardW, cardH, 42)
    ctx.fillStyle = '#fff'
    ctx.fill()

    // QR через canvas-инстанс qr-code-styling
    const mod = await import('qr-code-styling')
    const qr = new mod.default(qrOptions(url, inkStops, 'canvas', QR_SIZE * 2)) as QRCodeStyling
    const raw = await qr.getRawData('png')
    if (raw) {
      const qrImg = await loadImage(URL.createObjectURL(raw as Blob))
      ctx.drawImage(qrImg, cardX + 40, cardY + 50, QR_SIZE, QR_SIZE)
      URL.revokeObjectURL(qrImg.src)
    }

    // подпись @USERNAME градиентом чернил
    const inkGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH)
    inkStops.forEach((c, i) => inkGrad.addColorStop(inkStops.length === 1 ? 0 : i / (inkStops.length - 1), c))
    ctx.fillStyle = inkGrad
    ctx.font = '700 22px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(label.toUpperCase(), W / 2, cardY + cardH - 28, cardW - 40)

    // аватар с белым кольцом, нависает на 70% (tweb AVATAR_OVERHANG)
    const aR = 50
    const aCx = W / 2
    const aCy = cardY - 20 // центр: 70px над картой при size 100
    ctx.beginPath()
    ctx.arc(aCx, aCy, aR + 4, 0, Math.PI * 2)
    ctx.fillStyle = '#fff'
    ctx.fill()
    const avatarImg = avatar.src ? await loadImage(avatar.src).catch(() => null) : null
    ctx.save()
    ctx.beginPath()
    ctx.arc(aCx, aCy, aR, 0, Math.PI * 2)
    ctx.clip()
    if (avatarImg) {
      const side = Math.min(avatarImg.width, avatarImg.height)
      ctx.drawImage(
        avatarImg,
        (avatarImg.width - side) / 2, (avatarImg.height - side) / 2, side, side,
        aCx - aR, aCy - aR, aR * 2, aR * 2,
      )
    } else {
      ctx.fillStyle = inkStops[0]
      ctx.fillRect(aCx - aR, aCy - aR, aR * 2, aR * 2)
      ctx.fillStyle = '#fff'
      ctx.font = '700 40px system-ui, sans-serif'
      ctx.fillText(avatar.text ?? '?', aCx, aCy + 14)
    }
    ctx.restore()

    return await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  } catch {
    return null
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = rej
    img.src = src
  })
}
