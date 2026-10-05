// Порт tweb `src/components/chat/botCommands.ts` (812502980) — список команд бота
// по кнопке `.new-message-bot-commands` строки ввода (`ChatInput.constructBotCommands`,
// tweb `input.ts:962-1046`). База — `AutocompletePeerHelper` (Б-34). Б-36, пачка П-6.
//
// Расхождения:
//  1. Команды — ручкой `GET /bots/{id}/commands` (`managers.bots.commands`), а не
//     `userFull.bot_info.commands` (`appProfileManager.getProfile`): `bot_info` в
//     `userFull` бэкенд не производит. Карточку для `processPeerFullForCommands`
//     собирает вызывающий — так же, как `CommandsHelper`.
//  2. `AutocompletePeerHelper` берёт `managers` шестым аргументом (аватарки и имена
//     строк — зеркало карточек), у tweb он импортирует их сам.
import type ChatInput from '@components/chat/input'
import callbackify from '@helpers/callbackify'
import AutocompletePeerHelper from '@components/chat/autocompletePeerHelper'
import processPeerFullForCommands from '@components/chat/processPeerFullForCommands'
import type { Managers } from '@/client/bootstrap'
import type { Middleware } from '@helpers/middleware'
import { toPeerId } from '@core/peers/peerId'

const CLASS_NAME = 'bot-commands'
export default class ChatBotCommands extends AutocompletePeerHelper {
  private userId?: UserId

  constructor(
    appendTo: HTMLElement,
    chatInput: ChatInput,
    private managers: Managers,
  ) {
    super(appendTo, undefined, CLASS_NAME, (target) => {
      const innerHTML = target.querySelector(`.${AutocompletePeerHelper.BASE_CLASS_LIST_ELEMENT}-name`)!.innerHTML
      return chatInput.getReadyToSend(() => {
        chatInput.messageInput.innerHTML = innerHTML
        void chatInput.sendMessage(true)
        this.toggle(true)
      })
    }, 'Chat.BotCommands', managers)
  }

  public setUserId(userId: UserId, middleware: Middleware) {
    if(this.userId === userId && this.list?.childElementCount) {
      this.toggle(false)
      return
    }

    this.userId = userId
    return callbackify(this.managers.bots.commands(+userId).catch(() => []), (commands) => {
      if(!middleware()) return
      // расхождение 1 шапки
      const filtered = processPeerFullForCommands(toPeerId(+userId, false), { bot_info: { user_id: userId, commands } })

      const PADDING_TOP = 8
      // const PADDING_BOTTOM = 8;
      const PADDING_BOTTOM = 24
      const height = filtered.length * 50 + PADDING_TOP + PADDING_BOTTOM
      this.container.style.setProperty('--height', height + 'px')

      this.render(filtered, middleware)
    })
  }
}
