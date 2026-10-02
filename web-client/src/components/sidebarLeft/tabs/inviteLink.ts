// Порт tweb `src/components/sidebarLeft/tabs/inviteLink.ts:1-132` (812502980) —
// виджет ссылки-приглашения (класс, не вкладка): плашка с адресом, срезанным
// посередине, кнопка справа (меню ⋮ или «копировать») и кнопка под плашкой.
// Потребители у нас — вкладка ссылки папки (`sharedFolder.solid.tsx`) и ссылки
// чата правой колонки (`sidebarRight/tabs/chatInviteLinkShared.ts::ChatInviteLink`);
// у оригинала ещё бусты, ссылка-подарок и ссылка звонка — этих экранов у нас нет.
//
//   div.invite-link-container[.{class}]
//     div.invite-link.rp-overflow (+ ripple) > div.invite-link-text > middle-ellipsis-element
//                                            + [.btn-icon.btn-menu-toggle.invite-link-menu | .btn-icon.invite-link-menu(copy)]
//     [button.btn-primary.btn-color-primary.invite-link-button | div.invite-link-buttons > …]
//
// Расхождения с оригиналом:
//  1. `shareLink` (`:129-131`) зовёт мост `popups/shareUrl.bridge.ts` —
//     React-выбор получателей (ВРЕМЕННО до 2C-24): Solid-попапа
//     `shareUrlToPeers` над `pickUser` у нас ещё нет.
//  2. `ariaLabel` кнопок ставится атрибутом `aria-label`: у нашего `ButtonIcon`
//     такой опции нет (шапка `editFolder.solid.tsx`, расхождение 9).
//  3. `wrapPlainText(s)` (`:118`) — без сущностей это тождество
//     (`wrapPlainText.ts:7-13`), текст кладётся как есть.
import { copyTextToClipboard } from '@helpers/clipboard'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import type ListenerSetter from '@helpers/listenerSetter'
import I18n from '@lib/langPack'
import Button from '@components/button'
import ButtonIcon from '@components/buttonIcon'
import ButtonMenuToggle from '@components/buttonMenuToggle'
import { MiddleEllipsisElement } from '@components/middleEllipsis'
import ripple from '@components/ripple'
import { toastNew } from '@components/toast'
import shareUrlToPeers from '@components/popups/shareUrl.bridge' // ВРЕМЕННО до 2C-24

export class InviteLink {
  public container: HTMLDivElement
  public textElement: HTMLDivElement
  public button?: HTMLButtonElement
  public buttonText?: HTMLSpanElement
  public onButtonClick?: () => void

  public url!: string

  constructor({
    buttons,
    button,
    onButtonClick,
    listenerSetter,
    url,
    noRightButton,
    onClick,
    class: className,
  }: {
    buttons?: Parameters<typeof ButtonMenuToggle>[0]['buttons'],
    /**
     * The action under the link. An array puts them side by side in one row —
     * the Call Link box needs Share and Copy together.
     */
    button?: HTMLButtonElement | HTMLButtonElement[] | false,
    onButtonClick?: () => void,
    listenerSetter: ListenerSetter,
    url?: string,
    noRightButton?: boolean,
    onClick?: () => void,
    /** Extra class on the container, for a caller that places it itself. */
    class?: string
  }) {
    this.onButtonClick = onButtonClick

    const linkContainer = this.container = document.createElement('div')
    linkContainer.classList.add('invite-link-container')
    if(className) linkContainer.classList.add(...className.split(' ').filter(Boolean))

    const link = document.createElement('div')
    link.classList.add('invite-link', 'rp-overflow')

    const text = this.textElement = document.createElement('div')
    text.classList.add('invite-link-text')

    let rightButton: HTMLElement | undefined
    if(buttons) {
      rightButton = ButtonMenuToggle({
        buttons,
        direction: 'bottom-left',
        buttonOptions: { noRipple: true },
        listenerSetter,
      })
      // расхождение 2
      rightButton.setAttribute('aria-label', I18n.format('MultiAccount.More', true))
    } else if(!noRightButton) {
      rightButton = ButtonIcon('copy', { noRipple: true })
      rightButton.setAttribute('aria-label', I18n.format('CopyLink', true))
      attachClickEvent(rightButton, () => this.copyLink(), { listenerSetter })
    }

    if(rightButton) rightButton.classList.add('invite-link-menu')

    if(!button && button !== false) {
      button = Button('', { text: 'ShareLink' })
      this.buttonText = button.lastElementChild as HTMLSpanElement
      attachClickEvent(button, () => {
        if(this.onButtonClick) this.onButtonClick()
        else this.shareLink()
      }, { listenerSetter })
    }

    const buttonElements = button ? (Array.isArray(button) ? button : [button]) : []
    buttonElements.forEach((element) => {
      element.className = 'btn-primary btn-color-primary invite-link-button'
    })
    this.button = buttonElements[0]

    let buttonsElement: HTMLElement | undefined
    if(buttonElements.length > 1) {
      buttonsElement = document.createElement('div')
      buttonsElement.classList.add('invite-link-buttons')
      buttonsElement.append(...buttonElements)
    } else {
      buttonsElement = buttonElements[0]
    }

    if(url) this.setUrl(url)
    ripple(link)
    link.append(...[
      text,
      rightButton,
    ].filter(Boolean) as HTMLElement[])

    linkContainer.append(link, buttonsElement || '')

    attachClickEvent(link, onClick || (() => this.copyLink()), { listenerSetter })
  }

  public setUrl(url: string) {
    let s = url
    if(s.includes('//')) {
      s = url.split('//').slice(1).join('//')
    }

    // Middle truncation, so both ends of the link survive a narrow box: the
    // same element documents and audio trim their file names with.
    const element = new MiddleEllipsisElement()
    element.textContent = s // расхождение 3

    this.textElement.replaceChildren(element)
    this.url = url
  }

  public copyLink = (url: string = this.url) => {
    void copyTextToClipboard(url)
    toastNew({ langPackKey: 'LinkCopied' })
  }

  // расхождение 1
  public shareLink = (url: string = this.url) => {
    shareUrlToPeers({ url, openAfter: true })
  }
}
