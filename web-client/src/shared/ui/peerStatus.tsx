/**
 * ПОДПИСЬ ПРИСУТСТВИЯ В REACT-ДЕРЕВЕ — живым узлом ядра.
 *
 * Тонкая обёртка над `core/presence` (порт tweb
 * `wrappers/getUserStatusString.ts`) и `DomNode`, ровно как обёртки дат в
 * `shared/ui/dateNodes`. Добавляет она одно: `useMemo` по ДАННЫМ статуса.
 *
 * Мемо здесь не оптимизация, а условие работы. Узел `i18n(key, args)` записан в
 * `I18n.weakMap` и обновляет СЕБЯ САМ — на смену языка его переписывает ядро
 * (`applyLangPack` обходит `.i18n`). Пересоздавать его на каждом рендере значит
 * терять всё, что ядро на него навесило, и делать бессмысленной саму живость.
 *
 * Карточка пира едет вместе со статусом: подпись служебного аккаунта, бота и
 * поддержки решается ПО ПИРУ (`getUserStatusString`, ветки :15-37 оригинала),
 * а не по присутствию. Экран, который присутствие держит отдельно
 * (`chatsStore.presence`), передаёт его `status`-ом; без него берётся
 * `user.status`.
 *
 * Зависимости — конструктор статуса и `was_online`, а НЕ объект `status`:
 * зеркало пиров отдаёт новый объект на каждое обновление присутствия, и мемо по
 * ссылке пересобирало бы узел там, где подпись не менялась. Тот же разбор — у
 * `dateNodes` и в `TopicsPanel`/`SharedMedia`.
 *
 * ── Про «был(а) в сети 5 минут назад» ──────────────────────────────────────
 * Эта ветка ЗАВИСИТ ОТ ТЕКУЩЕГО ВРЕМЕНИ, и узел сам себя по таймеру не
 * пересчитывает — как и у оригинала: tweb пересобирает подпись, когда приходит
 * `updateUserStatus`, а не по тику. Поэтому отдельного таймера здесь нет
 * намеренно: он был бы нашей добавкой поверх порта.
 */
import { useMemo } from 'react'

import { getUserStatusString } from '@core/presence'
import type { User, UserStatus } from '@core/peers/peer'
import { userStatusWasOnline } from '@core/peers/peer'

import DomNode from './DomNode'

export function PeerStatus({ user, status = user?._ === 'user' ? user.status : undefined, className }: {
  user: User | undefined
  status?: UserStatus
  className?: string
}) {
  const kind = status?._
  const wasOnline = userStatusWasOnline(status)
  const real = user?._ === 'user' ? user : undefined
  const peerId = real?.id
  const bot = !!real?.pFlags?.bot
  const support = !!real?.pFlags?.support
  // eslint-disable-next-line react-hooks/exhaustive-deps -- зависимости ДАННЫЕ, см. докблок
  const node = useMemo(() => getUserStatusString(user, status), [peerId, bot, support, kind, wasOnline])
  return <DomNode node={node} className={className} />
}
