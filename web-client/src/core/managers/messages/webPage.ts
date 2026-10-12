// src/core/managers/messages/webPage.ts
//
// ПРЕВЬЮ ССЫЛКИ В ОТПРАВКЕ И ПРАВКЕ — порт параметров tweb `sendText`
// (`appMessagesManager.ts:2583-2600`: `noWebPage`, `webPage`, `webPageOptions`,
// `invertMedia`) и двух его помощников: `getInputMediaWebPage` (:4866-4880) и
// `generateOutgoingWebPage` (:4882-4910). Решение принимает композер
// (`components/chat/input.ts`, плашка над полем, tweb input.ts:3533-3631),
// а сюда оно приходит готовым — одинаково для текста по WS, поста канала по
// REST и правки (`editMessage` :2207-2220).
//
// Провод — плоские поля TL `messages.sendMessage`/`sendMedia`/`editMessage`
// (раздел P1 «Провод Б-72» контракта Ф-5): `no_webpage`, `invert_media`,
// `media: inputMediaWebPage`.
import type { MessageMediaWebPage, WebPage } from '../../media/messageMedia'
import type { InputMedia } from '@layer'

export type InputMediaWebPage = InputMedia.inputMediaWebPage

/** tweb `sendText` :2595-2599 */
export type WebPageOptions = Partial<{
  largeMedia: boolean
  smallMedia: boolean
  optional: boolean
}>

/** Параметры превью отправки/правки — имена 1:1 с tweb `sendText` (:2590-2599). */
export interface WebPageSendOptions {
  /** крестик плашки (tweb input.ts:4139) → `no_webpage` */
  noWebPage?: boolean
  /** карточка плашки — превью ЭТОЙ ссылки (`inputMediaWebPage.url`) */
  webPage?: WebPage | null
  webPageOptions?: WebPageOptions
  /** «выше сообщения» — флаг сообщения `invert_media` */
  invertMedia?: boolean
}

/** Порт tweb `getInputMediaWebPage` (:4866-4880). */
export function getInputMediaWebPage(options: WebPageSendOptions): InputMediaWebPage | undefined {
  if(!options.webPage) {
    return
  }

  const webPageOptions = options.webPageOptions ?? {}
  return {
    _: 'inputMediaWebPage',
    url: options.webPage.url,
    pFlags: {
      force_large_media: webPageOptions.largeMedia || undefined,
      force_small_media: webPageOptions.smallMedia || undefined,
      optional: webPageOptions.optional || undefined,
    },
  }
}

/** Порт вложения бабла из tweb `generateOutgoingWebPage` (:4893-4900): у
 *  временного сообщения карточка плашки стоит сразу, до эха сервера. */
export function generateOutgoingWebPageMedia(options: WebPageSendOptions): MessageMediaWebPage | undefined {
  if(!options.webPage) {
    return
  }

  const webPageOptions = options.webPageOptions ?? {}
  return {
    _: 'messageMediaWebPage',
    pFlags: {
      force_large_media: webPageOptions.largeMedia || undefined,
      force_small_media: webPageOptions.smallMedia || undefined,
    },
    webpage: options.webPage,
  }
}

/** Проводные поля превью ОТПРАВКИ: tweb `generateOutgoingWebPage`
 *  (:4890-4909) — `{media}` при карточке, иначе `{no_webpage}` — плюс
 *  `invert_media` из `commonOptions` (:2746). Ложные флаги не кладутся (TL
 *  true-флаг: отсутствие = false). */
export function sendWebPageWireFields(options: WebPageSendOptions): WebPageWireFields {
  const media = getInputMediaWebPage(options)
  const fields: WebPageWireFields = media ? { media } : {}
  if(!media && options.noWebPage) fields.no_webpage = true
  if(options.invertMedia) fields.invert_media = true
  return fields
}

/** Проводные поля превью ПРАВКИ — tweb `editMessage` (:2216-2220): оба
 *  флага как есть и `media`, когда есть карточка. */
export function editWebPageWireFields(options: WebPageSendOptions): WebPageWireFields {
  const media = getInputMediaWebPage(options)
  const fields: WebPageWireFields = media ? { media } : {}
  if(options.noWebPage) fields.no_webpage = true
  if(options.invertMedia) fields.invert_media = true
  return fields
}

export interface WebPageWireFields {
  no_webpage?: true
  invert_media?: true
  media?: InputMediaWebPage
}
