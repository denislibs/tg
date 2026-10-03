// Порт tweb `src/lib/internalLinkProcessor.ts` (812502980, 1661 строка) — разбор и
// исполнение внутренних ссылок Telegram (`t.me/…` и наш хост `core/publicLink`,
// `tg://…`). Конструктор зовёт `appImManager.construct` (tweb `appImManager.ts:326`).
//
// Портированы обработчики, у которых есть предмет на бэкенде (план волны 7, задача 5-4):
//  `showMaskedAlert` :91-113, `addstickers`/`addemoji` :195-230, `addlist` :246-257 и
//  `tg_addlist` :533-545, `joinchat` :259-270 и `tg_join`/`tg_joinchat` :547-560,
//  `im` :327-432, `tg_resolve` :434-501, `tg_privatepost` :503-517; процессоры
//  `processMessageLink` :1053, `processPrivatePostLink` :1091, `processStickerSetLink`
//  :1123, `processJoinChatLink` :1127, `processWebAppLink` :1362, `processListLink`
//  :1432, `processInternalLink` :1619.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Обработчики без предмета не зарегистрированы (их ссылка остаётся браузеру —
//     `helpers/addAnchorListener.ts::onAnchorClick`), строки бэклога плана
//     `2026-10-02-wave-7-carcass-first.md`: `execBotCommand`/`setMediaTimestamp`
//     (сущностей нет), `searchByHashtag` (поиска по чату нет до П-5, Б-20),
//     `invoice`, `voicechat`/`call`, `boost`, `premium_offer`, `giftcode`, `m`/`message`,
//     `stars_topup`, `share`/`msg_url`, `nft`, `iv`, `addstyle` (Б-75), `new`,
//     `settings`, `contacts`, `chats` (Б-77). В ветках `im`/`tg_resolve` ссылки
//     этих видов (история, эфир, буст, телефон, коллекция, альбом, attach-бот)
//     отвечают тостом `Link.NotSupported` — так tweb отвечает на ссылку, чей вид
//     известен, а путь — нет (`showUnsupportedLinkToast`, :67-69).
//  2. `stack` ссылок («вернуться к сообщению») не портирован — `lib/internalLink.ts`.
//  3. `start=` бота: у tweb это `startParam` → `chat.input.setStartParam` → кнопка
//     «Запустить» плашки управления (`input.ts:1972-2010`). Плашки у нас нет (Б-36):
//     бот запускается сразу (`managers.bots.start`, прежнее поведение `useDeepLinks`),
//     потом открывается чат. `startgroup`/`startchannel` (`showAddBotToChat`) — нет
//     попапа выбора чата (Б-78): открывается сам бот.
//  4. `processJoinChatLink`: `checkChatInvite` и попап предпросмотра
//     (`showJoinChatInvitePopup`) — нет ручки предпросмотра (Б-79): вступаем сразу
//     (`importChatInvite`) и открываем чат, заявка — тост `RequestToJoinSent`
//     (tweb `joinChatInvite.tsx:110-126`).
//  5. `processWebAppLink`: мини-приложений по имени (`getBotApp`) и
//     `bot_has_main_app` нет — главное приложение бота у нас кнопка-меню
//     (`bots.menuButton`), подтверждение `confirmBotWebViewInner` и attach-меню — Б-76.
//  6. `processPrivatePostLink`: `resolveChannel` нет — карточку чата отдаёт
//     `peers.getPeers` (не участнику закрытого чата — отказ → `LinkNotFound`).
import PopupElement from '@components/popups/popupElement'
import PopupPeer from '@components/popups/popupPeer'
import showSharedFolderInvitePopup from '@components/popups/sharedFolderInvite.solid'
import { showStickersPopup } from '@components/sidebarLeft/settingsPopups'
import { toastNew } from '@components/toast'
import { MOUNT_CLASS_TO } from '@config/debug'
import addAnchorListener, { listenForAnchorClicks, listenForMaskedAnchorAuxClicks } from '@helpers/addAnchorListener'
import { toPeerId } from '@core/peers/peerId'
import { ANCHOR_ACTION_ATTRIBUTE, PHONE_NUMBER_REG_EXP } from '@lib/richtext/url'
import { isWebAppNameValid } from '@lib/richtext/validators'
import appImManager from '@lib/appImManager'
import { INTERNAL_LINK_TYPE, type InternalLink, type InternalLinkTypeMap } from '@lib/internalLink'
import type { Managers } from '@/client/bootstrap'

type ApiError = { type?: string }

/**
 * A link whose section we know but whose path we do not — the one thing worse
 * than not opening it is doing nothing about it. tdesktop answers the same way
 * (`Router::showUnsupportedMessage`).
 */
const showUnsupportedLinkToast = () => {
  toastNew({ langPackKey: 'Link.NotSupported' })
}

