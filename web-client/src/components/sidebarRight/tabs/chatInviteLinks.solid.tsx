/** @jsxImportSource solid-js */
/**
 * порт tweb/src/components/sidebarRight/tabs/chatInviteLinks.tsx:1-618 (812502980) —
 * вкладка «Пригласительные ссылки» правой колонки: заставка, основная ссылка
 * виджетом `ChatInviteLink`, дополнительные ссылки строками `UsernameRow` с
 * кольцом остатка срока/лимита, отозванные ссылки, меню строки и ⋮ основной.
 * Регистрация — `AppChatInviteLinksTab` в `solidJsTabs/tabs.ts` (tweb `:699-712`);
 * открывает её редактор чата (`editChat.tsx:687-692`, у нас — `editChat.solid.tsx`,
 * 0б-1). Содержимое строится, как у
 * оригинала, императивно (`wrapSolidComponent` + узлы в `tab.scrollable`),
 * компонент возвращает `null`.
 *
 *   .tabs-tab.chat-folders-container.chat-discussion-container > .sidebar-content > .scrollable
 *     div (корень острова)
 *     div.sticker-container (UtyanLinks 120×120) + div.caption «ChannelLinkInfo»
 *     Section «InviteLink» > div.invite-link-container (+ .invite-link-subtitle)
 *     Section «InviteLinks.Additional» > button «CreateNewLink» + content > a.row.usernames-username.is-link…
 *     Section «RevokedLinks»[.hide] > button «DeleteAllRevokedLinks» + content > строки
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. (О-120) Основная ссылка — не `chatFull.exported_invite`, а `p.exportedInvite`
 *     (порт `getChatInviteLink`, расхождение 1 `chatInviteLinkShared.ts`). Отзыв
 *     основной: сервер не отдаёт `messages.exportedChatInviteReplaced`, поэтому
 *     новая основная выпускается следом (`exportChatInvite`) — видимый исход
 *     тот же (`:128`, `:140-141`).
 *  2. (О-121) Режим ссылок одного админа (`adminId`: подписи
 *     `ManageLinks.Admin.Permanent.Desc`, `LinksCreatedByThisAdmin`) и секция
 *     «Ссылки других админов» (`:231-290`) — нет на бэкенде, у вкладки нет
 *     открывателя с `adminId`. У оригинала без `adminsInvites` секция
 *     удаляется (`:285-287`) — здесь она и не создаётся.
 *  3. (О-122) Заявок по ссылке нет на проводе: ветки `requested`/`JoinRequests`
 *     в подписи строки (`:458`, `:486-490`) не портированы.
 *  4. (О-123) Платные ссылки-подписки (`subscription_pricing`: `StarsAmount`,
 *     `Stars.Subscriptions.PerMonth`, иконка `link_paid`, `:409-414`, `:436`) —
 *     нет на бэкенде.
 *  5. (О-17) Имена чата — одно поле `username` (`chatType.solid.tsx`, расхождение
 *     5), `getPeerActiveUsernames` → `[chat.username]`; сообществ (`communityFull`,
 *     `:575`) нет (О-5). Чат — из зеркала (`cachedChat`), а не `getChat` (`:44`).
 *  6. `invite.start_date` (`:510`) не производится сервером — берётся `date`,
 *     как у оригинала при его отсутствии.
 *  7. Отказ в подтверждении (`confirmationPopup` — отклонённое обещание)
 *     гасится в самом действии: у оригинала он улетает необработанным.
 *  8. Кольцо остатка (`:554-558`) собирается `createElementNS`, а не строкой
 *     разметки (правило репо, шапка `putPreloader.ts`); цвета — переменные
 *     темы `--green-color`/`--danger-color` (наш `customProperties.getProperty`
 *     берёт имя с `--`).
 *  9. Заставка: отказ лотти (нет WASM SIMD) — статичный кадр
 *     (`renderStaticAssetFallback`), как в `chatFolders.solid.tsx`.
 */
