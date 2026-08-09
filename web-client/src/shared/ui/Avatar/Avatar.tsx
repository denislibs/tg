import type { CSSProperties } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import classNames from '../../lib/classNames'
import { glyph } from '../../../core/tgico-icons'
import s from './Avatar.module.scss'

// tweb avatarNew.tsx:52 — та же длительность, что и `.fade-in` в _avatar.scss (`.2s`).
const FADE_IN_DURATION = 200

type PhotoPhase = 'pending' | 'animating' | 'shown'

// Фотография аватара — порт механики tweb avatarNew.tsx:549-604, а не буквально
// «повесить fade-in при монтировании» (так и было раньше, ошибочно — см. отчёт
// task-7). В tweb `<img>` создаётся ОТСОЕДИНЁННЫМ от DOM и вставляется только в
// колбэке после реальной загрузки байтов (`_setMedia(element)`), поэтому часы
// анимации стартуют в момент готовности фото, а не в момент рендера рамки.
// Здесь тот же эффект получаем без ручного DOM: держим <img> невидимым
// (opacity: 0, класс fade-in ещё не добавлен — иначе анимация отыграла бы
// вхолостую, пока элемент скрыт) до `onLoad`, и лишь тогда одновременно
// показываем картинку и добавляем `fade-in`.
//
// Гейты, которых не было у первой реализации:
// - `cached` (avatarNew.tsx:549: `cached = !(result instanceof Promise)`) —
//   браузерный аналог: `img.complete && naturalWidth > 0` сразу после монтирования
//   означает, что байты уже были декодированы (тот же кэш соединений/памяти),
//   грузить нечего — фото показывается без анимации, как и в tweb.
// - `liteMode.isAvailable('animations')` (avatarNew.tsx:549) — здесь эквивалент
//   репозитория: класс `animation-level-0` на body (см. dialogsPlaceholder.ts:39,
//   spoilerSupport.ts:22-23).
//
// `key={src}` пересоздаёт DOM-узел на каждую новую фотографию — тот же эффект,
// что у tweb, где `putAvatar` каждый раз создаёт новый `image = document.
// createElement('img')`: класс `fade-in`, снятый императивно после предыдущей
// загрузки, не может «залипнуть» и не вернуться при смене src на старом узле.
function AvatarPhoto({ src }: { src: string }) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [phase, setPhase] = useState<PhotoPhase>('pending')

  // Синхронно (до пейнта) проверяем, не были ли байты уже доступны — иначе
  // между «pending» и «shown» мелькнёт лишний кадр с opacity: 0.
  useLayoutEffect(() => {
    const img = imgRef.current
    const cached = !!img && img.complete && img.naturalWidth > 0
    setPhase(cached ? 'shown' : 'pending')
  }, [src])

  // tweb снимает fade-in по setTimeout(FADE_IN_DURATION), а не по animationend
  // (avatarNew.tsx:600) — так класс уходит даже если сама CSS-анимация почему-то
  // не отыграла (например, animation-level-0 подхватился между кадрами).
  useEffect(() => {
    if (phase !== 'animating') return
    const timer = setTimeout(() => setPhase('shown'), FADE_IN_DURATION)
    return () => clearTimeout(timer)
  }, [phase])

  const handleLoad = () => {
    const animationsDisabled = document.body.classList.contains('animation-level-0')
    setPhase(animationsDisabled ? 'shown' : 'animating')
  }

  return (
    <img
      key={src}
      ref={imgRef}
      className={classNames('avatar-photo', phase === 'animating' ? 'fade-in' : '')}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      style={phase === 'pending' ? { opacity: 0 } : undefined}
      onLoad={handleLoad}
    />
  )
}

// Canonical avatar sizes (px) by role — prefer a named size over a magic number
// at call sites. A raw number is still accepted for genuine one-offs.
export const AVATAR_SIZE = {
  xs: 32, // compact menus / inline lists
  sm: 40, // search results, small rows
  md: 42, // member / contact rows (tweb 'abitbigger')
  lg: 48, // settings / info rows
  dialog: 54, // chat-list row (default)
  profile: 120, // profile / info header
} as const

export type AvatarSize = keyof typeof AVATAR_SIZE

// Размеры, для которых в tweb `_avatar.scss` есть готовый класс `.avatar-N`
// (он задаёт --size и --multiplier = 54 / N). Для прочих ставим то же самое инлайном.
const TWEB_AVATAR_SIZES = new Set([
  162, 144, 128, 120, 107, 100, 90, 89, 86, 84, 76, 75, 64, 60, 54, 48, 46, 44,
  42, 40, 37, 36, 35, 34, 32, 30, 26, 24, 22, 20, 18, 16,
])

