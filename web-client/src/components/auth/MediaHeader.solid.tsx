/** @jsxImportSource solid-js */
// MediaHeader — общая шапка «иконка → заголовок → подзаголовок» (порт tweb
// src/components/mediaHeader.tsx, https://github.com/morethanwords/tweb —
// строки 1-100 файла: контейнер + Sticker/Title/Subtitle). Solid-версия
// нашего уже существующего React-порта `auth/MediaHeader.tsx` — тот же
// `mediaHeader.module.scss`, поэтому CSS у обеих версий общий.
//
// Урезано против tweb СОЗНАТЕЛЬНО, а не по недосмотру: оригинал у `Sticker`
// умеет ещё `name` — встроенный lottie-ассет (`LottieAnimation`). Ни одна из
// трёх карточек задачи 4 (SignIn/AuthCode/Password) им не пользуется — SignIn
// кладёт svg-логотип, AuthCode/Password кладут обезьянок готовым `element`
// (см. докблок `cards/AuthCodeCard.solid.tsx` про то, почему сама обезьянка —
// ЗАГЛУШКА в этой задаче). Ветку `name` заводить незачем: мёртвый код по
// правилу web-client/CLAUDE.md. Появится настоящий потребитель (интро-попапы,
// SignUpCard) — дописать веткой `Show`, как у React-версии.
import { type JSX } from 'solid-js'
import classNames from '@helpers/string/classNames'
import styles from './mediaHeader.module.scss'

function MediaHeader(props: { class?: string; children?: JSX.Element }): JSX.Element {
  return <div class={classNames(styles.container, props.class)}>{props.children}</div>
}

/** Слот под иконку/канву/обезьянку. `size` уезжает в `--sticker-size` (tweb 1:1). */
MediaHeader.Sticker = function MediaHeaderSticker(props: {
  size?: number
  class?: string
  children?: JSX.Element
}): JSX.Element {
  const size = () => props.size ?? 130
  return (
    <div class={classNames(styles.sticker, props.class)} style={{ '--sticker-size': `${size()}px` }}>
      {props.children}
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
