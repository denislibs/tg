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
// ветка `name` была дописана локальной `ASSETS`-картой + lottie-web.
//
// Этап 2 плана «один движок lottie» (docs/superpowers/plans/2026-09-05-
// lottie-single-engine.md) снял и то, и другое: `name` едет ПРЯМО в
// портированный `LottieAnimation` (`components/lottieAnimation.solid.tsx`,
// tlottie), Solid-компонент вызывает Solid-компонент без моста — тот же приём,
// что у оригинала (`tweb mediaHeader.tsx:66-76`, включая `restartOnClick`).
import { type JSX } from 'solid-js'
import classNames from '@helpers/string/classNames'
import LottieAnimation from '../lottieAnimation.solid'
import type { LottieAssetName } from '@lib/lottie/lottieLoader'
import styles from './mediaHeader.module.scss'

function MediaHeader(props: { class?: string; children?: JSX.Element }): JSX.Element {
  return <div class={classNames(styles.container, props.class)}>{props.children}</div>
}

/**
 * Слот под иконку/канву/обезьянку/лотти. `size` уезжает в `--sticker-size`
 * (tweb 1:1). `name` — встроенный лотти-ассет, рисуется `LottieAnimation`
 * (`class={styles.lottie}` даёт ему `width/height: var(--size)` — те же
 * правила, что у tweb `mediaHeader.module.scss`), `children` — произвольное
 * содержимое (svg-логотип, обезьянка, аватар регистрации, QR); как
 * `name`/`element` у tweb `MediaHeader.Sticker`.
 */
MediaHeader.Sticker = function MediaHeaderSticker(props: {
  size?: number
  name?: LottieAssetName
  class?: string
  children?: JSX.Element
}): JSX.Element {
  const size = () => props.size ?? 130
  return (
    <div class={classNames(styles.sticker, props.class)} style={{ '--sticker-size': `${size()}px` }}>
      {props.name ? (
        <LottieAnimation
          class={styles.lottie}
          size={size()}
          name={props.name}
          restartOnClick
          // Деградация без WASM SIMD (backlogs/frontend/
          // lottie-no-wasm-fallback.md, часть 2 — закрыта): реджект (NO_WASM/
          // сеть) гасим ЗДЕСЬ, в одном месте на компонент — приём
          // `StickerMedia.tsx:282`. `LottieAnimation` зовёт
          // `loadAnimationAsAsset`, которая на NO_WASM сама подставляет
          // статичный PNG первого кадра в контейнер ДО реджекта
          // (`lib/lottie/lottieAssetFallback.ts`) — иконка шапки не пропадает.
          onPromise={(promise) => void promise.catch(() => {})}
        />
      ) : (
        props.children
      )}
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
