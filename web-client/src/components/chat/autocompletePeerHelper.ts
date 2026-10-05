// Порт tweb `src/components/chat/autocompletePeerHelper.ts` (812502980) — база
// списочных хелперов с аватаркой (упоминания, команды): строка
// `div.autocomplete-peer-helper-list-element[data-peer-id]` с аватаркой 30px,
// именем и описанием. Пачка П-6, Б-34. Стили — `styles/tweb/_autocompletePeerHelper.scss`.
//
// Расхождения с оригиналом:
//  1. Эфемерных команд (`ephemeral`, иконка `eyecross` с тултипом
//     `Ephemeral.CommandTooltip`, `:62-64`, `:130-136`) нет — у бэкенда нет флага
//     `botCommand.pFlags.ephemeral`.
//  2. `avatarNew` и `PeerTitle` берут `managers` (зеркало карточек —
//     `peers.fillMirror`), у tweb они импортируют их сами.
import setInnerHTML from '@helpers/dom/setInnerHTML'
import type { Middleware } from '@helpers/middleware'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'
import { avatarNew, type AvatarManagers } from '@components/avatar'
import Scrollable from '@components/scrollable'
import I18n, { type LangPackKey } from '@lib/langPack'
import PeerTitle from './peerTitle'
import AutocompleteHelper from './autocompleteHelper'
import type AutocompleteHelperController from './autocompleteHelperController'

export type AutocompletePeerHelperItem = { peerId: PeerId, name?: string, description?: string }

export default class AutocompletePeerHelper extends AutocompleteHelper {
  public static BASE_CLASS = 'autocomplete-peer-helper'
  public static BASE_CLASS_LIST_ELEMENT = AutocompletePeerHelper.BASE_CLASS + '-list-element'
  private scrollable!: Scrollable

  constructor(
    appendTo: HTMLElement,
    controller: AutocompleteHelperController | undefined,
    protected className: string,
    onSelect: (target: Element) => boolean | void | Promise<boolean>,
    ariaLabel: LangPackKey,
    protected avatarManagers: AvatarManagers,
  ) {
    super({
      appendTo,
      controller,
      listType: 'y',
      onSelect,
    })

    this.container.classList.add(AutocompletePeerHelper.BASE_CLASS, className)
    this.container.setAttribute('role', 'listbox')
    this.container.setAttribute('aria-label', I18n.format(ariaLabel, true))
  }

  public init: (() => void) | null = () => {
    this.list = this.container.ownerDocument.createElement('div')
    this.list.classList.add(AutocompletePeerHelper.BASE_CLASS + '-list', this.className + '-list')

    this.container.append(this.list)

    this.scrollable = new Scrollable(this.container)

    this.addEventListener('visible', () => {
      setTimeout(() => { // it is not rendered yet
        this.scrollable.scrollPosition = 0
      }, 0)
    })
  }

  public render(
    data: AutocompletePeerHelperItem[],
    middleware: Middleware,
    doNotShow?: boolean,
  ) {
    if(this.init) {
      if(!data.length) {
        return
      }

      this.init()
      this.init = null
    }

    if(data.length) {
      this.list.replaceChildren()
      data.forEach((d) => {
        const div = AutocompletePeerHelper.listElement({
          className: this.className,
          peerId: d.peerId,
          name: d.name,
          description: d.description,
          middleware,
          ownerDocument: this.container.ownerDocument,
          managers: this.avatarManagers,
        })

        this.list.append(div)
      })
    }

    if(!doNotShow) {
      this.toggle(!data.length)
    }
  }

  public static listElement(options: {
    className: string,
    peerId: PeerId,
    name?: string,
    description?: string,
    middleware: Middleware,
    ownerDocument?: Document,
    managers: AvatarManagers,
  }) {
    const BASE = AutocompletePeerHelper.BASE_CLASS_LIST_ELEMENT
    options.className += '-list-element'
    const ownerDocument = options.ownerDocument || document

    const div = ownerDocument.createElement('div')
    div.classList.add(BASE, options.className)
    div.dataset.peerId = '' + options.peerId
    div.setAttribute('role', 'option')
    div.setAttribute('aria-selected', 'false')

    const { node } = avatarNew({
      middleware: options.middleware,
      size: 30,
      peerId: options.peerId,
      managers: options.managers,
    })
    node.classList.add(BASE + '-avatar', options.className + '-avatar')

    const name = ownerDocument.createElement('div')
    name.classList.add(BASE + '-name', options.className + '-name')
    if(!options.name) {
      name.append(new PeerTitle({
        peerId: options.peerId,
        dialog: false,
        onlyFirstName: false,
        middleware: options.middleware,
        managers: options.managers,
      }).element)
    } else {
      setInnerHTML(name, wrapEmojiText(options.name))
    }

    div.append(node, name)

    if(options.description) {
      const description = ownerDocument.createElement('div')
      description.classList.add(BASE + '-description', options.className + '-description')
      setInnerHTML(description, wrapEmojiText(options.description))
      div.append(description)
    }

    return div
  }
}
