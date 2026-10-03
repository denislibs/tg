// Порт tweb `components/chat/sendAs.ts` (812502980, 418 строк) — кнопка «Отправить от
// имени» в строке ввода: аватарка выбранной личности, меню личностей
// (`channels.getSendAs`). Пачка П-6, Б-31.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. `default_send_as` у бэкенда нет (`channelFull` его не несёт, ручки
//     `messages.saveDefaultSendAs` нет). Личность по умолчанию — первая из списка
//     `chats.getSendAs` (сам пользователь, `GET /chats/{id}/send_as`), выбор
//     запоминается на сессию (`selected`), а не на сервере — бэклог Б-127. Кнопка
//     ставится, только если личностей больше одной: у оригинала это решает сервер,
//     выдавая `default_send_as` лишь там, где отправка от имени возможна.
//  2. Премиум-личностей (`premium_required`, `isPremiumFeaturesHidden`,
//     `showPremiumPopup`) нет — флаг бэкенд не производит.
//  3. Режим платной реакции (`forPaidReaction`, `menuContainer`, `defaultPeerId`) не
//     перенесён: его зовёт только попап звёздной реакции, а он React (`StarReactionPopup`).
//  4. `peer_full_update` → перечитывание — у нас события нет; список перечитывается на
//     смене пира (`ChatInput.finishPeerChange`).
//  5. Флаги пира — синхронно из зеркала (`core/peerCache.ts`), монофорумов нет.
import ListenerSetter from '@helpers/listenerSetter'
import liteMode from '@helpers/liteMode'
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'
import safeAssign from '@helpers/object/safeAssign'
import I18n, { i18n } from '@lib/langPack'
import type { Managers } from '@/client/bootstrap'
import { cachedChat, isChannelPeer, isMegagroupPeer } from '@core/peerCache'
import { getPeerId, isUser } from '@core/peers/peerId'
import { setTransition as SetTransition } from '@core/dom/setTransition'
import { avatarNew } from '@components/avatar'
import { type ButtonMenuItemOptions, ButtonMenuSync } from '@components/buttonMenu'
import ButtonMenuToggle from '@components/buttonMenuToggle'
import Icon from '@components/icon'
import PeerTitle from '@components/chat/peerTitle'
import { getChatMembersString } from '@components/wrappers/getChatMembersString'

const SEND_AS_ANIMATION_DURATION = 300

/** Расхождение 1: выбор личности на сессию — по чату. */
const selected = new Map<PeerId, PeerId>()

export interface ChatSendAsOptions {
  managers: Managers,
  onReady: (container: HTMLElement, skipAnimation?: boolean) => void,
  onChange: (sendAsPeerId: PeerId) => void
}

export default class ChatSendAs {
  private avatar?: ReturnType<typeof avatarNew>
  private container!: HTMLElement
  private closeBtn!: HTMLElement
  private btnMenu?: HTMLElement
  private sendAsPeers: { peerId: PeerId }[] = []
  private sendAsPeerId?: PeerId
  private updatingPromise?: Promise<(() => void) | undefined>
  private middlewareHelper: MiddlewareHelper
  private listenerSetter: ListenerSetter
  private peerId?: PeerId
  private buttons: ButtonMenuItemOptions[] = []

  private managers!: ChatSendAsOptions['managers']
  private onReady!: ChatSendAsOptions['onReady']
  private onChange!: ChatSendAsOptions['onChange']

  constructor(options: ChatSendAsOptions) {
    safeAssign(this, options)
    this.middlewareHelper = getMiddleware()
    this.listenerSetter = new ListenerSetter()
    this.construct()
  }

