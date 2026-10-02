/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarRight/tabs/groupPermissions/groupPermissions.tsx:1-428
 * (812502980) — вкладка правой колонки «Разрешения» группы: запреты участников
 * по умолчанию (`ChatPermissions`), плата за сообщения (`chargeForMessasgesSection`),
 * медленный режим (`RangeStepsSelector`) и исключения — ограниченные участники.
 * Регистрация — `AppGroupPermissionsTab` в `solidJsTabs/tabs.ts` (tweb `:640-648`);
 * открывает её редактор группы (`editChat`, задача 0б-1; до неё — мост React
 * `group/GroupEditFlow.tsx`). Разметка — дамп
 * `docs/tweb/dom/dumps/15-right-13-group-permissions.json`.
 *
 * Модель сохранения — оригинала: изменения копятся в `createSolidTabState`, а
 * сеть зовётся угловой галочкой в шапке или кнопкой «Save» подтверждения на
 * закрытии (`saveCallbacks`), не на каждом изменении.
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. `editChatDefaultBannedRights` (:89-91) и `toggleSlowMode` (:162-170) — ОДИН
 *     вызов `groups.editChatDefaultBannedRights(peerId, rights, slowmode)`:
 *     бэкенд хранит пару одной ручкой `PUT /chats/{id}/permissions` (разбор у
 *     метода, `core/managers/groupsManager.ts`). Как и у оригинала, права уходят
 *     при любом сохранении; `handleChannelsTooMuch` (:166) не зовётся — ошибки
 *     `CHANNELS_TOO_MUCH` у бэкенда нет, попапа `popups/channelsTooMuch` у нас тоже.
 *  2. `updateChannelPaidMessagesPrice` (:120) → `groups.setChargeStars`
 *     (`PUT /chats/{id}/charge_stars`; менять плату бэкенд даёт только
 *     создателю — `usecase/chat/group_settings.go::SetChatChargeStars`).
 *  3. (О-116 волна 7) «Не ограничивать бустеров» (`doNotRestrictBoostersSection.tsx`,
 *     :174-195, `channels.setBoostsToUnblockRestrictions`) — у бэкенда нет
 *     `boosts_unrestrict` (`domain/mtchat.go::ChannelFull`), секция не портирована.
 *  4. (О-117 волна 7) «Широковещательная группа» (`showConvertToGigagroupPopup`,
 *     :197-217) — гигагрупп у бэкенда нет (`gigagroup`, `megagroup_size_max`).
 *  5. (О-118 волна 7) Исключения только показываются: щелчок по строке и
 *     «Добавить исключение» (:221-247, `openUserPermissionsTab`,
 *     `showPickUserPopup`) открывают права участника — вкладку задачи 0б-7;
 *     до неё у строки «Добавить исключение» нет `clickable`, у списка — щелчка.
 *     Живого обновления списка (`chat_participant`, :307-341) нет: кадра по
 *     участнику на проводе нет (`appSearchSuper.ts`, расхождение 32).
 *  6. `isChannel(chatId)` (:385) у нас всегда истина: любая группа — `channel`
 *     (решение №2), поэтому ветки legacy-чата (`setLength` без загрузки и
 *     `dialog_migrate`, :387-396) нет, `chatId` — `const`.
 *  7. `apiManagerProxy.getChat`/`appChatsManager.getChat` → зеркало `cachedChat`;
 *     `appProfileManager.getChatFull` → `groups.card(peerId).fullChat`;
 *     `getChannelParticipants({filter: channelParticipantsBanned})` →
 *     `groups.channelParticipantsBanned` (без `offset`/`limit`: ручка отдаёт
 *     список целиком); `wrapPeerTitle` → `PeerTitle` (`components/chat/peerTitle.ts`).
 *  8. `useHotReloadGuard` (:31) не портирован — обвязка их дев-сборки.
 */
import { type Component, createSignal, onMount } from 'solid-js'
import replaceContent from '@helpers/dom/replaceContent'
import ScrollableLoader from '@helpers/scrollableLoader'
import { addDialogNew, createChatList, type DialogDom } from '@lib/appDialogsManager'
import { getPeerId, toPeerId } from '@core/peers/peerId'
import { i18n, join, type LangPackKey } from '@lib/langPack'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'
import PeerTitle from '@components/chat/peerTitle'
import RangeStepsSelector from '@components/rangeStepsSelector'
import formatDuration from '@helpers/formatDuration'
import { wrapFormattedDuration } from '@components/wrappers/wrapDuration'
import { cachedChat } from '@core/peerCache'
import type { Channel, ChatBannedRights } from '@core/peers/peer'
import type { ChannelParticipant } from '@core/peers/participant'
import { ChatPermissions, createSolidTabState } from './sharedPermissions'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import type { AppGroupPermissionsTab } from '@components/solidJsTabs/tabs'
import { wrapSolidComponent } from '@helpers/solid/wrapSolidComponent'

