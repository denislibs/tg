/** @jsxImportSource solid-js */
// Порт tweb `src/components/sidebarLeft/pendingSuggestionItem.tsx` (812502980,
// 1-86) — строка плашки-подсказки (`Row` с крестиком) и её простой вид
// `SimpleSuggestion`; в свёрнутой колонке вместо строки — квадрат с одним
// эмодзи (`useIsSidebarCollapsed`).
//
// Эталон DOM (живой tweb, плашка «Never miss a message!»):
//   div.rp.row.row-clickable.hover-effect._suggestion._secondary
//     > button.btn-icon.close._close + div.row-title > span.text-bold._suggestionTitle
//     + div.row-subtitle > span._suggestionSubtitle
//
// Расхождение с оригиналом одно: у `SimpleSuggestion` нет пропа `danger`
// (класс `.danger`, `color: 'danger'`, `hover-danger-effect`). Его зовёт
// единственный вид — «аккаунт заморожен» (`frozenSuggestion.tsx`), а заморозки
// на бэкенде нет (О-108 волна 7); ветка без вызывающего — мёртвый код.
import { Show, type JSX } from 'solid-js'
import Button from '@components/buttonTsx.solid'
import RippleElement from '@components/rippleElement.solid'
import Row from '@components/rowTsx.solid'
import styles from '@components/sidebarLeft/pendingSuggestion.module.scss'
import cancelEvent from '@helpers/dom/cancelEvent'
import documentFragmentToNodes from '@helpers/dom/documentFragmentToNodes'
import classNames from '@helpers/string/classNames'
import I18n from '@lib/langPack'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'
import { useIsSidebarCollapsed } from '@stores/foldersSidebar.solid'

export const PendingSuggestion = (props: Parameters<typeof Row>[0] & { closable?: () => void }) => {
  return (
    <Row
      {...props}
      class={classNames(styles.suggestion, props.class)}
    >
      {props.children}
      {props.closable && (
        <Button.Icon
          icon="close"
          class={styles.close}
          aria-label={I18n.format('Close', true)}
          onClick={(e) => {
            cancelEvent(e)
            props.closable!()
          }}
        />
      )}
    </Row>
  )
}

PendingSuggestion.Title = (props: Parameters<typeof Row.Title>[0]) => {
  return (
    <Row.Title {...props}>
      <span class={classNames('text-bold', styles.suggestionTitle)}>{props.children}</span>
    </Row.Title>
  )
}

PendingSuggestion.Subtitle = (props: Parameters<typeof Row.Subtitle>[0]) => {
  return (
    <Row.Subtitle {...props}>
      <span class={styles.suggestionSubtitle}>{props.children}</span>
    </Row.Subtitle>
  )
}

export function SimpleSuggestion(props: {
  emoji: string | (() => DocumentFragment)
  title: JSX.Element
  subtitle: JSX.Element
  onClick: () => void
  onClose?: () => void
}) {
  const [isSidebarCollapsed] = useIsSidebarCollapsed()
  const emoji = typeof(props.emoji) === 'string' ? () => wrapEmojiText(props.emoji as string) : props.emoji

  return (
    <Show
      when={isSidebarCollapsed()}
      fallback={
        <PendingSuggestion
          class={styles.secondary}
          clickable={props.onClick}
          closable={props.onClose}
        >
          <PendingSuggestion.Title>{props.title}</PendingSuggestion.Title>
          <PendingSuggestion.Subtitle>{props.subtitle}</PendingSuggestion.Subtitle>
        </PendingSuggestion>
      }
    >
      <RippleElement
        component="div"
        class={classNames(styles.collapsed, 'hover-effect')}
        onClick={props.onClick}
      >
        {documentFragmentToNodes(emoji())}
      </RippleElement>
    </Show>
  )
}
