// Порт tweb `src/components/chat/processPeerFullForCommands.ts` (812502980) —
// команды ботов из карточки пира (`bot_info`), с поиском по `/запросу`.
// Пачка П-6, Б-34; Ф-6 f6-bots: на входе настоящая полная карточка
// (`userFull.bot_info` — одна запись, `channelFull.bot_info` — вектор).
//
// Расхождение: флага `pFlags.ephemeral` у команд нет (эфемерных команд у
// бэкенда нет) — поле `ephemeral` не заводится.
import SearchIndex from '@lib/searchIndex'
import type { BotInfo, ChatFull, UserFull } from '@core/peers/peer'
import { toPeerId } from '@core/peers/peerId'

export default function processPeerFullForCommands(
  peerId: PeerId,
  full: ChatFull | UserFull,
  query?: string,
) {
  const botInfo = 'bot_info' in full ? full.bot_info : undefined
  const botInfos: BotInfo[] = botInfo ?
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
