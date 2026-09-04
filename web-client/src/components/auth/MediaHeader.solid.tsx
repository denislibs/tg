/** @jsxImportSource solid-js */
// MediaHeader — общая шапка «иконка → заголовок → подзаголовок» (порт tweb
// src/components/mediaHeader.tsx, https://github.com/morethanwords/tweb —
// строки 1-100 файла: контейнер + Sticker/Title/Subtitle). Solid-версия
// нашего уже существующего React-порта `auth/MediaHeader.tsx` — тот же
// `mediaHeader.module.scss`, поэтому CSS у обеих версий общий.
//
// Задача 4 сознательно урезала `Sticker` против tweb: там он ещё умеет `name`
// — встроенный lottie-ассет (`LottieAnimation`). Ни одна из трёх карточек
// задачи 4 (SignIn/AuthCode/Password) им не пользовалась. Задача 5 завела
// настоящего потребителя (`cards/EmailRecoverCard.solid.tsx` — Mailbox), и
// ветка `name` дописана здесь тем же приёмом, что у React `MediaHeader.tsx`
// (`ASSETS`-карта + ленивый `loadLottie()` + lottie-web `loadAnimation` в
// канву), только на Solid-примитивах жизненного цикла (`onMount`/`onCleanup`
// вместо `useEffect`).
import { onCleanup, onMount, type JSX } from 'solid-js'
import type { AnimationItem } from 'lottie-web'
import classNames from '@helpers/string/classNames'
import { loadLottie } from '../lottie'
import styles from './mediaHeader.module.scss'

/** Встроенные лотти-ассеты слота (tweb `LottieAssetName`) — грузятся лениво. */
const ASSETS = {
  Mailbox: () => import('../../assets/tgs/Mailbox.json'),
}

export type StickerAssetName = keyof typeof ASSETS

/**
 * Порт tweb `<LottieAnimation>` в объёме, который нужен слоту шапки:
 * `div._lottie[style="--size: Npx"] > canvas.lottie`. Класс канвы даёт сам
 * lottie-web через `rendererSettings.className`, как в оригинале.
 */
function StickerLottie(props: { name: StickerAssetName; size: number }): JSX.Element {
  let hostEl: HTMLDivElement | undefined
  let anim: AnimationItem | undefined
  let alive = true

  onMount(() => {
    void Promise.all([loadLottie(), ASSETS[props.name]()]).then(([lottie, mod]) => {
      if (!alive || !hostEl) return
      anim = lottie.loadAnimation({
        container: hostEl,
        renderer: 'canvas',
        loop: false,
        autoplay: true,
        animationData: mod.default as unknown,
        rendererSettings: { className: 'lottie', dpr: window.devicePixelRatio || 1 },
      })
    })
  })

  onCleanup(() => {
    alive = false
    anim?.destroy()
    anim = undefined
  })

  // tweb `restartOnClick` — клик проигрывает анимацию заново.
  return (
    <div
      ref={hostEl}
      class={styles.lottie}
      style={{ '--size': `${props.size}px` }}
      onClick={() => anim?.goToAndPlay(0)}
    />
  )
}

function MediaHeader(props: { class?: string; children?: JSX.Element }): JSX.Element {
  return <div class={classNames(styles.container, props.class)}>{props.children}</div>
}

/**
 * Слот под иконку/канву/обезьянку/лотти. `size` уезжает в `--sticker-size`
 * (tweb 1:1). `name` — встроенный лотти-ассет (см. `StickerLottie` выше),
 * `children` — произвольное содержимое (svg-логотип, обезьянка, аватар
 * регистрации, QR); как `name`/`element` у tweb `MediaHeader.Sticker`.
 */
MediaHeader.Sticker = function MediaHeaderSticker(props: {
  size?: number
  name?: StickerAssetName
  class?: string
  children?: JSX.Element
}): JSX.Element {
  const size = () => props.size ?? 130
  return (
    <div class={classNames(styles.sticker, props.class)} style={{ '--sticker-size': `${size()}px` }}>
      {props.name ? <StickerLottie name={props.name} size={size()} /> : props.children}
    </div>
  )
}

MediaHeader.Title = function MediaHeaderTitle(props: { class?: string; children?: JSX.Element }): JSX.Element {
  // `text-overflow-wrap` — JS-маркер без своих стилей и в самом tweb, но он
  // есть в живом DOM (dom-референс §4.4/§4.6), поэтому остаётся здесь тоже.
  return (
    <div class={classNames(styles.title, 'text-center', 'text-overflow-wrap', props.class)}>
      {props.children}
    </div>
  )
}

MediaHeader.Subtitle = function MediaHeaderSubtitle(props: {
  /** приглушённый вариант (`.secondary`) — на signIn/signQR/authCode */
  secondary?: boolean
  class?: string
  children?: JSX.Element
}): JSX.Element {
  // Глобальный `.secondary` (не хешированный, styles/tweb/_bridge.scss) идёт
  // РЯДОМ с модульным — тот же приём, что у React-версии.
  return (
    <div
      class={classNames(
        styles.subtitle,
        props.secondary ? classNames(styles.secondary, 'secondary') : '',
        'text-center',
        props.class,
      )}
    >
      {props.children}
    </div>
  )
}

export default MediaHeader
