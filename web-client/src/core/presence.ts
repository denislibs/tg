// Подпись присутствия собеседника — порт tweb
// `components/wrappers/getUserStatusString.ts` в объёме ветки
// `switch(user.status?._)` (:39-89).
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
// Шапка файла при этом утверждала «подсистемы переводов у нас нет» — с задачи
// #109 она есть, и утверждение стало ложным раньше, чем код.
//
// ── Что не портировано (и почему) ──────────────────────────────────────────
// Оригинал принимает ПОЛЬЗОВАТЕЛЯ и до `switch` по статусу проходит ветки,
// которым нужен сам объект: `Peer.RepliesNotifications`/`Peer.ServiceNotifications`
// по id (:15-21), `Bot`/`BotUsers` по `pFlags.bot` (:23-32) и `SupportStatus`
// по `pFlags.support` (:34-37). Наши вызывающие передают ТОЛЬКО статус, поэтому
// бот сегодня подписан как обычный пользователь («был(а) давно»). Расхождение
// названо ЗАДАЧЕЙ #130; ключ `SupportStatus` заведён вместе с остальными, чтобы
// её не пришлось начинать со словаря.
import { i18n, type FormatterArguments } from '@lib/langPack'
import type { LangPackKey } from '@/lang'

import type { UserStatus } from './peers/peer'
import { userStatusWasOnline } from './peers/peer'
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
 * Подпись статуса — порт `switch(user.status?._)` (:39-89).
 *
 * Проверки `expires` здесь НЕТ намеренно: истёкший онлайн гасит владелец
 * статуса (`degradeExpiredPresence`, порт `updateUsersStatuses`), ровно как в
 * оригинале, — иначе срок годности читался бы в двух местах по-разному.
 */
export function userStatusLabel(status: UserStatus | undefined): HTMLElement {
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
