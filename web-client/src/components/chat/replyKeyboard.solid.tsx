/** @jsxImportSource solid-js */
// Порт tweb `src/components/chat/replyKeyboard.tsx` (812502980, 188 строк) —
// клавиатура бота над строкой ввода (`div.reply-keyboard` в `.rows-wrapper`),
// выпадашка по кнопке `.toggle-reply-markup` строки ввода (`DropdownHover`).
// Создаёт её `ChatInput.constructReplyMarkup` (tweb `input.ts:948-960`). Стили —
// `styles/tweb/_replyKeyboard.scss`. Б-36, пачка П-6.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Источник разметки. У tweb `getReplyMarkup` читает
//     `chat.historyStorageNoThreadId.replyMarkup`, которое ведёт воркерный
//     `mergeReplyKeyboard`, и узнаёт о смене событием `history_reply_markup`.
//     У нас окно истории — зеркало главного потока (`core/history/messagesMirror.ts`),
//     поэтому «последняя клавиатура» выводится из окна основного чата
//     (`winKey(peerId)` — аналог `historyStorageNoThreadId`) свёрткой того же
//     `mergeReplyKeyboard` (`core/markup/replyMarkup.ts::getHistoryReplyMarkup`),
//     а вместо `history_reply_markup` — подписка на зеркало (`subscribeMirror`):
//     окно сменилось → пересчёт → обработчик оригинала, если клавиатура другая.
//  2. Флаг `pFlags.used` форс-ответа оригинал пишет в объект хранилища; у нас
//     разметка пересобирается из окна, поэтому «уже ответили» помнит множество
//     `USED_FORCE_REPLIES` (`peerId_mid`) на всё приложение — как хранилище tweb.
//  3. `getReplyMarkup`/`checkAvailability`/`checkForceReply` синхронные: зеркало
//     читается синхронно. У tweb `checkAvailability()` — промис, и в обработчике
//     `history_reply_markup` его истинность ничего не проверяет; здесь условие
//     «доступна и открыта» проверяется по-настоящему.
//  4. `wrapOptions.textColor` кнопок нет — стилей кнопок у бэкенда нет
//     (`wrappers/keyboardButton.ts`, расхождение 2).
//  5. Опции `managers` нет: у tweb поле присваивается и не читается.
import type ChatInput from '@components/chat/input'
import DropdownHover from '@helpers/dropdownHover'
import type { ReplyMarkup, ReplyKeyboardMarkup } from '@core/markup/replyMarkup'
import { getHistoryReplyMarkup, isForceReplyMarkup } from '@core/markup/replyMarkup'
import { mirrorWindow, subscribeMirror, winKey } from '@core/history/messagesMirror'
import { cachedUser } from '@core/peerCache'
import { toPeerId } from '@core/peers/peerId'
import { isBot } from '@core/peers/predicates'
import ListenerSetter, { type Listener } from '@helpers/listenerSetter'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import findUpAsChild from '@helpers/dom/findUpAsChild'
import cancelEvent from '@helpers/dom/cancelEvent'
import { getHeavyAnimationPromise } from '@core/dom/heavyAnimation'
import safeAssign from '@helpers/object/safeAssign'
import Scrollable from '@components/scrollable'
import wrapKeyboardButton from '@components/wrappers/keyboardButton'
import classNames from '@helpers/string/classNames'
import type { Middleware, MiddlewareHelper } from '@helpers/middleware'
import { For } from 'solid-js'
import { render } from 'solid-js/web'
import ReplyMarkupLayout from '@components/chat/bubbleParts/replyMarkupLayout.solid'
import { ChatType } from '@components/chat/chatType'

/** Расхождение 2 шапки: форс-ответы, на которые уже открыли плашку ответа. */
const USED_FORCE_REPLIES = new Set<string>()

const isBotUser = (userId: number) => isBot(cachedUser(toPeerId(userId, false)))

export default class ReplyKeyboard extends DropdownHover {
  private static BASE_CLASS = 'reply-keyboard'
  private appendTo!: HTMLElement
  private listenerSetter!: ListenerSetter
  private btnHover!: HTMLElement
  private peerId?: PeerId
  private touchListener?: Listener
  private chatInput!: Pick<ChatInput, 'chat' | 'initMessageReply'>
  private scrollable: Scrollable
  private middlewareHelper: MiddlewareHelper
  private ephemeralMode = false
  /** расхождение 1 шапки: окно и разметка, от которых считали в прошлый раз */
  private lastWindow?: readonly unknown[]
  private lastReplyMarkup?: ReplyMarkup

  constructor(options: {
    listenerSetter: ListenerSetter,
    appendTo: HTMLElement,
    btnHover: HTMLElement,
    chatInput: Pick<ChatInput, 'chat' | 'initMessageReply'>,
    middleware: Middleware
  }) {
    super({
      element: document.createElement('div'),
    })

    safeAssign(this, options)

    this.element.classList.add(ReplyKeyboard.BASE_CLASS)
    this.element.style.display = 'none'

    this.scrollable = new Scrollable()
    this.middlewareHelper = options.middleware.create()
    this.element.append(this.scrollable.container)

    this.attachButtonListener(this.btnHover, this.listenerSetter)
    // tweb `history_reply_markup` — расхождение 1 шапки
    options.middleware.onDestroy(subscribeMirror(this.onMirrorChange))
  }

