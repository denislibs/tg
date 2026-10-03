// Порт tweb `src/components/chat/processPeerFullForCommands.ts` (812502980) —
// команды ботов из карточки пира (`bot_info`), с поиском по `/запросу`.
// Пачка П-6, Б-34.
//
// Расхождение: на вход — `bot_info` в нашей форме (`BotInfoForCommands`): у
// бэкенда нет `userFull.bot_info`/`chatFull.bot_info`, команды бота отдаёт ручка
// `GET /bots/{id}/commands` (`bots.commands`), из неё карточку и собирает
// `CommandsHelper`. Флага `pFlags.ephemeral` у команд нет (эфемерных команд у
// бэкенда нет) — поле `ephemeral` не заводится.
import SearchIndex from '@lib/searchIndex'
import type { BotCommand } from '@core/managers/botsManager'
import { toPeerId } from '@core/peers/peerId'

export type BotInfoForCommands = { user_id?: UserId, commands?: BotCommand[] }

export default function processPeerFullForCommands(
  peerId: PeerId,
  full: { bot_info?: BotInfoForCommands | BotInfoForCommands[] },
  query?: string,
) {
  const botInfo = 'bot_info' in full ? full.bot_info : undefined
  const botInfos: BotInfoForCommands[] = botInfo ?
    (Array.isArray(botInfo) ? botInfo : [botInfo]) :
    []
  let index: SearchIndex<number> | undefined

  if(query !== undefined) {
    index = new SearchIndex<number>({
      ignoreCase: true,
    })
  }

  type T = {
    peerId: PeerId,
    name: string,
    description: string,
    index: number,
    command: string,
  }
  const commands: T[] = []
  botInfos.forEach((botInfo) => {
    if(!botInfo.commands) {
      return
    }

    botInfo.commands.forEach(({ command, description }) => {
      const c = '/' + command
      const commandIndex = commands.length
      commands.push({
        peerId: botInfo.user_id ? toPeerId(+botInfo.user_id, false) : peerId,
        command: command,
        name: c,
        description: description,
        index: commandIndex,
      })

      if(index) {
        index.indexObject(commandIndex, c)
      }
    })
  })

  let out: T[]
  if(!index) {
    out = commands
  } else {
    const found = index.search(query!)
    out = Array.from(found).map((commandIndex) => commands[commandIndex])
  }

  out = out.sort((a, b) => a.index - b.index)

  return out
}