  private construct() {
    this.container = document.createElement('div')
    this.container.classList.add('new-message-send-as-container')
    this.container.setAttribute('role', 'button')
    this.container.setAttribute('aria-label', I18n.format('SendMessageAsTitle', true))

    this.closeBtn = document.createElement('div')
    this.closeBtn.classList.add('new-message-send-as-close', 'new-message-send-as-avatar')
    this.closeBtn.setAttribute('aria-hidden', 'true')
    this.closeBtn.append(Icon('close'))

    const sendAsButtons: ButtonMenuItemOptions[] = [{
      text: 'SendMessageAsTitle',
      onClick: () => {},
    }]

    let previousAvatar: ChatSendAs['avatar']
    const onSendAsMenuToggle = (visible: boolean) => {
      if(visible) {
        previousAvatar = this.avatar
      }

      const isChanged = this.avatar !== previousAvatar
      const useRafs = !visible && isChanged ? 2 : 0

      SetTransition({
        element: this.closeBtn,
        className: 'is-visible',
        forwards: visible,
        duration: SEND_AS_ANIMATION_DURATION,
        useRafs,
      })
      if(!isChanged && previousAvatar) {
        SetTransition({
          element: previousAvatar.node,
          className: 'is-visible',
          forwards: !visible,
          duration: SEND_AS_ANIMATION_DURATION,
          useRafs,
        })
      }
    }

    ButtonMenuToggle({
      buttonOptions: { noRipple: true },
      listenerSetter: this.listenerSetter,
      container: this.container,
      direction: 'top-right',
      buttons: sendAsButtons,
      onOpenBefore: () => {
        onSendAsMenuToggle(true)
      },
      onOpen: (_e, btnMenu) => {
        sendAsButtons[0].element!.classList.add('btn-menu-item-header')
        this.btnMenu = btnMenu
        this.btnMenu.classList.add('scrollable', 'scrollable-y', 'new-message-send-as-menu')
        this.btnMenu.append(...this.buttons.map((button) => button.element!))
      },
      onClose: () => {
        onSendAsMenuToggle(false)
      },
      onCloseAfter: () => {
        this.btnMenu = undefined
      },
    })

    this.container.append(this.closeBtn)
  }

  private updateButtons(peers: ChatSendAs['sendAsPeers']) {
    const buttons: ButtonMenuItemOptions[] = peers.map((sendAsPeer, idx) => {
      const textElement = document.createElement('div')

      const { peerId: sendAsPeerId } = sendAsPeer

      const subtitle = document.createElement('div')
      subtitle.classList.add('btn-menu-item-subtitle')
      if(isUser(sendAsPeerId)) {
        subtitle.append(i18n('Chat.SendAs.PersonalAccount'))
      } else if(sendAsPeerId === this.peerId && isMegagroupPeer(this.peerId)) {
        subtitle.append(i18n('VoiceChat.DiscussionGroup'))
      } else {
        subtitle.append(getChatMembersString(cachedChat(sendAsPeerId), (key, args) => I18n.format(key, true, args)))
      }

      const title = document.createElement('div')
      title.append(new PeerTitle({ peerId: sendAsPeerId, middleware: this.middlewareHelper.get(), managers: this.managers }).element)

      textElement.append(
        title,
        subtitle,
      )

      return {
        onClick: idx ? () => {
          void this.changeSendAsPeerId(sendAsPeerId)
          if(this.peerId) selected.set(this.peerId, sendAsPeerId)

          const middleware = this.middlewareHelper.get()
          const executeButtonsUpdate = () => {
            if(this.sendAsPeerId !== sendAsPeerId || !middleware()) return
            const peers = this.sendAsPeers.slice()
            const idx = peers.findIndex((peer) => peer.peerId === sendAsPeerId)
            if(idx !== -1) peers.splice(idx, 1)
            peers.unshift(sendAsPeer)
            this.updateButtons(peers)
          }

          if(liteMode.isAvailable('animations')) {
            setTimeout(executeButtonsUpdate, 250)
          } else {
            executeButtonsUpdate()
          }
        } : () => {},
        textElement,
      }
    })

    ButtonMenuSync({ buttons })
    buttons.forEach((button, idx) => {
      const { peerId } = peers[idx]
      const avatar = avatarNew({
        middleware: this.middlewareHelper.get(),
        size: 26,
        peerId,
        managers: this.managers,
      })
      avatar.node.classList.add('btn-menu-item-icon', 'btn-menu-item-avatar')

      if(!idx) {
        avatar.node.classList.add('active')
      }

      button.element!.prepend(avatar.node)
    })

    this.buttons = buttons

    // if already opened
    this.btnMenu?.append(...this.buttons.map((button) => button.element!))
  }

