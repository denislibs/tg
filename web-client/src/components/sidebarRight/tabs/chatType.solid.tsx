/** @jsxImportSource solid-js */
/**
 * порт tweb/src/components/sidebarRight/tabs/chatType.tsx:1-416 (812502980) —
 * вкладка «Тип канала» / «Тип группы» правой колонки: приватный/публичный,
 * ссылка-приглашение с отзывом, поле публичного имени, угловая «Сохранить».
 * Регистрация — `AppChatTypeTab` в `solidJsTabs/tabs.ts` (tweb `:536-540`);
 * открывает её редактор чата (`editChat`, задача 0б-1). Содержимое строится,
 * как у оригинала, императивно (`wrapSolidComponent` + узлы в `tab.scrollable`),
 * компонент возвращает `null`.
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. Ссылка-приглашение (`:101`) читается не из `chatFull.exported_invite` —
 *     такого поля в нашем `ChannelFull` нет (докблок `Link` в
 *     `peerProfile.solid.tsx`), — а портом `appProfileManager.getChatInviteLink`
 *     (`:561-582`) ниже: основная ссылка — первая активная из `groups.listInvites`,
 *     нет её — создаётся. Первый `await` вкладки стоит там, где у оригинала
 *     `await isBroadcast` (`:40`), поэтому узлы секций ложатся после корня острова.
 *  2. Отзыв ссылки (`getChatInviteLink(chatId, true)`, `:112`) — отзыв текущей
 *     основной ссылки и выпуск новой (`editInvite(revoked)` + `createInvite`):
 *     `messages.exportChatInvite` у нас нет, а видимый исход тот же — прежняя
 *     ссылка перестаёт работать, в строке новая. Адрес — `origin + /join/<токен>`,
 *     как у строки `Link` профиля (у tweb `t.me/+…`).
 *  3. `isBroadcast` (`:40`) — синхронно из зеркала пиров (`isBroadcastPeer`),
 *     `chat` (`:87`, `:217`) — `cachedChat`: вкладку открывают из загруженного чата.
 *  4. `migrateChat` (`:206`) не зовётся: базовых групп сервер не производит
 *     (`domain/mtchat.go`, решение №2), любая наша группа — уже `channel`.
 *     `makeChannelPrivate`/`updateUsername` (`:208`, `:210`) — один
 *     `groups.setType(peerId, isPublic, username)` (`PUT /chats/{id}/type`).
 *  5. Коллекции имён (`usernames`: несколько имён, порядок, скрытие, покупка
 *     занятого имени на Fragment) у нас нет — одно поле `username`
 *     (`core/peers/predicates.ts`, `isPublic`). Поэтому не портированы
 *     `UsernamesSection` (`:187-197`), подпись покупки
 *     `purchaseUsernameCaption` (`:169`, `:179`, `:151-153`),
 *     `getPeerEditableUsername`/`getPeerActiveUsernames` (`:171`, `:409` —
 *     здесь `chat.username`) и подписка `chat_update` (`:89-99`: её читают только
 *     секции п. 6 и 7) — О-17 волна 7.
 *  6. Секция вступления (`:270-372`: «вступать, чтобы писать», заявки на
 *     вступление, бот-привратник `guard_bot_id` с переходом в права участника,
 *     `handleChannelsTooMuch`, `chat_full_update`) — нет на бэкенде: флагов
 *     `join_to_send`/`join_request` у `channel` нет (`domain/mtchat.go`,
 *     `ChannelFlags`) — О-15 волна 7. Их ветки в `onChange`/`onPrivacyChange`/
 *     сохранении (`:72-74`, `:147-148`, `:242-259`) уходят вместе с секцией.
 *  7. Запрет копирования (`:374-407`, `messages.toggleNoForwards`) — нет на
 *     бэкенде (`noforwards` у `channel` не объявлен) — О-16 волна 7.
 *  8. `ButtonCorner` без `ariaLabel: 'Save'` (`:199`) — шапка `components/buttonCorner.ts`.
 *  9. Попап отзыва — `PopupPeer` классом (`components/popups/popupPeer.ts`), у
 *     tweb `showPeerPopup` (Solid-обёртка того же попапа, `popups/peer.tsx`).
 */