export class InternalLinkProcessor {
  protected managers!: Managers

  private showUsernameResolveError(err: ApiError) {
    if(err.type === 'USERNAME_NOT_OCCUPIED') {
      toastNew({ langPackKey: 'NoUsernameFound' })
    } else if(err.type === 'USERNAME_INVALID') {
      toastNew({ langPackKey: 'Alert.UserDoesntExists' })
    }
  }

  public construct(managers: Managers) {
    this.managers = managers

    // a middle click never reaches an anchor's inline `onclick`, so the alert below is wired to it
    // separately — otherwise the masked link opens in a new tab with nothing asked
    listenForMaskedAnchorAuxClicks()
    // наша замена inline-`onclick` (шапка `helpers/addAnchorListener.ts`)
    listenForAnchorClicks()

    addAnchorListener<{}>({
      name: 'showMaskedAlert',
      callback: ({ element }) => {
        const href = element.href

        const a = element.cloneNode(true) as HTMLAnchorElement
        a.className = 'anchor-url'
        a.innerText = href
        a.removeAttribute(ANCHOR_ACTION_ATTRIBUTE)

        PopupElement.createPopup(PopupPeer, 'popup-masked-url', {
          titleLangKey: 'OpenUrlTitle',
          descriptionLangKey: 'OpenUrlAlert2',
          descriptionLangArgs: [a],
          buttons: [{
            langKey: 'Open',
            callback: () => {
              a.click()
            },
          }],
        }).show()
      },
    })

    ;([
      ['addstickers', INTERNAL_LINK_TYPE.STICKER_SET],
      ['addemoji', INTERNAL_LINK_TYPE.EMOJI_SET],
    ] as [
      'addstickers' | 'addemoji',
      INTERNAL_LINK_TYPE.STICKER_SET | INTERNAL_LINK_TYPE.EMOJI_SET,
    ][]).forEach(([name, type]) => {
      addAnchorListener<{ pathnameParams: string[] }>({
        name,
        callback: ({ pathnameParams }) => {
          if(!pathnameParams[1]) {
            return
          }

          const link: InternalLink = {
            _: type,
            set: pathnameParams[1],
          }

          return this.processInternalLink(link)
        },
      })

      addAnchorListener<{
        uriParams: {
          set: string
        }
      }>({
        name,
        protocol: 'tg',
        callback: ({ uriParams }) => {
          const link = this.makeLink(type, uriParams)
          return this.processInternalLink(link)
        },
      })
    })

    // t.me/addlist/adasdasd
    addAnchorListener<{ pathnameParams: string[] }>({
      name: 'addlist',
      callback: ({ pathnameParams }) => {
        const link: InternalLink = {
          _: INTERNAL_LINK_TYPE.ADD_LIST,
          slug: pathnameParams[1],
        }

        return this.processInternalLink(link)
      },
    })

    // Support old t.me/joinchat/asd and new t.me/+asd
    addAnchorListener<{ pathnameParams: string[] }>({
      name: 'joinchat',
      callback: ({ pathnameParams }) => {
        const link: InternalLink = {
          _: INTERNAL_LINK_TYPE.JOIN_CHAT,
          invite: pathnameParams[1] || decodeURIComponent(pathnameParams[0]).slice(1),
        }

        return this.processInternalLink(link)
      },
    })

    type K = {
      thread?: string, comment?: string, start?: string, startgroup?: string, startchannel?: string,
      startattach?: string, attach?: string, startapp?: string, story?: string, boost?: string,
      voicechat?: string, videochat?: string, livestream?: string
    }

    addAnchorListener<{
      pathnameParams: string[],
      uriParams: K
    }>({
      name: 'im',
      callback: ({ pathnameParams, uriParams, masked }) => {
        let link: InternalLink
        if(
          'voicechat' in uriParams || 'videochat' in uriParams || 'livestream' in uriParams ||
          'boost' in uriParams || pathnameParams?.[0] === 'boost' ||
          ['s', 'c', 'a'].includes(pathnameParams?.[1]) ||
          PHONE_NUMBER_REG_EXP.test(pathnameParams[0]) ||
          'startattach' in uriParams || 'attach' in uriParams
        ) {
          // расхождение 1: эфир, буст, история, коллекция, альбом, телефон, attach-бот
          return showUnsupportedLinkToast()
        } else if(pathnameParams[0] === 'c') {
          pathnameParams.shift()
          const thread = 'thread' in uriParams ? uriParams.thread : pathnameParams[2] && pathnameParams[1]
          link = {
            _: INTERNAL_LINK_TYPE.PRIVATE_POST,
            channel: pathnameParams[0],
            post: pathnameParams[2] || pathnameParams[1],
            thread,
            comment: uriParams.comment,
          }
        } else if(pathnameParams[1] ? isWebAppNameValid(pathnameParams[1]) : uriParams.startapp !== undefined) {
          link = {
            _: INTERNAL_LINK_TYPE.WEB_APP,
            domain: pathnameParams[0],
            appname: pathnameParams[1],
            startapp: uriParams.startapp,
            masked,
          }
        } else {
          const thread = 'thread' in uriParams ? uriParams.thread : pathnameParams[2] && pathnameParams[1]
          link = {
            _: INTERNAL_LINK_TYPE.MESSAGE,
            domain: pathnameParams[0],
            post: pathnameParams[2] || pathnameParams[1],
            thread,
            comment: uriParams.comment,
            start: 'start' in uriParams ? uriParams.start : undefined,
            startgroup: 'startgroup' in uriParams ? uriParams.startgroup : undefined,
            startchannel: 'startchannel' in uriParams ? uriParams.startchannel : undefined,
          }
        }

        return this.processInternalLink(link)
      },
    })

    addAnchorListener<{
      uriParams: K & {
        domain: string,
        post?: string,
        phone?: string,
        appname?: string,
        game?: string
      }
    }>({
      name: 'resolve',
      protocol: 'tg',
      callback: ({ uriParams, masked }) => {
        let link: InternalLink
        if(
          uriParams.voicechat !== undefined || uriParams.videochat !== undefined || uriParams.livestream !== undefined ||
          uriParams.story || uriParams.phone ||
          uriParams.attach !== undefined || uriParams.startattach !== undefined
        ) {
          // расхождение 1
          return showUnsupportedLinkToast()
        } else if(uriParams.domain === 'telegrampassport') {
          return
        } else if((uriParams.appname || uriParams.startapp) !== undefined) {
          link = this.makeLink(INTERNAL_LINK_TYPE.WEB_APP, {
            masked,
            domain: uriParams.domain,
            appname: uriParams.appname,
            startapp: uriParams.startapp,
          })
        } else {
          link = this.makeLink(INTERNAL_LINK_TYPE.MESSAGE, {
            domain: uriParams.domain,
            post: uriParams.post,
            thread: uriParams.thread,
            comment: uriParams.comment,
            start: uriParams.start,
            startgroup: uriParams.startgroup,
            startchannel: uriParams.startchannel,
          })
        }

        return this.processInternalLink(link)
      },
    })

    addAnchorListener<{
      uriParams: {
        channel: string,
        post: string,
        thread?: string,
        comment?: string
      }
    }>({
      name: 'privatepost',
      protocol: 'tg',
      callback: ({ uriParams }) => {
        const link = this.makeLink(INTERNAL_LINK_TYPE.PRIVATE_POST, uriParams)
        return this.processInternalLink(link)
      },
    })

    // tg://addlist?slug=asd
    addAnchorListener<{
      uriParams: {
        slug: string
      }
    }>({
      name: 'addlist',
      protocol: 'tg',
      callback: ({ uriParams }) => {
        const link = this.makeLink(INTERNAL_LINK_TYPE.ADD_LIST, uriParams)
        return this.processInternalLink(link)
      },
    })

    ;(['joinchat', 'join'] as const).forEach((name) => {
      addAnchorListener<{
        uriParams: {
          invite: string
        }
      }>({
        name,
        protocol: 'tg',
        callback: ({ uriParams }) => {
          const link = this.makeLink(INTERNAL_LINK_TYPE.JOIN_CHAT, uriParams)
          return this.processInternalLink(link)
        },
      })
    })
  }

