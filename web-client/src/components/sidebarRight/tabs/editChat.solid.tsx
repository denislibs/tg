/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarRight/tabs/editChat.tsx:1-726` (812502980) —
 * вкладка правой колонки «Изменить» группы и канала (`AppEditChatTab`,
 * `solidJsTabs/tabs.ts`, tweb `tabs.ts:723-727`). Задача 0б-1 плана волны 7, шаг
 * каркаса К-5. Открывает её кнопка «Изменить» общих медиа (tweb
 * `sharedMedia.tsx:674-702`: `createTab(AppEditChatTab).open({chatId})`).
 *
 *   .sidebar-content > div > button.btn-corner (сохранить, только при правке)   (:602-614)
 *   scrollable > div (корень острова):
 *     .avatar-edit (AvatarEdit или .disable-hover без права менять инфо)        (:616-640)
 *     Section.no-delimiter[PeerInfo.SetAboutDescription] > .input-wrapper        (:642-663)
 *     Section[ForumToggleDescription | DiscussionInfo] — строки настроек         (:665-810)
 *     Section — «Подписывать сообщения» (канал)                                  (:895-922)
 *     Section — «История чата» (группа)                                          (:924-938)
 *     Section — «Удалить канал» / «Удалить и выйти»                              (:967-977)
 *
 * Модель сохранения — оригинала: название, описание и фото уходят в сеть только
 * по угловой кнопке (`save`, :408-436), после чего вкладка закрывается; правка
 * полей лишь показывает кнопку (`isDirty`). Закрытие без кнопки — отказ от
 * правки, как у оригинала. Тумблеры (темы, подписи, история) пишут сразу.
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. Данные (`loadEditChatData`, :79-99) — одна карточка `groups.card(peerId)`
 *     (`chat` + `fullChat`) и каталог реакций `getAvailableReactions` (общий кэш
 *     сессии, `chat/reactions.ts`; поле `inactive` вместо `pFlags.inactive`).
 *     `appConfig`, `joinedCommunities` не грузятся: их потребители — строки п. 4–5.
 *  2. Миграции группы нет (`dialog_migrate`, `onMigrate`, :102-131, :371-375):
 *     базовых групп сервер не производит, любая наша группа — уже `channel`
 *     (как у `chatType.solid.tsx`, расхождение 4). Поэтому вместо ресурса по
 *     сигналу `chatId` — один запрос.
 *  3. Заявки (:700-708), реакции (:710-718), обсуждение (:743-761) и
 *     админы/участники/удалённые (:849-873) вернула пачка П-1 (Б-39…Б-41).
 *     `PeerTitleTsx` подписи обсуждения — узел `PeerTitle` (`chat/peerTitle.ts`)
 *     на своей миддлвари, как `AvatarPlaceholder` (п. 9).
 *  4. Строк без предмета у нас нет совсем (Б-105): личные сообщения канала
 *     (монофорум, :720-731), приветственные сообщения (layer 229, :377-406,
 *     :763-771), «Недавние действия» (админ-лог, :773-790).
 *  5. Секций без бэкенда нет (Б-106): доходы (`TransactionHistorySection`,
 *     :812-816), стикеры и эмодзи группы (:818-847), автоперевод канала
 *     (:875-893), сообщество (:940-965); вместе с ними — `handleChannelsTooMuch`
 *     у тумблеров тем и истории (лимита каналов сервер не знает).
 *  6. Порог тем (`forum_upgrade_participants_min`, :203-207): `help.getAppConfig`
 *     у нас нет, а сервер включает темы в группе любого размера — условие
 *     числа участников опущено.
 *  7. Менеджеры — наши ручки: `editTitle` + `editAbout` (:412-417) — один
 *     `groups.editInfo` (`PATCH /chats/{id}`; текущее имя чата передаётся как
 *     есть, ручка пишет все три поля); `editPhoto` — `groups.setPhoto` по
 *     `media_id` (`AvatarEdit`, расхождение 3 его шапки); `toggleForum` —
 *     `groups.setForum`; `toggleSignatures` — `channels.setSignatures`;
 *     `togglePreHistoryHidden(!value)` — `groups.setHistory(value)`.
 *  8. `chat_update`/`chat_full_update` (:352-370): краткая форма — из зеркала
 *     пиров (`subscribePeerMirror`, писатель — воркер). Полная перечитывается
 *     (`groups.card`) на кадры `rt:chat_update` и `rt:chat_participant` этого
 *     чата — это поводы `refreshFullPeer` оригинала (`channel_update`,
 *     `invalidateChannelParticipants`), после которых он и шлёт
 *     `chat_full_update`. Из самого снимка `chat_update` полную форму не берём:
 *     он общий на всех участников и счётчиков зрителя (`admins_count`,
 *     `kicked_count`, `requests_pending`) не несёт. Включение тем кадра не шлёт
 *     (`usecase/chat/topic.go::SetForum`) — после него карточка перечитывается
 *     так же.
 *  9. `AvatarNewTsx` — `AvatarPlaceholder` ниже: императивный `avatarNew` со
 *     своей миддлварью на время показа.
 * 10. `showDeleteDialogPopup` — наш попап (`popups/deleteDialog.ts`) с
 *     `managers` вторым аргументом и `onSelect` последним (его расхождение 5).
 * 11. Ссылок у строки «Пригласительные ссылки» (:688-697) — подпись `1`, как у
 *     оригинала; `getInitArgs` берёт `managers` первым аргументом (шапка
 *     `chatInviteLinkShared.ts`, расхождение 6).
 */
import { createEffect, createMemo, createResource, createSignal, onCleanup, Show, type Component } from 'solid-js'
import { Portal } from 'solid-js/web'
import AvatarEdit, { type AvatarEditPayload } from '@components/avatarEdit'
import { avatarNew } from '@components/avatar'
import Button from '@components/buttonTsx.solid'
import CheckboxFieldTsx from '@components/checkboxFieldTsx.solid'
import { InputFieldTsx } from '@components/inputFieldTsx.solid'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'
import { toastNew } from '@components/toast'
import PeerTitle from '@components/chat/peerTitle'
import { getAvailableReactions } from '@components/chat/reactions'
import showDeleteDialogPopup from '@components/popups/deleteDialog'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import {
  AppChatAdministratorsTab,
  AppChatDiscussionTab,
  AppChatInviteLinksTab,
  AppChatMembersTab,
  AppChatReactionsTab,
  AppChatRequestsTab,
  AppChatTypeTab,
  AppGroupPermissionsTab,
  AppRemovedUsersTab,
  type AppEditChatTab,
} from '@components/solidJsTabs/tabs'
import type SidebarSlider from '@components/slider'
import cancelEvent from '@helpers/dom/cancelEvent'
import numberThousandSplitter from '@helpers/number/numberThousandSplitter'
import { getMiddleware } from '@helpers/middleware'
import { subscribeOn } from '@helpers/solid/subscribeOn'
import { i18n, type LangPackKey } from '@lib/langPack'
import rootScope from '@lib/rootScope'
import { RT } from '@core/realtime/events'
import { cachedChat, subscribePeerMirror } from '@core/peerCache'
import { getPeerId, toPeerId } from '@core/peers/peerId'
import { hasRights, type ChatRights } from '@core/peers/rights'
import type { Channel, ChannelFull } from '@core/peers/peer'
import type { Managers } from '@/client/bootstrap'

// :60-74 — флаги прав в объёме бэкенда (О-115 волны 7, `sharedPermissions.ts`)
const PERMISSION_FLAGS = [
  'send_messages',
  'send_media',
  'invite_users',
  'pin_messages',
  'change_info',
] as const satisfies readonly ChatRights[]

type EditChatTab = InstanceType<typeof AppEditChatTab>

async function loadEditChatData(tab: EditChatTab, chatId: ChatId) {
  // расхождение 1
  const [card, availableReactions] = await Promise.all([
    tab.managers!.groups.card(toPeerId(chatId as number, true)),
    getAvailableReactions(tab.managers!) ?? [],
  ])
  return card && {
    chatId,
    chatFull: card.fullChat,
    chat: card.chat,
    availableReactions,
  }
}

type EditChatData = NonNullable<Awaited<ReturnType<typeof loadEditChatData>>>

const EditChatTab: Component = () => {
  const [tab] = useSuperTab<typeof AppEditChatTab>()
  const promiseCollector = usePromiseCollector()
  // расхождение 2
  const initialPromise = loadEditChatData(tab, tab.payload.chatId)

  tab.container.classList.add('edit-peer-container', 'edit-group-container')
  promiseCollector.collect(initialPromise)

  const [data] = createResource(() => initialPromise)

  return (
    <Show when={data()} keyed>
      {(loaded) => <EditChatForm data={loaded} />}
    </Show>
  )
}

export default EditChatTab

/** `AvatarNewTsx` оригинала (расхождение 9). */
function AvatarPlaceholder(props: { peerId: PeerId, managers: Managers }) {
  const middlewareHelper = getMiddleware()
  onCleanup(() => middlewareHelper.destroy())
  const avatar = avatarNew({
    peerId: props.peerId,
    size: 120,
    middleware: middlewareHelper.get(),
    managers: props.managers,
  })
  avatar.node.classList.add('avatar-placeholder')
  return avatar.node
}

/** `PeerTitleTsx` оригинала (расхождение 3). */
function PeerTitleNode(props: { peerId: PeerId, managers: Managers }) {
  const middlewareHelper = getMiddleware()
  onCleanup(() => middlewareHelper.destroy())
  return new PeerTitle({
    peerId: props.peerId,
    middleware: middlewareHelper.get(),
    managers: props.managers,
  }).element
}

function EditChatForm(props: { data: EditChatData }) {
  const [tab] = useSuperTab<typeof AppEditChatTab>()
  const managers = tab.managers!
  const slider = tab.slider as SidebarSlider
  const [chat, setChat] = createSignal<Channel>(props.data.chat)
  const [chatFull, setChatFull] = createSignal<ChannelFull>(props.data.chatFull)
  const [title, setTitle] = createSignal(props.data.chat.title)
  const [about, setAbout] = createSignal(props.data.chatFull.about || '')
  const [saving, setSaving] = createSignal(false)
  const [hasAvatarPreview, setHasAvatarPreview] = createSignal(false)
  const [topicsBusy, setTopicsBusy] = createSignal(false)
  const [signaturesBusy, setSignaturesBusy] = createSignal(false)
  const [historyBusy, setHistoryBusy] = createSignal(false)
  const [deleting, setDeleting] = createSignal(false)
  let uploadAvatar: AvatarEditPayload | undefined
  let alive = true

  const chatId = () => props.data.chatId
  const peerId = () => toPeerId(chatId() as number, true)
  const channel = () => chat()
  const isBroadcast = () => !!channel().pFlags?.broadcast
  const isForum = () => !!channel().pFlags?.forum
  const isAdmin = () => hasRights(chat(), 'just_admin')
  const isChannel = () => chat()._ === 'channel'
  const canInviteUsers = () => hasRights(chat(), 'invite_users')
  const canChangeType = () => hasRights(chat(), 'change_type')
  const canChangePermissions = () => hasRights(chat(), 'change_permissions')
  const canToggleForum = () => hasRights(chat(), 'toggle_forum')
  const canChangeInfo = () => hasRights(chat(), 'change_info')
  const canDeleteChat = () => hasRights(chat(), 'delete_chat')
  const canPostMessages = () => hasRights(chat(), 'post_messages')
  const canManageInviteLinks = () => hasRights(chat(), 'invite_links')
  const linkedChatId = () => chatFull().linked_chat_id
  const availableReactionsLength = props.data.availableReactions.filter((reaction) => {
    return !reaction.inactive
  }).length

  const avatarEdit = new AvatarEdit((payload) => {
    uploadAvatar = payload
    setHasAvatarPreview(true)
  }, { managers })

  const isDirty = createMemo(() => {
    return title() !== props.data.chat.title ||
      about() !== (props.data.chatFull.about || '') ||
      hasAvatarPreview()
  })
  const canSave = createMemo(() => {
    return isDirty() && !!title().trim() && !saving()
  })
  // расхождение 6
  const showTopics = createMemo(() => {
    return canToggleForum() && !isBroadcast()
  })
  const showDiscussion = createMemo(() => {
    return isAdmin() && (isBroadcast() || !!linkedChatId())
  })
  // расхождение 3: только строки, которые здесь есть
  const hasMainSettings = createMemo(() => {
    return canChangeType() ||
      canManageInviteLinks() ||
      (canInviteUsers() && isAdmin()) ||
      (canChangeInfo() && isAdmin()) ||
      (canChangePermissions() && !isBroadcast()) ||
      showDiscussion() ||
      showTopics()
  })
  const mainCaption = createMemo<LangPackKey | undefined>(() => {
    if(showTopics()) {
      return 'ForumToggleDescription'
    }

    if(isAdmin()) {
      return 'DiscussionInfo'
    }
  })

  const reactionsSubtitle = createMemo(() => {
    const reactions = chatFull().available_reactions ?? { _: 'chatReactionsNone' } as const
    if(reactions._ === 'chatReactionsSome') {
      const length = reactions.reactions.length
      return length === availableReactionsLength ?
        i18n('ReactionsAll') :
        `${length}/${availableReactionsLength}`
    }

    return i18n(reactions._ === 'chatReactionsAll' ? 'ReactionsAll' : 'Checkbox.Disabled')
  })

  // :282-291; `PrivacySettingsController.Paid` — у 0б-6 (`send_paid_messages_stars`)
  const permissionsSubtitle = createMemo(() => {
    return PERMISSION_FLAGS.reduce((count, flag) => {
      return count + +hasRights(chat(), flag, chat().default_banned_rights)
    }, 0) + '/' + PERMISSION_FLAGS.length
  })

  // :303-321 (у базовой группы — `chatParticipants`; базовых групп нет, расхождение 2)
  const administratorsCount = createMemo(() => {
    const count = chatFull().admins_count
    return count || 1
  })
  const membersCount = createMemo(() => {
    return numberThousandSplitter(chatFull().participants_count ?? 0)
  })
  const removedUsersSubtitle = createMemo(() => {
    const count = chatFull().kicked_count || 0
    return count ? numberThousandSplitter(count) : i18n('NoBlockedUsers')
  })

  const [topics, setTopics] = createSignal(isForum())
  const [signMessages, setSignMessages] = createSignal(!!channel().pFlags?.signatures)
  const [showProfiles, setShowProfiles] = createSignal(
    !!channel().pFlags?.signatures && !!channel().pFlags?.signature_profiles,
  )
  const [showChatHistory, setShowChatHistory] = createSignal(!chatFull().pFlags?.hidden_prehistory)

  createEffect(() => {
    avatarEdit.container.classList.toggle('is-forum', isForum())
  })
  createEffect(() => {
    setTopics(isForum())
    setSignMessages(!!channel().pFlags?.signatures)
    setShowProfiles(!!channel().pFlags?.signatures && !!channel().pFlags?.signature_profiles)
  })
  createEffect(() => {
    setShowChatHistory(!chatFull().pFlags?.hidden_prehistory)
  })

  // расхождение 8 — `chat_update`
  onCleanup(subscribePeerMirror(() => {
    const updatedChat = cachedChat(peerId())
    if(alive && updatedChat?._ === 'channel' && updatedChat !== chat()) {
      setChat(updatedChat)
    }
  }))
  const refreshCard = async() => {
    const card = await managers.groups.card(peerId())
    if(alive && card) {
      setChat(card.chat)
      setChatFull(card.fullChat)
    }
  }

  // расхождение 8 — `chat_full_update`
  subscribeOn(rootScope)(RT.chatUpdate, (evt) => {
    if(alive && getPeerId(evt.peer) === peerId()) {
      void refreshCard()
    }
  })
  subscribeOn(rootScope)(RT.chatParticipant, (update) => {
    if(alive && toPeerId(update.channel_id, true) === peerId()) {
      void refreshCard()
    }
  })

  const save = async() => {
    if(!canSave()) {
      return
    }

    const promises: Promise<unknown>[] = []
    // расхождение 7
    if(title() !== props.data.chat.title || about() !== (props.data.chatFull.about || '')) {
      promises.push(managers.groups.editInfo(peerId(), {
        title: title(),
        about: about(),
        username: chat().username ?? '',
      }))
    }
    if(uploadAvatar) {
      promises.push(uploadAvatar.file().then((mediaId) => {
        return managers.groups.setPhoto(peerId(), mediaId)
      }))
    }

    setSaving(true)
    try {
      await Promise.all(promises)
      tab.close()
    } catch(error) {
      console.error('edit chat error', error)
      toastNew({ langPackKey: 'Error.AnError' })
    } finally {
      setSaving(false)
    }
  }

  const toggleTopics = async(value: boolean) => {
    if(linkedChatId()) {
      setTopics(!value)
      toastNew({ langPackKey: 'ChannelTopicsDiscussionForbidden' })
      return
    }

    setTopicsBusy(true)
    try {
      await managers.groups.setForum(peerId(), value)
      await refreshCard() // расхождение 8
    } catch(error) {
      setTopics(!value)
      console.error('toggleForum error', error)
    } finally {
      setTopicsBusy(false)
    }
  }

  const toggleSignMessages = async(value: boolean) => {
    const profiles = value && showProfiles()
    setSignaturesBusy(true)
    try {
      await managers.channels.setSignatures(peerId(), value, profiles)
    } catch(error) {
      setSignMessages(!value)
      console.error('toggleSignatures error', error)
    } finally {
      setSignaturesBusy(false)
    }
  }
  const toggleShowProfiles = async(value: boolean) => {
    setSignaturesBusy(true)
    try {
      await managers.channels.setSignatures(peerId(), signMessages(), value)
    } catch(error) {
      setShowProfiles(!value)
      console.error('toggle signature profiles error', error)
    } finally {
      setSignaturesBusy(false)
    }
  }
  const toggleChatHistory = async(value: boolean) => {
    setHistoryBusy(true)
    try {
      await managers.groups.setHistory(peerId(), value)
    } catch(error) {
      setShowChatHistory(!value)
      console.error('togglePreHistoryHidden error:', error)
    } finally {
      setHistoryBusy(false)
    }
  }

  // расхождение 10
  const deleteChat = () => {
    if(deleting()) {
      return
    }

    showDeleteDialogPopup(peerId(), managers, undefined, undefined, (promise) => {
      setDeleting(true)
      promise.then(() => {
        tab.close()
      }, () => {
        setDeleting(false)
      })
    })
  }

  onCleanup(() => {
    alive = false
    avatarEdit.clear()
    uploadAvatar = undefined
  })

  return (
    <>
      <Portal mount={tab.content}>
        <Show when={isDirty()}>
          <Button.Corner
            class="is-visible"
            icon="check"
            aria-label={i18n('Save').textContent ?? undefined}
            disabled={!canSave()}
            tabIndex={0}
            onClick={() => void save()}
          />
        </Show>
      </Portal>

      <Show
        when={canChangeInfo()}
        fallback={(
          <div
            class="avatar-edit disable-hover"
            classList={{ 'is-forum': isForum() }}
          >
            <AvatarPlaceholder peerId={peerId()} managers={managers} />
          </div>
        )}
      >
        {avatarEdit.container}
        <Portal mount={avatarEdit.container}>
          <Show when={!hasAvatarPreview()}>
            <AvatarPlaceholder peerId={peerId()} managers={managers} />
          </Show>
        </Portal>
      </Show>

      <Section noDelimiter caption="PeerInfo.SetAboutDescription">
        <div class="input-wrapper">
          <InputFieldTsx
            label={isBroadcast() ? 'EnterChannelName' : 'CreateGroup.NameHolder'}
            name="chat-name"
            maxLength={255}
            required
            value={title()}
            onRawInput={setTitle}
            disabled={!canChangeInfo()}
          />
          <InputFieldTsx
            label="DescriptionPlaceholder"
            name="chat-description"
            maxLength={255}
            withLinebreaks
            value={about()}
            onRawInput={setAbout}
            disabled={!canChangeInfo()}
          />
        </div>
      </Section>

      <Show when={hasMainSettings()}>
        <Section caption={mainCaption()}>
          <Show when={canChangeType()}>
            <Row clickable={() => {
              void slider.createTab(AppChatTypeTab).open({
                chatId: chatId(),
                chatFull: chatFull(),
              })
            }}>
              <Row.Icon icon="lock_filled" />
              <Row.Title>{i18n(isBroadcast() ? 'ChannelType' : 'GroupType')}</Row.Title>
              <Row.Subtitle>{i18n((() => {
                const isPublic = !!channel().username
                if(isBroadcast()) {
                  return isPublic ? 'TypePublic' : 'TypePrivate'
                }

                return isPublic ? 'TypePublicGroup' : 'TypePrivateGroup'
              })())}</Row.Subtitle>
            </Row>
          </Show>

          <Show when={canManageInviteLinks()}>
            <Row clickable={() => {
              void slider.createTab(AppChatInviteLinksTab).open({
                chatId: chatId(),
                p: AppChatInviteLinksTab.getInitArgs(managers, chatId()),
              })
            }}>
              <Row.Icon icon="link_filled" />
              <Row.Title>{i18n('InviteLinks')}</Row.Title>
              <Row.Subtitle>1</Row.Subtitle>
            </Row>
          </Show>

          <Show when={canInviteUsers() && isAdmin() && !!chatFull().requests_pending}>
            <Row clickable={() => {
              void slider.createTab(AppChatRequestsTab).open(chatId())
            }}>
              <Row.Icon icon="adduser" />
              <Row.Title>{i18n(isBroadcast() ? 'SubscribeRequests' : 'MemberRequests')}</Row.Title>
              <Row.Subtitle>{chatFull().requests_pending}</Row.Subtitle>
            </Row>
          </Show>

          <Show when={canChangeInfo() && isAdmin()}>
            <Row clickable={() => {
              void slider.createTab(AppChatReactionsTab).open({ chatId: chatId() })
            }}>
              <Row.Icon icon="reactions_filled" />
              <Row.Title>{i18n('Reactions')}</Row.Title>
              <Row.Subtitle>{reactionsSubtitle()}</Row.Subtitle>
            </Row>
          </Show>

          {/* Б-105 — личные сообщения канала (:720-731) */}

          <Show when={canChangePermissions() && !isBroadcast()}>
            <Row clickable={() => {
              void slider.createTab(AppGroupPermissionsTab).open({ chatId: chatId() })
            }}>
              <Row.Icon icon="key_filled" />
              <Row.Title>{i18n('ChannelPermissions')}</Row.Title>
              <Row.Subtitle>{permissionsSubtitle()}</Row.Subtitle>
            </Row>
          </Show>

          <Show when={showDiscussion()}>
            <Row clickable={() => {
              void slider.createTab(AppChatDiscussionTab).open({
                chatId: chatId(),
                linkedChatId: linkedChatId(),
              })
            }}>
              <Row.Icon icon="bubble_filled" />
              <Row.Title>{i18n(isBroadcast() ? 'PeerInfo.Discussion' : 'LinkedChannel')}</Row.Title>
              <Row.Subtitle>
                <Show when={linkedChatId()} fallback={i18n('PeerInfo.Discussion.Add')} keyed>
                  {(id) => <PeerTitleNode peerId={toPeerId(id, true)} managers={managers} />}
                </Show>
              </Row.Subtitle>
            </Row>
          </Show>

          {/* Б-105 — приветственные сообщения (:763-771), «Недавние действия»
              (:773-790) */}

          <Show when={showTopics()}>
            <Row clickable={linkedChatId() ? (event) => {
              toastNew({ langPackKey: 'ChannelTopicsDiscussionForbidden' })
              cancelEvent(event)
            } : undefined}>
              <Row.CheckboxFieldToggle>
                <CheckboxFieldTsx
                  toggle
                  signal={[topics, setTopics]}
                  disabled={topicsBusy()}
                  onChange={(value) => void toggleTopics(value)}
                />
              </Row.CheckboxFieldToggle>
              <Row.Icon icon="topics_filled" />
              <Row.Title>{i18n('Topics')}</Row.Title>
            </Row>
          </Show>
        </Section>
      </Show>

      {/* Б-106 — доходы (:812-816), стикеры группы (:818-847) */}

      <Section>
        <Row clickable={() => {
          void slider.createTab(AppChatAdministratorsTab).open({ chatId: chatId() })
        }}>
          <Row.Icon icon="admin_filled" />
          <Row.Title>{i18n('PeerInfo.Administrators')}</Row.Title>
          <Row.Subtitle>{administratorsCount()}</Row.Subtitle>
        </Row>
        <Row clickable={() => {
          void slider.createTab(AppChatMembersTab).open(chatId())
        }}>
          <Row.Icon icon="newgroup_filled" />
          <Row.Title>{i18n(isBroadcast() ? 'PeerInfo.Subscribers' : 'GroupMembers')}</Row.Title>
          <Row.Subtitle>{membersCount()}</Row.Subtitle>
        </Row>
        <Show when={isChannel()}>
          <Row clickable={() => {
            void slider.createTab(AppRemovedUsersTab).open({ chatId: chatId() })
          }}>
            <Row.Icon icon="person_crossed_filled" />
            <Row.Title>{i18n('ChannelBlockedUsers')}</Row.Title>
            <Row.Subtitle>{removedUsersSubtitle()}</Row.Subtitle>
          </Row>
        </Show>
      </Section>

      {/* Б-106 — автоперевод (:875-893) */}

      <Show when={isBroadcast() && canPostMessages()}>
        <Section caption={showProfiles() ? 'ChannelSignProfilesInfo' : 'ChannelSignMessagesInfo'}>
          <Row disabled={signaturesBusy()}>
            <Row.CheckboxFieldToggle>
              <CheckboxFieldTsx
                toggle
                signal={[signMessages, setSignMessages]}
                disabled={signaturesBusy()}
                onChange={(value) => void toggleSignMessages(value)}
              />
            </Row.CheckboxFieldToggle>
            <Row.Title>{i18n('ChannelSignMessages')}</Row.Title>
          </Row>
          <Show when={signMessages()}>
            <Row disabled={signaturesBusy()}>
              <Row.CheckboxFieldToggle>
                <CheckboxFieldTsx
                  toggle
                  signal={[showProfiles, setShowProfiles]}
                  disabled={signaturesBusy()}
                  onChange={(value) => void toggleShowProfiles(value)}
                />
              </Row.CheckboxFieldToggle>
              <Row.Title>{i18n('ChannelSignMessagesWithProfile')}</Row.Title>
            </Row>
          </Show>
        </Section>
      </Show>

      <Show when={!isBroadcast() && canChangeType()}>
        <Section>
          <Row disabled={historyBusy()}>
            <Row.CheckboxFieldToggle>
              <CheckboxFieldTsx
                toggle
                signal={[showChatHistory, setShowChatHistory]}
                disabled={historyBusy()}
                onChange={(value) => void toggleChatHistory(value)}
              />
            </Row.CheckboxFieldToggle>
            <Row.Title>{i18n('ChatHistory')}</Row.Title>
          </Row>
        </Section>
      </Show>

      {/* Б-106 — сообщество (:940-965) */}

      <Show when={canDeleteChat()}>
        <Section>
          <Button
            class="btn-primary btn-transparent danger"
            disabled={deleting()}
            icon="delete"
            text={isBroadcast() ? 'PeerInfo.DeleteChannel' : 'DeleteAndExitButton'}
            onClick={deleteChat}
          />
        </Section>
      </Show>
    </>
  )
}
