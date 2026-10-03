// Порт tweb `src/lib/internalLink.ts` (812502980) в объёме типов, у которых есть
// предмет на нашем бэкенде (план волны 7, задача 5-4). Остальные типы оригинала —
// строками бэклога плана `2026-10-02-wave-7-carcass-first.md` (Б-75…Б-79): их
// обработчикам нечего звать.
//
// Поле `stack` ссылок (`ChatSetPeerOptions['stack']`, «вернуться к сообщению, из
// которого перешли») не портировано: стека возврата у нашего `setPeer` нет —
// `getStackFromElement` блока E (задача 5-7).

// * https://core.telegram.org/api/links

export enum INTERNAL_LINK_TYPE {
  MESSAGE,
  PRIVATE_POST,
  STICKER_SET,
  JOIN_CHAT,
  EMOJI_SET,
  WEB_APP,
  ADD_LIST,
}

export type InternalLink =
  InternalLink.InternalLinkMessage |
  InternalLink.InternalLinkPrivatePost |
  InternalLink.InternalLinkStickerSet |
  InternalLink.InternalLinkJoinChat |
  InternalLink.InternalLinkEmojiSet |
  InternalLink.InternalLinkWebApp |
  InternalLink.InternalLinkAddList

export namespace InternalLink {
  export interface InternalLinkMessage {
    _: INTERNAL_LINK_TYPE.MESSAGE,
    domain: string,
    post?: string,
    comment?: string,
    thread?: string,
    start?: string,
    startgroup?: string,
    startchannel?: string,
  }

  export interface InternalLinkPrivatePost {
    _: INTERNAL_LINK_TYPE.PRIVATE_POST,
    channel: string,
    post: string,
    thread?: string,
    comment?: string,
  }

  export interface InternalLinkStickerSet {
    _: INTERNAL_LINK_TYPE.STICKER_SET,
    set: string
  }

  export interface InternalLinkJoinChat {
    _: INTERNAL_LINK_TYPE.JOIN_CHAT,
    invite: string
  }

  export interface InternalLinkEmojiSet {
    _: INTERNAL_LINK_TYPE.EMOJI_SET,
    set: string
  }

  export interface InternalLinkWebApp {
    _: INTERNAL_LINK_TYPE.WEB_APP,
    domain: string,
    appname?: string,
    startapp?: string,
    masked?: boolean,
  }

  export interface InternalLinkAddList {
    _: INTERNAL_LINK_TYPE.ADD_LIST,
    slug: string
  }
}

export type InternalLinkTypeMap = {
  [INTERNAL_LINK_TYPE.MESSAGE]: InternalLink.InternalLinkMessage,
  [INTERNAL_LINK_TYPE.PRIVATE_POST]: InternalLink.InternalLinkPrivatePost,
  [INTERNAL_LINK_TYPE.STICKER_SET]: InternalLink.InternalLinkStickerSet,
  [INTERNAL_LINK_TYPE.JOIN_CHAT]: InternalLink.InternalLinkJoinChat,
  [INTERNAL_LINK_TYPE.EMOJI_SET]: InternalLink.InternalLinkEmojiSet,
  [INTERNAL_LINK_TYPE.WEB_APP]: InternalLink.InternalLinkWebApp,
  [INTERNAL_LINK_TYPE.ADD_LIST]: InternalLink.InternalLinkAddList,
}
