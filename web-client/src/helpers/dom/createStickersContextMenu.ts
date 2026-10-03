// Порт tweb `src/helpers/dom/createStickersContextMenu.ts` (812502980, 212 строк) — меню по ПКМ
// (долгому нажатию) на стикере, GIF и эмодзи эмодзи-дропдауна (`emoticonsDropdown/tab.ts`
// `attachHelpers`).
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ
//  1. Пунктов статуса нет: «Поставить статусом» (`SetAsEmojiStatus`) и статус на срок
//     (`canHaveEmojiTimer`, `SetEmojiStatusUntil*`) ставят документ своего эмодзи статусом, а
//     статус у нас — юникод без срока (`PUT /me/emoji_status`, `profileManager.setEmojiStatus`).
//  2. «Отправить с подписью» GIF (`showNewMediaPopup(..., doc)`), «Без звука» и «По расписанию»
//     (`sendDocId({silent})`, `scheduleSending`) — нет: попап вложений принимает только файлы
//     (мост `popups/newMedia.ts`), отправка документа строки ввода — без `silent`, меню
//     отправки и расписание — Б-32 (П-6, «отправка»).
//  3. «В избранном ли» (`verifyFavoriteSticker`) — запросом `stickers.faved()`/`savedGifs()`, а
//     не кэшем менеджера (`acknowledged...getFavedStickersStickers().cached`); изменение избранного
//     объявляется тут же событием `sticker_updated`/`gifs_updated` (у tweb — менеджером).
//  4. «Убрать из недавних» стикер — без ручки (`messages.saveRecentSticker(unsave)` у бэкенда
//     нет), пункт только у недавних эмодзи (`appEmojiManager.deleteRecentEmoji`).
//  5. Документ берётся `managers.docs.getDoc`; у GIF из поиска Tenor документа нет — меню не
//     открывается (у tweb каждый GIF — документ инлайн-бота).
import type { MyDocument } from '@core/media/messageMedia'
import { startClient } from '@/client/bootstrap'
import rootScope from '@lib/rootScope'
import appEmojiManager from '@lib/appManagers/appEmojiManager'
import createContextMenu from '@helpers/dom/createContextMenu'
import findUpClassName from '@helpers/dom/findUpClassName'
import type { ButtonMenuItemOptionsVerifiable } from '@components/buttonMenu'
import type ChatInput from '@components/chat/input'
import { copyTextToClipboard } from '@helpers/clipboard'
import { getEmojiFromElement } from '@components/emoticonsDropdown/tabs/emoji'
import showStickersPopup from '@components/popups/stickers.bridge'

export default function createStickersContextMenu({
  listenTo,
  chatInput,
  isPack,
  verifyRecent,
  appendTo,
  isEmojis,
  isGif,
  canViewPack,
  onContextMenu,
  onOpen,
  onClose,
}: {
  listenTo: HTMLElement
  chatInput?: ChatInput
  isPack?: boolean
  verifyRecent?: (target: HTMLElement) => boolean
  appendTo?: HTMLElement
  isEmojis?: boolean
  isGif?: boolean
  canViewPack?: boolean
  onContextMenu?: (event: MouseEvent | TouchEvent) => {
    cleanup: () => void
    onMenuOpen?: (menu: HTMLElement) => void
  } | void
  onOpen?: () => unknown
  onClose?: () => unknown
}) {
  const managers = () => startClient().managers
  let target: HTMLElement | null = null, doc: MyDocument | undefined
  let contextMenuAddon: {
    cleanup: () => void
    onMenuOpen?: (menu: HTMLElement) => void
  } | undefined
  const verifyFavoriteSticker = async(toAdd: boolean) => {
    if(!doc) return false
    const favedStickers = await (isGif ? managers().stickers.savedGifs() : managers().stickers.faved())
    const found = favedStickers.some((_doc) => _doc.id === doc!.id)
    return toAdd ? !found : found
  }

  const toggleFaved = async(faved: boolean) => {
    const document = doc!
    if(isGif) {
      await (faved ? managers().stickers.saveGif(document.id) : managers().stickers.deleteGif(document.id))
      rootScope.dispatchEvent('gifs_updated', await managers().stickers.savedGifs())
      return
    }

    await (faved ? managers().stickers.fave(document.id) : managers().stickers.unfave(document.id))
    rootScope.dispatchEvent('sticker_updated', { type: 'faved', document, faved })
  }

  const buttons: ButtonMenuItemOptionsVerifiable[] = isEmojis ? [{
    icon: 'copy',
    text: 'Copy',
    onClick: () => {
      if(doc) {
        void copyTextToClipboard(doc.stickerEmojiRaw || '')
      } else {
        void copyTextToClipboard(getEmojiFromElement(target!)?.emoji || '')
      }
    },
  }, {
    icon: 'stickers_face',
    text: 'ViewPackPreview',
    onClick: () => {
      const input = doc!.stickerSetInput!
      showStickersPopup({ id: input.id }, true, chatInput)
    },
    verify: () => !!(canViewPack && doc?.stickerSetInput),
  }, {
    icon: 'delete',
    text: 'DeleteFromRecent',
    onClick: () => {
      const emoji = getEmojiFromElement(target!)
      if(emoji) appEmojiManager.deleteRecentEmoji(emoji)
    },
    verify: () => (target && verifyRecent?.(target)) ?? false,
  }] : [{
    icon: 'stickers',
    text: 'Context.ViewStickerSet',
    onClick: () => showStickersPopup({ id: doc!.stickerSetInput!.id }, false, chatInput),
    verify: () => !isPack && !isGif && !!doc?.stickerSetInput,
  }, {
    icon: isGif ? 'gifs' : 'favourites',
    text: isGif ? 'SaveToGIFs' : 'AddToFavorites',
    onClick: () => void toggleFaved(true),
    verify: () => verifyFavoriteSticker(true),
  }, {
    icon: isGif ? 'crossgif' : 'crossstar',
    text: isGif ? 'Message.Context.RemoveGif' : 'DeleteFromFavorites',
    onClick: () => void toggleFaved(false),
    verify: () => verifyFavoriteSticker(false),
  }]

  return createContextMenu({
    listenTo,
    appendTo,
    findElement: (e) => {
      contextMenuAddon?.cleanup()
      contextMenuAddon = onContextMenu?.(e) || undefined
      target = e.target as HTMLElement
      if(isEmojis) {
        const superEmoji = findUpClassName(target, 'super-emoji')
        if(superEmoji) {
          target = superEmoji.firstElementChild as HTMLElement
        } else {
          target = findUpClassName(target, 'emoji') || findUpClassName(target, 'custom-emoji')
        }
      } else if(isGif) {
        target = findUpClassName(e.target as HTMLElement, 'gif')
      } else {
        target = findUpClassName(e.target as HTMLElement, 'media-sticker-wrapper')
      }

      return target
    },
    onOpen: async() => {
      const docId = Number(target?.dataset.docId)
      doc = Number.isFinite(docId) && docId ? await managers().docs.getDoc(docId) : undefined
      return onOpen?.()
    },
    onClose: () => {
      contextMenuAddon?.cleanup()
      contextMenuAddon = undefined
      onClose?.()
    },
    onOpenAfter: (element) => {
      contextMenuAddon?.onMenuOpen?.(element)
    },
    buttons,
  })
}
