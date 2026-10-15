// Порт tweb `src/components/chat/commandsHelper.ts` (812502980) — подсказка
// команд бота по `/` в начале строки ввода; выбор сразу отправляет команду.
// Пачка П-6, Б-34; Ф-6 f6-bots.
//
// Команды читаются из ПОЛНОЙ карточки пира, как у оригинала (`:47-63`):
// `userFull.bot_info` у бота, `channelFull.bot_info` у группы; в группе у команды
// стоит суффикс `@username` бота (`:24-29`). Кадр `updateBotCommands` правит
// закэшированную карточку (`chatFullCache.applyBotCommands`), поэтому каждый
// запрос видит свежий список без повторного похода в сеть.
//
// Расхождения с оригиналом:
//  1. Команда ставится в поле текстом (`textContent`), а не `innerHTML` узла
//     имени: правило «не строить DOM из строки» (`web-client/CLAUDE.md`); имя
//     команды — латиница без разметки, значение то же.
//  2. Эфемерных команд (`ephemeralReceiverId`) у бэкенда нет.
import type { Managers } from '@/client/bootstrap'
import { cachedUser, isAnyGroupPeer } from '@core/peerCache'
import { isAnyChat, isUser } from '@core/peers/peerId'
import { isBot as isBotPeer } from '@core/peers/predicates'
import { getProfileByPeerId } from '@/stores/fullPeers.solid'
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
        const targetElement = target as HTMLElement
        const botPeerId = +targetElement.dataset.peerId!
        let name = target.querySelector(`.${AutocompletePeerHelper.BASE_CLASS_LIST_ELEMENT}-name`)!.textContent!
        if(isAnyChat(chatInput.chat.peerId)) {
          const bot = cachedUser(botPeerId)
          const username = bot?._ === 'user' ? bot.username : undefined
          if(username) {
            name += '@' + username
          }
        }

        hideCommandAutocomplete(controller)
        return chatInput.getReadyToSend(() => {
          chatInput.messageInput.textContent = name
          void chatInput.sendMessage(true)
        })
      },
      'Chat.BotCommands',
      managers,
    )
  }

  public async checkQuery(query: string, peerId: PeerId) {
    const isBot = isUser(peerId) && isBotPeer(cachedUser(peerId))
    if(!isBot && !isAnyGroupPeer(peerId)) {
      return false
    }

    const middleware = this.controller!.getMiddleware()
    void getProfileByPeerId(this.managers, peerId).then((full) => {
      if(!middleware() || !full) {
        return
      }

      const filtered = processPeerFullForCommands(peerId, full, query)
      this.render(filtered, middleware)
    }).catch(() => {})

    return true
  }
}
