# Покрытие tweb: сводка

<!-- Файл генерируется: node tools/tweb-parity/inventory.mjs. Руками не править. -->

Снято: 2026-08-16. Источник: `/Users/denisurevic/Documents/tweb` @ `e52b5d931`.

| Срез | Значение |
|---|---|
| Общих партиалов `src/scss` в tweb (в скоупе) | 129 |
| Из них есть файлом у нас | 70 |
| CSS-классов в tweb | 3638 |
| Из них встречаются у нас | 2240 (62%) |
| Попапов в tweb | 84 |
| Из них нашлись у нас по имени | 11 точно, 3 предположительно |
| Локальных `*.module.scss` компонентов форка | 138 (отдельный слой, см. ниже) |

«Встречается у нас» = имя класса найдено в наших scss или в коде компонентов.
Это признак наличия, а не паритета: точное совпадение вёрстки проверяет
`dom-parity.mjs`, набор селекторов внутри файла — `scss-parity.mjs`.

Локальный tweb — форк с частичной миграцией на Solid, поэтому часть стилей там
живёт в `*.module.scss` рядом с компонентом. Мы портируем глобальный слой, а модульные
файлы смотрим точечно — они в `styles.json` с `kind: "module"`.

## Партиалы tweb, которых у нас нет файлом

Отсортировано по числу классов, которых нет нигде в нашем коде — это и есть дыра.
Файл может отсутствовать, а классы быть (переехали в другой наш файл) — такие внизу.

| Файл | Классов | Нет у нас | Док |
|---|---|---|---|
| `base.scss` | 241 | 100 | — |
| `_stars.scss` | 73 | 47 | right-sidebar.md |
| `_starGiftInfo.scss` | 49 | 40 | right-sidebar.md |
| `_poll.scss` | 34 | 22 | bubbles.md |
| `_similarChannels.scss` | 23 | 19 | right-sidebar.md |
| `_starGiftUpgrade.scss` | 21 | 18 | right-sidebar.md |
| `_mediaAttacher.scss` | 37 | 17 | composer.md |
| `_global.scss` | 33 | 15 | state-and-layout.md |
| `_foldersSidebar.scss` | 28 | 15 | left-sidebar.md |
| `_boost.scss` | 15 | 13 | channels.md |
| `_chatSearch.scss` | 18 | 11 | chat-feed.md |
| `_movableElement.scss` | 11 | 11 | state-and-layout.md |
| `_simpleMessageInput.scss` | 12 | 11 | composer.md |
| `_themes.scss` | 17 | 10 | state-and-layout.md |
| `_limitLine.scss` | 12 | 9 | popups.md |
| `_tooltip.scss` | 15 | 9 | popups.md |
| `_reportAd.scss` | 13 | 8 | popups.md |
| `_topics.scss` | 31 | 7 | left-sidebar.md |
| `_deleteMegagroupMessages.scss` | 10 | 7 | popups.md |
| `_colorPicker.scss` | 7 | 6 | — |
| `_inviteLink.scss` | 7 | 6 | popups.md |
| `_quizHint.scss` | 10 | 6 | popups.md |
| `_chatlistInvite.scss` | 19 | 6 | left-sidebar.md |
| `_toggleReadDate.scss` | 8 | 6 | right-sidebar.md |
| `_chatToast.scss` | 9 | 5 | chat-feed.md |
| `_crop.scss` | 9 | 5 | media.md |
| `_usernames.scss` | 9 | 5 | right-sidebar.md |
| `_chatPreview.scss` | 19 | 5 | — |
| `tonePopupShell.module.scss` | 6 | 4 | — |
| `_joinChatInvite.scss` | 6 | 4 | popups.md |
| `_replyKeyboard.scss` | 8 | 3 | composer.md |
| `_makePaid.scss` | 4 | 3 | channels.md |
| `fieldSectionPanel.module.scss` | 2 | 2 | — |
| `_stickerViewer.scss` | 13 | 2 | media.md |
| `_createContact.scss` | 7 | 2 | popups.md |
| `_editAvatar.scss` | 3 | 2 | — |
| `_instanceDeactivated.scss` | 4 | 2 | state-and-layout.md |
| `editableFieldContent.module.scss` | 1 | 1 | — |
| `inlineRippleLink.module.scss` | 1 | 1 | — |
| `_customEmoji.scss` | 7 | 1 | media.md |
| `_emojiAnimation.scss` | 2 | 1 | media.md |
| `_sparkles.scss` | 2 | 1 | — |
| `_starGift.scss` | 1 | 1 | right-sidebar.md |
| `_starsBadge.scss` | 5 | 1 | right-sidebar.md |
| `_limit.scss` | 4 | 1 | popups.md |
| `_mute.scss` | 2 | 1 | popups.md |
| `_reactedList.scss` | 10 | 1 | popups.md |
| `_sponsored.scss` | 5 | 1 | channels.md |
| `_normalize.scss` | 0 | 0 | state-and-layout.md |
| `_typography.scss` | 0 | 0 | state-and-layout.md |
| `_mediaEditorFonts.scss` | 0 | 0 | media.md |
| `fonts.scss` | 0 | 0 | — |
| `functions.scss` | 0 | 0 | — |
| `mixins.scss` | 0 | 0 | — |
| `shared.scss` | 0 | 0 | — |
| `style.scss` | 0 | 0 | — |
| `_style.scss` | 1 | 0 | — |
| `tgico.scss` | 0 | 0 | — |
| `variables.scss` | 0 | 0 | — |

