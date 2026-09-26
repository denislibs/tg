/** @jsxImportSource solid-js */
// Порт tweb `src/components/chatTypeMenu/index.tsx:1-74` — фильтр типа чата
// (все / личные / группы / каналы) в правом слоте заголовка группы «Messages»
// глобального поиска (`sidebarLeft/index.ts:1118-1126`).
//
// Разметка сверена с дампом живого Telegram
// `docs/tweb/dom/dumps/14-left-03-search-chats.json`:
// `chat-type-menu > span.primary.checkable-button-menu._ButtonMenu.btn-menu-toggle > span.i18n`.
//
// Как им пользуется владелец поиска (tweb `sidebarLeft/index.ts`, у нас —
// задача 12 плана глобального поиска):
//   const chatTypeMenu = new ChatTypeMenu()
//   chatTypeMenu.feedProps({ onChange: (chatType) => …, selected: 'all' })
//   searchGroups.messages.setNameRight({ children: chatTypeMenu })
//   chatTypeMenu.props.selected = 'all'   // сброс (:1307, :1501)
//   chatTypeMenu.props.hidden = true      // при чипах (:1214)
// `props` — изменяемый стор: выбор в меню пишет `props.selected` сам (:40),
// владелец читает его оттуда (:1107, :1309).
//
// Расхождения с оригиналом:
//  1. `ChatType` — `NonNullable` от поля опций: у оригинала тип вместе с
//     `undefined` (`RequestHistoryOptions['chatType']`, `appMessagesManager.ts:312`),
//     а ключом `Record` ниже он быть не может. Опции — `SearchHistoryOptions`
//     шва `messages.searchHistory` (задача 6 плана).
//  2. `if(import.meta.hot) import.meta.hot.accept()` (`:9`) не перенесён —
//     HMR у нас нет (расхождение 1 в шапке `shared/solid/defineSolidElement.solid.tsx`).
//  3. План (задача 10) предлагал монтировать компонент мостом `mountSolid`;
//     взят custom element, как у оригинала: `mountSolid` не даёт компоненту
//     писать свои пропы, а владелец читает выбор именно из них (см. выше).
import { createEffect, createMemo, onCleanup } from 'solid-js'
import { i18n, type LangPackKey } from '@lib/langPack'
import defineSolidElement, { type PassedProps } from '@shared/solid/defineSolidElement.solid'
import type { ButtonMenuItemOptions } from '@components/buttonMenu'
import ButtonMenuToggle from '@components/buttonMenuToggle'
import styles from '@components/chatTypeMenu.module.scss'
import type { SearchHistoryOptions } from '@core/managers/messagesManager'

export type ChatType = NonNullable<SearchHistoryOptions['chatType']>

type Props = {
  selected?: ChatType
  hidden?: boolean
  onChange?: (type: ChatType) => void
}

const langKeyMap: Record<ChatType, LangPackKey> = {
  'all': 'AllChats',
  'users': 'UsersOnly',
  'groups': 'GroupsOnly',
  'channels': 'ChannelsOnly',
}

const keys: ChatType[] = ['all', 'users', 'groups', 'channels']

const ChatTypeMenu = defineSolidElement({
  name: 'chat-type-menu',
  component: (props: PassedProps<Props>) => {
    const selected = createMemo(() => props.selected || 'all')

    const options: (ButtonMenuItemOptions & { id: ChatType })[] = keys.map((key) => ({
      id: key,
      emptyIcon: true,
      text: langKeyMap[key],
      onClick: () => {
        props.selected = key
        props.onChange?.(key)
      },
    }))

    createEffect(() => {
      const option = options.find(({ id }) => id === selected())
      if(!option) return

      option.icon = 'check'
      onCleanup(() => {
        option.icon = undefined
      })
    })

    const span = <span
      class={`primary checkable-button-menu ${styles.ButtonMenu}`}
      classList={{
        [styles.hidden]: !!props.hidden,
      }}
    >{i18n(langKeyMap[selected()])}</span> as HTMLSpanElement

    const buttonMenu = ButtonMenuToggle({
      container: span,
      buttons: options,
      direction: 'bottom-left',
      onOpen: (_, element) => {
        element.style.bottom = 'unset'
      },
    })

    return <>{buttonMenu}</>
  },
})

export default ChatTypeMenu
