/** @jsxImportSource solid-js */
// Порт tweb `src/components/chat/bubbleParts/replyMarkupLayout.tsx` (812502980) —
// раскладка клавиатуры бота: `.reply-markup` → `.reply-markup-row` →
// `.reply-markup-button`; углы `is-first`/`is-last` получают кнопки последнего
// ряда. Потребители — `chat/replyKeyboard.solid.tsx` (клавиатура над композером)
// и `wrappers/keyboardButton.ts` (узел кнопки). Стили — `styles/tweb/_chatBubble.scss`
// (`.reply-markup*`) и `_replyKeyboard.scss`. Б-36, пачка П-6.
//
// Расхождения:
//  1. `wrapOptions` (`WrapSomethingOptions`) у `Inline`/`createInlineReplyMarkup`
//     нет: кнопке он нужен только под стиль с иконкой-эмодзи (`button.style.icon`),
//     а стилей кнопок бэкенд не производит (`wrappers/keyboardButton.ts`,
//     расхождение 2). Зону жизни `createInlineReplyMarkup` берёт `middleware`.
//  2. Ряды инлайн-разметки — наши `KeyboardButtonRow` (`core/markup/replyMarkup.ts`),
//     у tweb — `KeyboardInlineButtonRow` новой схемы.
//  3. `ref` в `Row`/`Button` — с `!` под строгий tsconfig; у `Row` присваивание
//     колбэком (`ref={(el) => ref = el}`), а не `ref={ref}`: линтер не видит
//     присваивания, которое дописывает компилятор Solid.
import { children, createContext, createEffect, createMemo, createSignal, For, Show, useContext, type JSX, type Ref } from 'solid-js'
import { render } from 'solid-js/web'
import wrapKeyboardButton, { type KeyboardButtonChat } from '@components/wrappers/keyboardButton'
import type { MyMessage } from '@core/models'
import { filterReplyMarkupRows, type KeyboardButtonRow } from '@core/markup/replyMarkup'
import type { IconName } from '@core/tgico-icons'
import type { Middleware } from '@helpers/middleware'
import classNames from '@helpers/string/classNames'
import { IconTsx } from '@components/iconTsx.solid'
import RippleElement from '@components/rippleElement.solid'

type ContextValue = {
  elements: () => JSX.Element[]
}
const Context = createContext<ContextValue>()

const ReplyMarkupLayout = (props: {
  children?: JSX.Element
}) => {
  const [elements, setElements] = createSignal<JSX.Element[]>([])
  const value: ContextValue = {
    elements,
  }

  const resolvedChildren = children(() => (
    <Context.Provider value={value}>
      {props.children}
    </Context.Provider>
  ))

  createEffect<void>(() => void setElements(resolvedChildren.toArray()))

  return (
    <div class="reply-markup">
      {resolvedChildren()}
    </div>
  )
}

type RowContextValue = {
  isLast: boolean
  elements: () => JSX.Element[]
}
const RowContext = createContext<RowContextValue>()

ReplyMarkupLayout.Row = (props: {
  children: JSX.Element
  class?: string
}) => {
  const context = useContext(Context)!
  const [elements, setElements] = createSignal<JSX.Element[]>([])
  let ref!: HTMLDivElement
  const value: RowContextValue = {
    get isLast() {
      return context.elements()[context.elements().length - 1] === ref
    },
    elements,
  }

  const resolvedChildren = children(() => (
    <RowContext.Provider value={value}>
      {props.children}
    </RowContext.Provider>
  ))

  createEffect<void>(() => void setElements(resolvedChildren.toArray()))

  return (
    <div ref={(el) => ref = el} class={classNames('reply-markup-row', props.class)}>
      {resolvedChildren()}
    </div>
  )
}

ReplyMarkupLayout.Button = (props: {
  onClick?: (e: MouseEvent) => void
  children: JSX.Element
  class?: string
  textClass?: string
  icon?: IconName
  ref?: Ref<HTMLElement>
  as?: 'button' | 'a'
}) => {
  const rowContext = useContext(RowContext)!
  let ref!: HTMLElement
  const isFirst = createMemo(() => rowContext.elements()[0] === ref)
  const isLast = createMemo(() => rowContext.elements()[rowContext.elements().length - 1] === ref)
  return (
    <RippleElement
      component={props.as || 'button'}
      ref={(_ref: HTMLElement) => {
        ref = _ref
        ;(props.ref as ((el: HTMLElement) => void) | undefined)?.(ref)
      }}
      class={classNames(
        'reply-markup-button',
        rowContext.isLast && isFirst() && 'is-first',
        rowContext.isLast && isLast() && 'is-last',
        props.class,
      )}
      onClick={props.onClick}
    >
      <Show when={props.icon}>
        <IconTsx icon={props.icon!} class="reply-markup-button-icon" />
      </Show>
      <span class={classNames('reply-markup-button-text', props.textClass)}>
        {props.children}
      </span>
    </RippleElement>
  )
}

ReplyMarkupLayout.Inline = (props: {
  rows: KeyboardButtonRow[]
  chat: KeyboardButtonChat
  message?: MyMessage
}) => {
  const rows = filterReplyMarkupRows(props.rows)

  return (
    <ReplyMarkupLayout>
      <For each={rows}>
        {(row) => (
          <ReplyMarkupLayout.Row>
            <For each={row.buttons}>
              {(button) => {
                return wrapKeyboardButton({
                  button,
                  chat: props.chat,
                  message: props.message,
                })
              }}
            </For>
          </ReplyMarkupLayout.Row>
        )}
      </For>
    </ReplyMarkupLayout>
  )
}

export default ReplyMarkupLayout

export function createInlineReplyMarkup(options: {
  rows: KeyboardButtonRow[]
  chat: KeyboardButtonChat
  message?: MyMessage
  middleware: Middleware
}): HTMLDivElement {
  const container = document.createElement('div')
  const dispose = render(() => (
    <ReplyMarkupLayout.Inline
      rows={options.rows}
      chat={options.chat}
      message={options.message}
    />
  ), container)
  options.middleware.onDestroy(dispose)
  return container.firstElementChild as HTMLDivElement || container as unknown as HTMLDivElement
}