  private onMirrorChange = () => {
    if(!this.peerId) return
    const history = mirrorWindow(winKey(this.peerId))
    if(history === this.lastWindow) return
    this.lastWindow = history

    const replyMarkup = this.getReplyMarkup()
    if(isSameReplyMarkup(replyMarkup, this.lastReplyMarkup)) return
    this.lastReplyMarkup = replyMarkup

    if(this.checkAvailability(replyMarkup) && this.isActive()) {
      this.render()
    }

    void getHeavyAnimationPromise().then(() => {
      this.checkForceReply()
    })
  }

  public init() {
    this.appendTo.append(this.element)

    this.listenerSetter.add(this)('open', () => {
      this.render()

      if(IS_TOUCH_SUPPORTED) {
        this.touchListener = this.listenerSetter.add(document.body)('touchstart', this.onBodyTouchStart, { passive: false, capture: true }) as unknown as Listener
        this.listenerSetter.add(this)('close', () => {
          if(this.touchListener) this.listenerSetter.remove(this.touchListener)
        }, { once: true })
      }
    })

    return super.init()
  }

  private onBodyTouchStart = (e: TouchEvent) => {
    const target = e.touches[0].target as HTMLElement
    if(!findUpAsChild(target, this.element) && target !== this.btnHover) {
      cancelEvent(e)
      void this.toggle(false)
    }
  }

  public checkForceReply() {
    const replyMarkup = this.getReplyMarkup()
    if(this.ephemeralMode) {
      return
    }

    if(isForceReplyMarkup(replyMarkup) &&
      !replyMarkup.pFlags?.hidden &&
      !replyMarkup.pFlags?.used) {
      replyMarkup.pFlags = { ...replyMarkup.pFlags, used: true }
      USED_FORCE_REPLIES.add(this.peerId + '_' + replyMarkup.mid)
      void this.chatInput.initMessageReply({ replyToMsgId: replyMarkup.mid })
    }
  }

  private getReplyMarkup(): ReplyMarkup {
    // the welcome messages section shares the chat's history storage, yet a bot's keyboard or
    // force-reply there is not for writing templates (desktop and Android have none in it)
    const history = this.chatInput.chat.type !== ChatType.Welcome && this.peerId ?
      mirrorWindow(winKey(this.peerId)) :
      undefined
    const replyMarkup = history && getHistoryReplyMarkup(history, isBotUser)
    if(isForceReplyMarkup(replyMarkup) && USED_FORCE_REPLIES.has(this.peerId + '_' + replyMarkup.mid)) {
      replyMarkup.pFlags = { ...replyMarkup.pFlags, used: true }
    }

    return replyMarkup || {
      _: 'replyKeyboardHide',
      pFlags: {},
    }
  }

  public render(replyMarkup?: ReplyKeyboardMarkup) {
    if(replyMarkup === undefined) {
      replyMarkup = this.getReplyMarkup() as ReplyKeyboardMarkup
    }

    this.scrollable.replaceChildren()
    this.middlewareHelper.clean()

    const markup = replyMarkup
    const dispose = render(() => (
      <ReplyMarkupLayout>
        <For each={markup.rows}>
          {(row) => (
            <ReplyMarkupLayout.Row class={ReplyKeyboard.BASE_CLASS + '-row'}>
              <For each={row.buttons}>
                {(button) => (
                  wrapKeyboardButton({
                    button,
                    chat: this.chatInput.chat,
                    replyMarkup: markup,
                    onClick: () => {
                      void this.toggle(false)
                    },
                    className: classNames(ReplyKeyboard.BASE_CLASS + '-button', 'btn'),
                  })
                )}
              </For>
            </ReplyMarkupLayout.Row>
          )}
        </For>
      </ReplyMarkupLayout>
    ), this.scrollable.container)
    this.middlewareHelper.get().onDestroy(dispose)
  }

  public checkAvailability(replyMarkup?: ReplyMarkup) {
    if(replyMarkup === undefined) {
      replyMarkup = this.getReplyMarkup()
    }

    const hide = this.ephemeralMode ||
      replyMarkup._ === 'replyKeyboardHide' ||
      // a force-reply inline markup is tracked as the last keyboard, but it is drawn in
      // its own bubble — there is no panel to open for it
      replyMarkup._ === 'replyInlineMarkup' ||
      !(replyMarkup as ReplyKeyboardMarkup).rows?.length
    this.btnHover.classList.toggle('hide', hide)

    if(hide) {
      void this.toggle(false)
    }

    return !hide
  }

  public setEphemeralMode(ephemeralMode: boolean) {
    this.ephemeralMode = ephemeralMode
    this.checkAvailability()
  }

  public setPeer(peerId: PeerId) {
    this.peerId = peerId
    this.lastWindow = mirrorWindow(winKey(peerId))
    this.lastReplyMarkup = this.getReplyMarkup()

    this.checkAvailability(this.lastReplyMarkup)
    this.checkForceReply()
  }
}

/** Расхождение 1 шапки: свёртка пересобирает копию разметки на каждом пересчёте,
 *  поэтому «та же клавиатура» — то же сообщение, тот же источник рядов и те же флаги. */
function isSameReplyMarkup(a: ReplyMarkup | undefined, b: ReplyMarkup | undefined) {
  if(a === b) return true
  if(!a || !b || a._ !== b._) return false
  const aa = a as ReplyKeyboardMarkup, bb = b as ReplyKeyboardMarkup
  return aa.mid === bb.mid &&
    aa.rows === bb.rows &&
    !!aa.pFlags?.hidden === !!bb.pFlags?.hidden
}
