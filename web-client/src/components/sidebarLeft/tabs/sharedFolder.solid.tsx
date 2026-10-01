/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/sharedFolder.tsx:1-306` (812502980) —
 * вкладка ссылки-приглашения папки «Share Folder» (`AppSharedFolderTab`,
 * `solidJsTabs/tabs.ts`, Eventable: событие `delete`). Задача 25 плана волны 2D
 * (`docs/superpowers/plans/2026-09-26-wave-2d-settings-rowtsx.md`).
 *
 *   .sidebar-content (скроллер вкладки снят, :133) > div.selector…     (`AppSelectPeers`, :176-192)
 *     div.scrollable.selector-scrollable
 *       div.sticker-container (Folders_Shared, 86×86)                  (:127-128, :281-293)
 *       div.caption «SharedFolder.Edit.Description» | «SharedFolder.NoChats»  (:123-126, :60-78)
 *       [Section «InviteLink» > div.invite-link-container]             (:142-171, `inviteLink.ts`)
 *       div.selector-height-container > Section «N chats selected» | «These chats cannot be shared»
 *         + caption «SharedFolder.Edit.Subtitle» > ul.chatlist (a.row[.cant-select])
 *
 * Открывает редактор папки (`editFolder.solid.tsx`, `openChatlistInvite`,
 * tweb `editFolder.tsx:702-724`): клик по строке ссылки, новая ссылка и отказ
 * «нечем делиться» (без ссылки — вкладка объясняет, почему чаты не расшарить).
 *
 * Расхождения с оригиналом:
 *  1. (О-23) Выбор чатов ссылки не портирован: у бэкенда нет
 *     `chatlists.editExportedInvite` (есть только создание, список и отзыв —
 *     `backend/internal/adapter/delivery/http/router.go`, `/me/folders/{id}/invites`,
 *     `/me/folder_invites/{slug}`). Поэтому нет галки «Save» в шапке
 *     (`confirmBtn`, `:129-131`, `:258-272`), её показа по изменению выбора
 *     (`onSelectChange`, `:86-89`), подтверждения на закрытии
 *     (`isConfirmationNeededOnClose`, `:103-112`) и события `edit`. Список чатов
 *     рисуется, как у оригинала (выбранные — чаты ссылки), но выбор не меняется:
 *     строку, которую оригинал дал бы отметить или снять, вкладка «трясёт»
 *     (`shake` — отказ оригинала на снятии последнего чата, `:248-251`).
 *     Нерасшариваемая строка — тост и тряска, как у оригинала (`:228-240`).
 *  2. `canSelectPeer` (`:48-58`): расшариваются только публичные группы и каналы
 *     (`usecase/folders.shareableChats` — `isPublic` у нас; вектора `usernames`
 *     нет, см. `core/peers/predicates.ts::isPublic`). Права `invite_links`
 *     (`hasRights`) не дают расшарить приватный чат — сервер его отбросит, так что
 *     и строка не выбираема.
 *  3. Подписка на `filter_update` (`:135-139`) не заведена: обновлённая папка
 *     у оригинала читается только галкой (`filter.title.text` в
 *     `editExportedInvite`, `:264`) — её нет (расхождение 1); `id` папки не меняется.
 *  4. Название папки — строка без сущностей (`Folder.title`): `wrapFolderTitle`
 *     (`:295-299`) не нужен, узел названия строится сразу.
 *  5. Папка и ссылка — наши `Folder`/`FolderInvite` (`core/managers/foldersManager.ts`):
 *     пиры ссылки — `peerIds`, включённые чаты — `includeChats`; удаление —
 *     `managers.folders.revokeInvite(slug)` вместо
 *     `filtersStorage.deleteExportedInvite(filter.id, url)` (`:153-159`). Путь
 *     ссылки у нас относительный (`/addlist/<slug>`) — в виджет идёт полный адрес
 *     (`inviteUrl`, `editFolderShared.ts`).
 *  6. Кнопки «Share Link» под ссылкой нет: `InviteLink` без попапа
 *     `shareUrlToPeers` (волна 2C) — расхождение 1 в `inviteLink.ts`.
 *  7. Подпись чата по умолчанию (`getChatMembersString`, `:100`) даёт сам
 *     селектор (`AppSelectPeers.wrapSubtitle` — тот же `getChatMembersString`):
 *     наш `getSubtitleForElement` строку не возвращает (тип — узел).
 *  8. Заставка: при отказе загрузки лотти — статичная картинка
 *     (`renderStaticAssetFallback`), как в `editFolder.solid.tsx`.
 */
import { onCleanup, onMount } from 'solid-js'
import I18n, { i18n, type LangPackKey } from '@lib/langPack'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import lottieLoader from '@lib/lottie/lottieLoader'
import { renderStaticAssetFallback } from '@lib/lottie/lottieAssetFallback'
import AppSelectPeers from '@components/appSelectPeers.solid'
import type { DialogElement } from '@lib/appDialogsManager'
import Section from '@components/section.solid'
import { toastNew } from '@components/toast'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import type { AppSharedFolderTab } from '@components/solidJsTabs/tabs'
import { InviteLink } from '@components/sidebarLeft/tabs/inviteLink'
import { inviteUrl } from '@components/sidebarLeft/tabs/editFolderShared'
import filterUnique from '@helpers/array/filterUnique'
import shake from '@helpers/dom/shake'
import { unwrapSolidElement } from '@helpers/solid/wrapSolidComponent'
import { isUser } from '@core/peers/peerId'
import { peerKey, type Chat, type User } from '@core/peers/peer'
import { isBroadcast, isPublic } from '@core/peers/predicates'

const SharedFolder = () => {
  const [tab] = useSuperTab<typeof AppSharedFolderTab>()
  const promiseCollector = usePromiseCollector()
  const managers = tab.managers!

  const filter = tab.payload.filter // расхождение 3
  const chatlistInvite = tab.payload.chatlistInvite

  let descriptionI18n!: I18n.IntlElement
  let descriptionTitle!: HTMLElement
  let chatsTitleI18n!: I18n.IntlElement
  let loadAnimationPromise!: Promise<unknown>
  let animation: LottiePlayer | undefined
  let selector: AppSelectPeers | undefined
  const elementMap: Map<PeerId, DialogElement> = new Map()
  const peersMap: Map<PeerId, User | Chat> = new Map()

  // :48-58 (расхождение 2)
  const canSelectPeer = (peer: Chat | User | undefined) => {
    if(!peer || !chatlistInvite) {
      return false
    }

    if(peer._ === 'user' || peer._ === 'userEmpty') {
      return false
    }

    return isPublic(peer)
  }

  // :60-78
  const updateDescription = (length = chatlistInvite ? chatlistInvite.peerIds.length : undefined) => {
    if(!chatlistInvite) {
      descriptionI18n.compareAndUpdate({ key: 'SharedFolder.NoChats' })
      chatsTitleI18n.compareAndUpdate({ key: 'SharedFolder.NoChats.Title' })
    } else {
      descriptionI18n.update({
        key: 'SharedFolder.Edit.Description',
        args: [
          descriptionTitle,
          i18n('Chats', [length!]),
        ],
      })

      chatsTitleI18n.update({
        key: 'ChatsSelected',
        args: [length!],
      })
    }
  }

  // :80-90 — без галки (расхождение 1)
  const onSelectChange = (length: number) => {
    updateDescription(length)
  }

  // :92-101 (расхождение 7)
  const getSubtitleForElement = (peerId: PeerId) => {
    const peer = peersMap.get(peerId)
    if(peer?._ === 'user') {
      return i18n(peer.pFlags?.bot ? 'SharedFolder.Cant.ShareBots' : 'SharedFolder.Cant.ShareUsers')
    } else if(!canSelectPeer(peer)) {
      return i18n('SharedFolder.Cant.Share')
    }

    return undefined
  }

  ;(tab as typeof tab & { _onOpenAfterTimeout?: () => void })._onOpenAfterTimeout = () => {
    void loadAnimationPromise.then(() => {
      if(!animation) return
      animation.autoplay = true
      animation.play()
    })
  }

  onMount(() => {
    tab.container.classList.add('edit-folder-container', 'shared-folder-container')
    const caption = document.createElement('div')
    caption.classList.add('caption')
    descriptionI18n = new I18n.IntlElement()
    caption.append(descriptionI18n.element)
    const stickerContainer = document.createElement('div')
    stickerContainer.classList.add('sticker-container')

    tab.content.remove()

    // :295-299 (расхождение 4)
    descriptionTitle = document.createElement('span')
    descriptionTitle.append(filter.title)

    let linkSection: HTMLElement | undefined
    if(chatlistInvite) {
      const inviteLink: InviteLink = new InviteLink({
        buttons: [{
          icon: 'copy',
          text: 'CopyLink',
          onClick: () => inviteLink.copyLink(),
        }, {
          icon: 'delete',
          className: 'danger',
          text: 'DeleteLink',
          onClick: () => {
            // расхождение 5
            void managers.folders.revokeInvite(chatlistInvite.slug).then(() => {
              tab.eventListener.dispatchEvent('delete')
              tab.close()
            })
          },
        }],
        listenerSetter: tab.listenerSetter,
        url: inviteUrl(chatlistInvite),
      })

      linkSection = unwrapSolidElement(
        <Section name="InviteLink">
          {inviteLink.container}
        </Section>,
      ) as HTMLElement
    }

    {
      const titleI18n = chatsTitleI18n = new I18n.IntlElement()

      const _selector = selector = new AppSelectPeers({
        middleware: tab.middlewareHelper.get(),
        appendTo: tab.container,
        onChange: onSelectChange,
        peerType: [],
        getSubtitleForElement,
        processElementAfter: (peerId, dialogElement) => {
          elementMap.set(peerId, dialogElement)
          dialogElement.container.classList.toggle('cant-select', !canSelectPeer(peersMap.get(peerId)))
        },
        sectionNameLangPackKey: titleI18n.element,
        sectionCaption: 'SharedFolder.Edit.Subtitle',
        managers,
        noSearch: true,
        meAsSaved: false,
        multiSelect: true,
      })

      _selector.scrollable.attachBorderListeners(tab.container)

      const selectedPeers = chatlistInvite?.peerIds ?? []
      _selector.addInitial(selectedPeers)

      const combinedPeerIds = filterUnique(selectedPeers.concat(filter.includeChats))

      promiseCollector.collect((async() => {
        const peers = await managers.peers.getPeers(combinedPeerIds)
        const ratings: Map<User | Chat, number> = new Map()
        const peerIds: Map<User | Chat, PeerId> = new Map()
        peers.forEach((peer) => {
          const peerId = peerKey(peer)
          peerIds.set(peer, peerId)
          peersMap.set(peerId, peer)

          let rating = 0
          if(!canSelectPeer(peer)) {
            rating = -1
          } else if(_selector.selected.has(peerId)) {
            rating = 1
          }

          ratings.set(peer, rating)
        })
        peers.sort((a, b) => ratings.get(b)! - ratings.get(a)!)
        await _selector.renderResultsFunc(peers.map((peer) => peerIds.get(peer)!))

        // :223-243
        _selector.add = (options) => {
          const peerId = options.key as PeerId
          const dialogElement = elementMap.get(peerId)
          if(!dialogElement) return false
          const { container } = dialogElement
          if(container.classList.contains('cant-select')) {
            let langPackKey: LangPackKey
            if(isUser(peerId)) {
              langPackKey = 'SharedFolder.Toast.NoPrivate'
            } else {
              const peer = peersMap.get(peerId) as Chat | undefined
              langPackKey = isBroadcast(peer) ? 'SharedFolder.Toast.NoAdminChannel' : 'SharedFolder.Toast.NoAdminGroup'
            }

            toastNew({ langPackKey })
            shake(container)
            return false
          }

          // (О-23) выбор чатов ссылки — расхождение 1
          shake(container)
          return false
        }

        // :245-254 — (О-23) снять чат со ссылки нельзя, расхождение 1
        _selector.remove = (key) => {
          const container = elementMap.get(key as PeerId)?.container
          if(container) shake(container)
          return false
        }
      })())
    }

    selector.scrollable.prepend(...[
      stickerContainer,
      caption,
      linkSection,
    ].filter(Boolean) as HTMLElement[])

    // :280-300 (расхождение 8)
    loadAnimationPromise = lottieLoader.loadAnimationFromURLManually('Folders_Shared').then(async(cb) => {
      const player = await cb({
        container: stickerContainer,
        loop: false,
        autoplay: false,
        width: 86,
        height: 86,
        middleware: tab.middlewareHelper.get(),
      })

      animation = player

      return lottieLoader.waitForFirstFrame(player)
    }).catch(() => {
      renderStaticAssetFallback(stickerContainer, 'Folders_Shared')
    })

    promiseCollector.collect(loadAnimationPromise)
    updateDescription()
  })

  onCleanup(() => {
    if(selector) {
      selector.container.remove()
      selector = undefined
    }
  })

  return null
}

export default SharedFolder
