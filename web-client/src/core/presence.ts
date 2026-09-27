// Подпись присутствия собеседника — порт tweb
// `components/wrappers/getUserStatusString.ts` целиком (`getUserStatusString`
// ниже).
//
// ── Что здесь было до задачи #126 ───────────────────────────────────────────
// Строки собирались РУКАМИ по тернарнику `lang === 'ru'`: пять пар для веток
// статуса и ещё четыре — для «был(а) в сети N назад». Отказов от этого два, и
// оба видел пользователь:
//
//  • веток было ДВЕ, а языков пять (плюс любой, приехавший с
//    `langpack.getLanguages`) — украинский, испанский, немецкий и французский
//    читали английскую ветку. И читали её в шапке КАЖДОГО чата;
//  • подпись была СТРОКОЙ и застывала в языке момента сборки: `applyLangPack`
//    переписывает только инстансы из `weakMap` (`lib/langPack.ts:568-572`).
//
// ── Что было до задачи «особые чаты» (бывшая #130) ─────────────────────────
// Функция называлась `userStatusLabel(status)` и принимала ТОЛЬКО статус, а
// оригинал принимает ПОЛЬЗОВАТЕЛЯ: до `switch` по статусу он проходит ветки по
// id (`Peer.ServiceNotifications`, :15-21), `pFlags.bot` (:23-32) и
// `pFlags.support` (:34-37). Без них служебный «Telegram» (777000) и боты
// подписывались как люди — «был(а) давно». Теперь ветки портированы.
//
// ── Два отступления, оба от формы наших данных ─────────────────────────────
//  • статус — ВТОРЫМ параметром (по умолчанию `user.status`): присутствие у нас
//    живёт отдельным зеркалом (`chatsStore.presence`, пишет `rt:presence`), а не
//    полем карточки, как `user.status` у оригинала. Экран, у которого живое
//    присутствие есть, передаёт его сюда; решение по веткам пира — всё равно по
//    карточке;
//  • `Peer.RepliesNotifications` (REPLIES_PEER_ID) и `BotUsers`
//    (`bot_active_users`) — предметов нет: служебного пира «Replies» у нас нет,
//    числа активных пользователей бота бэкенд не отдаёт. Ветка бота поэтому
//    всегда `Bot` — ровно так оригинал поступает при `bot_active_users ===
//    undefined` (:24-27).
import { i18n, type FormatterArguments } from '@lib/langPack'
import type { LangPackKey } from '@/lang'

import type { User, UserStatus } from './peers/peer'
import { userStatusWasOnline } from './peers/peer'
import { SERVICE_PEER_ID } from './peers/peerId'
import { formatFullSentTimeRaw } from '@helpers/date'

/**
 * «был(а) в сети …» для оффлайн-статуса — порт ветки `userStatusOffline`
 * (:55-78). Четыре исхода, и границы у них ровно оригинала: минута, час, те же
 * сутки, всё остальное.
 *
 * Последний исход собирается ДВУМЯ аргументами-узлами
 * (`formatFullSentTimeRaw`), а не склейкой: «был(а) в сети вчера в 14:30» —
 * это одна строка языка `Peer.Status.LastSeenAt` («last seen %@ at %@») с двумя
 * подстановками, и порядок частей в ней задаёт ПЕРЕВОД.
 *
 * Аргумент — СЕКУНДЫ эпохи (как `was_online` на проводе), а не миллисекунды:
 * прежняя сигнатура принимала миллисекунды, и каждый вызывающий домножал сам.
 */
export function lastSeenLabel(wasOnline: number): HTMLElement {
  const today = new Date()
  const now = today.getTime() / 1000 | 0
  const diff = now - wasOnline

  let key: LangPackKey
  let args: FormatterArguments | undefined

  if(diff < 60) {
    key = 'Peer.Status.justNow'
  } else if(diff < 3600) {
    key = 'Peer.Status.minAgo'
    args = [diff / 60 | 0]
  } else if(diff < 86400 && today.getDate() === new Date(wasOnline * 1000).getDate()) {
    key = 'LastSeen.HoursAgo'
    args = [diff / 3600 | 0]
  } else {
    key = 'Peer.Status.LastSeenAt'
    const { dateEl, timeEl } = formatFullSentTimeRaw(wasOnline)
    args = [dateEl, timeEl!]
  }

  return i18n(key, args)
}

