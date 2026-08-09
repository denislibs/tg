// MediaHeader — общая шапка «иконка → заголовок → подзаголовок» (порт tweb
// `src/components/mediaHeader.tsx`). Её носят все карточки экрана входа.
//
// В tweb контейнер несёт `styles.container`, но этот класс в модуле пуст, и в
// живом DOM у шапки голый `div` — так же и здесь.
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { type AnimationItem } from 'lottie-web'
import classNames from '../../shared/lib/classNames'
import { loadLottie } from '../lottie'
import s from './mediaHeader.module.scss'

/** Встроенные лотти-ассеты слота (tweb `LottieAssetName`) — грузятся лениво. */
const ASSETS = {
  Mailbox: () => import('../../assets/tgs/Mailbox.json'),
}

export type StickerAssetName = keyof typeof ASSETS

function MediaHeader({ className = '', children }: { className?: string; children?: ReactNode }) {
  return <div className={className}>{children}</div>
}

/**
 * Порт tweb `<LottieAnimation>` в объёме, который нужен слоту шапки:
 * `div._lottie[style="--size: Npx"] > canvas.lottie`. Класс канвы даёт сам
 * lottie-web через `rendererSettings.className`, как в оригинале.
 */
function StickerLottie({ name, size }: { name: StickerAssetName; size: number }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<AnimationItem | null>(null)

  useEffect(() => {
    let alive = true
    void Promise.all([loadLottie(), ASSETS[name]()]).then(([lottie, mod]) => {
      if (!alive || !hostRef.current) return
      animRef.current = lottie.loadAnimation({
        container: hostRef.current,
        renderer: 'canvas',
        loop: false,
        autoplay: true,
        animationData: mod.default as unknown,
        rendererSettings: { className: 'lottie', dpr: window.devicePixelRatio || 1 },
      })
    })
    return () => {
      alive = false
      animRef.current?.destroy()
      animRef.current = null
    }
  }, [name])

  // tweb `restartOnClick` — клик проигрывает анимацию заново.
  return (
    <div
      ref={hostRef}
      className={s.lottie}
      style={{ '--size': `${size}px` } as CSSProperties}
      onClick={() => animRef.current?.goToAndPlay(0)}
    />
  )
}

/**
 * Слот под иконку/лотти/канву. `size` уезжает в `--sticker-size` (tweb 1:1).
 * `name` — встроенный лотти-ассет, `children` — произвольное содержимое
 * (svg-логотип, обезьянка, аватар регистрации); как `name`/`element` в tweb.
 */
MediaHeader.Sticker = function MediaHeaderSticker({
  size = 130,
  name,
  className = '',
  children,
}: {
  size?: number
  name?: StickerAssetName
  className?: string
  children?: ReactNode
}) {
  return (
    <div
      className={classNames(s.sticker, className)}
      style={{ '--sticker-size': `${size}px` } as CSSProperties}
    >
      {name ? <StickerLottie name={name} size={size} /> : children}
    </div>
  )
}

MediaHeader.Title = function MediaHeaderTitle({
  className = '',
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  // `text-overflow-wrap` стилей не имеет и в самом tweb — это JS-маркер,
  // но в DOM он есть, и differ его сверяет.
  return (
    <div className={classNames(s.title, 'text-center', 'text-overflow-wrap', className)}>
      {children}
    </div>
  )
}

MediaHeader.Subtitle = function MediaHeaderSubtitle({
  secondary,
  className = '',
  children,
}: {
  /** приглушённый вариант (`.secondary`) — на signIn / signQR / authCode */
  secondary?: boolean
  className?: string
  children?: ReactNode
}) {
  // В живом tweb у приглушённого подзаголовка класс `secondary` НЕ хеширован —
  // рядом с модульным идёт глобальный из base.scss (у нас — `styles/tweb/_bridge.scss`).
  return (
    <div
      className={classNames(
        s.subtitle,
        secondary ? classNames(s.secondary, 'secondary') : '',
        'text-center',
        className,
      )}
    >
      {children}
    </div>
  )
}

export default MediaHeader