  private makeLink<T extends INTERNAL_LINK_TYPE>(type: T, uriParams: Omit<InternalLinkTypeMap[T], '_'>) {
    return {
      _: type,
      ...uriParams,
    } as unknown as InternalLinkTypeMap[T]
  }

  public processMessageLink = async(link: InternalLink.InternalLinkMessage) => {
    const postId = link.post ? +link.post : undefined
    const commentId = link.comment ? +link.comment : undefined
    const threadId = link.thread ? +link.thread : undefined

    // расхождение 3
    if(link.start !== undefined) {
      let peer
      try {
        peer = await this.managers.peers.resolveUsername(link.domain)
      } catch(err) {
        this.showUsernameResolveError(err as ApiError)
        return
      }

      if(peer._ === 'user' && peer.pFlags?.bot) {
        const peerId = await this.managers.bots.start(peer.id, link.start)
        return appImManager.setInnerPeer({ peerId })
      }
    }

    return appImManager.openUsername({
      userName: link.domain,
      lastMsgId: postId,
      commentId,
      threadId,
    })
  }

  public processPrivatePostLink = async(link: InternalLink.InternalLinkPrivatePost) => {
    const peerId = toPeerId(+link.channel, true)

    // расхождение 6
    let peer
    try {
      [peer] = await this.managers.peers.getPeers([peerId])
    } catch{ /* ниже — как отказ `resolveChannel` */ }

    if(!peer) {
      toastNew({ langPackKey: 'LinkNotFound' })
      return
    }

    const postId = +link.post
    const threadId = link.thread ? +link.thread : undefined

    return appImManager.op({
      peer,
      lastMsgId: postId,
      threadId,
    })
  }