import { createSignal, type Component } from 'solid-js'
import { copyTextToClipboard } from '@helpers/clipboard'
import { wrapSolidComponent } from '@helpers/solid/wrapSolidComponent'
import Button from '@components/button'
import { setButtonLoader } from '@components/putPreloader'
import RadioFormTsx, { type RadioFormTsxValue } from '@components/radioFormTsx.solid'
import Row from '@components/rowTsx.solid'
import { toastNew } from '@components/toast'
import { UsernameInputField } from '@components/usernameInputField'
import { i18n } from '@lib/langPack'
import PopupElement from '@components/popups/popupElement'
import PopupPeer, { confirmationPopup } from '@components/popups/popupPeer'
import ButtonCorner from '@components/buttonCorner'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import toggleDisability from '@helpers/dom/toggleDisability'
import Section from '@components/section.solid'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import type { AppChatTypeTab } from '@components/solidJsTabs/tabs'
import { cachedChat, isBroadcastPeer } from '@core/peerCache'
import { toPeerId } from '@core/peers/peerId'
import type { Channel } from '@core/peers/peer'
import type { Managers } from '@/client/bootstrap'

/** Порт tweb `appProfileManager.getChatInviteLink` (`:561-582`) — расхождения 1, 2 шапки. */
async function getChatInviteLink(managers: Managers, peerId: PeerId, force?: boolean) {
  const [primary] = await managers.groups.listInvites(peerId)
  if(!force && primary) {
    return location.origin + primary.url
  }

  if(primary) {
    await managers.groups.editInvite(peerId, primary.token, { revoked: true })
  }

  return location.origin + (await managers.groups.createInvite(peerId)).url
}

