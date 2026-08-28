// ЕДИНСТВЕННАЯ точка входа императивного кода за URL медиа (картинки и их
// превью). Ванильный аналог `core/hooks/useMediaUrl.ts`, без React.
//
// Аналог в tweb — `appDownloadManager.downloadMediaURL` (его зовёт `wrapPhoto`
// в `getDownloadPromise`): один модуль, который знает про кэш-контекст, ходит к
// владельцу и раздаёт всем врапперам один и тот же промис. Здесь роль
// кэш-контекста играет зеркало `core/mediaCache.ts`.
//
// ── Почему это обязано быть ОДНО место ──────────────────────────────────────
// Владелец факта — воркер (`core/managers/mediaManager.ts::downloadMediaURL`).
// Он объявляет URL кадром `rt:media_url` ТОЛЬКО в момент СОЗДАНИЯ URL, а
// `SuperMessagePort` кадры не буферизует. Значит URL, который у воркера уже
// был, до вкладки доезжает исключительно ответом RPC — и применить его к
// зеркалу обязан получатель ответа, иначе остальные потребители того же id
// факта не увидят никогда (норма «владелец отвечает на объявленный пробел
// всегда», web-client/CLAUDE.md). Развесить `applyMediaUrl` по каждому
// врапперу — это N независимых писателей одного факта; вместо этого писатель
// один, а пин `core/noDuplicateMediaUrl.test.ts` держит их список.
//
// ── Что здесь есть сверх хука (и почему это не отсебятина) ──────────────────
//  • Склейка одновременных запросов одного ключа (`inflight`). Лента открывает
//    десятки баблов разом, альбом — до десяти картинок одного сообщения;
//    без склейки каждый бабл шлёт свой RPC за тем же id. В tweb ровно это же
//    делает `appDownloadManager` (общий кэш промисов по имени файла).
//  • Гонка «кадр против ответа»: RPC ещё летит, а `rt:media_url` от НАШЕГО же
//    запроса уже применён проектором. Подписка на зеркало отдаёт URL сразу, не
//    дожидаясь ответа — на холодном старте это целый round-trip раньше.
import makeError from '@helpers/makeError'
import type { Middleware } from '@helpers/middleware'
import { applyMediaUrl, cachedMediaUrl, subscribeMediaUrlMirror } from '../mediaCache'
import { startClient } from '../../client/bootstrap'

const MIDDLEWARE_ERROR = makeError('MIDDLEWARE')

const inflight = new Map<string, Promise<string>>()
const inflightKey = (id: number, thumb: boolean) => `${id}${thumb ? '_thumb' : ''}`

// Запрос к владельцу со склейкой по ключу. Ответ применяется к зеркалу
// БЕЗУСЛОВНО — это снимок владельца, а не вывод вызывающего: то, что конкретный
// бабл успел умереть, не делает URL неверным, а следующий потребитель того же
// id получит его синхронно вместо второго round-trip'а.
function requestFromOwner(id: number, thumb: boolean): Promise<string> {
  const key = inflightKey(id, thumb)
  const existing = inflight.get(key)
  if (existing) return existing

  const promise = startClient().managers.media.downloadMediaURL(id, { thumb })
    .then((url) => {
      applyMediaUrl({ id, thumb, url })
      return url
    })

  const forget = () => { if (inflight.get(key) === promise) inflight.delete(key) }
  void promise.then(forget, forget)
  inflight.set(key, promise)
  return promise
}

/**
 * Отдать URL медиа: синхронное попадание в зеркало → без сети; промах → RPC к
 * владельцу с применением ответа к зеркалу.
 *
 * Отклоняется `{type:'MIDDLEWARE'}`, если зона актуальности вызывающего умерла
 * до доставки, и ошибкой RPC, если владелец не отдал URL (404 ещё не
 * сгенерированного превью, сеть) — вызывающий на этом вешает manual-кольцо
 * прелоадера, как `wrapPhoto` в tweb.
 */
export function ensureMediaUrl(id: number, opts?: { thumb?: boolean, middleware?: Middleware }): Promise<string> {
  const thumb = !!opts?.thumb
  const middleware = opts?.middleware

  if (middleware && !middleware()) return Promise.reject(MIDDLEWARE_ERROR)

  const cached = cachedMediaUrl(id, thumb)
  if (cached !== undefined) return Promise.resolve(cached)

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      unsubscribe()
      fn()
    }

    // Подписка ставится ДО запроса: кадр `rt:media_url` от этого же запроса
    // может приземлиться в зеркало раньше, чем вернётся RPC-ответ.
    const unsubscribe = subscribeMediaUrlMirror(() => {
      const url = cachedMediaUrl(id, thumb)
      if (url !== undefined) finish(() => resolve(url))
    })

    middleware?.onClean(() => { finish(() => reject(MIDDLEWARE_ERROR)) })

    requestFromOwner(id, thumb).then(
      (url) => { finish(() => resolve(url)) },
      (err: unknown) => { finish(() => reject(err)) },
    )
  })
}
