/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/mediaHeader.tsx` (812502980, 211 строк) — общая
 * шапка «стикер → заголовок → подзаголовок»: карточки входа, интро-попапы,
 * вкладки настроек (сессия, пасскеи). Каждая часть — свой подкомпонент со
 * своими пропами:
 *
 *   <MediaHeader>
 *     <MediaHeader.Sticker name="key" size={100} />
 *     <MediaHeader.Title>{i18n('…')}</MediaHeader.Title>
 *     <MediaHeader.Subtitle color="secondary">{i18n('…')}</MediaHeader.Subtitle>
 *   </MediaHeader>
 *
 * `Sticker` берёт встроенный лотти-ассет (`name`) или свой узел (`element`:
 * svg-логотип, обезьянка, аватар, канва QR). Узел, созданный JSX, передавать
 * ФУНКЦИЕЙ (`element={() => <X/>}`): проп читается дважды (`:125`, `:137`), и
 * JSX-выражение, отданное значением, построилось бы дважды.
 *
 * До волны 2D жила в `components/auth/` урезанной (строки 1-100 оригинала:
 * контейнер + Sticker/Title/Subtitle с `children`/`secondary`); перенесена на
 * место оригинала и доведена до HEAD (задача 5 плана 2D).
 *
 * Модель отступов — HEAD: ритм между частями держит блок (`gap: .5rem` в
 * `mediaHeader.module.scss`), у частей нет вертикальных полей, выравнивание —
 * классами модуля (`.title, .subtitle`), глобальных `text-center`/`secondary`
 * части не носят (О-29 плана 2D; вместе с ней переведён `auth/AuthFlow.module.scss`).
 *
 * Отличия от оригинала:
 *  1. `lottieLoader` — синглтон по умолчанию `LottieAnimation`, а не импорт
 *     tweb `:7` (тот же модуль; явная передача ничего не добавляет).
 *  2. `onPromise` гасит отказ загрузки (`NO_WASM` — деградация без WASM SIMD,
 *     статичный кадр `LottieAnimation` ставит сам): у tweb отказа нет, у нас
 *     он остался бы необработанным.
 */
import { type JSX, type Ref, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'

import LottieAnimation from '@components/lottieAnimation.solid'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import classNames from '@helpers/string/classNames'
import type { LottieAssetName } from '@lib/lottie/lottieLoader'

import styles from '@components/mediaHeader.module.scss'

function MediaHeader(props: {
  class?: string
  children?: JSX.Element
  marginTop?: boolean
  marginBottom?: boolean
  /** Блок на цветной подложке `MediaHeader.Backdrop` — текст белеет и ложится поверх. */
  onBackdrop?: boolean
  /** Выравнивание текста к началу строки вместо центра — подтверждение читается абзацем. */
  align?: 'start'
}): JSX.Element {
  return (
    <div
      class={classNames(
        styles.container,
        props.align === 'start' && styles.alignStart,
        props.onBackdrop && styles.onBackdrop,
        props.marginTop && styles.marginTop,
        props.marginBottom && styles.marginBottom,
        props.class,
      )}
    >
      {props.children}
    </div>
  )
}

/** Слой под всем остальным — окрашенный узел (фон подарка) детьми. Нужен `onBackdrop` у шапки. */
MediaHeader.Backdrop = function MediaHeaderBackdrop(props: {
  class?: string
  children?: JSX.Element
}): JSX.Element {
  return <div class={classNames(styles.backdrop, props.class)}>{props.children}</div>
}

export type MediaHeaderStickerProps = {
  /** Встроенный лотти-ассет. Взаимоисключает `element`. */
  name?: LottieAssetName
  /** Свой узел (svg, канва, обезьянка…). JSX — функцией, см. шапку. Взаимоисключает `name`. */
  element?: JSX.Element | (() => JSX.Element)
  /** Размер в px (`--sticker-size` и размер отрисовки лотти). По умолчанию 130. */
  size?: number
  /** Доп. класс обёртки стикера. */
  class?: string
  /** Перезапуск анимации по щелчку. По умолчанию true. */
  restartOnClick?: boolean
  /** Стикер готов: с плеером для `name`, без аргумента для `element` (готов сразу). */
  onReady?: (animation?: LottiePlayer) => void
  ref?: Ref<HTMLDivElement>
}

MediaHeader.Sticker = function MediaHeaderSticker(props: MediaHeaderStickerProps): JSX.Element {
  const size = () => props.size || 130

  if(props.element) {
    props.onReady?.()
  }

  return (
    <div
      class={classNames(styles.sticker, props.class)}
      style={{ '--sticker-size': size() + 'px' }}
      ref={props.ref}
    >
      <Show
        when={props.name}
        fallback={typeof(props.element) === 'function' ? props.element() : props.element}
      >
        <LottieAnimation
          class={styles.lottie}
          size={size()}
          restartOnClick={props.restartOnClick ?? true}
          name={props.name!}
          onPromise={(promise) => {
            // см. шапку, п. 2
            promise.then(props.onReady, () => {})
          }}
        />
      </Show>
    </div>
  )
}

export type MediaHeaderTitleProps = {
  class?: string
  /** Семантический тег там, где это заголовок страницы или диалога. */
  tag?: 'div' | 'h1' | 'h2'
  /** Кегль в px: 24 — основной (по умолчанию), 20 — компактный узких попапов. */
  size?: 20 | 24
  children?: JSX.Element
}

MediaHeader.Title = function MediaHeaderTitle(props: MediaHeaderTitleProps): JSX.Element {
  return (
    <Dynamic
      component={props.tag || 'div'}
      data-popup-title
      class={classNames(
        styles.title,
        props.size === 20 && styles.title20,
        props.class,
      )}
    >
      {props.children}
    </Dynamic>
  )
}

export type MediaHeaderSubtitleProps = {
  class?: string
  /** `secondary` — мельче и серым (подсказка), `danger` — что-то пропало или не удалось. */
  color?: 'secondary' | 'danger'
  children?: JSX.Element
}

MediaHeader.Subtitle = function MediaHeaderSubtitle(props: MediaHeaderSubtitleProps): JSX.Element {
  return (
    <div
      class={classNames(
        styles.subtitle,
        props.color && styles[props.color],
        props.class,
      )}
    >
      {props.children}
    </div>
  )
}

export default MediaHeader