import type { Component } from 'solid-js'
import { hexToRgb, hslaToString, mixColors, rgbaToHsla } from '@shared/lib/color'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import createContextMenu from '@helpers/dom/createContextMenu'
import customProperties from '@helpers/dom/customProperties'
import findUpClassName from '@helpers/dom/findUpClassName'
import toggleDisability from '@helpers/dom/toggleDisability'
import tsNow from '@helpers/tsNow'
import { i18n, joinElementsWith } from '@lib/langPack'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'
import lottieLoader from '@lib/lottie/lottieLoader'
import { renderStaticAssetFallback } from '@lib/lottie/lottieAssetFallback'
import rootScope from '@lib/rootScope'
import Button from '@components/button'
import type { ButtonMenuItemOptionsVerifiable } from '@components/buttonMenu'
import { confirmationPopup } from '@components/popups/popupPeer'
import Section, { appendSectionContent } from '@components/section.solid'
import UsernameRow from '@components/usernameRow.solid'
import { wrapLeftDuration } from '@components/wrappers/wrapDuration'
import { type ChatInvite, type ChatInviteActions, ChatInviteLink, getChatInviteLinksInitArgs, isActiveInvite } from './chatInviteLinkShared'
import { AppChatInviteLinkTab, AppEditChatInviteLinkTab, type AppChatInviteLinksTab } from '@components/solidJsTabs/tabs'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import { mountSolidComponent, wrapSolidComponent } from '@helpers/solid/wrapSolidComponent'
import { cachedChat } from '@core/peerCache'
import { toPeerId } from '@core/peers/peerId'
import type { Channel } from '@core/peers/peer'
import type SidebarSlider from '@components/slider'

const SVG_NS = 'http://www.w3.org/2000/svg'