## Портированные файлы с самым большим отставанием

| Файл | Классов в tweb | Есть у нас | Покрытие | Док |
|---|---|---|---|---|

Полные списки недостающих классов — в `styles.json`, поле `missingClasses`.

## Попапы tweb без пары у нас

Сопоставление идёт по имени файла, поэтому переименованный попап тоже попадёт сюда —
список читать как «проверить», а не как «отсутствует».

`aboutAd`, `addBotToChat`, `ageVerification`, `aiEditorPopup`, `channelsTooMuch`, `chatPreview`, `convertToGigagroup`, `createBot`, `createContact`, `createStarGiftOffer`, `emailSetup`, `featureDetails`, `floatingStarsBalance`, `forward`, `frozen`, `limit`, `logOut`, `myQrCode`, `noForwards`, `password`, `pickCountry`, `pickUser`, `pollLink`, `PopupAvatar`, `PopupBoostsViaGifts`, `PopupBuyResaleGift`, `PopupChooseGift`, `PopupChooseStory`, `PopupDeleteDialog`, `PopupDeleteMegagroupMessages`, `PopupDeleteMessages`, `PopupGiftLink`, `PopupGiftPremium`, `PopupJoinChatInvite`, `PopupMakePaid`, `PopupNewMedia`, `PopupPayment`, `PopupPaymentCard`, `PopupPaymentCardConfirmation`, `PopupPaymentMethods`, `PopupPaymentShipping`, `PopupPaymentShippingMethods`, `PopupPaymentVerification`, `PopupPeer`, `PopupPinMessage`, `PopupReactedList`, `PopupReassignBoost`, `PopupSellStarGift`, `PopupSendNow`, `PopupSharedFolderInvite`, `PopupSponsored`, `PopupStarGiftInfo`, `PopupStarGiftValue`, `PopupStarGiftWear`, `PopupStarsPay`, `PopupToggleReadDate`, `PopupWebAppEmojiStatusAccess`, `PopupWebAppLocationAccess`, `PopupWebAppPreparedMessage`, `previewCard`, `reportAd`, `requestPeer`, `scheduleSendingPopup`, `shareUrl`, `simpleConfirmation`, `starGiftUpgrade`, `starGiftUpgradePrice`, `starsRating`, `storiesStealthMode`, `transferStarGift`

### Предположительные пары (совпало не точно)

`checklist` → `CreateChecklistPopup`, `passkey` → `PasskeyIntroPopup`, `stickers` → `StickerSetModal`

## Наши попапы без прямого аналога в tweb

`AddContactView`, `AddStorySheet`, `CallsView`, `CloseFriendsSheet`, `ConfirmPopup`, `ContactsView`, `CreateGiveawayPopup`, `EditContactView`, `EditStorySheet`, `FolderInvitePopup`, `GiftInfoPopup`, `InstantView`, `KeyVerificationPopup`, `NewContactPopup`, `ReportPopup`, `RepostStorySheet`, `SchedulePopup`, `ScheduledView`, `SearchView`, `SendMediaPopup`, `SettingsView`, `StealthModePopup`, `StoriesArchiveSheet`, `StreamSettingsPopup`, `SuggestPostPopup`, `SuggestedPostsView`, `WalletView`

Часть из них — переименования (сопоставление идёт по имени файла), часть — наше собственное.

## Вне скоупа

Не считаем расхождением: `_prism.scss`, `_groupCall.scss`, `_call.scss`, `_boostsViaGifts.scss`, `_payment.scss`, `_webApp.scss`, `_accountsLimit.scss`, `_conferenceCall.scss`, `_giftLink.scss`, `_passcodeLockScreen.scss`, `_giftPremium.scss`, `_print.scss`, `_paymentCardConfirmation.scss`, `_paymentMethods.scss`, `_paymentShippingMethods.scss`, `_paymentVerification.scss`, `_webApp.scss`, `_roboto.scss`, `_robotoMono.scss`, `_paymentCard.scss`.