type ChannelParticipantBanned = Extract<ChannelParticipant, { _: 'channelParticipantBanned' }>

const GroupPermissions: Component = () => {
  const [tab] = useSuperTab<typeof AppGroupPermissionsTab>()
  const promiseCollector = usePromiseCollector()
  const managers = tab.managers!

  // расхождение 6: `let` оригинала нужен был только `dialog_migrate`
  const chatId = tab.payload.chatId
  const peerId = toPeerId(chatId as number, true)

  const saveCallbacks: Array<() => unknown> = []
  // карта `participants` (:39) нужна только `openPermissions` — О-118, расхождение 5

  const solidState = createSolidTabState<{
    rights?: ChatBannedRights,
    stars?: number,
    slowModeSeconds?: number
  }>({
    tab,
    save: async() => {
      for(const callback of saveCallbacks) {
        await callback()
      }
    },
    unsavedConfirmationProps: {
      descriptionLangKey: 'UnsavedChangesDescription.Group',
    },
  })

  let permissionsContent!: HTMLDivElement
  let slowmodeContent!: HTMLDivElement
  let exceptionsAdd!: HTMLDivElement
  let exceptionsList!: HTMLDivElement
  const [chargeElement, setChargeElement] = createSignal<HTMLElement>()
  const [slowmodeCaption, setSlowmodeCaption] = createSignal<HTMLElement>()

  const build = async() => {
    const chat = cachedChat(peerId) as Channel
    const isChannel = chat._ === 'channel'

    const chatPermissions = new ChatPermissions({
      chatId: chatId,
      listenerSetter: tab.listenerSetter,
      appendTo: permissionsContent,
      forChat: true,
      onSomethingChanged: () => {
        solidState.set({ rights: chatPermissions.takeOut() })
      },
    }, managers)

    solidState.setInitial({ rights: chatPermissions.takeOut() })

    // расхождение 1: вместе с медленным режимом (`range` заводится ниже)
    let range!: RangeStepsSelector<number>
    saveCallbacks.push(() => {
      return managers.groups.editChatDefaultBannedRights(peerId, chatPermissions.takeOut(), range.value)
    })

    if(isChannel) {
      const { default: createChargeForMessagesSection } = await import('./chargeForMessasgesSection.solid')

      const initialStars = +(chat.send_paid_messages_stars ?? 0) || 0
      solidState.setInitial({ stars: initialStars })

      const { element, dispose, promise } = createChargeForMessagesSection({
        initialStars,
        onStarsChange: (stars) => solidState.set({ stars }),
      })

      await promise

      setChargeElement(element)

      tab.middlewareHelper.get().onDestroy(() => dispose())

      saveCallbacks.push(() => {
        const { stars } = solidState.store

        if(initialStars === stars) return
        return managers.groups.setChargeStars(peerId, stars ?? 0)
      })
    }

    const chatFull = (await managers.groups.card(peerId))?.fullChat

    {
      let lastValue: number
      range = new RangeStepsSelector<number>({
        generateStep: (value) => {
          let t: HTMLElement
          if(!value) {
            t = i18n('SlowmodeOff')
          } else {
            const hours = Math.floor(value / 3600)
            const minutes = Math.floor(value / 60) % 60
            const seconds = value % 60
            if(hours) {
              t = i18n('SlowmodeHours', [hours])
            } else if(minutes) {
              t = i18n('SlowmodeMinutes', [minutes])
            } else {
              t = i18n('SlowmodeSeconds', [seconds])
            }
          }

          return [t, value]
        },
        onValue: (value) => {
          if(lastValue === value) {
            return
          }

          solidState.set({ slowModeSeconds: value })

          lastValue = value
          setSlowmodeCaption(value ?
            i18n('SlowmodeInfoSelected', [wrapFormattedDuration(formatDuration(value, 1))]) :
            i18n('SlowmodeInfoOff'))
        },
        middleware: tab.middlewareHelper.get(),
      })

      const values = [0, 5, 10, 30, 60, 300, 900, 3600]
      const steps = range.generateSteps(values)
      const initialValue = chatFull?.slowmode_seconds || 0

      solidState.setInitial({ slowModeSeconds: initialValue })
      range.setSteps(steps, values.indexOf(initialValue))

      slowmodeContent.append(range.container)

      // `toggleSlowMode` (:162-170) — в первом колбэке, расхождение 1
    }

    // «Не ограничивать бустеров» (:174-195) — О-116, расхождение 3;
    // «Широковещательная группа» (:197-217) — О-117, расхождение 4

    {
      let addExceptionSubtitle!: HTMLDivElement
      // `clickable` (showPickUserPopup → openPermissions, :222-234) — О-118, расхождение 5
      const addExceptionRow = wrapSolidComponent(() => (
        <Row>
          <Row.Icon icon="adduser" />
          <Row.Title>{i18n('ChannelAddException')}</Row.Title>
          <Row.Subtitle ref={(el) => addExceptionSubtitle = el}>{i18n('Loading')}</Row.Subtitle>
        </Row>
      ), tab.middlewareHelper.get())

      exceptionsAdd.append(addExceptionRow)

      const list = createChatList({ new: true })
      exceptionsList.append(list)
      // щелчок по строке → `openPermissions` (:255-261) — О-118, расхождение 5

      const setSubtitle = (dom: DialogDom, participant: ChannelParticipantBanned) => {
        const bannedRights = participant.banned_rights
        const defaultBannedRights = (cachedChat(peerId) as Channel).default_banned_rights

        const cantWhat: LangPackKey[] = []
        chatPermissions.fields.forEach((info) => {
          const mainFlag = info.flags[0] as keyof NonNullable<ChatBannedRights['pFlags']>
          if(bannedRights.pFlags?.[mainFlag] && !defaultBannedRights?.pFlags?.[mainFlag]) {
            cantWhat.push(info.exceptionText)
          }
        })

        const el = dom.lastMessageSpan

        if(cantWhat.length) {
          el.replaceChildren(...join(cantWhat.map((t) => i18n(t)), false))
          el.classList.toggle('hide', !cantWhat.length)
        } else {
          el.replaceChildren(i18n('UserRestrictionsBy', [new PeerTitle({
            peerId: toPeerId(participant.kicked_by, false),
            middleware: tab.middlewareHelper.get(),
            managers,
          }).element]))
          el.classList.remove('hide')
        }
      }

      const add = (participant: ChannelParticipantBanned, append: boolean) => {
        const participantPeerId = getPeerId(participant.peer)
        const dialogElement = addDialogNew({
          peerId: participantPeerId,
          container: list,
          rippleEnabled: true,
          avatarSize: 'abitbigger',
          append,
          wrapOptions: {
            middleware: tab.middlewareHelper.get(),
          },
          managers,
        })

        setSubtitle(dialogElement.dom, participant)
      }

      // живое обновление по `chat_participant` (:307-341) — О-118, расхождение 5

      const setLength = () => {
        const el = i18n(exceptionsCount ? 'Permissions.ExceptionsCount' : 'Permissions.NoExceptions', [exceptionsCount])
        replaceContent(addExceptionSubtitle, el)
      }

      let exceptionsCount = 0
      const setLoader = () => {
        const LOAD_COUNT = 50
        const loader = new ScrollableLoader({
          scrollable: tab.scrollable,
          getPromise: () => {
            return managers.groups.channelParticipantsBanned(peerId).then((res) => {
              for(const participant of res.participants) {
                add(participant as ChannelParticipantBanned, true)
              }

              exceptionsCount = res.count
              setLength()

              return res.participants.length < LOAD_COUNT || res.count === list.childElementCount
            })
          },
        })

        return loader.load()
      }

      // расхождение 6: ветки legacy-чата нет
      await setLoader()
    }
  }

  onMount(() => {
    tab.container.classList.add('edit-peer-container', 'group-permissions-container')
    tab.header.append(solidState.saveIcon())
    promiseCollector.collect(build())
  })

  return (
    <>
      <Section name="ChannelPermissionsHeader">
        <div ref={(el) => permissionsContent = el} />
      </Section>
      {chargeElement()}
      <Section name="Slowmode" caption={slowmodeCaption()}>
        <div ref={(el) => slowmodeContent = el} />
      </Section>
      <Section name="PrivacyExceptions">
        <div ref={(el) => exceptionsAdd = el} />
        <div ref={(el) => exceptionsList = el} class="chatlist-container" />
      </Section>
    </>
  )
}

export default GroupPermissions
