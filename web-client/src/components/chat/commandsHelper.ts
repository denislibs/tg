// Порт tweb `src/components/chat/commandsHelper.ts` (812502980) — подсказка
// команд бота по `/` в начале строки ввода; выбор сразу отправляет команду.
// Пачка П-6, Б-34.
//
// Расхождения с оригиналом:
//  1. Команды — только у личного чата с ботом: карточка (`getProfileByPeerId` →
//     `bot_info`) собирается из ручки `GET /bots/{id}/commands`
//     (`bots.commands`). У групп `chatFull.bot_info` бэкенд не производит
//     (`domain/mtchat.go`, «нет предмета») — `/` в группе подсказки не даёт,
//     Б-137. Поэтому и суффикс `@username` бота у команды в группе
//     (`:24-29`) не строится.
//  2. Команда ставится в поле текстом (`textContent`), а не `innerHTML` узла
//     имени: правило «не строить DOM из строки» (`web-client/CLAUDE.md`); имя
//     команды — латиница без разметки, значение то же.
//  3. `getReadyToSend` (отложенная отправка, Б-32) не зовётся — отправка сразу;
//     эфемерных команд (`ephemeralReceiverId`) у бэкенда нет.
import type { Managers } from '@/client/bootstrap'
import { cachedUser } from '@core/peerCache'
import { isUser } from '@core/peers/peerId'
import { isBot as isBotPeer } from '@core/peers/predicates'
import AutocompletePeerHelper from './autocompletePeerHelper'
import type AutocompleteHelperController from './autocompleteHelperController'
import processPeerFullForCommands from './processPeerFullForCommands'
import hideCommandAutocomplete from './hideCommandAutocomplete'
import type ChatInput from './input'

export default class CommandsHelper extends AutocompletePeerHelper {
  constructor(
    appendTo: HTMLElement,
    controller: AutocompleteHelperController,
    chatInput: ChatInput,
    private managers: Managers,
  ) {
    super(appendTo,
      controller,
      'commands-helper',
      (target) => {
        const name = target.querySelector(`.${AutocompletePeerHelper.BASE_CLASS_LIST_ELEMENT}-name`)!.textContent!
        hideCommandAutocomplete(controller)
        chatInput.messageInput.textContent = name
        void chatInput.sendMessage(true)
      },
      'Chat.BotCommands',
      managers,
    )
  }

  public async checkQuery(query: string, peerId: PeerId) {
    const isBot = isUser(peerId) && isBotPeer(cachedUser(peerId))
    if(!isBot) { // * расхождение 1
      return false
    }

    const middleware = this.controller!.getMiddleware()
    void this.managers.bots.commands(peerId).then((commands) => {
      if(!middleware()) {
        return
      }

      const filtered = processPeerFullForCommands(peerId, { bot_info: { user_id: peerId, commands } }, query)
      this.render(filtered, middleware)
    }).catch(() => {})

    return true
  }
}
