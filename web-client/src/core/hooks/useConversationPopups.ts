import { useState } from 'react'

/** Якорь всплывающего меню/панели: координаты из getBoundingClientRect. */
export interface MenuAnchor {
  top: number
  right: number
}
/** Якорь attach-меню (от левого-нижнего угла кнопки). */
export interface AttachAnchor {
  left: number
  bottom: number
}

/**
 * Реестр UI-попапов колонки чата: ~22 независимых toggle-состояния оверлеев
 * (инфо-панель, меню шапки/треда, подтверждения, пикеры, попапы канала…).
 * Вынесены из ConversationView, чтобы контроллер остался тонким, а
 * <ConversationOverlays> получал одну сущность вместо ~40 отдельных пропсов.
 * Никакой бизнес-логики — только видимость; открывают их хендлеры контроллера,
 * закрывают сами оверлеи.
 */
export function useConversationPopups() {
  const [infoOpen, setInfoOpen] = useState(false)
  // ⋮-меню тред-шапки (tweb topbar в треде)
  const [threadMenu, setThreadMenu] = useState<MenuAnchor | null>(null)
  // «Закреплённые сообщения» (tweb topbar.openPinned)
  const [pinnedOpen, setPinnedOpen] = useState(false)
  const [headerMenu, setHeaderMenu] = useState<MenuAnchor | null>(null)
  const [giftPopupOpen, setGiftPopupOpen] = useState(false)
  const [themePickerOpen, setThemePickerOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [addContactOpen, setAddContactOpen] = useState(false)
  const [editContactOpen, setEditContactOpen] = useState(false)
  const [attachAnchor, setAttachAnchor] = useState<AttachAnchor | null>(null)
  const [createPollOpen, setCreatePollOpen] = useState(false)
  const [createChecklistOpen, setCreateChecklistOpen] = useState(false)
  const [boostOpen, setBoostOpen] = useState(false)
  const [createGiveawayOpen, setCreateGiveawayOpen] = useState(false)
  const [streamOpen, setStreamOpen] = useState(false)
  // Предложка постов: компоновщик предложки (не-постер) и список предложек (админ).
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestedOpen, setSuggestedOpen] = useState(false)
  const [contactPickerOpen, setContactPickerOpen] = useState(false)
  const [locationPickerOpen, setLocationPickerOpen] = useState(false)
  // Запланированные сообщения: оверлей списка
  const [scheduledOpen, setScheduledOpen] = useState(false)
  // Попап длительности mute (tweb PopupMute): null — ещё не монтировали.
  const [muteOpen, setMuteOpen] = useState<boolean | null>(null)

  return {
    infoOpen, setInfoOpen,
    threadMenu, setThreadMenu,
    pinnedOpen, setPinnedOpen,
    headerMenu, setHeaderMenu,
    giftPopupOpen, setGiftPopupOpen,
    themePickerOpen, setThemePickerOpen,
    confirmDelete, setConfirmDelete,
    confirmClear, setConfirmClear,
    addContactOpen, setAddContactOpen,
    editContactOpen, setEditContactOpen,
    attachAnchor, setAttachAnchor,
    createPollOpen, setCreatePollOpen,
    createChecklistOpen, setCreateChecklistOpen,
    boostOpen, setBoostOpen,
    createGiveawayOpen, setCreateGiveawayOpen,
    streamOpen, setStreamOpen,
    suggestOpen, setSuggestOpen,
    suggestedOpen, setSuggestedOpen,
    contactPickerOpen, setContactPickerOpen,
    locationPickerOpen, setLocationPickerOpen,
    scheduledOpen, setScheduledOpen,
    muteOpen, setMuteOpen,
  }
}

export type ConversationPopups = ReturnType<typeof useConversationPopups>
