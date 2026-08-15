// src/core/hooks/useReactions.ts
// ViewModel-хук каталога доступных реакций (Telegram messages.getAvailableReactions,
// GET /reactions через reactionsManager). Каталог публичный и одинаковый для всех —
// как animated_emoji (core/animatedEmoji.ts), грузится один раз на сессию и кэшируется
// на уровне модуля: список синхронный (нужен рендеру чипа реакции — следующая задача),
// каждый новый вызывающий переиспользует уже прилетевший ответ вместо повторного похода
// в сеть. До первого ответа отдаёт пустой массив — вызывающая сторона держит свой
// фолбэк (core/reactions.ts: REACTIONS/QUICK_REACTION) на первый кадр.
import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import type { AvailableReaction } from '../managers/reactionsManager'

let cache: AvailableReaction[] | null = null
let inflight: Promise<AvailableReaction[]> | null = null

export function useReactions(): AvailableReaction[] {
  const managers = useManagers()
  const [list, setList] = useState<AvailableReaction[]>(cache ?? [])

  useEffect(() => {
    if (cache) return
    if (!inflight) {
      inflight = managers.reactions.list().then(
        (r) => { cache = r; return r },
        // Каталог недоступен (сид не накатан/сеть) — живём с пустым списком,
        // вызывающая сторона падает на свой фолбэк; cache не трогаем и обнуляем
        // inflight, чтобы следующий монт хука попробовал сходить в сеть снова,
        // а не застрял навсегда на одном неудачном ответе.
        () => { inflight = null; return [] },
      )
    }
    let alive = true
    void inflight.then((r) => { if (alive) setList(r) })
    return () => { alive = false }
  }, [managers])

  return list
}
