// Хук потребления факта «URL медиа» (Task 7, стадия C медиа-суперпорта).
//
// Синхронно читает зеркало (core/mediaCache.ts::cachedMediaUrl) прямо на
// рендере: повторный маунт того же id рисует картинку БЕЗ сети и БЕЗ мигания —
// это то, ради чего когда-то появился синхронный токен-URL (джиттер ленты не
// возвращаем). Промах зеркала → RPC downloadMediaURL к владельцу (воркеру):
// свежескачанный URL приезжает и кадром rt:media_url (проектор → зеркало →
// подписчики), и ответом самого RPC; URL, уже имевшийся у воркера, — ТОЛЬКО
// ответом RPC (SuperMessagePort кадры не буферизует — «попадание в контекст
// кадра не порождает», см. mediaManager.downloadMediaURL), поэтому ответ тоже
// применяется к зеркалу (норма «владелец отвечает на объявленный пробел
// всегда», web-client/CLAUDE.md; allow-list — core/noDuplicateMediaUrl.test.ts).
// Подписка — useSyncExternalStore по образцу useMediaTokenVersion
// (core/mediaUrl.ts), но снимок здесь per-ключ: глобальный notify зеркала не
// перерисовывает компоненты, чей URL не менялся.
import { useEffect, useSyncExternalStore } from 'react'
import { applyMediaUrl, cachedMediaUrl, subscribeMediaUrlMirror } from '../mediaCache'
import { useManagers } from './useManagers'
import { useMiddlewareHelper } from './useMiddlewareHelper'

export function useMediaUrl(id: number | null, opts?: { thumb?: boolean }): string {
  const thumb = !!opts?.thumb
  const managers = useManagers()
  const middlewareHelper = useMiddlewareHelper()
  const url = useSyncExternalStore(
    subscribeMediaUrlMirror,
    () => (id != null ? cachedMediaUrl(id, thumb) ?? '' : ''),
  )
  useEffect(() => {
    if (id == null || cachedMediaUrl(id, thumb) !== undefined) return
    // Протухание по смене сущности — дочерний scope на прогон эффекта, .get()
    // в момент запуска (норма «Асинхронщина и актуальность», web-client/CLAUDE.md):
    // поздний ответ старого id зеркало не трогает.
    const scope = middlewareHelper.get().create()
    const middleware = scope.get()
    managers.media.downloadMediaURL(id, { thumb })
      .then((u) => {
        if (!middleware()) return
        applyMediaUrl({ id, thumb, url: u })
      })
      // 404 превью (thumb ещё не сгенерирован) или сеть — остаёмся на подложке
      // ('' наружу); следующий маунт объявит пробел заново.
      .catch(() => {})
    return () => { scope.destroy() }
  }, [id, thumb, managers, middlewareHelper])
  return url
}
