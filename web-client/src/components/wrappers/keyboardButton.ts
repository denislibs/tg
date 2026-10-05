// Порт tweb `src/components/wrappers/keyboardButton.ts` (812502980, 426 строк) —
// обработчик кнопки клавиатуры бота (`getKeyboardButtonHandler`) и её узел
// (`wrapKeyboardButton`). Потребители — клавиатура над композером
// (`chat/replyKeyboard.solid.tsx`) и инлайн-разметка
// (`chat/bubbleParts/replyMarkupLayout.solid.tsx`). Б-36, пачка П-6.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Ветвление по конструктору КНОПКИ, а не по `button.type._`: в нашей модели
//     (`core/markup/replyMarkup.ts`) вид кнопки — её собственный `_`
//     (`keyboardButtonUrl`/`…Callback`/`…WebView`/`keyboardButton`), как в схеме
//     до разделения кнопки и её типа. Ветки оригинала → наши конструкторы:
//     `inlineButtonTypeUrl` → `keyboardButtonUrl`, `inlineButtonTypeWebView` →
//     `keyboardButtonWebView`, `inlineButtonTypeCallback` → `keyboardButtonCallback`,
//     `default` → `keyboardButton` (шлёт свой текст).
//  2. Веток без предмета нет: switch-inline, buy, url-auth, game, request-peer/
//     phone, copy, disabled, simple-web-view — бэкенд таких кнопок не производит
//     (шапка `replyMarkup.ts`). Нет и `button.style` (цвет фона, иконка-эмодзи) —
//     а с ним `wrapOptions`, `bg` и `customEmojiSize`; нет приветственных
//     сообщений (`welcome_template`) и эфемерного режима
//     (`getEphemeralSendingSnapshot`, `isEphemeralMessageId`).
//  3. Callback — `managers.bots.callback(botId, peerId, data, mid)` (у tweb
//     `appInlineBotsManager.callbackButtonClick(peerId, mid, data)`: бота воркер
//     находит по сообщению; наша ручка `/bots/{id}/callback` ждёт его в адресе).
//     В ответе `messages.botCallbackAnswer` у нас нет `url` — ветки
//     `openUrl(callbackAnswer.url)` нет.
//  4. Веб-апп открывает `openWebApp` из `core/webapp.ts` (модалка в
//     `GlobalOverlays`), а не `chat.openWebApp` (у tweb — запрос
//     `messages.requestWebView` и `WebApp`-попап): URL берётся прямой, из кнопки.
//  5. `wrapRichText` без `noLinebreaks` (у нас такой опции нет).
//  6. `viaBotId` у сообщения нет — бот кнопки берётся `replyMarkup.fromId` или
//     автор сообщения.
import classNames from '@helpers/string/classNames'
import wrapRichText from '@lib/richtext/wrapRichText'
import rootScope from '@lib/rootScope'
import type { MyMessage } from '@core/models'
import type { KeyboardButton, ReplyMarkup } from '@core/markup/replyMarkup'
import { toUserId } from '@core/peers/peerId'
import { peerTitle } from '@core/peerCache'
import { openWebApp } from '@core/webapp'
import type { IconName } from '@core/tgico-icons'
import { toast } from '@components/toast'
import { confirmationPopup } from '@components/popups/popupPeer'
import ReplyMarkupLayout from '@components/chat/bubbleParts/replyMarkupLayout.solid'
import type Chat from '@components/chat/chat'

export type AnyKeyboardButton = KeyboardButton

/** Члены `Chat`, которые зовёт обработчик (у tweb — весь `Chat`). */
export type KeyboardButtonChat = Pick<Chat, 'peerId' | 'managers'> & {
  appImManager: Pick<Chat['appImManager'], 'openUrl'>
}

/** Разметка с клиентскими полями `mergeReplyKeyboard` (`mid`, `fromId`). */
type MergedReplyMarkup = ReplyMarkup & { mid?: number, fromId?: PeerId }

export type KeyboardButtonHandler = {
  text: DocumentFragment | HTMLElement,
  onClick?: (e: Event) => void,
  icon?: IconName,
  as: 'button' | 'a',
  classNames: string[],
  refCallbacks: ((ref: HTMLElement) => void)[],
}

