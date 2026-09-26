// Порт tweb `src/lib/appManagers/utils/bots/canReportBot.ts` (2488f2cf0):
// «Пожаловаться» в личке есть только у бота.
//
// Две проверки оригинала не переносятся — предмета нет:
//  • `!user.pFlags.support` — флага `support` в нашем `User` нет
//    (`core/peers/peer.ts`, UserReal: схемные флаги без предмета не объявлены);
//  • `peerId !== VERIFICATION_CODES_BOT_ID` (489000, бот кодов подтверждения
//    Telegram) — такого пользователя у нашего бэкенда нет.
import type { User } from './peer'

export default function canReportBot(user: User | undefined): boolean {
  return user?._ === 'user' && !!user.pFlags?.bot
}