interface AvatarProps {
  background: string
  text?: string
  emoji?: string
  /** resolved image URL; when set it replaces the initials/emoji */
  src?: string
  /** a named size from AVATAR_SIZE, or a raw px number for one-offs */
  size?: AvatarSize | number
  online?: boolean
  /** color of the ring around the online dot (defaults to the surface behind the avatar) */
  ringColor?: string
  /** дополнительные классы на корне (например .person-avatar из tweb-топбара) */
  className?: string
  /** id пира — уезжает в `data-peer-id` (tweb avatarNew.tsx:1076) */
  peerId?: string | number
  /** клик по самому аватару (tweb вешает обработчик на узел .avatar) */
  onClick?: () => void
}

// Аватар — разметка tweb (avatarNew.tsx:1073): один узел
// `div.avatar.avatar-like.avatar-{N}` с инициалами прямо внутри либо
// `img.avatar-photo`. Форма/размер/шрифт/uppercase — из `_avatar.scss`
// (`.avatar-like` даёт --size, line-height и font-size от --multiplier).
// Онлайн-точка — `.is-online` (псевдоэлемент :after там же).
//
// Класс `avatar-gradient` в tweb стоит на узле `.avatar` БЕЗУСЛОВНО
// (avatarNew.tsx:1073 — он в самой строке class, а не в classList), и заливка
// приходит из `_avatar.scss:14` — `background: linear-gradient(--color-top,
// --color-bottom)` по `data-color`. Ставим так же.
//
// Отступление: `data-color` мы не пишем — цвет приходит готовой строкой градиента
// из `gradientFor()` (те же 7 значений) и применяется инлайном, поэтому
// заливка `.avatar-gradient` перекрывается; перевод на data-color потребует
// токенов --peer-avatar-* и правки ~45 мест вызова.
export default function Avatar({
  background,
  text,
  emoji,
  src,
  size = 'dialog',
  online = false,
  ringColor,
  className,
  peerId,
  onClick,
}: AvatarProps) {
  const px = typeof size === 'number' ? size : AVATAR_SIZE[size]
  const known = TWEB_AVATAR_SIZES.has(px)
  const style = {
    background,
    ...(known ? {} : { '--size': `${px}px`, '--multiplier': String(54 / px) }),
    ...(ringColor ? { '--avatar-ring': ringColor } : {}),
  } as CSSProperties

  return (
    <div
      className={classNames('avatar', 'avatar-like', known ? `avatar-${px}` : '', 'avatar-gradient', online ? 'is-online' : '', s.root, className ?? '')}
      style={style}
      data-peer-id={peerId}
      onClick={onClick}
    >
      {src ? (
        <AvatarPhoto src={src} />
      ) : emoji === 'tg-logo' ? (
        // отступление от tweb: в оригинале у сервисного аккаунта (id 777000)
        // обычная фотография пира — `img.avatar-photo`, никакого отдельного
        // глифа/иконки для него нет. У нас фото этого пира не приходит, поэтому
        // рисуем логотип сами; убрать вместе с появлением аватарки сервисного бота.
        <svg className={s.glyph} width={px * 0.62} height={px * 0.62} viewBox="0 0 24 24" fill="#fff" aria-label="Telegram">
          <path d="M21.8 3.1 1.9 10.8c-1 .4-1 1.8 0 2.1l5 1.6 1.9 6c.3.9 1.4 1.1 2 .4l2.7-2.7 5 3.7c.7.5 1.7.1 1.9-.7l3.4-16c.2-1-.7-1.8-1.6-1.4zM9.5 14.3l8.6-5.3c.2-.1.4.2.2.3l-7 6.6c-.2.2-.3.5-.3.8l-.2 2.4-1.3-4.1c-.1-.3 0-.6.2-.7z" />
        </svg>
      ) : emoji === 'saved' ? (
        // tweb avatarNew.tsx:737 ставит `icon: 'saved'`, а :1024 рендерит его
        // глифом шрифта — `Icon(name, 'avatar-icon', 'avatar-icon-' + name)`,
        // то есть `span.tgico.avatar-icon.avatar-icon-saved` без своих размеров:
        // кегль даёт `_avatar.scss` (`.avatar-icon-saved { font-size:
        // calc(30px / var(--multiplier)) !important }`), центрирование —
        // `line-height: inherit` + `text-align: center` от `.avatar-like`.
        <span className="tgico avatar-icon avatar-icon-saved" aria-hidden>{glyph('saved')}</span>
      ) : (
        text ?? emoji
      )}
    </div>
  )
}