export type WrapKeyboardButtonOptions = {
  button: AnyKeyboardButton,
  chat: KeyboardButtonChat,
  message?: MyMessage,
  replyMarkup?: ReplyMarkup,
  className?: string,
}

/** tweb `:39-397` */
export function getKeyboardButtonHandler({
  button,
  chat,
  message,
  replyMarkup,
  className,
}: WrapKeyboardButtonOptions): KeyboardButtonHandler | undefined {
  const text: DocumentFragment | HTMLElement = wrapRichText(button.text, { noLinks: true })
  let icon: IconName | undefined
  let onClick: ((e: Event) => void) | undefined
  let as: 'button' | 'a' = 'button'
  // у tweb первый колбэк запоминает узел для `toggleDisability` веток url-auth/
  // web-view (расхождения 2 и 4 шапки) — здесь узел нужен только ссылке
  const refCallbacks: ((ref: HTMLElement) => void)[] = []
  const classNamesArr: string[] = [className].filter(Boolean) as string[]

  const { peerId } = chat
  const merged = replyMarkup as MergedReplyMarkup | undefined
  const messageMid = merged?.mid || message?.id
  const botId = merged?.fromId || message?.fromId

  switch(button._) {
    case 'keyboardButtonUrl': {
      const r = wrapRichText(' ', {
        entities: [{
          _: 'messageEntityTextUrl',
          length: 1,
          offset: 0,
          url: button.url,
        }],
      })

      const anchor = r.firstElementChild as HTMLAnchorElement
      as = 'a'
      classNamesArr.push('is-link', anchor.className)
      icon = 'arrow_next'

      refCallbacks.push((ref) => {
        anchor.getAttributeNames().forEach((name) => {
          if(name !== 'class') {
            ref.setAttribute(name, anchor.getAttribute(name)!)
          }
        })
      })

      break
    }

    case 'keyboardButtonWebView': {
      classNamesArr.push('is-web-view')
      icon = 'webview'

      // расхождение 4 шапки: открытие синхронное, `toggleDisability` на время
      // запроса (`.finally(toggle)`) не нужен
      onClick = () => {
        openWebApp({
          url: button.url,
          botId: botId ? toUserId(botId) : undefined,
          botName: botId ? peerTitle(botId) : undefined,
        })
      }
      break
    }

    case 'keyboardButtonCallback': {
      onClick = () => {
        // расхождение 3 шапки
        if(!botId) return
        void chat.managers.bots.callback(toUserId(botId), peerId, button.data, messageMid)
        .then((callbackAnswer) => {
          if(typeof callbackAnswer.text === 'string' && callbackAnswer.text.length) {
            if(callbackAnswer.alert) {
              confirmationPopup({
                description: wrapRichText(callbackAnswer.text, { noLinks: true }),
                button: { langKey: 'OK', isCancel: true },
              }).catch(() => {})
            } else {
              toast(wrapRichText(callbackAnswer.text, { noLinks: true }))
            }
          }
        })
      }

      break
    }

    default: {
      if(!message) {
        onClick = () => {
          void chat.managers.messages.sendText({
            peerId,
            text: button.text,
            clientMsgId: crypto.randomUUID(),
            optimistic: { senderId: rootScope.myId },
          })
        }
      }

      break
    }
  }

  return {
    text,
    onClick,
    icon,
    as,
    classNames: classNamesArr,
    refCallbacks,
  }
}

/** tweb `:399-426` */
export default function wrapKeyboardButton(options: WrapKeyboardButtonOptions & {
  onClick?: () => void,
}) {
  const handler = getKeyboardButtonHandler(options)
  if(!handler) return

  const { onClick: _onClick } = options
  return ReplyMarkupLayout.Button({
    children: handler.text,
    class: classNames(...handler.classNames),
    onClick: _onClick ? (e) => (_onClick(), handler.onClick?.(e)) : handler.onClick,
    icon: handler.icon,
    ref: (ref) => {
      handler.refCallbacks.forEach((cb) => cb(ref))
    },
    as: handler.as,
  })
}
