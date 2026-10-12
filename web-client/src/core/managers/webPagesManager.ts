// Порт tweb `src/lib/appManagers/appWebPagesManager.ts` (812502980) — в объёме
// плашки превью над полем ввода: `getWebPage(url)` (:273-284), его зовёт
// `ChatInput.processWebPage` (tweb components/chat/input.ts:3594).
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ
//  1. Реестра карточек `webpages[id]` и ожидающих сообщений `pendingWebPages`
//     (:27-33, :66-196) нет: у нашей карточки нет `id` (снимок на сообщении,
//     `backend/internal/domain/mtwebpage.go`, докблок `WebPage`). В id-кэше все
//     карточки слиплись бы в слот `undefined`, и `safeReplaceObject` перерисовал
//     бы чужие. Догоняет карточку сообщения свой кадр `updateMessageWebPage`
//     (`messages.cacheWebPage`) — вместо `updateWebPage`/`webpage_updated`.
//  2. `invokeApiHashable` (:274) без хэша: сервер хэша не отдаёт, поэтому у
//     оригинала от него остаётся только склейка одинаковых запросов в полёте
//     (`invokeApiSingleProcess`, apiManagerMethods.ts:153-173) — она и
//     перенесена. Кэш ответов держит сервер (10 минут по URL).
//  3. Отказ ручки (429 — лимит частоты 1/с со всплеском 10, сеть) отвечает
//     `null`, а не reject: у tweb промис `getWebPage` в `processWebPage` без
//     `catch` — `then` не выполняется вовсе (плашка остаётся какой была,
//     `getWebPagePromise` не сбрасывается), а у нас отказ из воркера стал бы
//     необработанным reject во вкладке. `processWebPage` на `null` выходит
//     ровно так же — без снятия плашки и без `no_webpage`.
//  4. `getWebPagePreview` (:220-271, `messages.getWebPagePreview`) не
//     портирован: композер tweb зовёт `getWebPage`, а `getWebPagePreview`
//     зовёт только вложение-ссылка опроса (`popups/createPoll/mediaAttachment.tsx:242`)
//     — его у нас нет.
import type { RestClient } from '../net/restClient'
import { saveWebPage, type WebPage } from '../media/messageMedia'

/** webPageEmpty#211a1788 flags:# id:long url:flags.0?string = WebPage; */
interface WebPageEmpty { _: 'webPageEmpty'; url?: string }

/** messages.webPage#fd5e12bd webpage:WebPage chats:Vector<Chat> users:Vector<User> */
interface MessagesWebPage { _: 'messages.webPage'; webpage: WebPage | WebPageEmpty }

export function newWebPagesManager({ rest }: { rest: Pick<RestClient, 'get'> }) {
  const inFlight = new Map<string, Promise<WebPage | undefined | null>>()

  return {
    /** tweb :273-284. Ответ — карточка либо `undefined` («карточки нет»:
     *  `webPageEmpty`, у оригинала `saveWebPage` его без ожидающего не
     *  возвращает, :76-77); `null` — отказ ручки (расхождение 3). Пиров карточка не
     *  упоминает, `saveApiPeers` (:277) сохранять нечего — векторы пусты. */
    getWebPage(url: string): Promise<WebPage | undefined | null> {
      let promise = inFlight.get(url)
      if (promise) return promise

      promise = rest.get<MessagesWebPage>('/webpage', { url }).then((messagesWebPage) => {
        const webPage = messagesWebPage?.webpage
        return webPage?._ === 'webPage' ? saveWebPage(webPage) : undefined
      }, () => null).finally(() => {
        inFlight.delete(url)
      })
      inFlight.set(url, promise)
      return promise
    },
  }
}

export type WebPagesManager = ReturnType<typeof newWebPagesManager>