const ChatInviteLinks: Component = () => {
  const [tab] = useSuperTab<typeof AppChatInviteLinksTab>()
  const promiseCollector = usePromiseCollector()
  const managers = tab.managers!
  const slider = tab.slider as SidebarSlider
  const { chatId } = tab.payload
  const p = tab.payload.p ?? getChatInviteLinksInitArgs(managers, chatId)

  const menuButtonsActions = {} as ChatInviteActions
  const actions = menuButtonsActions

  promiseCollector.collect((async() => {
    const loadPromises: Promise<unknown>[] = []
    const middleware = tab.middlewareHelper.get()
    // :43-46 — у оригинала здесь `await Promise.all([getChat, p.chatFull])`;
    // чат — из зеркала (расхождение 5), `chatFull` — его аналог `exportedInvite`
    // (расхождение 1). Этот `await` ставит узлы вкладки после корня острова.
    const exportedInvite = await p.exportedInvite
    const chat = cachedChat(toPeerId(chatId as number, true)) as Channel | undefined
    const usernames = chat?.username ? [chat.username] : []

    // title is set by the scaffold (title: 'InviteLinks')
    tab.container.classList.add('chat-folders-container', 'chat-discussion-container')

    const stickerContainer = document.createElement('div')
    stickerContainer.classList.add('sticker-container')

    const caption = document.createElement('div')
    caption.classList.add('caption')
    caption.append(i18n('ChannelLinkInfo'))

    const wrapInviteTitle = (invite: ChatInvite) => {
      return invite.title ? wrapEmojiText(invite.title) : invite.link.split('://').pop()!
    }

    let inviteLink: ChatInviteLink,
      menuInvite: ChatInvite | undefined,
      menuItem: K | undefined,
      primaryInvite: ChatInvite | undefined,
      chatInviteLinkTab: InstanceType<typeof AppChatInviteLinkTab> | undefined
    const menuButtons: ButtonMenuItemOptionsVerifiable[] = [{
      icon: 'copy',
      text: 'CopyLink',
      onClick: () => inviteLink.copyLink(menuInvite?.link),
      verify: () => !menuInvite?.pFlags?.revoked,
    }, {
      icon: 'forward',
      text: 'ShareLink',
      onClick: () => {
        const url = menuInvite?.link || inviteLink.url
        inviteLink.shareLink(url)
      },
      verify: () => !menuInvite ? true : isActiveInvite(menuInvite),
    }, {
      icon: 'edit',
      text: 'InviteLinks.Edit',
      onClick: actions.editLink = async() => {
        const _menuItem = menuItem
        const editTab = slider.createTab(AppEditChatInviteLinkTab)
        editTab.eventListener.addEventListener('finish', (invite) => {
          _menuItem!.destroy()
          _menuItem!.row.container.replaceWith(createInviteRow(invite).container)
        })
        await editTab.open({
          chatId,
          invite: menuInvite,
        })
        if(chatInviteLinkTab) {
          slider.removeTabFromHistory(chatInviteLinkTab)
        }
      },
      verify: () => !!menuInvite && !menuInvite.pFlags?.revoked,
    }, {
      icon: 'delete',
      className: 'danger',
      text: 'RevokeLink',
      onClick: actions.revokeLink = async() => {
        const _menuItem = menuItem
        try {
          await confirmationPopup({
            titleLangKey: 'RevokeLink',
            descriptionLangKey: 'RevokeAlert',
            button: {
              langKey: 'RevokeButton',
              isDanger: true,
            },
          })
        } catch {
          return // расхождение 7
        }

        const invite = _menuItem?.invite || primaryInvite!

        const chatInvite = await managers.groups.editExportedChatInvite({
          chatId,
          link: invite.link,
          revoked: true,
        })

        const editedInvite = chatInvite.invite
        // расхождение 1: замену основной выпускаем сами — у сервера нет `…Replaced`
        const newInvite = _menuItem ? undefined : await managers.groups.exportChatInvite({ chatId })

        if(_menuItem) {
          revokedLinksContent.prepend(_menuItem.row.container)
          _menuItem.update(editedInvite)
        } else {
          const row = createInviteRow(editedInvite)
          revokedLinksContent.prepend(row.container)
          primaryInvite = newInvite
          inviteLink.setChatInvite(primaryInvite!)
        }

        onRevokedLinksUpdate()

        chatInviteLinkTab?.close()
      },
      verify: () => menuInvite ? !menuInvite.pFlags?.revoked : !!primaryInvite,
    }, {
      icon: 'delete',
      className: 'danger',
      text: 'DeleteLink',
      onClick: actions.deleteLink = () => {
        const _menuItem = menuItem!
        void managers.groups.deleteExportedChatInvite(
          chatId,
          _menuItem.invite.link,
        ).then(() => {
          _menuItem.destroy(true)
          onRevokedLinksUpdate()

          chatInviteLinkTab?.close()
        })
      },
      verify: () => !!menuInvite?.pFlags?.revoked,
    }]

    let inviteLinkSection: HTMLElement
    {
      inviteLink = new ChatInviteLink({
        buttons: menuButtons,
        listenerSetter: tab.listenerSetter,
        actions,
        withSubtitle: true,
      })

      inviteLink.subtitle.setAttribute('role', 'button')
      inviteLink.subtitle.tabIndex = 0
      attachClickEvent(inviteLink.subtitle, () => {
        // menuInvite = primaryInvite;
        openLink(primaryInvite!)
      }, { listenerSetter: tab.listenerSetter })

      inviteLinkSection = wrapSolidComponent(() => (
        <Section name="InviteLink">
          {inviteLink.container}
        </Section>
      ), tab.middlewareHelper.get())
    }

    let additionalLinks: HTMLElement, additionalLinksContent!: HTMLElement
    {
      additionalLinks = wrapSolidComponent(() => (
        <Section
          name="InviteLinks.Additional"
          caption="InviteLinks.Description"
          contentProps={{ ref: (element) => additionalLinksContent = element }}
        />
      ), tab.middlewareHelper.get())

      const btn = Button('btn-primary btn-transparent primary', { icon: 'plus', text: 'CreateNewLink' })

      attachClickEvent(btn, () => {
        const editTab = slider.createTab(AppEditChatInviteLinkTab)
        editTab.eventListener.addEventListener('finish', (chatInvite) => {
          const row = createInviteRow(chatInvite)
          if(primaryInvite) {
            additionalLinksContent.prepend(row.container)
          } else {
            additionalLinksContent.firstElementChild!.after(row.container)
          }
        })
        void editTab.open({ chatId })
      }, { listenerSetter: tab.listenerSetter })

      additionalLinksContent.append(btn)
      additionalLinksContent = appendSectionContent(additionalLinks)
    }

    // :231-290 — ссылки других админов (расхождение 2)

    let revokedLinks: HTMLElement, revokedLinksContent!: HTMLElement
    {
      revokedLinks = wrapSolidComponent(() => (
        <Section
          name="RevokedLinks"
          contentProps={{ ref: (element) => revokedLinksContent = element }}
        />
      ), tab.middlewareHelper.get())

      const btn = Button('btn-primary btn-transparent danger', { icon: 'delete', text: 'DeleteAllRevokedLinks' })

      attachClickEvent(btn, async() => {
        try {
          await confirmationPopup({
            titleLangKey: 'DeleteAllRevokedLinks',
            descriptionLangKey: 'ManageLinks.DeleteAll.Confirm',
            button: {
              langKey: 'Delete',
              isDanger: true,
            },
          })
        } catch {
          return // расхождение 7
        }

        const toggle = toggleDisability(btn, true)
        await managers.groups.deleteRevokedExportedChatInvites(chatId)
        toggle()

        Array.from(revokedLinksContent.children).forEach((el) => {
          const cache = invitesMap.get(el as HTMLElement)!
          cache.destroy(true)
        })
        onRevokedLinksUpdate()
      }, { listenerSetter: tab.listenerSetter })

      revokedLinksContent.append(btn)
      revokedLinksContent = appendSectionContent(revokedLinks)
    }

    tab.scrollable.append(
      stickerContainer,
      caption,
      inviteLinkSection,
      additionalLinks,
      revokedLinks,
    )

    const openLink = (invite: ChatInvite) => {
      const detailTab = chatInviteLinkTab = slider.createTab(AppChatInviteLinkTab)
      detailTab.eventListener.addEventListener('close', () => {
        chatInviteLinkTab = menuItem = menuInvite = undefined
      })
      void detailTab.open({
        chatId,
        chatInvite: invite,
        menuButtons,
        actions,
        // `onUpdate: menuItem?.update` (`:347`) — его зовёт только список заявок вкладки ссылки (расхождение 3)
      })
    }

    attachClickEvent(tab.scrollable.container, (e) => {
      const container = findUpClassName(e.target!, 'is-link')
      if(!container) {
        return
      }

      menuItem = invitesMap.get(container)
      menuInvite = menuItem!.invite
      openLink(menuInvite)
    }, { listenerSetter: tab.listenerSetter })

    createContextMenu({
      buttons: menuButtons,
      listenTo: tab.scrollable.container,
      findElement: (e) => {
        const container = findUpClassName(e.target!, 'is-link')
        if(container) {
          menuItem = invitesMap.get(container)
          menuInvite = menuItem!.invite
        }

        return container
      },
      onClose: () => menuItem = menuInvite = undefined,
      middleware,
      listenerSetter: tab.listenerSetter,
    })

    // расхождение 9
    const loadAnimationPromise = p.animationData.then(async(cb) => {
      const player = await cb({
        container: stickerContainer,
        loop: true,
        autoplay: true,
        width: 120,
        height: 120,
        middleware,
      })

      return lottieLoader.waitForFirstFrame(player)
    }).catch(() => {
      renderStaticAssetFallback(stickerContainer, 'UtyanLinks')
    })

    type InviteRow = {
      container: HTMLElement,
      title: HTMLElement,
      subtitle: HTMLElement,
      media: HTMLElement
    }
    type K = {
      row: InviteRow,
      invite: ChatInvite,
      update: (newInvite?: ChatInvite) => void,
      destroy: (unmount?: boolean) => void
    }
    const invitesMap: Map<HTMLElement, K> = new Map()
    const updateCallbacks: Set<() => void> = new Set()

    const createInviteRow = (invite: ChatInvite) => {
      let title!: HTMLDivElement, subtitle!: HTMLDivElement, media!: HTMLDivElement
      // расхождение 4: `subscription_pricing` (`:408-414`)

      const mounted = mountSolidComponent(() => (
        <UsernameRow
          isLink
          icon="limit_link"
          title={wrapInviteTitle(invite)}
          titleRef={(element) => title = element}
          subtitleRef={(element) => subtitle = element}
          mediaRef={(element) => media = element}
        />
      ), middleware)
      const row: InviteRow = {
        container: mounted.element,
        title,
        subtitle,
        media,
      }

      if(!invite.expire_date && !invite.pFlags?.revoked) {
        delete row.media.dataset.color
      }

      let onClean: (() => void) | undefined

      const destroy = (unmount?: boolean) => {
        onClean?.()
        invitesMap.delete(row.container)
        mounted.dispose()
        if(unmount) {
          row.container.remove()
        }
      }

      const update = (newInvite?: ChatInvite) => {
        if(newInvite) {
          invite = cache.invite = newInvite
        }

        const elements: (HTMLElement | string)[] = []
        const joined = invite.usage || 0
        // расхождение 3: `invite.requested` (`:458`)
        const time = tsNow(true)
        const expireDate = invite.expire_date
        const isExpired = !!expireDate && expireDate <= time
        // `joined >= undefined` у оригинала ложно — без лимита предела нет
        const isLimit = !!joined && invite.usage_limit !== undefined && joined >= invite.usage_limit
        const timeLeft = expireDate ? Math.max(0, expireDate - time) : undefined

        if(invite.pFlags?.revoked) {
          elements.push(
            i18n('InviteLink.JoinedRevoked'),
            i18n('ExportedInvitation.Status.Revoked'),
          )

          row.media.dataset.color = 'archive'
          if(circle) {
            circle.parentElement!.remove()
            circle = undefined
          }
          onClean?.()
        } else {
          if(joined) {
            elements.push(i18n('InviteLink.JoinedNew', [joined]))

            if(isLimit) {
              elements.push(i18n('InviteLinks.LimitReached'))
              row.media.dataset.color = 'red'
            } else if(invite.usage_limit) {
              elements.push(i18n('PeopleJoinedRemaining', [invite.usage_limit - joined]))
            }
          } else if(invite.usage_limit && !isExpired) {
            elements.push(i18n('CanJoin', [invite.usage_limit]))
          } else {
            elements.push(i18n(isExpired ? 'InviteLink.JoinedRevoked' : 'Chat.VoiceChat.JoinLink.Participants_ZeroValueHolder'))
          }
        }

        if(!invite.pFlags?.revoked && expireDate) {
          if(!isExpired) {
            elements.push(i18n('InviteLink.Sticker.TimeLeft', [wrapLeftDuration(timeLeft!)]))
          } else {
            row.media.dataset.color = 'red'
            elements.push(i18n('ExportedInvitation.Status.Expired'))
            onClean?.()
          }
        }

        if(!invite.pFlags?.revoked && ((expireDate && !isExpired) || (invite.usage_limit && !isLimit))) {
          const limitProgress = invite.usage_limit ? joined / invite.usage_limit : undefined
          // расхождение 6
          const timeProgress = expireDate ? 1 - timeLeft! / (expireDate - invite.date) : undefined
          const progress = Math.max(limitProgress ?? 0, timeProgress ?? 0)

          // расхождение 8
          const color1 = hexToRgb(customProperties.getProperty('--green-color'))
          const color2 = hexToRgb(customProperties.getProperty('--danger-color'))
          const mixedColor = mixColors(color2, color1, progress)
          const hsla = rgbaToHsla(...mixedColor)
          hsla.s = Math.max(55, hsla.s)
          row.media.style.setProperty('--color', hslaToString(hsla))

          if(circle) {
            totalLength ??= circle.getTotalLength()
            circle.style.strokeDasharray = `${totalLength * (1 - progress)}, ${totalLength}`

            if(isExpired) {
              const c = () => {
                _circle.parentElement!.remove()
              }

              const _circle = circle
              circle = undefined

              setTimeout(c, 400)
            }
          }
        }

        row.subtitle.replaceChildren(...joinElementsWith(elements, ' • '))
      }

      const cache: K = { row, invite, update, destroy }
      invitesMap.set(row.container, cache)

      let circle: SVGCircleElement | undefined, totalLength = 146.70338439941406
      if((invite.expire_date || invite.usage_limit) && isActiveInvite(invite)) {
        if(invite.expire_date) {
          onClean = () => {
            // invitesMap.delete(row);
            updateCallbacks.delete(update)
          }
          updateCallbacks.add(update)
          middleware.onDestroy(onClean)
        }

        // расхождение 8
        const svg = document.createElementNS(SVG_NS, 'svg')
        svg.setAttribute('class', 'usernames-username-icon-svg')
        svg.setAttribute('viewBox', '0 0 51 51')
        const _circle = document.createElementNS(SVG_NS, 'circle')
        _circle.setAttribute('class', 'usernames-username-icon-circle')
        _circle.setAttribute('cx', '25.5')
        _circle.setAttribute('cy', '25.5')
        _circle.setAttribute('r', '23.5')
        svg.append(_circle)
        row.media.append(svg)

        circle = _circle
      }

      update()

      return row
    }

    const onRevokedLinksUpdate = () => {
      revokedLinks.classList.toggle('hide', !revokedLinksContent.childElementCount)
    }

    const loadLinksPromise = Promise.all([p.invites, p.invitesRevoked]).then(([chatInvites, chatInvitesRevoked]) => {
      // расхождение 1, 5
      if(!usernames.length) {
        primaryInvite = exportedInvite
      }

      inviteLink.setChatInvite(primaryInvite || usernames[0])

      ;([
        [chatInvites.invites, additionalLinksContent],
        [chatInvitesRevoked.invites, revokedLinksContent],
      ] as Array<[ChatInvite[], HTMLElement]>).forEach(([invites, content]) => {
        invites.forEach((invite) => {
          if(primaryInvite?.link === invite.link) {
            return
          }

          const row = createInviteRow(invite)
          content.append(row.container)
        })
      })

      onRevokedLinksUpdate()

      const update = () => {
        updateCallbacks.forEach((cb) => cb())
      }

      const updateInterval = setInterval(update, 1000)
      middleware.onDestroy(() => {
        invitesMap.forEach(({ destroy }) => destroy())
        clearInterval(updateInterval)
      })
      tab.listenerSetter.add(rootScope)('theme_changed', () => {
        invitesMap.forEach(({ update }) => update())
      })
    })

    loadPromises.push(loadAnimationPromise, loadLinksPromise)
    await Promise.all(loadPromises)
  })())

  return null
}

export default ChatInviteLinks
