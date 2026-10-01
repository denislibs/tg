/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/newGroup.tsx` (812502980) — второй
 * шаг «Новой группы» (`AppNewGroupTab`, `solidJsTabs/tabs.ts`). Открывает его
 * `takeOut` вкладки выбора участников (`createNewGroupTab.ts`). Дамп —
 * `docs/tweb/dom/dumps/14-left-31-new-group-name.json`.
 *
 *   div.tabs-tab.new-group-container
 *     .sidebar-content
 *       .scrollable
 *         Section > button.avatar-edit + div.input-wrapper (имя + скрытое «Location»)
 *         Section[.hide без участников] «N members» > ul.chatlist.chatlist-new > строки
 *       button.btn-corner (создать)
 *
 * Расхождения с оригиналом:
 *  1. Группа «рядом» (`isGeoChat`, геолокация, OpenStreetMap, `createChannel`
 *     с `geo_point`, :21-31, :67-94, :127-151, :204-211) не портирована: у tweb
 *     её никто не открывает (`AppNewGroupTab` открывают только
 *     `createNewGroupTab.ts:9` и сообщества). Поле «Location» оставлено скрытым,
 *     как у оригинала вне этой ветки (:212-213), — разметка та же.
 *  2. `onCreate`/`openAfter`/`title`/`asChannel` (:39, :152-167, :186-188) —
 *     нагрузка добавления чата в сообщество (`communities/addChatToCommunity.tsx`),
 *     сообществ нет (О-5 волны 7): группа всегда создаётся `createChat`, после
 *     создания всегда открывается, имя-черновик — всегда из участников.
 *  3. `appChatsManager.createChat` → `managers.groups.createChat` (тот же
 *     ответ `{chatId, missingInvitees}`), `editPhoto(chatId, inputFile)` →
 *     `managers.groups.setPhoto(peerId, mediaId)` — фото ставится ключом пира
 *     и id залитого медиа (шапка `components/avatarEdit.ts`, расхождение 3;
 *     класс общий с «Новым каналом», задача 0а-3).
 *  4. `appImManager.setInnerPeer` → `core/navigation/openPeer.ts` (роль
 *     `setInnerPeer`, пока `AppImManager` не портирован — этап 4).
 *  5. `handleMissingInvitees` (`addChatUsers.ts:15`, попап «пригласить
 *     ссылкой») не портирован — нет `showPickUserPopup` (О-35 волны 7):
 *     пропущенные настройкой приватности просто не попадают в группу.
 *  6. `appUsersManager.getUser`/`getSelf` → `managers.peers.getUsers` (тот же
 *     порядок, что `Promise.all` оригинала); свой пользователь — по
 *     `rootScope.myId`.
 *  7. `ButtonCorner` без `ariaLabel` — шапка `components/buttonCorner.ts`.
 */
import { onCleanup, onMount } from 'solid-js'
import InputField from '@components/inputField'
import AvatarEdit, { type AvatarEditPayload } from '@components/avatarEdit'
import ButtonCorner from '@components/buttonCorner'
import Section from '@components/section.solid'
import { addDialogNew, createChatList } from '@lib/appDialogsManager'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import type { AppNewGroupTab } from '@components/solidJsTabs/tabs'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import toggleDisability from '@helpers/dom/toggleDisability'
import { unwrapSolidElement } from '@helpers/solid/wrapSolidComponent'
import rootScope from '@lib/rootScope'
import { getUserStatusString } from '@core/presence'
import { openPeer } from '@core/navigation/openPeer'
import { toPeerId, toUserId } from '@core/peers/peerId'

const NewGroup = () => {
  const [tab] = useSuperTab<typeof AppNewGroupTab>()
  const promiseCollector = usePromiseCollector()
  const managers = tab.managers!

  const { peerIds } = tab.payload

  let uploadAvatar: AvatarEditPayload | null = null
  let nextBtn!: HTMLButtonElement

  // :44-46
  const avatarEdit = new AvatarEdit((_upload) => {
    uploadAvatar = _upload
  }, { managers })

  // :48-57
  const groupNameInputField = new InputField({
    label: 'CreateGroup.NameHolder',
    maxLength: 128,
  })

  const groupLocationInputField = new InputField({
    label: 'ChatLocation',
    name: 'location',
    canBeEdited: false,
  })

  // :59-61
  const list = createChatList({
    new: true,
  })

  onMount(() => {
    tab.container.classList.add('new-group-container')

    const inputWrapper = document.createElement('div')
    inputWrapper.classList.add('input-wrapper')

    inputWrapper.append(
      groupNameInputField.container,
      groupLocationInputField.container,
    )

    // :105-110 (без ветки `isGeoChat` — расхождение 1)
    tab.listenerSetter.add(groupNameInputField.input)('input', () => {
      const value = groupNameInputField.value
      const valueCheck = !!value.length && !groupNameInputField.input.classList.contains('error')
      nextBtn.classList.toggle('is-visible', valueCheck)
    })

    nextBtn = ButtonCorner({ icon: 'arrow_next' })

    // :114-190 (ветка `createChat` — расхождения 1–5)
    attachClickEvent(nextBtn, () => {
      const groupTitle = groupNameInputField.value
      const userIds = peerIds.map(toUserId)
      const toggle = toggleDisability(nextBtn, true)

      managers.groups.createChat(groupTitle, userIds)
      .then((result) => {
        if(uploadAvatar) {
          const peerId = toPeerId(result.chatId, true)
          void uploadAvatar.file().then((mediaId) => managers.groups.setPhoto(peerId, mediaId))
        }

        return result
      })
      .then(({ chatId }) => {
        tab.close()
        openPeer(managers, { id: toPeerId(chatId, true), title: groupTitle })
        // О-35 волна 7: `handleMissingInvitees(chatId, missingInvitees)` (расхождение 5)
      }).catch((err: unknown) => {
        console.error('createGroup error', err)
        toggle()
      })
    }, { listenerSetter: tab.listenerSetter })

    // :192-208
    const section = unwrapSolidElement(
      <Section>
        {avatarEdit.container}
        {inputWrapper}
      </Section>,
    ) as HTMLElement

    const chatsSection = unwrapSolidElement(
      <Section
        class={!peerIds.length ? 'hide' : undefined}
        name="Members"
        nameArgs={[peerIds.length]}
      >
        {list}
      </Section>,
    ) as HTMLElement

    tab.content.append(nextBtn)
    tab.scrollable.append(section, chatsSection)

    // :212-213
    groupLocationInputField.container.classList.add('hide')

    // :216-235
    const usersPromise = managers.peers.getUsers(peerIds)
    const myUserPromise = managers.peers.getUsers([rootScope.myId]).then(([user]) => user)

    const a = usersPromise.then((users) => {
      users.forEach((user) => {
        const { dom } = addDialogNew({
          peerId: toPeerId(user.id),
          container: list,
          rippleEnabled: false,
          avatarSize: 'abitbigger',
          wrapOptions: {
            middleware: tab.middlewareHelper.get(),
          },
          managers,
        })

        dom.lastMessageSpan.append(getUserStatusString(user))
      })
    })

    // :239-253 (без `title` из нагрузки — расхождение 2)
    const setTitlePromise = peerIds.length > 0 && peerIds.length < 5 ? Promise.all([usersPromise, myUserPromise]).then(([users, myUser]) => {
      const names = users.map((user) => [user.first_name, user.last_name, user.username].find(Boolean))
      names.unshift(myUser?.first_name)

      names[0] = names[0] + ' & ' + names.splice(1, 1)[0]
      groupNameInputField.setDraftValue(names.join(', '))
    }) : Promise.resolve()

    promiseCollector.collect(Promise.all([a, setTitlePromise]))
  })

  // :258-261
  onCleanup(() => {
    avatarEdit.clear()
    uploadAvatar = null
  })

  return null
}

export default NewGroup
