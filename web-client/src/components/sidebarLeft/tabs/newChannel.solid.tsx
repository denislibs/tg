/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/newChannel.tsx` (812502980, 108
 * строк) — вкладка «Новый канал»: аватар (`AvatarEdit`), название (до 128) и
 * описание (до 255, с переводами строк) в секции с подписью
 * `Channel.DescriptionHolderDescrpiton`, угловая «Далее». По ответу —
 * открыть канал, убрать вкладку из истории и открыть выбор подписчиков
 * (`addChatUsers`, `skippable`). Вкладка `AppNewChannelTab` —
 * `solidJsTabs/tabs.ts` (tweb :262-270, `noSame`).
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. Полезной нагрузки нет: `onCreate`/`openAfter` (:19, :62-66) нужны только
 *     сообществам (`communities/addChatToCommunity.tsx:43`), а их на бэкенде нет
 *     (О-5 волны 7). Оба открывающих оригинала
 *     из нашей подсистемы (`sidebarLeft/index.ts:1090`,
 *     `internalLinkProcessor.ts:770`) зовут `open({})` — поведение то же, что у
 *     ветки `openAfter = true`.
 *  2. (О-40) `handleChannelsTooMuch` (:52) — нет: бэкенд не знает отказа
 *     `CHANNELS_TOO_MUCH` и лимита каналов, повторять нечего.
 *  3. Создание — `managers.channels.createChannel({title, about})`: ответ —
 *     ключ пира канала, а не `ChatId`; `broadcast: true` (:50) не передаётся —
 *     ручка `POST /channels` создаёт только каналы.
 *  4. Фото — `groups.setPhoto(peerId, mediaId)` вместо `editPhoto(channelId,
 *     inputFile)` (:55-58): провода `InputFile` нет (шапка `avatarEdit.ts`, п. 3).
 *  5. `appImManager.setInnerPeer` (:68) → `openPeer` — ВРЕМЕННО до Э4-3
 *     (класса `AppImManager` ещё нет). `appSidebarLeft.removeTabFromHistory`
 *     (:69) → `tab.slider`: вкладку открывает колоночный слайдер, он и есть
 *     `appSidebarLeft`; `useHotReloadGuard` (HMR-ветки tweb) не портирован.
 *  6. `tab.slider as SidebarSlider` — поле вкладки объявлено узким контрактом
 *     (`SliderSuperTabSlider`, шапка `sliderTab.ts`), как у соседних вкладок.
 *  7. `ButtonCorner` без `ariaLabel: 'Next'` (:37) — шапка `components/buttonCorner.ts`.
 *  8. (О-44) Диалог нового канала — `dialogs.refresh()` после создания. У оригинала
 *     его приносит ответ `channels.createChannel`: `Updates` прогоняются через
 *     `processUpdateMessage` (`appChatsManager.ts:587-593`), и диалог встаёт в
 *     список из апдейтов. Наш `POST /channels` отвечает `messages.chatFull` без
 *     диалога и кадра не шлёт — без перезапроса канал не появляется в списке, а
 *     шапка открытого чата остаётся без названия (тот же путь, что у снесённого
 *     `onChatCreated` React-экрана).
 */
import { onCleanup, onMount } from 'solid-js'
import type InputField from '@components/inputField'
import { InputFieldTsx } from '@components/inputFieldTsx.solid'
import AvatarEdit, { type AvatarEditPayload } from '@components/avatarEdit'
import ButtonCorner from '@components/buttonCorner'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import Section from '@components/section.solid'
import addChatUsers from '@components/addChatUsers'
import toggleDisability from '@helpers/dom/toggleDisability'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import type { AppNewChannelTab } from '@components/solidJsTabs/tabs'
import type SidebarSlider from '@components/slider'
import { openPeer } from '@core/navigation/openPeer'
import { peerTitle } from '@core/peerCache'

const NewChannel = () => {
  const [tab] = useSuperTab<typeof AppNewChannelTab>()
  const managers = tab.managers!

  let uploadAvatar: AvatarEditPayload | null = null
  let nameField!: InputField
  let descField!: InputField
  let nextBtn: HTMLButtonElement

  const avatarEdit = new AvatarEdit((_upload) => {
    uploadAvatar = _upload
  }, { managers })

  const onLengthChange = () => {
    nextBtn.classList.toggle('is-visible', !!nameField.value.length &&
      !nameField.input.classList.contains('error') &&
      !descField.input.classList.contains('error'))
  }

  onMount(() => {
    tab.container.classList.add('new-channel-container')

    nextBtn = ButtonCorner({ icon: 'arrow_next' })
    tab.content.append(nextBtn)

    attachClickEvent(nextBtn, () => {
      const title = nameField.value
      const about = descField.value

      const toggle = toggleDisability(nextBtn, true)
      // расхождения 2 (О-40 волна 7), 3
      managers.channels.createChannel({ title, about })
      .then((peerId) => {
        if(uploadAvatar) {
          void uploadAvatar.file().then((mediaId) => {
            void managers.groups.setPhoto(peerId, mediaId)
          })
        }

        // ВРЕМЕННО до Э4-3 — `appImManager.setInnerPeer({peerId})` (расхождение 5)
        openPeer(managers, { id: peerId, title: peerTitle(peerId) })
        // О-44 волна 7 — диалог канала (расхождение 8)
        void managers.dialogs.refresh().catch(() => {})
        const slider = tab.slider as SidebarSlider
        slider.removeTabFromHistory(tab)
        addChatUsers({
          peerId,
          slider,
          skippable: true,
        })
      }).catch((err) => {
        console.error('createChannel error', err)
        toggle()
      })
    }, { listenerSetter: tab.listenerSetter })

    nameField.input.addEventListener('input', onLengthChange)
    descField.input.addEventListener('input', onLengthChange)
  })

  onCleanup(() => {
    avatarEdit.clear()
    uploadAvatar = null
  })

  return (
    <Section caption="Channel.DescriptionHolderDescrpiton">
      {avatarEdit.container}
      <div class="input-wrapper">
        <InputFieldTsx
          label="EnterChannelName"
          maxLength={128}
          instanceRef={(ref) => nameField = ref}
        />
        <InputFieldTsx
          label="DescriptionOptionalPlaceholder"
          maxLength={255}
          withLinebreaks
          instanceRef={(ref) => descField = ref}
        />
      </div>
    </Section>
  )
}

export default NewChannel