const ChatType: Component = () => {
  const [tab] = useSuperTab<typeof AppChatTypeTab>()
  const promiseCollector = usePromiseCollector()
  const { chatId } = tab.payload
  const managers = tab.managers!
  const peerId = toPeerId(chatId as number, true)

  promiseCollector.collect((async() => {
    tab.container.classList.add('edit-peer-container', 'group-type-container')

    const isBroadcast = isBroadcastPeer(peerId)
    // :101 — первый `await` вкладки, на месте `await isBroadcast` (:40), расхождение 1
    const inviteLinkSignal = createSignal(await getChatInviteLink(managers, peerId))
    const privacySignal = createSignal<'private' | 'public'>()
    const privacyValues: RadioFormTsxValue<'private' | 'public'>[] = [{
      langPackKey: isBroadcast ? 'ChannelPrivate' : 'MegaPrivate',
      subtitle: i18n(isBroadcast ? 'ChannelPrivateInfo' : 'MegaPrivateInfo'),
      value: 'private',
    }, {
      langPackKey: isBroadcast ? 'ChannelPublic' : 'MegaPublic',
      subtitle: i18n(isBroadcast ? 'ChannelPublicInfo' : 'MegaPublicInfo'),
      value: 'public',
    }]

    tab.title.replaceChildren(i18n(isBroadcast ? 'ChannelType' : 'GroupType'))

    const publicContainer = document.createElement('div')
    let onChange = () => {}
    const onPrivacyChange = (value: 'private' | 'public') => {
      privacySignal[1](value)
      const a: HTMLElement[][] = [[privateSection], [publicContainer]]
      if(value === 'public') a.reverse()

      a[0].forEach((container) => container.classList.remove('hide'))
      a[1].forEach((container) => container.classList.add('hide'))

      onChange()
    }

    const section = wrapSolidComponent(() => (
      <Section name={isBroadcast ? 'ChannelType' : 'GroupType'}>
        <RadioFormTsx
          selected={privacySignal[0]()}
          values={privacyValues}
          onChange={onPrivacyChange}
        />
      </Section>
    ), tab.middlewareHelper.get())

    const chat = cachedChat(peerId) as Channel

    const btnRevoke = Button('btn-primary btn-transparent danger', { icon: 'delete', text: 'RevokeLink' })

    attachClickEvent(btnRevoke, () => {
      PopupElement.createPopup(PopupPeer, 'revoke-link', {
        buttons: [{
          langKey: 'RevokeButton',
          callback: () => {
            const toggle = toggleDisability([btnRevoke], true)

            void getChatInviteLink(managers, peerId, true).then((link) => {
              toggle()
              inviteLinkSignal[1](link)
            })
          },
        }],
        titleLangKey: 'RevokeLink',
        descriptionLangKey: 'RevokeAlert',
      }).show()
    }, { listenerSetter: tab.listenerSetter })

    const privateSection = wrapSolidComponent(() => (
      <Section>
        <Row
          clickable={() => {
            void copyTextToClipboard(inviteLinkSignal[0]())
            toastNew({ langPackKey: 'LinkCopied' })
          }}
        >
          <Row.Title>{inviteLinkSignal[0]()}</Row.Title>
          <Row.Subtitle>{i18n(isBroadcast ? 'ChannelPrivateLinkHelp' : 'MegaPrivateLinkHelp')}</Row.Subtitle>
        </Row>
        {btnRevoke}
      </Section>
    ), tab.middlewareHelper.get())

    const inputWrapper = document.createElement('div')
    inputWrapper.classList.add('input-wrapper')

    const placeholder = 't.me/'

    let changedPrivacy = false
    onChange = () => {
      changedPrivacy = (privacySignal[0]() === 'private' && (originalValue !== placeholder)) ||
        (linkInputField.isValidToChange() && linkInputField.input.classList.contains('valid'))
      applyBtn.classList.toggle('is-visible', changedPrivacy)
    }

    const linkInputField = new UsernameInputField({
      label: 'SetUrlPlaceholder',
      name: 'group-public-link',
      plainText: true,
      listenerSetter: tab.listenerSetter,
      availableText: 'Link.Available',
      invalidText: 'Link.Invalid',
      takenText: 'Link.Taken',
      onChange: onChange,
      peerId,
      head: placeholder,
    }, managers)

    const originalValue = placeholder + (chat.username || '')

    inputWrapper.append(linkInputField.container)

    const publicSection = wrapSolidComponent(() => (
      <Section
        noDelimiter
        caption={isBroadcast ? 'Channel.UsernameAboutChannel' : 'Channel.UsernameAboutGroup'}
      >
        {inputWrapper}
      </Section>
    ), tab.middlewareHelper.get())

    publicContainer.append(publicSection)

    const applyBtn = ButtonCorner({ icon: 'check', className: 'is-visible' })
    tab.content.append(applyBtn)

    const getUsername = () => privacySignal[0]() === 'public' ? linkInputField.getValue() : ''

    const changePrivacy = async() => {
      const username = getUsername()
      return managers.groups.setType(peerId, !!username, username)
    }

    const confirmChangingPrivacy = async() => {
      const username = getUsername()
      if(!username) {
        const wasUsername = (cachedChat(peerId) as Channel).username
        if(wasUsername) {
          await confirmationPopup({
            descriptionLangKey: isBroadcast ? 'ChannelVisibility.Confirm.MakePrivate.Channel' : 'ChannelVisibility.Confirm.MakePrivate.Group',
            descriptionLangArgs: [wasUsername],
            button: {
              langKey: 'OK',
            },
          })
        }
      }
    }

    attachClickEvent(applyBtn, async() => {
      if(changedPrivacy) {
        await confirmChangingPrivacy()
      }

      const unsetLoader = setButtonLoader(applyBtn)
      try {
        if(changedPrivacy) {
          await changePrivacy()
        }

        tab.close()
      } catch(err) {
        console.error('changePrivacy error', err)
        unsetLoader()
      }
    }, { listenerSetter: tab.listenerSetter })

    tab.scrollable.append(section, privateSection, publicContainer)

    onPrivacyChange(originalValue !== placeholder ? 'public' : 'private')
    linkInputField.setOriginalValue(originalValue, true)
  })())

  return null
}

export default ChatType
