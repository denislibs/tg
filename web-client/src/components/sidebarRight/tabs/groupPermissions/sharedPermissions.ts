/**
 * Порт tweb/src/components/sidebarRight/tabs/groupPermissions/sharedPermissions.ts:1-470
 * (812502980) — общий кит вкладок прав, файлом, как у оригинала:
 *  • `ChatPermissions` (:34-163) — тумблеры запретов участника (`chatBannedRights`):
 *    права группы по умолчанию (`groupPermissions.solid.tsx`, `forChat`) и права
 *    конкретного участника (`participant`, вкладка прав участника — задача 0б-7);
 *  • `ChatAdministratorRights` (:165-353) — тумблеры прав админа (`chatAdminRights`),
 *    вкладка прав участника/админа (0б-7);
 *  • `createSolidTabState` (:355-470) — состояние вкладки с угловой галочкой
 *    «Сохранить» в шапке: запись по галочке или по «Save» подтверждения на
 *    закрытии, а не на каждом изменении.
 *
 * Строки — `CheckboxFields` (`components/checkboxFields.solid.tsx`) с
 * `asRestrictions`: снятый тумблер — красный «запрещено».
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. (О-115 волна 7) Флаги, которых нет у бэкенда. Запреты участника у нас —
 *     пять флагов (`backend/internal/domain/mtchat.go:535-544`,
 *     `core/peers/rights.ts::MEMBER_PERM_FLAGS`), поэтому в `ChatPermissions` нет
 *     вложенных под «Отправку медиа» девяти гранулярных запретов
 *     (`send_photos`/`send_videos`/`send_stickers`+`send_gifs`/`send_audios`/
 *     `send_docs`/`send_voices`/`send_roundvideos`/`embed_links`/`send_polls`,
 *     :66-76), запрета форума `manage_topics` (:83) и связок `toggleWith` между
 *     ними (:98-100). «Отправка сообщений» — наш флаг `send_messages`
 *     (у оригинала `send_plain`, :79): у бэкенда он и означает текст. Раз
 *     `send_media` у нас настоящий флаг, а не сводный по вложенным, `takeOut` не
 *     пропускает его (`IGNORE_FLAGS`, :138-140), а `manage_linked_peers`
 *     (:156-158) не переносится — флага нет. У `ChatAdministratorRights` нет
 *     `manage_welcome_messages` (:222-225, отсюда и опция `isBot`), «управления
 *     историями» (:205-209, :227), `manage_call`, `manage_direct_messages`
 *     (:232-236), `manage_linked_peers` (:328-336) и флага `other` (:342-344):
 *     у бэкенда десять прав админа (`adminRightNames`,
 *     `keepPFlags` отбрасывает чужие имена), а снятие админа — своя ручка
 *     (`DELETE /chats/{id}/admins/{userId}`), не пустые права.
 *  2. Ветки legacy-чата `chat` нет (`CHAT_LEGACY_ADMIN_RIGHTS`, :338-341): базовых
 *     групп бэкенд не производит (решение №2, `core/peers/peer.ts::ChatReal`).
 *  3. `apiManagerProxy.getChat` → зеркало `cachedChat` (`core/peerCache.ts`);
 *     `getPeerActiveUsernames(chat)[0]` (:105) → `chat.username` (одно имя,
 *     `core/peers/predicates.ts::isPublic`); `isForum` (:59) у `ChatPermissions`
 *     не читается — его единственный потребитель там, строка `manage_topics`, в п. 1.
 *  4. `banned_rights`/`admin_rights` участника приезжают проводной формой
 *     `ChannelParticipantWire` (`core/managers/groupsManager.ts`), и их тип там
 *     шире схемы; сужение — приведением у чтения (`asBannedRights`/`asAdminRights`).
 *  5. `createSolidTabState`: кнопка подтверждения — наш `PopupButton`
 *     (`popups/popupElement.ts`, у tweb `PopupPeerOptions['buttons'][number]`),
 *     `confirmationPopup` — наш (`popups/popupPeer.ts`).
 */