/**
 * «У пира есть присутствие» — гейт оригинала вокруг typing и подсветки «в
 * сети» в шапке (tweb `appImManager.getUserStatus`, :3725
 * `!user.pFlags.bot && !user.pFlags.support`): боту и служебному аккаунту
 * показывают только подпись по пиру. Карточки нет — считаем человеком.
 */
export function userHasPresence(user: User | undefined): boolean {
  return !(user?._ === 'user' && (user.pFlags?.bot || user.pFlags?.support))
}

/**
 * Подпись пользователя под именем — порт `getUserStatusString` (:7-94).
 *
 * Порядок веток — оригинала: служебный аккаунт по id → бот → поддержка →
 * статус присутствия. Карточки нет (ещё не доехала) — сразу статус, как у
 * оригинала пустой `span` для `!user` заменён тем, что у нас есть: живое
 * присутствие из зеркала.
 *
 * Проверки `expires` здесь НЕТ намеренно: истёкший онлайн гасит владелец
 * статуса (`degradeExpiredPresence`, порт `updateUsersStatuses`), ровно как в
 * оригинале, — иначе срок годности читался бы в двух местах по-разному.
 */
export function getUserStatusString(
  user: User | undefined,
  status: UserStatus | undefined = user?._ === 'user' ? user.status : undefined,
): HTMLElement {
  if (user?._ === 'user') {
    if (user.id === SERVICE_PEER_ID) return i18n('Peer.ServiceNotifications') // :19-21
    if (user.pFlags?.bot) return i18n('Bot') // :23-27
    if (user.pFlags?.support) return i18n('SupportStatus') // :34-37
  }

  switch (status?._) {
    case 'userStatusOnline':
      return i18n('Online')
    case 'userStatusRecently':
      return i18n('Lately')
    case 'userStatusLastWeek':
      return i18n('WithinAWeek')
    case 'userStatusLastMonth':
      return i18n('WithinAMonth')
    case 'userStatusOffline':
      // НУЛЕВОЕ ВРЕМЯ — форма НАШЕГО провода, которой у оригинала нет.
      // `NewUserStatusOffline(time.Time{})` собирает `{was_online: 0}`
      // (`backend/internal/domain/mtpeer_test.go:257-260`) — так бэкенд говорит
      // «точного времени нет». В MTProto этого не бывает: скрытое правилом
      // приватности время приезжает ОТДЕЛЬНЫМ конструктором
      // (`userStatusRecently`), поэтому `getUserStatusString` про ноль не знает
      // и посчитал бы разницу от эпохи — «был(а) в сети 1 янв. 1970 в 03:00».
      // Здесь временная защита на клиенте: чинить это надо на проводе, чтобы
      // «времени нет» ехало своим конструктором, — ЗАДАЧА #131.
      return userStatusWasOnline(status) === 0
        ? i18n('Lately')
        : lastSeenLabel(userStatusWasOnline(status))
    default:
      return i18n('ALongTimeAgo')
  }
}

/**
 * Индекс присутствия для сортировки — порт `appUsersManager.getUserStatusForSort`
 * (`appUsersManager.ts:707-739`) в объёме ветки по статусу (карточку по id там
 * достаёт сам менеджер; у нас её даёт зеркало, `cachedUser`). Убывающий порядок
 * даёт «онлайн первыми»: у онлайна и оффлайна это срок/время последнего входа
 * (большие числа), у «недавно/на неделе/в месяце» — 3/2/1, у прочих — 0.
 * Потребитель — `components/sortedUserList.ts` (`getIndex`).
 */
export function getUserStatusForSort(status: UserStatus | undefined): number {
  if(status) {
    const expires = status._ === 'userStatusOnline' ? status.expires : (status._ === 'userStatusOffline' ? status.was_online : 0)
    if(expires) {
      return expires
    }

    switch(status._) {
      case 'userStatusRecently':
        return 3
      case 'userStatusLastWeek':
        return 2
      case 'userStatusLastMonth':
        return 1
    }
  }

  return 0
}
