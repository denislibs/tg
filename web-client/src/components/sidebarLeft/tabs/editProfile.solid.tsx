/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/editProfile.tsx` (812502980, 436
 * строк) — «Редактировать профиль», вкладка `AppEditProfileTab` колоночного
 * слайдера (`solidJsTabs/tabs.ts`, tweb :84-98: `noSame`, предзагрузка
 * `getEditProfileInitArgs`). Задача 27 плана 2D, дамп
 * `14-left-25-settings-edit-profile`.
 *
 *   .tabs-tab.edit-profile-container
 *     .sidebar-content > .scrollable > div
 *       button.avatar-edit > canvas.avatar-edit-canvas + .avatar-edit-icon + .avatar-120.avatar-placeholder  (:358)
 *       Section[caption Bio.Description] > .input-wrapper (имя 70 · фамилия 64 · bio) + [Row «Add Birthday»]  (:360-408)
 *       Section «EditAccount.Username» [caption UsernameHelp] > .input-wrapper > поле имени (plainText)        (:410-419, :441-485)
 *     button.btn-corner (check) — видна, пока форма изменена                                               (:84)
 *
 * Открывают вкладку ⋮ → «Edit Profile» корня настроек (`settings.solid.tsx`,
 * tweb `settings.tsx:106`).
 *
 * Расхождения с оригиналом (номер — у строки):
 *  1. Аватар: `EditPeer` и `AvatarEdit` — общие классы волны 7 (0б-10 и 0а-3),
 *     взятые дословно; у нашего `EditPeer` ветки `AvatarEdit` нет
 *     (`doNotEditAvatar: true` — литерал, `editPeer.ts` шапка п. 1). Поэтому
 *     её тело (tweb `editPeer.ts:56-64`: `uploadAvatar`, `handleChange`, снятие
 *     заглушки, заглушка внутри кнопки) и её доля в `isChanged` (:95-98)
 *     живут здесь, в том же месте, где оригинал сам дописывает `isChanged`
 *     (:143-145). Кроп и видео-аватар — медиаредактор (`getFileAndOpenEditor`,
 *     О-24; порт — программа медиаредактора, МР-5/МР-6): до него `AvatarEdit`
 *     берёт картинку выбором файла без кропа (шапка `avatarEdit.ts`).
 *  2. Загрузка аватара — `media.upload` → `profile.addPhoto(mediaId)` вместо
 *     `uploadProfilePhoto({file, video, videoStartTs})` (:310-322): у нас фото
 *     ставится по `media_id`. (О-65) Кольца прогресса на большом аватаре
 *     профиля (`trackAvatarUpload`, `stores/avatarUpload.ts`) нет: наш
 *     `media.upload` не отдаёт ни прогресса, ни отмены.
 *  3. (О-64) `bioMaxLength` — число 70, а не `apiManager.getLimit('bio')`
 *     (tweb `tabs.ts:86`, премиум — 140): лимитов с сервера у нас нет, свой
 *     бэкенд режет по `maxBioLen = 70` (`usecase/auth/profile.go:14`) для всех.
 *  4. `user`/`userFull` — наш `me` (`UserReal`/`UserFull`) из зеркала
 *     `chatsStore` (мост чтения, `getEditProfileInitArgs`), а не
 *     `getSelf()`/`getProfile()`. Сохранение — `profile.update({firstName,
 *     lastName, bio})`, `profile.setUsername` вместо `updateProfile`/
 *     `updateUsername`; новый `me` доезжает `rt:me` (профиль-менеджер
 *     объявляет его сам), своей записи в зеркало вкладка не делает.
 *  5. `getPeerEditableUsername(user)` → `user.username`: коллекционных имён
 *     (`usernames[]`, `editable`) у нас нет (О-62).
 *  6. Секции, которых нет (у места — комментарий):
 *     • (О-62) `UsernamesSection` (:421-425) — список нескольких имён с
 *       сортировкой и скрытием: нет `usernames[]`, `toggleUsername`,
 *       `reorderUsernames`;
 *     • (О-63) подпись покупки имени (`purchaseUsernameCaption`, :150,
 *       :396-401, :464-468) — нет торговли именами и отказа
 *       `USERNAME_PURCHASE_AVAILABLE`;
 *     • (О-25) «Personal Channel» (:427-438, :99-102, :141-171, :213-251,
 *       :329-331) — нет `personal_channel_id` в модели, ручек
 *       `updatePersonalChannel`/`getAdminedPersonalChannels`;
 *     • «Chat Automation» (:440-454, :103-139, :173-211) — SKIP по плану:
 *       бизнес-ботов у бэкенда нет (О-42), `connectedBot` в предзагрузке тоже.
 *  7. Попап дня рождения — мост к React-модалке до 2C-14
 *     (`sidebarLeft/settingsPopups.tsx`, ВРЕМЕННО у строки); `saveMyBirthday`
 *     получает `managers` параметром.
 *  8. Поля имени/фамилии/bio — contenteditable `InputField` без rich-вставки
 *     (О-28, шапка `inputField.ts`): значение — `textContent`.
 */
import { createResource, createSignal, onMount, Show } from 'solid-js'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import type { AppEditProfileTab } from '@components/solidJsTabs/tabs'
import Section from '@components/section.solid'
import Row from '@components/rowTsx.solid'
import { InputFieldTsx } from '@components/inputFieldTsx.solid'
import { i18n } from '@lib/langPack'
import EditPeer from '@components/editPeer'
import AvatarEdit, { type AvatarEditPayload } from '@components/avatarEdit'
import type InputField from '@components/inputField'
import { UsernameInputField } from '@components/usernameInputField'
import { saveMyBirthday, showBirthdayPopup } from '@components/sidebarLeft/settingsPopups'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import { toPeerId } from '@core/peers/peerId'
import type { UserFull, UserReal } from '@core/peers/peer'
import type { MaybePromise } from '@types'
import type { Managers } from '@/client/bootstrap'

type AppEditProfileTabType = typeof AppEditProfileTab

// расхождения 3, 4; `connectedBot` — 6
export type EditProfileTabPayload = {
  bioMaxLength: MaybePromise<number>
  user: MaybePromise<UserReal>
  userFull: MaybePromise<UserFull>
}

const EditProfileTab = () => {
  const [tab] = useSuperTab<AppEditProfileTabType>()
  const promiseCollector = usePromiseCollector()

  const payload = tab.payload
  const loadPromise = Promise.all([
    Promise.resolve(payload.bioMaxLength),
    Promise.resolve(payload.user),
    Promise.resolve(payload.userFull),
  ])
  promiseCollector.collect(loadPromise)

  const [data] = createResource(() => loadPromise.then(([bioMaxLength, user, userFull]) => ({ bioMaxLength, user, userFull })))

  return (
    <Show when={data()}>
      {(formData) => <EditProfileForm data={formData()} />}
    </Show>
  )
}

export default EditProfileTab

type FormData = {
  bioMaxLength: number
  user: UserReal
  userFull: UserFull
}

const EditProfileForm = (props: { data: FormData }) => {
  const [tab] = useSuperTab<AppEditProfileTabType>()
  const managers = tab.managers as Managers
  const { user, userFull, bioMaxLength } = props.data

  tab.container.classList.add('edit-profile-container')

  const inputFields: InputField[] = []

  const editPeer = new EditPeer({
    peerId: toPeerId(user.id, false),
    inputFields,
    listenerSetter: tab.listenerSetter,
    // расхождение 1
    doNotEditAvatar: true,
    middleware: tab.middlewareHelper.get(),
    managers,
  })

  // расхождение 1 — ветка `AvatarEdit` tweb `editPeer.ts:56-64`
  let uploadAvatar: AvatarEditPayload | undefined
  const avatarEdit = new AvatarEdit((payload) => {
    uploadAvatar = payload
    editPeer.handleChange()
    editPeer.avatarElem.node.remove()
  }, { managers })
  avatarEdit.container.append(editPeer.avatarElem.node)

  tab.content.append(editPeer.nextBtn)

  let firstNameInputField!: InputField
  let lastNameInputField!: InputField
  let bioInputField!: InputField
  let usernameInputField!: UsernameInputField

  const trackInputField = (field: InputField) => {
    inputFields.push(field)
    tab.listenerSetter.add(field.input)('input', editPeer.handleChange)
  }

  const [hasBirthday, setHasBirthday] = createSignal(!!userFull.birthday)

  // tweb :143-145 дописывает сюда личный канал (О-25); доля аватара —
  // tweb `editPeer.ts:95-98` (расхождение 1)
  const origIsChanged = editPeer.isChanged
  editPeer.isChanged = () => !!uploadAvatar || origIsChanged()

  const onSave = () => {
    editPeer.nextBtn.disabled = true

    const promises: Promise<unknown>[] = []

    // расхождение 4
    promises.push(managers.profile.update({
      firstName: firstNameInputField.value,
      lastName: lastNameInputField.value,
      bio: bioInputField.value,
    }).then(() => {
      tab.close()
    }, (err) => {
      console.error('updateProfile error:', err)
    }))

    if(uploadAvatar) {
      // расхождение 2
      const filePromise = uploadAvatar.file()
      promises.push(filePromise.then((mediaId) => {
        return managers.profile.addPhoto(mediaId)
      }, () => {
        // swallow cancellation/upload errors so Promise.race below doesn't reject the whole save
      }))
    }

    if(usernameInputField.isValidToChange()) {
      promises.push(managers.profile.setUsername(usernameInputField.value))
    }

    // (О-25) `updatePersonalChannel` (:329-331) — расхождение 6

    void Promise.race(promises).finally(() => {
      editPeer.nextBtn.removeAttribute('disabled')
    })
  }

  attachClickEvent(editPeer.nextBtn, onSave, { listenerSetter: tab.listenerSetter })

  onMount(() => {
    firstNameInputField.setOriginalValue(user.first_name, true)
    lastNameInputField.setOriginalValue(user.last_name, true)
    bioInputField.setOriginalValue(userFull.about, true)
    // расхождение 5
    usernameInputField.setOriginalValue(user.username, true)
    editPeer.handleChange()
  })

  return (
    <>
      {avatarEdit.container}

      <Section caption="Bio.Description">
        <div class="input-wrapper">
          <InputFieldTsx
            label="EditProfile.FirstNameLabel"
            name="first-name"
            maxLength={70}
            instanceRef={(ref) => {
              firstNameInputField = ref
              trackInputField(ref)
            }}
          />
          <InputFieldTsx
            label="Login.Register.LastName.Placeholder"
            name="last-name"
            maxLength={64}
            instanceRef={(ref) => {
              lastNameInputField = ref
              trackInputField(ref)
            }}
          />
          <InputFieldTsx
            label="EditProfile.BioLabel"
            name="bio"
            maxLength={bioMaxLength}
            instanceRef={(ref) => {
              bioInputField = ref
              trackInputField(ref)
            }}
          />
        </div>
        <Show when={!hasBirthday()}>
          <Row clickable={() => {
            // расхождение 7
            showBirthdayPopup({
              onSave: async(date) => {
                if(await saveMyBirthday(managers, date)) {
                  setHasBirthday(true)
                  return true
                }
                return false
              },
            })
          }}>
            <Row.Icon icon="gift_filled" />
            <Row.Title>{i18n('EditProfile.AddBirthdayRow')}</Row.Title>
          </Row>
        </Show>
      </Section>

      <UsernameSection
        editPeer={editPeer}
        usernameInputFieldRef={(ref) => {
          usernameInputField = ref
          trackInputField(ref)
        }}
      />

      {/* (О-62) `UsernamesSection` (:421-425) — расхождение 6 */}
      {/* (О-25) Section «EditProfile.PersonalChannel.Title» (:427-438) — расхождение 6 */}
      {/* Section «ChatAutomation.Title» (:440-454) — SKIP, расхождение 6 */}
    </>
  )
}

const UsernameSection = (props: {
  editPeer: EditPeer
  usernameInputFieldRef: (ref: UsernameInputField) => void
}) => {
  const [tab] = useSuperTab<AppEditProfileTabType>()

  // (О-63) без подписи покупки имени (:464-468) — расхождение 6
  const onChange = () => {
    props.editPeer.handleChange()
  }

  const inputField = new UsernameInputField({
    label: 'EditProfile.Username.Label',
    name: 'username',
    plainText: true,
    listenerSetter: tab.listenerSetter,
    onChange,
    availableText: 'EditProfile.Username.Available',
    takenText: 'EditProfile.Username.Taken',
    invalidText: 'EditProfile.Username.Invalid',
  }, tab.managers as Managers)

  props.usernameInputFieldRef(inputField)

  return (
    <Section
      name="EditAccount.Username"
      caption="UsernameHelp"
    >
      <div class="input-wrapper">
        {inputField.container}
      </div>
    </Section>
  )
}
