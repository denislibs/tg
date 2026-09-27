// Порт tweb `src/components/sidebarLeft/tabs/inviteLink.ts:1-132` (812502980) —
// виджет ссылки-приглашения (класс, не вкладка): плашка с адресом, срезанным
// посередине, кнопка справа (меню ⋮ или «копировать») и кнопка под плашкой.
// Потребитель у нас — вкладка ссылки папки (`sharedFolder.solid.tsx`); у
// оригинала ещё бусты, ссылка-подарок и ссылка звонка — этих экранов у нас нет.
//
//   div.invite-link-container[.{class}]
//     div.invite-link.rp-overflow (+ ripple) > div.invite-link-text > middle-ellipsis-element
//                                            + [.btn-icon.btn-menu-toggle.invite-link-menu | .btn-icon.invite-link-menu(copy)]
//     [button.btn-primary.btn-color-primary.invite-link-button | div.invite-link-buttons > …]
//
// Расхождения с оригиналом:
//  1. Кнопки по умолчанию «Share Link» (`:73-80`) с `onButtonClick`/`buttonText`
//     и `shareLink` (`:129-131`) нет: `shareUrlToPeers` — попап выбора
//     получателей над `pickUser`/`forward`, у нас он только React-ом (волна 2C,
//     задачи 16/24 плана 2C), а Solid-код React не открывает. Без попапа кнопка
//     ничего бы не делала; своего действия под ссылкой (`onButtonClick`) не
//     передаёт ни один наш вызывающий. Возвращается вместе с Solid-попапом.
//     Явные кнопки под ссылкой (`button`) — как у оригинала.
//  2. `ariaLabel` кнопок ставится атрибутом `aria-label`: у нашего `ButtonIcon`
//     такой опции нет (шапка `editFolder.solid.tsx`, расхождение 9).
//  3. `wrapPlainText(s)` (`:118`) — без сущностей это тождество
//     (`wrapPlainText.ts:7-13`), текст кладётся как есть.
import { copyTextToClipboard } from '@helpers/clipboard'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import type ListenerSetter from '@helpers/listenerSetter'
import I18n from '@lib/langPack'
import ButtonIcon from '@components/buttonIcon'
import ButtonMenuToggle from '@components/buttonMenuToggle'
import { MiddleEllipsisElement } from '@components/middleEllipsis'
import ripple from '@components/ripple'
import { toastNew } from '@components/toast'

export class InviteLink {
  public container: HTMLDivElement
  public textElement: HTMLDivElement
  public button?: HTMLButtonElement

  public url!: string

  constructor({
    buttons,
    button,
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
    listenerSetter: ListenerSetter,
    url?: string,
    noRightButton?: boolean,
    onClick?: () => void,
    /** Extra class on the container, for a caller that places it itself. */
    class?: string
  }) {
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

    // :73-80 — кнопки по умолчанию нет (расхождение 1)

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
}