  private async updateAvatar(sendAsPeerId: PeerId, skipAnimation?: boolean) {
    const previousAvatar = this.avatar
    if(previousAvatar) {
      if(+(previousAvatar.node.dataset.peerId ?? 0) === sendAsPeerId) {
        return
      }
    }

    if(!previousAvatar) {
      skipAnimation = true
    }

    const useRafs = skipAnimation ? 0 : 2
    const duration = skipAnimation ? 0 : SEND_AS_ANIMATION_DURATION
    const avatar = this.avatar = avatarNew({
      middleware: this.middlewareHelper.get(),
      size: 40,
      isDialog: false,
      peerId: sendAsPeerId,
      managers: this.managers,
    })
    avatar.node.classList.add('new-message-send-as-avatar')
    await avatar.readyThumbPromise

    SetTransition({
      element: avatar.node,
      className: 'is-visible',
      forwards: true,
      duration,
      useRafs,
    })
    if(previousAvatar) {
      SetTransition({
        element: previousAvatar.node,
        className: 'is-visible',
        forwards: false,
        duration,
        onTransitionEnd: () => {
          previousAvatar.node.remove()
        },
        useRafs,
      })
    }

    this.container.append(avatar.node)
  }

  private changeSendAsPeerId(sendAsPeerId: PeerId, skipAnimation?: boolean) {
    this.sendAsPeerId = sendAsPeerId
    this.onChange(sendAsPeerId)
    return this.updateAvatar(sendAsPeerId, skipAnimation)
  }

  /**
   * tweb `updateManual` — расхождение 1: список личностей читается до выбора, а не
   * после `default_send_as`. Возвращает колбэк показа (tweb: показ делает
   * `finishPeerChange`, когда пир сменился).
   */
  public async updateManual(skipAnimation?: boolean): Promise<(() => void) | undefined> {
    const peerId = this.peerId
    if(this.updatingPromise || !peerId || !isChannelPeer(peerId)) {
      return
    }

    const middleware = this.middlewareHelper.get(() => {
      return !this.updatingPromise || this.updatingPromise === updatingPromise
    })

    const { container } = this
    const updatingPromise = this.updatingPromise = (async() => {
      const sendAsPeers = await this.managers.chats.getSendAs(peerId)
      if(!middleware()) return

      const peers: ChatSendAs['sendAsPeers'] = sendAsPeers.peers.map((sendAsPeer) => {
        return { peerId: getPeerId(sendAsPeer.peer) }
      })

      if(peers.length < 2) return

      await this.managers.peers.fillMirror(peers.map(({ peerId }) => peerId))
      if(!middleware()) return

      const stored = selected.get(peerId)
      const sendAsPeerId = stored !== undefined && peers.some((peer) => peer.peerId === stored) ? stored : peers[0].peerId

      await this.changeSendAsPeerId(sendAsPeerId, skipAnimation)
      if(!middleware()) return

      const idx = peers.findIndex((peer) => peer.peerId === sendAsPeerId)
      if(idx !== -1) {
        const peer = peers.splice(idx, 1)[0]
        peers.unshift(peer)
      }

      this.sendAsPeers = peers.slice()
      this.updateButtons(peers)

      return () => {
        this.onReady(container, skipAnimation)
      }
    })()

    void updatingPromise.finally(() => {
      if(this.updatingPromise === updatingPromise) {
        this.updatingPromise = undefined
      }
    })

    return updatingPromise
  }

  public update(skipAnimation?: boolean) {
    return this.updateManual(skipAnimation).then((callback) => callback?.())
  }

  public setPeerId(peerId?: PeerId) {
    this.middlewareHelper.clean()
    this.updatingPromise = undefined
    this.peerId = peerId
  }

  public getSendAsPeerId() {
    return this.sendAsPeerId
  }

  public destroy() {
    this.container.remove()
    this.setPeerId()
    this.listenerSetter.removeAll()
  }
}