import type { ChatRights } from '@core/peers/rights'
import { hasRights } from '@core/peers/rights'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import type ListenerSetter from '@helpers/listenerSetter'
import type { Channel, ChatAdminRights, ChatBannedRights } from '@core/peers/peer'
import type { ChannelParticipant } from '@core/peers/participant'
import { isParticipantCreator } from '@core/peers/participant'
import combineParticipantBannedRights from '@core/peers/combineParticipantBannedRights'
import { cachedChat } from '@core/peerCache'
import { toPeerId } from '@core/peers/peerId'
import type { LangPackKey } from '@lib/langPack'
import type SliderSuperTab from '@components/sliderTab'
import CheckboxFields, { type CheckboxFieldsField } from '@components/checkboxFields.solid'
import { createEffect, createRoot, createSignal, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'
import deepEqual from '@helpers/object/deepEqual'
import ButtonIcon from '@components/buttonIcon'
import throttle from '@helpers/schedulers/throttle'
import type { PopupButton } from '@components/popups/popupElement'
import { confirmationPopup, type ConfirmationPopupRejectReason } from '@components/popups/popupPeer'
import toggleDisability from '@helpers/dom/toggleDisability'
import { BANNED_RIGHTS_UNTIL_FOREVER } from '@core/managers/constants'
import type { Managers } from '@/client/bootstrap'

type PermissionsCheckboxFieldsField = CheckboxFieldsField & {
  flags: ChatRights[],
  exceptionText: LangPackKey
}

export type AdministratorRightsCheckboxFieldsField = CheckboxFieldsField & {
  flags: ChatRights[]
}

type ChannelParticipantBanned = Extract<ChannelParticipant, { _: 'channelParticipantBanned' }>
type ChannelParticipantAdminOrCreator = Extract<ChannelParticipant, { _: 'channelParticipantAdmin' | 'channelParticipantCreator' }>

/** Расхождение 4: проводная форма участника шире схемы. */
const asBannedRights = (participant: ChannelParticipantBanned) => participant.banned_rights as ChatBannedRights
const asAdminRights = (participant: ChannelParticipantAdminOrCreator) => participant.admin_rights as ChatAdminRights

export class ChatPermissions extends CheckboxFields<PermissionsCheckboxFieldsField> {
  protected chat!: Channel
  protected rights!: ChatBannedRights
  protected defaultBannedRights!: ChatBannedRights | undefined
  protected untilDate!: number

  constructor(private options: {
    chatId: ChatId,
    listenerSetter: ListenerSetter,
    appendTo: HTMLElement,
    participant?: ChannelParticipantBanned,
    forChat?: boolean,
    onSomethingChanged?: () => void
  }, protected managers: Managers) {
    super({
      listenerSetter: options.listenerSetter,
      fields: [],
      asRestrictions: true,
    })

    this.construct()
  }

  public construct() {
    const options = this.options
    const peerId = toPeerId(options.chatId as number, true)
    const chat = this.chat = cachedChat(peerId) as Channel
    const defaultBannedRights = this.defaultBannedRights = chat.default_banned_rights
    const rights = this.rights = options.participant ?
      combineParticipantBannedRights(chat, asBannedRights(options.participant)) :
      defaultBannedRights ?? { _: 'chatBannedRights', until_date: 0 }
    this.untilDate = rights.until_date || BANNED_RIGHTS_UNTIL_FOREVER

    // :66-84 — вложенные под «Отправку медиа» и `manage_topics`: О-115 (расхождение 1)
    const v: PermissionsCheckboxFieldsField[] = [
      { flags: ['send_messages'], text: 'UserRestrictionsSend', exceptionText: 'UserRestrictionsNoSend' },
      { flags: ['send_media'], text: 'UserRestrictionsSendMedia', exceptionText: 'UserRestrictionsNoSendMedia' },
      { flags: ['invite_users'], text: 'UserRestrictionsInviteUsers', exceptionText: 'UserRestrictionsNoInviteUsers' },
      { flags: ['pin_messages'], text: 'UserRestrictionsPinMessages', exceptionText: 'UserRestrictionsNoPinMessages' },
      { flags: ['change_info'], text: 'UserRestrictionsChangeInfo', exceptionText: 'UserRestrictionsNoChangeInfo' },
    ]

    v.forEach((info) => {
      const mainFlag = info.flags[0]
      info.checked = hasRights(chat, mainFlag, rights)
    })

    this.fields = v

    for(const info of this.fields) {
      if(!options.forChat && defaultBannedRights?.pFlags?.[info.flags[0] as keyof NonNullable<ChatBannedRights['pFlags']>]) {
        info.restrictionText = 'UserRestrictionsDisabled'
      } else if(chat.username && (info.flags.includes('pin_messages') || info.flags.includes('change_info'))) {
        info.restrictionText = options.participant ? 'UserRestrictionsDisabled' : 'EditCantEditPermissionsPublic'
      }
    }

    for(const info of this.fields) {
      if(info.nestedTo) {
        continue
      }

      const { nodes } = this.createField(info)!
      options.appendTo.append(...nodes)
    }

    this.fields.forEach((field) => {
      this.listenerSetter.add(field.checkboxField!.input)('change', () => {
        this.options?.onSomethingChanged?.()
      })
    })
  }

  public setUntilDate(untilDate: number) {
    this.untilDate = untilDate
    this.options.onSomethingChanged?.()
  }

  public takeOut() {
    const pFlags: NonNullable<ChatBannedRights['pFlags']> = {}
    const rights: ChatBannedRights = {
      _: 'chatBannedRights',
      until_date: this.untilDate,
      pFlags,
    }

    // `IGNORE_FLAGS` (`send_media`, :138-140) — расхождение 1
    for(const info of this.fields) {
      const banned = !info.checkboxField!.checked
      if(!banned) {
        continue
      }

      info.flags.forEach((flag) => {
        pFlags[flag as keyof typeof pFlags] = true
      })
    }

    return rights
  }
}

export class ChatAdministratorRights extends CheckboxFields<AdministratorRightsCheckboxFieldsField> {
  protected rights?: ChatAdminRights

  constructor(private options: {
    chatId: ChatId,
    listenerSetter: ListenerSetter,
    appendTo: HTMLElement,
    participant?: ChannelParticipantAdminOrCreator,
    rights?: ChatAdminRights,
    chat?: Channel,
    canEdit?: boolean,
    onSomethingChanged?: () => void,
    fields?: AdministratorRightsCheckboxFieldsField[],
    canGrant?: (right: ChatRights) => boolean,
    preserveUnhandledRights?: boolean
  }) {
    super({
      listenerSetter: options.listenerSetter,
      fields: [],
      asRestrictions: true,
    })

    this.construct()
  }

  public construct() {
    const options = this.options
    const chat = options.chat
    const isBroadcast = !!chat?.pFlags?.broadcast
    const isForum = !!chat?.pFlags?.forum
    const rights = this.rights = options.rights ?? (options.participant ? asAdminRights(options.participant) : undefined)

    const manageMessagesNested: AdministratorRightsCheckboxFieldsField[] | false = isBroadcast && [
      { flags: ['post_messages'], text: 'EditAdminPostMessages' },
      { flags: ['edit_messages'], text: 'EditAdminEditMessages' },
      { flags: ['delete_messages'], text: 'EditAdminDeleteMessages' },
    ]

    const isCreator = isParticipantCreator(options.participant)
    const manageMessagesNestedKey = 'post_messages_nested' as ChatRights
    // расхождение 1: строк без флага у бэкенда нет
    const v: (AdministratorRightsCheckboxFieldsField | false)[] = options.fields?.map((field) => ({
      ...field,
      flags: [...field.flags],
    })) || [
      { flags: ['change_info'], text: isBroadcast ? 'EditAdminChangeChannelInfo' : 'EditAdminChangeGroupInfo' },
      isBroadcast && { flags: [manageMessagesNestedKey], text: 'AdminRights.ManageMessages', nested: manageMessagesNested || undefined },
      !isBroadcast && { flags: ['delete_messages'], text: isBroadcast ? 'EditAdminDeleteMessages' : 'EditAdminGroupDeleteMessages' },
      !isBroadcast && { flags: ['ban_users'], text: 'EditAdminBanUsers' },
      !isBroadcast && { flags: ['invite_users'], text: 'EditAdminAddUsersViaLink' },
      !isBroadcast && { flags: ['pin_messages'], text: 'EditAdminPinMessages' },
      isForum && { flags: ['manage_topics'], text: 'ManageTopicsPermission' },
      isBroadcast && { flags: ['invite_users'], text: 'Channel.EditAdmin.PermissionInviteSubscribers' },
      !isBroadcast && { flags: ['anonymous'], text: 'EditAdminSendAnonymously', checked: rights ? undefined : false },
      { flags: ['add_admins'], text: 'EditAdminAddAdmins', checked: rights ? undefined : isCreator },
    ]

    const map: { [action in ChatRights]?: AdministratorRightsCheckboxFieldsField } = {}
    const fields = v.filter(Boolean) as AdministratorRightsCheckboxFieldsField[]
    if(manageMessagesNested) fields.push(...manageMessagesNested)
    fields.forEach((info) => {
      const mainFlag = info.flags[0]
      map[mainFlag] = info
      info.checked ??= options.canGrant ?
        !!rights?.pFlags?.[mainFlag as keyof NonNullable<ChatAdminRights['pFlags']>] :
        hasRights(chat, mainFlag, rights)
    })

    if(manageMessagesNested) {
      manageMessagesNested.forEach((info) => info.nestedTo = map[manageMessagesNestedKey])
      map[manageMessagesNestedKey]!.toggleWith = { unchecked: manageMessagesNested, checked: manageMessagesNested }
    }

    this.fields = fields

    const CREATOR_EXCEPTIONS: Set<ChatRights> = new Set([
      'anonymous',
    ])

    for(const info of this.fields) {
      const mainFlag = info.flags[0]
      if(!options.canEdit) {
        info.restrictionText = 'EditAdminCantEdit'
      } else if(options.canGrant ?
        !options.canGrant(mainFlag) :
        (isCreator && !CREATOR_EXCEPTIONS.has(mainFlag)) || !hasRights(chat, mainFlag)
      ) {
        info.restrictionText = 'EditCantEditPermissions'
      }
    }

    for(const info of this.fields) {
      if(info.nestedTo) {
        continue
      }

      const { nodes } = this.createField(info)!
      options.appendTo.append(...nodes)
    }

    this.fields.forEach((field) => {
      this.listenerSetter.add(field.checkboxField!.input)('change', () => {
        this.options?.onSomethingChanged?.()
      })
    })
  }

  public takeOut() {
    const pFlags: Record<string, true> = this.options.preserveUnhandledRights ?
      { ...this.rights?.pFlags } :
      {}

    for(const info of this.fields) {
      info.flags.forEach((flag) => {
        delete pFlags[flag]
      })
      if(!info.checkboxField!.checked) {
        continue
      }

      info.flags.forEach((flag) => {
        pFlags[flag] = true
      })
    }

    // `manage_linked_peers`, legacy-чат и `other` (:328-344) — расхождения 1, 2
    const rights: ChatAdminRights = {
      _: 'chatAdminRights',
      pFlags: pFlags as ChatAdminRights['pFlags'],
    }

    return rights
  }
}

type CreateSolidTabStateProps = {
  tab: SliderSuperTab,
  save: () => Promise<unknown>,
  alwaysShowSave?: boolean,
  unsavedConfirmationProps?: Partial<Pick<Parameters<typeof confirmationPopup>[0], 'titleLangKey' | 'descriptionLangKey' | 'button'>>
}

export const createSolidTabState = <StateStore extends object>({ tab, save, alwaysShowSave, unsavedConfirmationProps = {} }: CreateSolidTabStateProps) => createRoot((dispose) => {
  tab.middlewareHelper.get().onDestroy(dispose)

  const initialState: StateStore = {} as StateStore

  const [store, set] = createStore<StateStore>({} as StateStore)
  const [saveIcon] = createSignal<HTMLElement>(ButtonIcon('check primary appear-zoom', { ariaLabel: 'Save' }))
  const [saving, setSaving] = createSignal(false)
  const [valid, setValid] = createSignal(true)

  const [hasChanges, setHasChanges] = createSignal(false)
  const throttledSetHasChanges = throttle(setHasChanges, 200, true)

  createEffect(() => {
    throttledSetHasChanges(!deepEqual(store, initialState))
  })

  createEffect(() => {
    if(!saveIcon()) return

    saveIcon().classList.toggle(
      'appear-zoom--active',
      hasChanges() || !!alwaysShowSave,
    )
  })

  createEffect(() => {
    toggleDisability(saveIcon(), !valid() || saving())
  })

  const initiateSaving = async() => {
    setSaving(true)
    try {
      await save()
      dispose()
      void tab.close()
    } catch(err) {
      setSaving(false)
      throw err
    }
  }

  const detach = attachClickEvent(saveIcon(), () => void initiateSaving())
  onCleanup(detach)

  tab.isConfirmationNeededOnClose = async() => {
    if(!hasChanges() || saving()) return

    const saveButton: PopupButton = unsavedConfirmationProps.button || {
      langKey: 'Save',
    }

    try {
      await confirmationPopup({
        button: saveButton,
        buttons: [
          saveButton,
          { isCancel: true, langKey: 'Discard' },
        ],
        titleLangKey: 'UnsavedChanges',
        descriptionLangKey: 'UnsavedChangesDescription',
        ...unsavedConfirmationProps,
        rejectWithReason: true,
      })

      await initiateSaving()
    } catch(_reason: unknown) {
      const reason = _reason as ConfirmationPopupRejectReason

      if(reason !== 'canceled') {
        throw new Error()
      }
    }
  }

  onCleanup(() => {
    tab.isConfirmationNeededOnClose = undefined
  })

  return {
    setInitial: (state: Partial<StateStore>) => {
      Object.assign(initialState, state)
      set(state as StateStore)
    },

    store,
    set,
    saveIcon,

    saving,

    valid,
    setValid,

    hasChanges,

    dispose,

    save: initiateSaving,
  }
})
