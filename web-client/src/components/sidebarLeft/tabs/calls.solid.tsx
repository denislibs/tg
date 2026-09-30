/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/calls.tsx:1-439` (812502980) —
 * вкладка «Звонки» левой колонки: раздел Calls tdesktop
 * (`calls/calls_box_controller.cpp`), нарисованный строками tweb.
 *
 * У оригинала три части сверху вниз: действие «Начать новый звонок», блок
 * «Активные видеочаты» и сам журнал — поиск без пира по
 * `inputMessagesFilterPhoneCalls`, постранично, свёрнутый в строки
 * `groupCallLogMessages` (`lib/calls/helpers/callLog.ts`). Здесь есть только
 * журнал; первые две части — Отложено с номером (ниже).
 *
 * Расхождения с оригиналом:
 *  1. «Начать новый звонок» (`ConferenceCall.Create.Action` → `AppNewCallTab`,
 *     :421-431) — О-1 волны 7: у tweb строка стоит под
 *     `IS_CONFERENCE_CALL_SUPPORTED && IS_GROUP_CALL_SUPPORTED`, а вкладка
 *     `newCall.tsx` целиком про конференцию (пустая, по ссылке, с несколькими
 *     приглашёнными; один выбранный — лишь частный случай). Конференций на
 *     бэкенде нет (`backend/internal/domain/mtmessage.go:894`), поэтому нет ни
 *     строки, ни вкладки. По той же причине у строки журнала нет ветки
 *     `conferenceMsgId` (`joinConference`, иконка `group`).
 *  2. Блок «Активные видеочаты» (`ActiveGroupCalls`, :166-230) — О-46 волны 7:
 *     оригинал строит его из флага `call_not_empty` карточек чатов
 *     (`appGroupCallsManager.getActiveGroupCalls`), а наш бэкенд этого флага не
 *     производит (`backend/internal/domain/mtchat.go:170` — «предмета не имеют»).
 *  3. Меню «⋮» в шапке (:350-366) не заводится: у обоих его пунктов нет
 *     предмета. «Динамики и камера» открывает `AppSpeakersAndCameraTab` —
 *     вкладки ещё нет, это задача 2D-26 (ВРЕМЕННО до 2D-26: меню появится с
 *     ней). «Удалить все звонки» зовёт `messages.deletePhoneCallHistory` — ручки
 *     на бэкенде нет, О-45 волны 7.
 *  4. Страница журнала — `managers.calls.log(offset, limit)` (`GET /calls`),
 *     а не `getHistory({inputFilter: phoneCalls, offsetId})`: ручка листает
 *     СМЕЩЕНИЕМ, а не `offset_id`. Смещение считается по всем полученным
 *     сообщениям страницы — та же роль, что сдвиг курсора «за каждое сообщение
 *     страницы» у оригинала (:295-299). Звонок, пришедший между страницами,
 *     сдвинет выдачу на одно сообщение, и оно придёт повторно — дубль гасит
 *     ключ `peerId_id` в `addMessages`.
 *  5. Порядок журнала — по дате, а не по `mid` (:268-271): у tweb номера
 *     сообщений личных чатов — одна последовательность на аккаунт, у нас номер
 *     живёт внутри чата (`core/history/messageId.ts`), и сравнивать номера
 *     разных чатов нельзя. Сервер отдаёт страницу по глобальному id
 *     (`messagesrepo.go:458`), сортировка по дате стабильна и этот порядок
 *     сохраняет.
 *  6. События `history_multiappend`/`history_delete` (:370-378) → наши
 *     `history_append`/`history_delete` зеркала окон
 *     (`core/history/messagesMirror.ts`): у нас «новое сообщение» одно событие
 *     на своё и чужое (см. `web-client/CLAUDE.md`, «Градиент обоев»).
 *  7. `AvatarNewTsx`/`PeerTitleTsx` — наши императивные `avatarNew`
 *     (`components/avatar.ts`) и `PeerTitle` (`components/chat/peerTitle.ts`)
 *     узлом в `Row.Media`/`Row.Title`, как у `sidebarRight/savedDialogsTab`.
 *     `withIcons` (значки верификации/премиума) у нашего `PeerTitle` нет.
 *  8. Вызовы `appImManager` — до его порта (этап 4/5 волны 7): перезвон —
 *     наш движок звонков (ВРЕМЕННО до 5-5), «Показать в чате» —
 *     `requestMessageJump` + `openPeer`, тот же мост, что у строки чатлиста
 *     (`components/dialogRow.ts:361-373`), удаление — vanilla-попап
 *     `openDeleteMessageDialog` (ВРЕМЕННО до 2C-8).
 *  9. Отступление В7-6: кнопка перезвона есть и в Firefox — `IS_CALL_SUPPORTED`
 *     у нас отвечает за НАШ движок звонков (`RTCPeerConnection` +
 *     `getUserMedia`), а не повторяет UA-гейт tweb `webrtcSupport.ts`.
 */
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'
import Button from '@components/buttonTsx.solid'
import { IconTsx } from '@components/iconTsx.solid'
import { avatarNew } from '@components/avatar'
import PeerTitle from '@components/chat/peerTitle'
import { openDeleteMessageDialog } from '@components/messages/ChatDialogs'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import IS_CALL_SUPPORTED from '@environment/callSupport'
import classNames from '@helpers/string/classNames'
import { formatFullSentTime, formatTime } from '@helpers/date'
import { i18n } from '@lib/langPack'
import { logger } from '@lib/logger'
import rootScope from '@lib/rootScope'
import { startOutgoing } from '@core/calls/callEngine'
import { gradientFor } from '@core/dialogToChat'
import { requestMessageJump } from '@core/messageLink'
import { openPeer } from '@core/navigation/openPeer'
import { cachedPeer, cachedUser, peerTitle } from '@core/peerCache'
import { getPeerTitle, getUserTitle } from '@core/peers/getPeerTitle'
import { getPeerPhoto, getPeerPhotoId } from '@core/peers/peer'
import { isUser } from '@core/peers/peerId'
import type { Managers } from '@/client/bootstrap'
import {
  type CallLogGroup,
  type CallLogMessage,
  groupCallLogMessages,
  isCallLogMessage,
} from '@lib/calls/helpers/callLog'
import styles from '@components/sidebarLeft/tabs/calls.module.scss'

// tdesktop называет константы `kFirstPageCount = 20` / `kPerPageCount = 100`,
// но в запросе использует их наоборот — первая страница у него сотня
// (calls_box_controller.cpp:565). Копировать стоит именно поведение: первая
// страница в 20 сворачивается в так мало строк, что вторая грузится прямо на
// глазах. Следующие страницы — тоже по сотне, по той же причине (tweb :50-55).
const PER_PAGE_COUNT = 100

const log = logger('CALLS-TAB')

function isToday(dateSec: number) {
  const a = new Date(dateSec * 1000)
  const b = new Date()
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

/** Ключ сообщения журнала: номер живёт внутри чата (расхождение 5 в шапке). */
const messageKey = (message: CallLogMessage) => `${message.peerId}_${message.id}`

/**
 * ВРЕМЕННО до 5-5: роль `appImManager.callUser(peerId.toUserId(), type)`
 * (tweb :108). Движок звонков берёт КАРТОЧКУ собеседника, а не ключ, — собирается
 * она так же, как у перезвона по баблу (`components/chat/VanillaFeed.tsx:268-282`).
 */
function callUser(peerId: PeerId, video: boolean) {
  const user = cachedUser(peerId)
  const name = getUserTitle(user)
  startOutgoing(
    {
      id: peerId,
      name,
      avatar: gradientFor(peerId),
      avatarText: name.charAt(0).toUpperCase(),
      photoId: user?._ === 'user' ? getPeerPhotoId(user.photo) : 0,
    },
    video,
    peerId,
  )
}

/**
 * «12:30» сегодня, «вчера в 12:30» накануне, «3 февр. в 12:30» раньше —
 * `lng_call_box_status_*` tdesktop из собственных хелперов дат tweb. Больше
 * одного звонка в строке — перед временем их число, как у всех клиентов (:70-90).
 */
function CallStatusText(props: { group: CallLogGroup }) {
  const time = () => {
    const { date } = props.group
    return isToday(date) ? formatTime(new Date(date * 1000)) : formatFullSentTime(date)
  }

  return (
    <span class={styles.text}>
      {props.group.mids.length > 1 ?
        i18n('Calls.Status.Group', [props.group.mids.length, time()]) :
        time()}
    </span>
  )
}

function CallRow(props: {
  group: CallLogGroup
  onDelete: (group: CallLogGroup) => void
}) {
  const [tab] = useSuperTab()
  const managers = tab.managers as Managers

  // Аватар и имя — императивные узлы (расхождение 7); их зона актуальности —
  // строка, дочерняя к зоне вкладки: уходит строка — гаснут и они.
  const middlewareHelper = tab.middlewareHelper.get().create()
  onCleanup(() => middlewareHelper.destroy())
  const avatar = avatarNew({
    peerId: props.group.peerId,
    size: 42,
    isDialog: true,
    middleware: middlewareHelper.get(),
    managers,
  }).node
  const title = new PeerTitle({ peerId: props.group.peerId, middleware: middlewareHelper.get(), managers }).element

  const callBack = () => {
    callUser(props.group.peerId, props.group.video)
  }

  const showInChat = () => {
    // tweb `appImManager.setInnerPeer({peerId, lastMsgId})` (:111-116) —
    // прыжок ставится ДО открытия, лента потребляет его, когда чат откроется.
    const { peerId, mids } = props.group
    requestMessageJump(peerId, mids[0])
    const peer = cachedPeer(peerId)
    openPeer(managers, {
      id: peerId,
      title: getPeerTitle({ peerId, peer }),
      username: peer?._ === 'user' ? peer.username : undefined,
      photoId: getPeerPhotoId(getPeerPhoto(peer)) || undefined,
    })
  }

  // Отступление В7-6: флаг — поддержка НАШЕГО движка звонков, без UA-гейта
  // tweb против Firefox (`environment/callSupport.ts`).
  const canCallBack = () => isUser(props.group.peerId) && IS_CALL_SUPPORTED

  return (
    <Row
      clickable={showInChat}
      role="button"
      tabIndex={0}
      contextMenu={{
        buttons: [{
          icon: 'message',
          text: 'Message.Context.Goto',
          onClick: showInChat,
        }, {
          icon: 'delete',
          className: 'danger',
          text: 'Delete',
          onClick: () => props.onDelete(props.group),
        }],
      }}
    >
      <Row.Media size="abitbigger" element={avatar} />
      <Row.Title class="text-bold">{title}</Row.Title>
      <Row.Subtitle>
        <span class={styles.status}>
          <IconTsx
            icon="arrow_next"
            class={classNames(
              styles.arrow,
              props.group.direction === 'out' && styles.out,
              props.group.direction === 'missed' && styles.missed,
            )}
          />
          <CallStatusText group={props.group} />
        </span>
      </Row.Subtitle>
      <Show when={canCallBack()}>
        <Row.RightContent>
          <Button.Icon
            icon={props.group.video ? 'videocamera' : 'phone'}
            aria-label={i18n('CallBack').textContent!}
            // Своё действие, а не украшение строки, — поэтому, в отличие от
            // большинства кнопок-иконок, остаётся в порядке табуляции (:152-154).
            tabIndex={0}
            onClick={(e: MouseEvent) => {
              e.stopPropagation()
              callBack()
            }}
          />
        </Row.RightContent>
      </Show>
    </Row>
  )
}

const Calls = () => {
  const [tab] = useSuperTab()
  const promiseCollector = usePromiseCollector()
  const managers = tab.managers as Managers

  const [messages, setMessages] = createSignal<CallLogMessage[]>([])
  const [groups, setGroups] = createStore<{ list: CallLogGroup[] }>({ list: [] })
  const [loaded, setLoaded] = createSignal(false)

  let loading = false
  let offset = 0

  const isEmpty = createMemo(() => loaded() && !groups.list.length)

  createEffect(() => {
    // Keyed reconcile: подгрузка старых звонков — или живой новый — не трогает
    // строки, которые не изменились (и их аватарки).
    setGroups('list', reconcile(groupCallLogMessages(messages()), { key: 'id', merge: false }))
  })

  const addMessages = (added: CallLogMessage[]) => {
    if(!added.length) {
      return
    }

    setMessages((current) => {
      const byKey = new Map(current.map((message) => [messageKey(message), message]))
      added.forEach((message) => byKey.set(messageKey(message), message))
      // По дате, а не по номеру — расхождение 5 в шапке.
      return Array.from(byKey.values()).sort((a, b) => b.date - a.date)
    })
  }

  const removeMessages = (peerId: PeerId, mids: Set<number>) => {
    setMessages((current) => {
      const next = current.filter((message) => !(message.peerId === peerId && mids.has(message.id)))
      return next.length === current.length ? current : next
    })
  }

  const loadMore = () => {
    if(loading || loaded()) {
      return
    }

    loading = true
    const promise = managers.calls.log(offset, PER_PAGE_COUNT).then((result) => {
      const found = result.messages || []
      // Сдвиг за КАЖДОЕ сообщение страницы, звонок оно или нет: сообщение,
      // которое мы не рисуем, не должно застопорить листание (:295-299).
      offset += found.length

      // Короткая страница — конец журнала: ждать пустую значит потратить круг
      // до сервера, пока список всё ещё выглядит так, будто в нём есть ещё (:301-306).
      if(found.length < PER_PAGE_COUNT) {
        setLoaded(true)
        tab.scrollable.onScrolledBottom = undefined
      }

      addMessages(found.filter(isCallLogMessage))
    }, (error: unknown) => {
      // Упавшая страница не должна защёлкнуть список — следующий скролл повторит.
      log.error('loading the call log failed', error)
    }).finally(() => {
      loading = false
      if(!loaded()) {
        tab.scrollable.checkForTriggers()
      }
    })

    promiseCollector.collect(promise)
  }

  // ВРЕМЕННО до 2C-8: `showDeleteMessagesPopup(peerId, mids, ChatType.Chat)`
  // (tweb :323-329). Журнал — только личные чаты, а в личном чате tweb разрешает
  // «удалить у обоих» для всего, кроме кубика (`deleteMessages.ts:110-125`);
  // пакетной ручки нет — по одному сообщению, как у `useMessageActions`.
  const deleteGroup = (group: CallLogGroup) => {
    const mids = group.mids.slice()
    const remove = (revoke: boolean) => {
      for(const mid of mids) {
        managers.messages.deleteMessage(group.peerId, mid, revoke).catch((error: unknown) => {
          log.error('deleting a call failed', error)
        })
      }
    }

    openDeleteMessageDialog({
      peerId: group.peerId,
      managers,
      canRevoke: true,
      count: mids.length,
      chatType: 'private',
      peerFirstName: peerTitle(group.peerId, { onlyFirstName: true }),
      onDeleteForEveryone: () => remove(true),
      onDeleteForMe: () => remove(false),
    })
  }

  onMount(() => {
    tab.container.classList.add('calls-container')

    // Звонок, случившийся при открытой вкладке, встаёт наверх и сливается со
    // строкой над ним, если ей принадлежит (tdesktop подписан на
    // `MessageUpdate::NewAdded` по той же причине, :368-374).
    tab.listenerSetter.add(rootScope)('history_append', ({ message }) => {
      if(isCallLogMessage(message)) {
        addMessages([message])
      }
    })

    tab.listenerSetter.add(rootScope)('history_delete', ({ peerId, msgs }) => {
      removeMessages(peerId, msgs)
    })

    tab.scrollable.onScrolledBottom = loadMore
    loadMore()

    // Первую страницу собирает слайдер, поэтому она разрешается, пока вкладка
    // ещё за краем экрана, — и `checkForTriggers` из `finally` в `loadMore`
    // меряет скроллер нулевой высоты и ничего не зовёт. Без этого толчка
    // первая страница, не переполнившая список, не догрузила бы вторую (:390-399).
    void tab.shown.then(() => {
      if(!loaded()) {
        tab.scrollable.checkForTriggers()
      }
    })
  })

  onCleanup(() => {
    tab.scrollable.onScrolledBottom = undefined
  })

  return (
    <>
      <Show when={groups.list.length}>
        <Section contentProps={{ class: styles.list }}>
          <For each={groups.list}>{(group) => (
            <CallRow group={group} onDelete={deleteGroup} />
          )}</For>
        </Section>
      </Show>
      <Show when={isEmpty()}>
        <div class={styles.empty}>
          <div class={styles.emptyTitle}>{i18n('NoRecentCalls')}</div>
          <div class={styles.emptyDescription}>{i18n('NoRecentCallsInfo')}</div>
        </div>
      </Show>
    </>
  )
}

export default Calls
