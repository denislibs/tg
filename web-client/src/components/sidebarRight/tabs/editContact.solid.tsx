/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarRight/tabs/editContact.tsx:1-373` (812502980) —
 * вкладка правой колонки «Изменить контакт» / «Добавить контакт»
 * (`AppEditContactTab`, `solidJsTabs/tabs.ts`, tweb `tabs.ts:509-513`). Задача
 * 0б-10 плана волны 7 (`docs/superpowers/plans/2026-09-30-wave-7-shell-sidebars.md`).
 * Открывают её у tweb карандаш профиля (`sharedMedia.tsx:685`) и «Добавить в
 * контакты» шапки (`topbar.ts:905-906`); у нас — мост из React-панели после
 * `AppSidebarRight` (0б-0).
 *
 *   .sidebar-content > button.btn-circle.btn-corner (сохранить, EditPeer)       (:204)
 *   scrollable:
 *     div.avatar-edit > .avatar.avatar-placeholder                                (:207-209)
 *     div.profile-name > span.peer-title                                          (:222-226)
 *     div.profile-subtitle «EditContact.OriginalName»                             (:228-230)
 *     Section.no-delimiter > div.input-wrapper (имя, фамилия, заметка) + строки    (:291-296)
 *       контакт: Row «Notifications» с переключателем; новый: Row телефона         (:235-288)
 *     контакт:  Section[caption UserInfo.CustomPhotoHelp] > кнопки личного фото    (:119-125)
 *               Section > кнопка «PeerInfo.DeleteContact»                          (:303-321)
 *     новый, номер скрыт правилом: Section[caption …ShareMyPhoneNumber.Desc] > Row (:322-342)
 *
 * Модель сохранения — оригинала: сеть только по угловой кнопке (`:344-367`),
 * поля на каждом вводе лишь двигают её видимость (`EditPeer.handleChange`).
 *
 * Расхождения с оригиналом:
 *  1. Менеджеры — наши ручки воркера: `isContact` → `contacts.isContact`,
 *     `getPrivacy('inputPrivacyKeyPhoneNumber')` → `privacy.rule('phone_number')`,
 *     `getUser` → `peers.getUsers`, `addContact` → `contacts.add`,
 *     `deleteContacts` → `contacts.del`, `uploadContactProfilePhoto({save})` для
 *     сброса → `contacts.clearPhoto`, `togglePeerMute` → `groups.setMute`.
 *  2. Правило номера — в форме экрана (`PrivacyRule`, `privacyManager.ts`), а не
 *     вектором. Условие оригинала «есть `privacyValueDisallowAll`» (`:322-325`) у
 *     Telegram истинно и для «Мои контакты» (`[AllowContacts, DisallowAll]`), и для
 *     «Никто»; наш провод пишет «контакты» одним `AllowContacts`
 *     (`domain/mtprivacy.go::PrivacyRulesOf`), поэтому то же условие здесь —
 *     `value !== 'everybody'`: номер не виден новому контакту в обоих случаях.
 *  3. `getProfile` → `privacy.profile` (`GET /users/{id}`): он не кэшируется и
 *     каждый раз идёт в сеть, поэтому `refreshFullPeer` (`:135`) перед
 *     перестройкой секции фото не нужен — свежий ответ и есть сброс кэша.
 *  4. Заметка — `InputField` без эмодзи-кнопки (`InputFieldEmoji` — rich-путь,
 *     О-28 плана 2D): исходное значение — `note.text`, на запись уходит
 *     `textWithEntities` без разметки (`updateUserNote`, `profile.updateUserNote`).
 *  5. `showBirthdayPopup`/`suggestUserBirthday` — мост
 *     `popups/birthday.bridge.tsx` (ВРЕМЕННО до 2C-14, React `BirthdayModal`).
 *  6. Выбор и загрузка фото — мост `pickAvatarAndUpload.bridge.tsx`
 *     (ВРЕМЕННО до 2D-27, класс `AvatarEdit`).
 *  7. Мьют читается мостом зеркала диалогов (`chatsStore.dialogs[].notify_settings`,
 *     тот же источник, что `peerProfile.solid.tsx::Notifications`): подписка —
 *     на слушателях вкладки, как `rootScope` `notify_settings` у оригинала (`:213-220`).
 *  8. `wrapPeerTitle` (`:326`) и `PeerTitle` — наш `chat/peerTitle.ts` с
 *     `managers`/`middleware`; `toggleDisability` (`:307`) — атрибутом `disabled`
 *     (снят у нас задачей 9 плана 2D, как в `editFolder.solid.tsx`).
 *  9. `addContact` без `phone` (`:352`): у нас номер — вход добавления по номеру
 *     (`contact_id = 0`), а здесь пир известен.
 */
import { createSignal, type Signal } from 'solid-js'
import InputField from '@components/inputField'
import EditPeer from '@components/editPeer'
import CheckboxFieldTsx from '@components/checkboxFieldTsx.solid'
import Button from '@components/button'
import PeerTitle from '@components/chat/peerTitle'
import Row from '@components/rowTsx.solid'
import confirmDeleteContacts from '@components/popups/deleteContacts'
import { i18n } from '@lib/langPack'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import { renderComponent } from '@helpers/solid/renderComponent'
import { formatUserPhone } from '@core/format/phone'
import Section from '@components/section.solid'
import { wrapSolidComponent } from '@helpers/solid/wrapSolidComponent'
import { toastNew } from '@components/toast'
import { pickAvatarAndUpload } from '@components/pickAvatarAndUpload.bridge'
// ВРЕМЕННО до 2C-14 — `@components/popups/birthday` (расхождение 5)
import showBirthdayPopup, { suggestUserBirthday } from '@components/popups/birthday.bridge'
import { confirmationPopup } from '@components/popups/popupPeer'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import type { AppEditContactTab } from '@components/solidJsTabs/tabs'
import { useChatsStore } from '@stores/chatsStore'
import { isPeerMuted } from '@core/dialogs/notifySettings'

const noop = () => {}

const EditContact = () => {
  const [tab] = useSuperTab<typeof AppEditContactTab>()
  const promiseCollector = usePromiseCollector()
  const peerId = tab.payload
  const managers = tab.managers!

  // расхождение 1 — `appUsersManager.getUser`
  const getUser = async(userId: number) => (await managers.peers.getUsers([userId]))[0]
  // расхождение 3 — `appProfileManager.getProfile`
  const getProfile = async(userId: number) => (await managers.privacy.profile(userId)).fullUser

  promiseCollector.collect((async() => {
    const userId = peerId
    tab.container.classList.add('edit-peer-container', 'edit-contact-container')
    const [isContact, privacy] = await Promise.all([
      managers.contacts.isContact(userId),
      managers.privacy.rule('phone_number'),
    ])
    const isNew = !isContact
    tab.title.replaceChildren(i18n(isNew ? 'AddContactTitle' : 'Edit'))

    let nameInputField: InputField
    let lastNameInputField: InputField
    let noteInputField: InputField
    let editPeer: EditPeer
    let sharePhoneSignal: Signal<boolean> | undefined

    let canSuggestBirthday = false

    // Tracks the personal/suggest photo section so it can be re-rendered in place
    // after the personal photo is set/suggested/reset.
    let photoSectionContainer: HTMLElement | undefined

    // Built as a function (not inline) so it can be re-rendered in place after the
    // personal photo is set/reset — e.g. dropping the "Reset" button + flipping
    // "Update Photo" back to "Set Photo" once the custom photo is removed.
    async function buildPhotoSection(): Promise<HTMLElement> {
      const [user, fullUser] = await Promise.all([
        getUser(userId),
        getProfile(userId),
      ])
      const hasPersonal = !!fullUser?.personal_photo
      const firstName = user.first_name || ''

      const btnSetPhoto = Button('btn-primary btn-transparent', {
        icon: 'cameraadd',
        text: hasPersonal ? 'UserInfo.UpdatePhotoFor' : 'UserInfo.SetPhotoFor',
        textArgs: [firstName],
      })
      attachClickEvent(btnSetPhoto, () => {
        pickAvatarAndUpload({
          managers,
          mode: { userId },
          onUploaded: () => {
            toastNew({ langPackKey: 'UserInfo.PhotoSetToast', langPackArguments: [firstName] })
            void refreshPhotoSection()
          },
        })
      }, { listenerSetter: tab.listenerSetter })

      const btnSuggestPhoto = Button('btn-primary btn-transparent', {
        icon: 'edit',
        text: 'UserInfo.SuggestPhotoFor',
        textArgs: [firstName],
      })
      attachClickEvent(btnSuggestPhoto, () => {
        pickAvatarAndUpload({
          managers,
          mode: { userId, suggest: true },
          onUploaded: () => {
            toastNew({ langPackKey: 'UserInfo.PhotoSuggestedToast', langPackArguments: [firstName] })
            void refreshPhotoSection()
          },
        })
      }, { listenerSetter: tab.listenerSetter })

      let btnResetPhoto: HTMLElement | undefined
      if(hasPersonal) {
        btnResetPhoto = Button('btn-primary btn-transparent danger', {
          icon: 'delete',
          text: 'UserInfo.RemovePersonalPhoto',
        })
        attachClickEvent(btnResetPhoto, async() => {
          try {
            await confirmationPopup({
              titleLangKey: 'UserInfo.ResetCustomPhoto',
              descriptionLangKey: 'UserInfo.ResetCustomPhotoDescription',
              button: { langKey: 'Reset', isDanger: true },
            })
          } catch { return }
          await managers.contacts.clearPhoto(userId)
          toastNew({ langPackKey: 'UserInfo.PhotoResetToast' })
          void refreshPhotoSection()
        }, { listenerSetter: tab.listenerSetter })
      }

      return wrapSolidComponent(() => (
        <Section caption="UserInfo.CustomPhotoHelp">
          {btnSetPhoto}
          {btnSuggestPhoto}
          {btnResetPhoto}
        </Section>
      ), tab.middlewareHelper.get())
    }

    async function refreshPhotoSection() {
      const old = photoSectionContainer
      if(!old?.isConnected) return
      // расхождение 3: `refreshFullPeer` не нужен — профиль читается с сети
      const fresh = await buildPhotoSection()
      if(!old.isConnected) return // tab closed while the fresh book loaded
      old.replaceWith(fresh)
      photoSectionContainer = fresh
    }

    {
      const inputFields: InputField[] = []
      let rowsContainer: HTMLElement | undefined

      const inputWrapper = document.createElement('div')
      inputWrapper.classList.add('input-wrapper')

      nameInputField = new InputField({
        label: 'FirstName',
        name: 'contact-name',
        maxLength: 70,
        required: true,
      })
      lastNameInputField = new InputField({
        label: 'LastName',
        name: 'contact-lastname',
        maxLength: 70,
      })

      if(userId) {
        const user = await getUser(userId)

        if(isNew) {
          nameInputField.setDraftValue(user.first_name)
          lastNameInputField.setDraftValue(user.last_name)
        } else {
          nameInputField.setOriginalValue(user.first_name)
          lastNameInputField.setOriginalValue(user.last_name)
        }
      }

      inputWrapper.append(nameInputField.container, lastNameInputField.container)
      inputFields.push(nameInputField, lastNameInputField)

      if(userId) {
        const fullUser = await getProfile(userId)
        // `InputField` вместо `InputFieldEmoji` (расхождение 4)
        noteInputField = new InputField({
          label: 'ContactNoteRow',
          name: 'contact-note',
          maxLength: 128,
          withLinebreaks: true,
        })
        if(fullUser?.note) {
          noteInputField.setOriginalValue(fullUser.note.text)
        }
        inputFields.push(noteInputField)
        inputWrapper.append(noteInputField.container)

        canSuggestBirthday = !fullUser?.birthday
      }

      editPeer = new EditPeer({
        peerId: peerId,
        inputFields,
        listenerSetter: tab.listenerSetter,
        doNotEditAvatar: true,
        middleware: tab.middlewareHelper.get(),
        managers,
      })
      tab.content.append(editPeer.nextBtn)

      if(peerId) {
        const div = document.createElement('div')
        div.classList.add('avatar-edit')
        div.append(editPeer.avatarElem.node)

        const notificationsSignal = createSignal(false)

        // расхождение 7 — `notify_settings` оригинала
        const isEnabled = () => !isPeerMuted(
          useChatsStore.getState().dialogs.find((dialog) => dialog.peerId === peerId)?.notify_settings,
          Math.floor(Date.now() / 1000),
        )
        tab.listenerSetter.addCleanup(useChatsStore.subscribe(() => {
          notificationsSignal[1](isEnabled())
        }))

        const profileNameDiv = document.createElement('div')
        profileNameDiv.classList.add('profile-name')
        profileNameDiv.append(new PeerTitle({
          peerId,
          middleware: tab.middlewareHelper.get(),
          managers,
        }).element)

        const profileSubtitleDiv = document.createElement('div')
        profileSubtitleDiv.classList.add('profile-subtitle')
        profileSubtitleDiv.append(i18n('EditContact.OriginalName'))

        tab.scrollable.append(div, profileNameDiv, profileSubtitleDiv)
        rowsContainer = document.createElement('div')

        if(!isNew) {
          notificationsSignal[1](isEnabled())

          renderComponent({
            element: rowsContainer,
            Component: () => (
              <>
                <Row>
                  <Row.CheckboxFieldToggle>
                    <CheckboxFieldTsx
                      signal={notificationsSignal}
                      toggle
                      onChange={(checked) => managers.groups.setMute(peerId, !checked)}
                    />
                  </Row.CheckboxFieldToggle>
                  <Row.Title>{i18n('Notifications')}</Row.Title>
                  <Row.Subtitle>{i18n(notificationsSignal[0]() ? 'Checkbox.Enabled' : 'Checkbox.Disabled')}</Row.Subtitle>
                </Row>
                {canSuggestBirthday && (
                  <Row
                    clickable={() => {
                      showBirthdayPopup({
                        suggestForPeer: peerId,
                        onSave: (it) => suggestUserBirthday(userId, it),
                      })
                    }}
                  >
                    <Row.Icon icon="gift_filled" />
                    <Row.Title>{i18n('SuggestBirthdayRow')}</Row.Title>
                  </Row>
                )}
              </>
            ),
            middleware: tab.middlewareHelper.get(),
          })
        } else {
          const user = await getUser(userId)
          renderComponent({
            element: rowsContainer,
            Component: () => (
              <Row>
                <Row.Icon icon="phone_filled" />
                <Row.Title>{user.phone ? formatUserPhone(user.phone) : i18n('MobileHidden')}</Row.Title>
                <Row.Subtitle>{
                  user.phone ?
                    i18n('Phone') :
                    i18n('MobileHiddenExceptionInfo', [new PeerTitle({ peerId, middleware: tab.middlewareHelper.get(), managers }).element])
                }</Row.Subtitle>
              </Row>
            ),
            middleware: tab.middlewareHelper.get(),
          })
        }
      }

      tab.scrollable.append(wrapSolidComponent(() => (
        <Section noDelimiter>
          {inputWrapper}
          {rowsContainer}
        </Section>
      ), tab.middlewareHelper.get()))
    }

    if(!isNew) {
      photoSectionContainer = await buildPhotoSection()
      tab.scrollable.append(photoSectionContainer)

      const btnDelete = Button('btn-primary btn-transparent danger', { icon: 'delete', text: 'PeerInfo.DeleteContact' })

      attachClickEvent(btnDelete, () => {
        confirmDeleteContacts([peerId]).then(() => {
          // расхождение 8 — `toggleDisability`
          btnDelete.setAttribute('disabled', 'true')

          managers.contacts.del(userId).then(() => {
            tab.close()
          }, () => {
            btnDelete.removeAttribute('disabled')
          })
        }, noop)
      }, { listenerSetter: tab.listenerSetter })

      tab.scrollable.append(wrapSolidComponent(() => (
        <Section>
          {btnDelete}
        </Section>
      ), tab.middlewareHelper.get()))
    } else if(
      // расхождение 2
      privacy.value !== 'everybody' &&
      !privacy.allowUserIds.includes(userId)
    ) {
      const peerTitle = new PeerTitle({ peerId, middleware: tab.middlewareHelper.get(), managers }).element
      sharePhoneSignal = createSignal(true)
      const signal = sharePhoneSignal

      tab.scrollable.append(wrapSolidComponent(() => (
        <Section
          caption="NewContact.Exception.ShareMyPhoneNumber.Desc"
          captionArgs={[peerTitle]}
        >
          <Row>
            <Row.CheckboxField>
              <CheckboxFieldTsx signal={signal} />
            </Row.CheckboxField>
            <Row.Title>{i18n('NewContact.Exception.ShareMyPhoneNumber')}</Row.Title>
          </Row>
        </Section>
      ), tab.middlewareHelper.get()))
    }

    attachClickEvent(editPeer.nextBtn, async() => {
      editPeer.nextBtn.disabled = true

      try {
        // без номера (расхождение 9)
        await managers.contacts.add({
          contactId: userId,
          firstName: nameInputField.value,
          lastName: lastNameInputField.value,
          sharePhone: sharePhoneSignal?.[0](),
        })

        if(noteInputField.isChanged()) {
          // расхождение 4 — текст без разметки
          await managers.profile.updateUserNote(userId, { _: 'textWithEntities', text: noteInputField.value, entities: [] })
        }
      } catch(error) {
        console.error(error)
        toastNew({ langPackKey: 'Error.AnError' })
        return
      }

      editPeer.nextBtn.removeAttribute('disabled')
      tab.close()
    }, { listenerSetter: tab.listenerSetter })
  })())

  return null
}

export default EditContact
