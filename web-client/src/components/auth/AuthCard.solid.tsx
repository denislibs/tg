/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/pages/AuthCard.tsx` (61 строка) — оболочка карточки auth-флоу.
 *
 * Рендерит поверхность (`.card`, класс несёт САМА карточка, не хост — см.
 * `AuthCardsHost.solid.tsx`) и (опционально) оборачивает `children` в
 * `.input-wrapper`. Шапка (стикер/тайтл/сабтайтл) идёт пропом `header` и
 * рендерится НАД `.input-wrapper` — обычно это `<MediaHeader>` (порт которого —
 * не предмет этой задачи, появится вместе с настоящими карточками в задачах 4-5).
 *
 * 1:1 с оригиналом (`AuthCard.tsx:50-60`); правка одна — `Show/fallback` вместо
 * тернарника был бы возможен и там, и здесь: оставляем ИМЕННО `<Show>`, как в
 * исходнике, а не своё сокращение.
 */
import { Show, type JSX } from 'solid-js'
import classNames from '@helpers/string/classNames'
import styles from './AuthFlow.module.scss'

export type AuthCardProps = {
  /** Модификатор конкретной страницы — `styles.pageSignIn` и т.п. */
  class?: string
  /**
   * Всё, что выше полей формы — стикер, тайтл, сабтайтл. Рендерится ВНЕ
   * `.input-wrapper`.
   */
  header?: JSX.Element
  /**
   * Оборачивать ли `children` в `.input-wrapper`. По умолчанию `true` — у
   * типичной карточки список полей/кнопок. `false` — когда дети сами управляют
   * раскладкой (signQR мешает список помощи со своим input-wrapper, signImport
   * показывает только прелоадер).
   */
  inputWrapper?: boolean
  /** Поля формы, кнопки — всё, что идёт после шапки. */
  children?: JSX.Element
}

export default function AuthCard(props: AuthCardProps): JSX.Element {
  const useInputWrapper = () => props.inputWrapper !== false

  return (
    <div class={classNames(styles.card, props.class)}>
      {props.header}
      <Show when={useInputWrapper()} fallback={props.children}>
        <div class="input-wrapper">{props.children}</div>
      </Show>
    </div>
  )
}