  public processStickerSetLink = (link: InternalLink.InternalLinkStickerSet | InternalLink.InternalLinkEmojiSet) => {
    return showStickersPopup({ shortName: link.set })
  }

  public processJoinChatLink = (link: InternalLink.InternalLinkJoinChat) => {
    // расхождение 4
    return this.managers.groups.importChatInvite(link.invite).then((peerId) => {
      // `open` (not `setInnerPeer`) so a forum routes through `op` and opens the topics tab
      // in the left sidebar instead of just dropping into the chat view
      return appImManager.open({ peerId })
    }, (err: ApiError) => {
      if(err.type === 'INVITE_REQUEST_SENT') {
        toastNew({ langPackKey: 'RequestToJoinSent' })
      } else {
        toastNew({ langPackKey: 'InviteExpired' })
      }
    })
  }

  public processWebAppLink = async(link: InternalLink.InternalLinkWebApp) => {
    let user
    try {
      user = await this.managers.peers.resolveUsername(link.domain)
    } catch{ /* ниже — тост оригинала */ }

    if(!user || user._ !== 'user') {
      toastNew({ langPackKey: 'Alert.UserDoesntExists' })
      return
    }

    const botId = user.id

    // расхождение 5
    if(link.appname) {
      toastNew({ langPackKey: 'Alert.BotAppDoesntExist' })
      return
    }

    const menuButton = await this.managers.bots.menuButton(botId).catch(() => undefined)
    if(!menuButton?.url) {
      toastNew({ langPackKey: 'Alert.BotAppDoesntExist' })
      return
    }

    appImManager.openWebApp({
      botId,
      url: menuButton.url,
      startParam: link.startapp,
      main: true,
    })
  }

  public processListLink = async(link: InternalLink.InternalLinkAddList) => {
    let chatlistInvite
    try {
      chatlistInvite = await this.managers.folders.previewInvite(link.slug)
    } catch{
      // наш `GET /folder_invites/{slug}` отвечает отказом без имени — у tweb это `INVITE_SLUG_EXPIRED`
      toastNew({ langPackKey: 'SharedFolder.Link.Expired' })
      return
    }

    showSharedFolderInvitePopup({
      chatlistInvite,
      slug: link.slug,
      managers: this.managers,
    })
  }

  /**
   * НАШЕ РАСШИРЕНИЕ (у tweb нет): подтверждение входа по QR с другого устройства.
   * Код входа в QR — адрес клиента `/qr/<token>` (`auth/cards/SignQRCard.solid.tsx`),
   * его разбирает `appImManager.checkForLoginToken`. Вопрос — тем же `PopupPeer`,
   * что подтверждения оригинала (`confirmationPopup`).
   */
  public processLoginTokenLink = (token: string) => {
    return new Promise<void>((resolve) => {
      const popup = PopupElement.createPopup(PopupPeer, 'popup-qr-login', {
        titleLangKey: 'QrLogin.Confirm.Title',
        descriptionLangKey: 'QrLogin.Confirm.Text',
        buttons: [{
          langKey: 'QrLogin.Confirm.Action',
          callback: () => {
            void this.managers.auth.qrConfirm(token).catch(() => {
              toastNew({ langPackKey: 'Error.AnError' })
            })
          },
        }],
      })
      popup.addEventListener('close', () => resolve())
      popup.show()
    })
  }

  public processInternalLink(link: InternalLink) {
    const map: {
      [key in InternalLink['_']]?: (link: never) => unknown
    } = {
      [INTERNAL_LINK_TYPE.MESSAGE]: this.processMessageLink,
      [INTERNAL_LINK_TYPE.PRIVATE_POST]: this.processPrivatePostLink,
      [INTERNAL_LINK_TYPE.EMOJI_SET]: this.processStickerSetLink,
      [INTERNAL_LINK_TYPE.STICKER_SET]: this.processStickerSetLink,
      [INTERNAL_LINK_TYPE.JOIN_CHAT]: this.processJoinChatLink,
      [INTERNAL_LINK_TYPE.WEB_APP]: this.processWebAppLink,
      [INTERNAL_LINK_TYPE.ADD_LIST]: this.processListLink,
    }

    const processor = map[link._] as ((link: InternalLink) => unknown) | undefined
    if(!processor) {
      console.warn('Not supported internal link:', link)
      return
    }

    return processor(link)
  }
}

const internalLinkProcessor = new InternalLinkProcessor()
if(MOUNT_CLASS_TO) MOUNT_CLASS_TO.internalLinkProcessor = internalLinkProcessor
export default internalLinkProcessor
