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

import { userStatusLabel } from '@core/presence'
import type { UserStatus } from '@core/peers/peer'
import { userStatusWasOnline } from '@core/peers/peer'

import DomNode from './DomNode'

export function PeerStatus({ status, className }: {
  status: UserStatus | undefined
  className?: string
}) {
  const kind = status?._
  const wasOnline = userStatusWasOnline(status)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- зависимости ДАННЫЕ, см. докблок
  const node = useMemo(() => userStatusLabel(status), [kind, wasOnline])
  return <DomNode node={node} className={className} />
}
