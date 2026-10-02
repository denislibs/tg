// Словари языков проверяются ПОВЕДЕНИЕМ: что показал `i18n()` на конкретном числе.
// Сверять поля объекта строки бессмысленно — такая проверка зеленеет и на
// перепутанных местами формах числа (это уже случалось в волне дважды).
//
// Строки берутся из НАСТОЯЩИХ `dict.*.ts` и прогоняются через настоящее применение
// языка. Эти файлы больше не чанки приложения (задача 9), а ИСХОДНИК, из которого
// сервер набивает свою таблицу (`backend/internal/langsource`), — то есть проверяется
// ровно то, что в бою приедет по сети.
import { describe, expect, it } from 'vitest'

import lang, { type LangPackKey } from '@/lang'
import I18n, { i18n } from '@lib/langPack'
import { applyLang } from '@/test/lang'

import ru from './dict.ru'
import uk from './dict.uk'
import es from './dict.es'
import de from './dict.de'
import fr from './dict.fr'

const DICTS = { ru, uk, es, de, fr }
type Code = keyof typeof DICTS

/**
 * Применение языка — тем же кодом продукта, что и в бою (`@/test/lang::applyLang`
 * → `I18n.applyServerLangPack`). Слияние «английский вниз, перевод поверх» здесь
 * НЕ ПОВТОРЯЕТСЯ: повторённое, оно превращало бы проверки «непереведённый ключ
 * показывает английский» в проверки оснастки — разбор у самой `applyLang`.
 */
const apply = applyLang

const text = (key: LangPackKey, args: (string | number)[]) => i18n(key, args).textContent

/** Подстановка числа в строке формы — любая из принятых `superFormatter` записей. */
const PLACEHOLDER = /%\d\$[sd]|%[sd]/

/**
 * Русские строки, у которых формы совпадают ПО ЯЗЫКУ: «фото» и «видео» не склоняются
 * («1 фото», «5 фото»). Без этого списка правило «форма единицы отличается от формы
 * пятёрки» требовало бы выдумать несуществующее склонение; со списком — проверяется в
 * обе стороны, чтобы он не стал лазейкой (см. «исключение протухло» ниже).
 */
// `MinutesShort` (задача 18 плана 2D, автоблокировка код-пароля) — сокращение «мин»
// не склоняется: «1 мин», «5 мин», «21 мин».
const RU_INDECLINABLE = new Set<string>(['PreviewSender.SendPhoto', 'PreviewSender.SendVideo', 'OnlineCount', 'MinutesShort'])

// Состав словарей ничем, кроме этого пина, не держится: молча уронить строку могут обе
// самые массовые задачи волны — кодмод задачи 6 и снос `t()` задачей 9. Потеря выглядит
// не как падение, а как английский текст у русского пользователя, и без пина сборка
// про неё молчит. Числа — не данные и не тавтология: они считаются из словаря, а не из
// него же берутся, и обновлять их можно только осознанно.
//
// `fingerprint` нужен сверх чисел: переименование ключа их не меняет, а перевод при этом
// теряется точно так же. Изменили словарь намеренно — обновите снимок ЗДЕСЬ и объясните
// в теле коммита, что именно ушло и пришло.
// Задача 6 добавила русскому девять строк: те, что были зашиты в код ПО-РУССКИ
// (секретный чат, подтверждение входа по QR, подсказка о фото контакта). Текст у них
// тот же, что показывался раньше, — изменилось только то, что теперь он ключ и перевод,
// а не литерал в JSX (плюс «Звонок» — метка превью из `core/dialogToChat.ts`).
//
// Задача 6, раунд ревью: русскому дописаны 100 строк — ключи, которые зовёт код, а
// перевода под новым именем не было (звонок, редактор медиа, мини-приложения,
// ссылки-приглашения, обсуждение). Их полноту сторожит `dictCoverage.test.ts`.
//
// `plural` вырос с одного до девяти-десяти: девять ключей-ОБРЫВКОВ («members»,
// «subscribers», «days», …) сведены в формы числа — интерфейс печатал число и слово
// рядом, и слово не склонялось («1 members»).
//
// Раунд 2: у русского +3 ключа (`NewGroup.DefaultTitle`/`NewChannel.DefaultTitle` —
// название чата, созданного без имени; `Hours` и `CanJoin` — ключи оригинала взамен
// осиротевших `Duration.*` и выдуманного суффикса; минус два наших дубля,
// `InviteLinks.CanJoinSuffix` и `Chat.Context.ReadShowWhen`). У остальных четырёх +8:
// те же четыре ключа плюс блок `PreviewSender.*`, которого у них не было вовсе —
// заголовок попапа отправки падал на английский. `legacy` не изменился: «show when»
// теперь достаёт `PmReadShowWhen` вместо снятого дубля, «can join» ушёл в объявленные
// слияния (число уехало ВНУТРЬ строки).
// Снимок обновлён ЗАДАЧЕЙ 7: пустая выдача поиска сведена на ключи оригинала
// (`Search.Empty`/`Search.EmptyFrom` с жирным аргументом внутри строки) вместо трёх
// наших половинок. У русского ключей на один меньше (три → два), у остальных четырёх
// столько же (две половинки → две целых строки), а старых строк, получающих перевод,
// у них стало на одну больше: `Search.EmptyFrom` они раньше не переводили вовсе.
// Задача 8: каждому словарю добавлен РОВНО ОДИН ключ — `LanguageName`,
// самоназвание языка («Русский», «Українська», …). Им подписана строка «Язык» в
// настройках, как у tweb (`settings.tsx:254`); до этого имена языков лежали
// таблицей на экране (`i18n/index.tsx::LANGS`), а не в словаре.
//
// ФИНАЛЬНОЕ РЕВЬЮ (нарушение DoD 2a): плашка пересылки в композере приведена к
// оригиналу — вместо трёх наших плоских ключей (`Chat.Accessory.Forward.One`,
// `.Many`, `.Hidden`) две ФОРМЫ ЧИСЛА оригинала (`Chat.Accessory.Forward`,
// `Chat.Accessory.Hidden`, tweb lang.ts:3430 и :3436). У русского минус один
// ключ (3 → 2) и плюс две числовые строки; у остальных четырёх этих ключей не
// было вовсе, поэтому их снимки не изменились.
//
// Задача 9 убрала из снимка третье число — `legacy`, сколько СТАРЫХ строк
// («ключ = английская строка») ещё получают перевод. Убрала не потому, что оно
// неудобно, а потому, что его предмет снесён вместе с мостом `legacyDict`:
// старых строк не осталось ни одной, и число это теперь тождественный ноль во
// всех пяти языках. Состав самих словарей задача 9 не трогала — `keys` и
// `plural` те же, что были у задачи 8, и это главное, что пин здесь стережёт.
//
// Задача #121 («даты следуют за языком»): русскому добавлены ЧЕТЫРЕ ключа
// относительных дат оригинала — `Date.Today`/`Yesterday` (с заглавной, начинают
// подпись) и `Peer.Status.Today`/`Peer.Status.Yesterday` (строчные, внутри
// фразы). Их зовёт `helpers/date.ts::formatFullSentTimeRaw`, порт tweb
// `date.ts:135-176`. Остальных четырёх словарей это не коснулось — они покрыты
// наполовину by design.
//
// Задача #126 («подпись присутствия»): русскому добавлены ВОСЕМЬ ключей
// оригинала (`wrappers/getUserStatusString.ts`) — `WithinAWeek`,
// `WithinAMonth`, `ALongTimeAgo`, `SupportStatus`,
// `Peer.Status.justNow`, `Peer.Status.LastSeenAt` и ДВЕ числовые формы
// (`Peer.Status.minAgo`, `LastSeen.HoursAgo`), отчего `plural` вырос с 28 до 30.
// Тексты не новые: они дословно те, что стояли в `core/presence.ts` тернарником
// `lang === 'ru'`, — переехали из кода в словарь. Формы числа у «минут» и
// «часов» появились ВПЕРВЫЕ: склейка `${diffMin} мин назад` их выразить не
// могла. Остальных четырёх словарей это не коснулось: под ними остаётся
// английский нижний слой — ровно то, что они показывали и до порта, только
// теперь это видно как непереведённый ключ, а не спрятано в ветке `else`.
//
// Задача #128 («футер комментариев»): русскому добавлен `LeaveAComment`, а
// `Chat.Title.Comments` переименован в `Comments` во всех пяти — отсюда `keys`
// у русского 1305 при том же `plural`.
//
// Ревью задачи 6 волны 3 (снос React-версии экрана входа): семь ключей,
// которых больше не зовёт НИ ОДИН потребитель (звавшая их React-версия
// снесена целиком, Solid-карточки используют СВОИ ключи), удалены из
// `lang.ts` и всех пяти словарей — `Login.ByPasskey`, `Login.ByPhone`,
// `Login.Passkey.Failed`, `Login.Password.SubtitleFlat`, `Login.PhoneInvalid`,
// `Login.Register.LastName.Placeholder`, `Login.ResetPassword.CodeHint`.
// Присутствовали не во всех пяти одинаково: у русского все семь (1309 → 1302,
// −7); у остальных четырёх — по четыре (`Login.ByPasskey` и
// `Login.ResetPassword.CodeHint` не имели перевода в uk/es/de/fr, отдавались
// нижним английским слоем и в их `DICTS` не попадали): 688 → 684 (uk), 687 →
// 683 (es/de/fr). `plural` не менялся — среди семи не было числовых строк.
//
// Задача 5 волны «шапка профиля классом PeerProfileAvatars» (раунд правок 1,
// 2026-09-05): русскому +1 ключ — `SubscribeRequests` (1302 → 1303). Это НЕ
// новый вызов: `t('SubscribeRequests')` в `UserInfoPanel.tsx` (секция заявок
// на вступление у групп/каналов) существовал и до задачи 5 дословно — перевода
// под ним не было НИКОГДА, просто `dictCoverage.test.ts` его не видел: скан
// парует кавычки по всему файлу регуляркой без разбора синтаксиса
// (`dictCoverage.test.ts:39`), и где-то раньше по файлу чётность кавычек была
// сбита ДО этого вызова — снос инлайновой карусели фото профиля задачей 5
// случайно сдвинул чётность и впервые сделал вызов видимым скану. Разбор и
// цифры — `web-client/backlogs/frontend/dict-coverage-scan-quote-pairing.md`.
// `plural` не менялся — строка не числовая.
//
// Задача «глухие перехваты на экране входа»: русскому +1 ключ —
// `Login.Passkey.Error` (1305 → 1306). Имя ВОЗВРАЩАЕТСЯ в словарь, и это не
// откат задачи 6: тогда его увели в `Error.SomethingWentWrong`, потому что под
// ним у нас жила ОБЩАЯ «что-то пошло не так» пяти мест, не имеющих отношения
// ко входу (папки, истории, близкие друзья) — имя было занято не по делу.
// Теперь ключ заводится ровно под свой предмет у оригинала: отказ входа по
// ключу доступа (tweb `langSign.ts:36`, текст сверяет `langTweb.test.ts`),
// вместо прежнего ПУСТОГО `catch {}`. `Error.SomethingWentWrong` при этом жив
// и своих пятерых вызывающих не теряет. `plural` не менялся — строка не числовая.
// Сдвиг набора задачей «открытие чата по ссылке»: русскому добавлены два ключа
// отказа резолва имени — `NoUsernameFound` и `Alert.UserDoesntExists` (оба взяты
// у оригинала дословно, tweb `lang.ts:1718` и `:3391`). До этой задачи отказ
// `#@username` глушился пустым `catch {}` (прежний `useUrlSync.ts`), а у
// оригинала он показывается тостом (`appImManager.ts:1802-1809`). `plural` не
// менялся — обе строки не числовые.
// Сдвиг набора задачей «разнобой языка интерфейса»: русскому добавлен ОДИН
// числовой ключ — `OnlineCount` (tweb lang.ts:1810, «%1$d online»), которого у
// нас не было вовсе. Его зовёт шапка чата
// (`wrappers/getChatMembersString.ts::getChatStatusString`, порт хвоста
// `appImManager.ts:3105`): до этого «, N онлайн» приклеивалось к подписи РУССКИМ
// ЛИТЕРАЛОМ мимо словаря. Отсюда `keys` 1310 → 1311 и `plural` 32 → 33. В
// остальных четырёх словарях ключа нет намеренно — они покрыты наполовину by
// design, под ними английский нижний слой. «Онлайн» в русском не склоняется,
// поэтому ключ стоит в `RU_INDECLINABLE`.
// Сдвиг набора волной 3 shared media: задача 10 добавила русскому
// `ProfileStories` (tweb lang.ts:2437, «Posts») — заголовок вкладки историй у
// канала/группы, который `loadFirstTime` подставляет вместо «Stories»
// (`appSearchSuper.ts:2483-2486`); задача 11 — ШЕСТЬ ключей 1:1 с tweb lang.ts:
// пять пунктов `createParticipantContextMenu` (`SetAsAdmin`, `EditAdminRights`,
// `KickFromSupergroup`, `AddToGroup`, `AddToChannel`) и подпись ранга
// `Chat.ChannelBadge` (`wrappers/participantRank.ts`); задача 12 — два ключа
// витрины подарков `StarGiftCollectionsEmptyOther` (tweb lang.ts:3326) и
// `StarGiftLimitedBadgeNum` (lang.ts:3178), их зовёт `stargifts/*.solid.tsx`.
// Отсюда `keys` 1311 → 1320, множественных форм не прибавилось. В остальных четырёх
// словарях ключей нет намеренно — под ними английский нижний слой.
//
// Задача 7 глобального поиска: русскому добавлен `Separator.ShowLess` — кнопка
// «Показать меньше» группы поиска (`components/searchGroup.solid.tsx`, tweb
// `searchGroup.tsx:73`). `keys` 1320 → 1321.
//
// Сдвиг набора задачей 10 глобального поиска: русскому добавлены семь ключей
// 1:1 с tweb lang.ts:4296-4303 — пункты `ChatTypeMenu` (`AllChats`, `UsersOnly`,
// `GroupsOnly`, `ChannelsOnly`) и тексты `EmptySearchPlaceholder`
// (`NoResultsTitle`, `NoResultsSubtitle`, `SearchInAllChats`). Вместе с задачей 7 `keys`
// 1320 → 1328, множественных форм не прибавилось; остальным четырём — ничего.
//
// Задача 9 глобального поиска: русскому добавлены три ключа 1:1 с tweb lang.ts —
// подпись своей строки `Presence.YourChat` (:258, `loadChats`), заголовок
// группы вкладки «Каналы» `Chat.Search.JoinedChannels` (:4093) и форма числа
// `Channels` (:1353) — имя скрытой группы каналов с запросом. `keys` 1328 →
// 1331, `plural` 33 → 34; остальным четырём — ничего.
//
// Задача 12 глобального поиска (владелец `initSearch`): русскому добавлены пять
// ключей 1:1 с tweb lang.ts — заголовок группы `SearchAllChatsShort` (:1819),
// имя вкладки `ChannelsTab` (:3379), ссылка очистки недавних `ClearRecentSearch`
// (:2030), кнопка подтверждения `ClearButton` (:1820) и имя приложения `AppName`
// (:1750) — заголовок попапа без своего (`popups/peer.ts:58`). `keys` 1331 →
// 1336, множественных форм не прибавилось; остальным четырём — ничего.
//
// Сдвиг набора задачей 14 shared media (меню элемента и выделение, tweb
// 812502980): русскому добавлены шесть ключей 1:1 с tweb lang.ts —
// `Message.Context.Goto`, `Message.Context.Selection.{Clear,Delete,Download,
// Forward}` и множественная форма `messages` (счётчик плашки выделения):
// Вместе с задачами 9 и 12 глобального поиска `keys` 1328 → 1342, `plural` 33 → 35 (`Channels` и `messages`). Замена трёх самодельных ключей
// копирования медиа ключами оригинала число строк не меняла (у `FINGERPRINT`).
//
// Сдвиг набора портом tweb e96e06c37 (S9, подтверждение замаскированной
// ссылки): русскому добавлены три ключа 1:1 с tweb lang.ts — `Open`,
// `OpenUrlTitle`, `OpenUrlAlert2` (попап `showMaskedAlert`): `keys` 1334 → 1337.
// Портом tweb 72c50bfef (уведомления без Web Notifications API) — ключ
// `Notifications.Restricted`: 1337 → 1338.
// Пилот плана 2D (задача 6, вкладка «Уведомления и звуки»): ключи tweb lang.ts
// `Telegram.NotificationSettingsViewController` (заголовок вкладки) и имена
// секций `NotificationsPrivateChats`/`NotificationsGroups`/`NotificationsChannels`
// — всем пяти словарям, КРОМЕ совпавших с английским дословно (правило
// «непереведённый ключ виден как отсутствие перевода»): у de нет
// `NotificationsPrivateChats` («Private Chats»), у fr — заголовка
// («Notifications»). ru 1346 → 1350, uk 682 → 686, es 681 → 685,
// de/fr 681 → 684. `plural` не менялся.
//
// Выравнивание корня настроек по tweb (`fix/settings-root-items`): у ВСЕХ пяти
// словарей снят `General.NightMode` — строки «Ночной режим» в корне у tweb нет
// (ночной режим — пункт подменю «Ещё» бургера). У русского вдобавок сняты
// выдумки `Premium.Row.Subtitle`/`Premium.Row.Active` (подзаголовка у строки
// Premium у оригинала нет) и `DarkMode` (пункт бургера у tweb подписан по теме),
// а добавлены четыре ключа 1:1 с tweb lang.ts — `EnableDarkMode`,
// `DisableDarkMode`, `MenuTelegramStars`, `SetAsEmojiStatus`: у русского
// −4 +4, число то же; у остальных −1 (поверх пилота: ru 1350, uk 685, es 684, de/fr 683).
//
// Задача 10 плана 2D (вкладка «Горячие клавиши», порт tweb keyboardShortcuts.tsx):
// десять ключей tweb lang.ts — `KeyboardShortcuts.Action.{Send,OpenSearch,
// SavedMessages,ZoomIn,ZoomOut,PlayPauseStory,CloseStories,Undo}`,
// `KeyboardShortcuts.Section.Formatting.Caption`, `…Section.MediaEditor` — всем пяти
// словарям (с английским дословно не совпал ни один): +10 каждому. ru 1350 → 1360,
// uk 686 → 696, es 685 → 695, de/fr 684 → 694. Врезкой той же задачи снесён React-экран
// `settings/HotkeysSettings.tsx`, а с ним — десять ключей, которые читал только он:
// самодельные `KeyboardShortcuts.Action.{HistoryStart,HistoryEnd,PlayPause,Exit,LockApp}`,
// `KeyboardShortcuts.Hint.PasscodeNotSet`, `KeyboardShortcuts.Section.PhotoEditor` и ключи
// tweb `MediaZoomIn`/`MediaZoomOut`/`Undo` (на вкладке их место заняли ключи
// `keyboardShortcuts.tsx`): −10 каждому. ru 1360 → 1350, uk 696 → 686, es 695 → 685,
// de/fr 694 → 684 — числа те же, что до задачи, набор другой (см. `FINGERPRINT`).
// Поверх корня настроек (снят `General.NightMode`): ru 1350, uk 685, es 684, de/fr 683.
//
// Задача 7 плана 2D («Данные и память» и автозагрузка): ключи tweb lang.ts
// `AutoDownloadContacts/Groups/Channels/Off/Files` (подписи строк Photos/Videos/
// Files), `AutodownloadContacts/Channels` (строки вкладок автозагрузки),
// `StorageQuota.Clear/Other/FailedToCalculate` и формы числа `Seconds`/`Minutes`
// (полная карта разрядов `wrapDuration.ts::DURATION_LANG_KEYS`). У fr нет двух
// `…Contacts` — совпали с английским дословно. ru 1350 → 1362, uk 686 → 698,
// es 685 → 697, de 684 → 696, fr 684 → 694; `plural` +2 у всех. Поверх корня настроек
// (у uk/es/de/fr −1): ru 1362, uk 697, es 696, de 695, fr 693.
//
// Задача 11 плана 2D (вкладка «Энергосбережение»): +13 ключей tweb lang.ts —
// `LiteMode.EnableText`/`Info`/`DisableAlert` и десять `LiteMode.Key.*.Title`
// дерева ключей — всем пяти словарям: ru 1350 → 1363, uk 686 → 699, es 685 → 698,
// de/fr 684 → 697. Врезкой сняты четыре ключа снесённого React-экрана, которых у
// tweb нет или которых больше никто не читает (`LiteMode.Caption`,
// `LiteMode.Key.background_animation.Title`, `LiteMode.Key.emoji.Title`,
// `Animations`): −4 каждому словарю.
// Поверх задач 7 и 10 и корня настроек (+9 каждому): ru 1371, uk 706, es 705, de 704, fr 702.
//
// Задачей 14 плана 2D (вкладка «Быстрая реакция») снят самодельный
// `DoubleTapSettingInfo` — подпись React-экрана, которой у tweb нет, читатель ушёл
// вместе с экраном: всем пяти по −1 (ru 1349, uk 685, es 684, de/fr 683).
// Поверх задач 7, 10, 11 и корня настроек (−1 каждому): ru 1370, uk 705, es 704, de 703, fr 701.
//
// Задача 9 плана 2D (экран сессии, незавершённые входы): восемь ключей tweb
// lang.ts:5635-5645 — `AuthSessions.View.{Device,Application,System,Location,
// LocationInfo,TerminateSession}`, `AuthSessions.IncompleteAttempts(Info)` — всем
// пяти, кроме совпавшего с английским у fr (`AuthSessions.View.Application` —
// «Application»). ru 1350 → 1358, uk 686 → 694, es 685 → 693, de 684 → 692,
// fr 684 → 691. `plural` не менялся.
// Поверх задач 7, 10, 11, 14 и корня настроек: ru 1378, uk 713, es 712, de 711, fr 708.
//
// Задача 12 плана 2D (вкладки «Обои» и «Цвет»): самодельные ключи прежнего
// React-экрана `ChatBackground.Upload`/`.Reset`/`.Blurred` (после сноса экрана —
// ни одного читателя) заменены ключами tweb lang.ts `ChatBackground.UploadWallpaper`,
// `Appearance.Reset`, `ChatBackground.Blur` и добавлен заголовок вкладки
// `ChatBackground` — всем пяти словарям: −3 +4, у каждого +1 (ru 1350 → 1351,
// uk 686 → 687, es 685 → 686, de/fr 684 → 685). `Appearance.Color.Hex`/`.RGB`
// (подписи полей выбора цвета) не переводятся — `NO_TRANSLATION` в
// `dictCoverage.test.ts`. `plural` не менялся.
// Поверх задач 7, 9, 10, 11, 14 и корня настроек: ru 1379, uk 714, es 713, de 712, fr 709.
//
// Мастер 2FA (план 2D, задача 19): +7 ключей tweb lang.ts
// (`TwoStepVerificationTitle`, `PleaseEnterCurrentPassword`, `YourEmailSkipWarning`,
// `YourEmailSkipWarningText`, `TwoStepVerificationEmailSet`,
// `TwoStepVerificationPasswordSetInfo`, `TwoStepVerificationEmailSetInfo`) всем
// пяти словарям: ru 1350 → 1357, uk 686 → 693, es 685 → 692, de/fr 684 → 691.
// `plural` не менялся.
// Снос React-мастера 2FA (`settings/TwoStepVerification.tsx`) — −6 наших ключей,
// которых нет у tweb и которые читал только он (`TwoStepAuth.EnterCurrentPassword`/
// `InvalidPassword`/`PasswordsDontMatch`/`EmailHelp`/`PasswordHelp`/`SetPassword`),
// у ru ещё −1 (`Common.DoneSuffix` — имя шага того же экрана): ru 1357 → 1350,
// uk 693 → 687, es 692 → 686, de/fr 691 → 685.
// Поверх задач 7, 9, 10, 11, 12, 14 и корня настроек: ru 1379, uk 715, es 714, de 713, fr 710.
//
// Задача 16 плана 2D (селектор пиров `AppSelectPeers`): ключ tweb lang.ts
// `RequestJoin.List.SearchEmpty` — подпись пустой выдачи (`appSelectPeers.tsx:1041`),
// всем пяти словарям: ru 1350 → 1351, uk 686 → 687, es 685 → 686,
// de/fr 684 → 685. `plural` не менялся.
// Поверх задач 7, 9, 10, 11, 12, 14, 19 и корня настроек: ru 1380, uk 716, es 715, de 714, fr 711.
//
// Задача 18 плана 2D (вкладка «Код-пароль», порт tweb passcodeLock/*): ключи tweb
// lang.ts `PasscodeLock.Notice`, `PasscodeLock.Next`, `PasscodeLock.Disabled`,
// `PasscodeLock.EnableLockShortcut`, `PasscodeLock.LockShortcutDescription` и
// числовой `MinutesShort` (у es и fr его нет — «%1$d min» совпал с английским):
// ru 1350 → 1356 (plural 35 → 36), uk 686 → 692, de 684 → 690 (plural 24 → 25),
// es 685 → 690, fr 684 → 689. Врезкой той же задачи сняты ключи снесённого
// React-экрана, у которых не осталось читателей, — `PasscodeLock.ForgotNotice`,
// `PasscodeLock.AutoLock.Caption`, `Unit.Minutes.Abbr` (и у ru `Common.Next`):
// ru 1356 → 1352, остальные −3 (uk 689, de 687, es 687, fr 686).
// Поверх задач 7, 9, 10, 11, 12, 14, 16, 19 и корня настроек: ru 1382, uk 719, es 717, de 717, fr 713.
//
// Задача 17 плана 2D (вкладки правил приватности, порт tweb privacySection/privacy/*):
// +11 ключей tweb lang.ts — `PrivacyExceptions`, `PrivacyMessages`, `Privacy.Bio`,
// `WhoCanAddMe`, `Privacy.Birthday`, `Privacy.BirthdayCaption`,
// `PrivacySettingsController.{Forwards.CustomHelp,LastSeenDescription,ProfilePhoto.CustomHelp}`,
// `PrivacyVoiceMessagesInfo` и числовой `Users` (у fr `PrivacyExceptions`/`PrivacyMessages`
// совпали с английским — в `SAME_AS_ENGLISH`, вместо снятого `Exceptions`). Сняты 13
// ключей без читателей: подписи и счётчик снесённого `settings/PrivacyRule.tsx`
// (`Exceptions`, `PrivacySettingsController.UserCount`, `Privacy.{LastSeen,ProfilePhoto}Caption`,
// `Privacy.VoiceCustomHelp`, `Privacy.BirthdayChoose`, `PrivacyForwardsInfo`) и давно
// мёртвые подписи того же экрана (`PrivacyPhoneInfo2`, `Privacy.LastSeenShortCaption`,
// `Privacy.{ProfilePhoto,Calls,Forwards}Choose`, `Privacy.NeverShareCaption`). Итого −2 у
// всех пяти (plural без изменений: `UserCount` → `Users`): ru 1380, uk 717, es 715, de 715, fr 711.
//
// Задача 24 плана 2D (вкладки «Папки», порт tweb chatFolders/editFolder/includedChats):
// ключи tweb lang.ts `FilterAll{Contacts,NonContacts,Groups,Channels,Bots}`,
// `FilterMenuDelete`, `FilterAlwaysShow`/`FilterNeverShow`, `EditFolder.EmojiAsIconTip`,
// `ChatList.Filter.{Contacts,Bots,ReadChats}`, `SharedFolder.{CreateLink,Description,
// Includes}`, `SharedFolder.Toast.{NeedName,NoTypes,NoExcluded}`, `LimitReached` и
// числовые `Chats`, `Groups`, `FilterShowMoreChats` (plural +3 у всех). У es/de/fr нет
// `ChatList.Filter.Bots` («Bots» совпал с английским), у fr — и `ChatList.Filter.Contacts`:
// ru 1382 → 1404, uk 719 → 741, es/de 717 → 738, fr 713 → 733. Врезкой той же
// задачи сняты ключи снесённых React-экранов папок без других читателей —
// `FilterRecommended` (секции нет, О-20), `FilterPersonal`/`FilterPersonalDescription`/
// `FilterUnreadDescription` (выдуманные пресеты рекомендованных), `Chat.ContextMenu.Read`,
// `MiniApps.AppsMore` и у ru ещё `SharedFolder.Edit.Title`/`SharedFolder.Link.Caption`
// (секция «Поделиться» прежнего редактора): ru 1404 → 1396, остальные −6
// (uk 735, es/de 732, fr 727).
// Поверх задачи 17: ru 1394, uk 733, es/de 730, fr 725.
//
// Задача 25 плана 2D (вкладка ссылки папки, порт tweb sharedFolder/inviteLink): +13
// ключей tweb lang.ts всем пяти — `SharedFolder.Edit.{Title,Description,Subtitle}`,
// `SharedFolder.NoChats`, `SharedFolder.NoChats.Title`,
// `SharedFolder.Cant.{Share,ShareBots,ShareUsers}`,
// `SharedFolder.Toast.{NoPrivate,NoAdminChannel,NoAdminGroup}`, `DeleteLink` и
// числовой `ChatsSelected` (plural +1 у всех). У ru снят наш `Folder.Share.Empty` —
// тост «нечем делиться» прежнего редактора заменён вкладкой ссылки без ссылки
// (`openChatlistInvite()`, как у оригинала): ru 1394 → 1406, uk 733 → 746,
// es/de 730 → 743, fr 725 → 738.
//
// Порт экрана блокировки код-паролем (tweb `components/passcodeLock/*`): ключи
// снесённого React-экрана `PasscodeLock.WrongPasscodeShort`,
// `PasscodeLock.ForgotPasscode.Text`, `PasscodeLock.Logout.Text` заменены ключами
// tweb `PasscodeLock.WrongPasscode`, `PasscodeLock.ForgotPasscode.OneAccount`/
// `.MultipleAccounts`, `PasscodeLock.LogoutPopup.Description` и `LogOut` у всех пяти:
// −3 +5 (plural без изменений) — ru 1396, uk 735, es/de 732, fr 727.
// Поверх задачи 25 (+2 каждому): ru 1408, uk 748, es/de 745, fr 740.
//
// Особые чаты («Telegram» 777000 и «Избранное»): у ru +4 ключа tweb lang.ts —
// `Peer.ServiceNotifications` (подпись служебного аккаунта, getUserStatusString
// :19-21) и `Verified.Bot`/`Verified.Channel`/`Verified.Group` (строка
// официальной верификации профиля, peerProfile.tsx BotVerification): ru 1412.
//
// Задача 28 плана 2D (корень настроек `AppSettingsTab`, порт tweb settings.tsx):
// +2 ключа tweb lang.ts всем пяти — заголовки строк корня
// `AccountSettings.PrivacyAndSecurity` и `AccountSettings.Filters` (:254, :256);
// у наших `PrivacySettings`/`ChatList.Filter.List.Title` остаются читатели —
// заголовки самих вкладок. У ru ещё −10: снесён экран подписки `PremiumManage`
// (у tweb его нет — Premium открывает попап), с ним — его ключи без других
// читателей: восемь наших `Premium.Manage.*` и `Stars.Subscription`/
// `Stars.Subscription.Cancel`. Итог: ru 1404, uk 750, es/de 747, fr 742.
//
// Задача 21 плана 2D (вкладка «Passkeys», порт tweb passkeys.tsx + popups/passkey.tsx):
// +7 ключей tweb lang.ts всем пяти — `Privacy.Passkeys.Caption`,
// `Privacy.Passkey.Created`/`Privacy.Passkey.LastUsage` (подзаголовок строки),
// `Passkey.Deletion.Title`/`Passkey.Deletion.Text` (подтверждение удаления),
// `Passkey.Created`/`Passkey.CreationError` (тосты `createPasskey`); −7 наших
// ключей снесённого React-экрана без других читателей — `Passkeys.Add`,
// `Passkeys.Caption`, `Passkeys.Created`, `Passkeys.Item`, `Passkeys.LastUsed`,
// `Passkeys.Unsupported`, `Passkey.CreateError`. Число строк то же, набор другой.
// Задача 0а-1 волны 7 (вкладка контактов вместо React-экранов «Контакты» и
// «Новое сообщение»): −2 наших ключа у всех пяти — `Compose.NewMessage` (заголовок
// снесённого «Нового сообщения»: у tweb это вкладка «Контакты») и `Contacts.NotFound`
// (пустая выдача снесённого экрана). Итог: ru 1402, uk 748, es/de 745, fr 740.
// Пилюля `messageActionSuggestBirthday` (users.suggestBirthday, О-22 плана
// волны 7): у ru +2 ключа tweb — `BirthdaySuggestIncoming`/`Outgoing`: ru 1404.
//
// Задача 20 плана 2D (вкладка «Автоудаление», порт tweb autoDeleteMessages/*):
// +3 ключа tweb lang.ts всем пяти — `AutoDeleteMessages.InfoDefault` (описание
// попапа своего срока) и `UnsavedChanges`/`UnsavedChangesDescription.Privacy`
// (подтверждение несохранённого на закрытии). Итог (поверх 0а-1 и О-22): ru 1407, uk 751,
// es/de 748, fr 743.
//
// Задача 0б-2 волны 7 (вкладка типа чата, порт tweb `sidebarRight/tabs/chatType.tsx`
// и `usernameInputField.ts`): +5 ключей tweb lang.ts всем пяти — подписи поля имени
// `Link.{Available,Invalid,Taken}` и подтверждение снятия имени
// `ChannelVisibility.Confirm.MakePrivate.{Channel,Group}`. У ru ещё −2: со сносом
// React-экрана `ChatTypeScreen` ушли наши `LinkInvalid`/`LinkTaken` без других
// читателей. Итог: ru 1410, uk 756, es/de 753, fr 748.
//
// Задача 15 плана 2D («Стикеры и эмодзи», порт tweb stickersAndEmoji.tsx): +7
// ключей tweb lang.ts — `SuggestStickersAll`/`Installed`/`None`,
// `LoopAnimatedStickersInfo`, `Emoji`, `Telegram.InstalledStickerPacksController`,
// `StickersBotInfo`; у es и fr без `Telegram.InstalledStickerPacksController` —
// «Stickers» там совпадает с английским (нижний слой). Сняты у всех пяти
// `DynamicPackOrder` (секции нет, О-43) и наш `Settings.BigEmoji` (ни одного
// читателя); у ru ещё четыре ключа снесённого React-экрана — `Stickers.MySets`,
// `Stickers.NoSets`, `Stickers.AddSets`, `Stickers.SearchSets`. Итог (поверх 0б-2): ru 1411,
// uk 761, es 757, de 758, fr 752.
// Задача 22 плана 2D (вкладка «Заблокированные», порт tweb blockedUsers.tsx): −1 наш
// ключ у всех пяти — `BlockedEmptyDescription` (пустое состояние снесённого
// React-экрана; у оригинала его нет). Итог: ru 1409, uk 755, es/de 752, fr 747.
// Задача 0а-3 волны 7 (вкладка «Новый канал», порт tweb newChannel.tsx +
// addChatUsers.ts): у ru +5 ключей tweb lang.ts — подтверждение `addChatUsers`
// (`AddMembersAlertTitle`/`AddMembersAlertCountText`/`AddMembersAlertNamesText`,
// `InviteToGroupError`) и поле поиска выбора подписчиков `SendMessageTo`; −1 у всех
// пяти: со сносом React-экрана `NewChannelFlow` ушёл наш `NewChannel.DefaultTitle`
// (вкладка tweb без названия канал не создаёт). Итог: ru 1414, uk 755, es/de 752, fr 747.
// Задача 26 плана 2D (вкладка «Динамики и камера», порт tweb
// speakersAndCamera.tsx + call/*): +8 ключей tweb lang.ts всем пяти — имена
// секций `CallSettings.OutputSection`/`InputSection`, подписи ошибок захвата
// `CallSettings.MicrophoneUnavailable`/`CameraUnavailable`, `aria-label` метра
// `AccDescr.MicrophoneLevel`, тосты отказа `ConferenceCall.Media.MicrophoneError`/
// `CameraError`, «Default» попапа выбора `Rtmp.OutputPopup.Default`. Сняты ключи
// без читателей: `CallSettings.AcceptCalls` (+ `.Caption` у ru/uk — у es/de/fr его
// не было) — строка «Принимать звонки» ушла в О-8 вместе с экраном, и
// `CallSettings.AcceptCallsShort` (читателя не было и до задачи). Итог (поверх 0б-2): ru 1415,
// uk 761, es/de 759, fr 754.
// Задача 27 плана 2D («Редактировать профиль» `AppEditProfileTab`, порт tweb
// editProfile.tsx): снесён React-экран `settings/EditProfile.tsx`, с ним — шесть
// наших ключей без других читателей (`EditProfile.LastNameLabel`,
// `EditProfile.Username.Checking`/`.Rules`/`.TooShort`/`.Caption`,
// `EditProfile.VideoError`; у uk/es/de/fr их было по три). У ru +4 ключа tweb
// lang.ts: `EditAccount.Username`, `EditProfile.Username.Invalid`,
// `Login.Register.LastName.Placeholder`, `UsernameHelp`. Итог (поверх задач 21,
// 0а-1, 20, О-22 и 0б-2 волны 7): ru 1408, uk 753, es/de 750, fr 745.
// Задача 2-2 волны 7 (бургер — порт tweb `createToolsMenu`/`createMoreSubmenu`):
// у ru +4 ключа tweb lang.ts — `Calls`, `CreateANew`, `PictureInPicture`,
// `ClientPip.Exit` (`TelegramFeaturesUrl` — адрес, перевода не требует,
// `dictCoverage.test.ts`). Сняты ключи без читателей: у всех пяти — `Stars.Wallet`
// (экран «Кошелёк» снесён: его единственный вход был пунктом бургера, которого
// у tweb нет), у ru ещё `Stars.TopUpTitle`/`Stars.Transaction`/`StarGift.Converted`
// (строки истории того же экрана) и `Pip.Title`/`Pip.Unsupported` (подпись и тост
// прежнего пункта PiP — у tweb `PictureInPicture`, а пункт без поддержки скрыт
// verify). Итог: ru 1415, uk 760, es 757, de 758, fr 752.
// Задача 23 плана 2D (хаб «Конфиденциальность» `AppPrivacyAndSecurityTab`, порт tweb
// privacyAndSecurity.tsx + тумблер «Hide Read Time» privacy/lastSeen.tsx): +5 ключей
// tweb lang.ts всем пяти — `PrivacySettingsController.UserCount` и `Passkeys` (оба
// с формами числа), `PrivacyAndSecurity.Item.Off`, `HideReadTime`, `HideReadTimeInfo`.
// Сняты ключи снесённого React-экрана без других читателей: `DeleteAccount.Action`/
// `.Caption`/`.Text`/`.Title` (удаления аккаунта в приложении у tweb нет) и
// `PrivacyGroupsTitle` (у tweb строка — `WhoCanAddMe`) у всех пяти; у ru ещё ключи
// снесённой вкладки «Время прочтения» — `PrivacyReadTime`, `PrivacyReadTimeTitle`,
// `Privacy.ReadTimeCaption`. Итог (поверх 2-2 волны 7): ru 1412 (форм числа 44), uk 760,
// es 757, de 758, fr 752 (форм числа +2 у каждого).
// Задача 0а-2 волны 7 («Новая группа», порт tweb newGroup.tsx): у ru +1 ключ tweb
// lang.ts — скрытое поле места `ChatLocation` (`SendMessageTo` завела 0а-3); у всех
// пяти −1: со сносом React-экрана `NewGroupFlow` и `useSidebarActions` ушёл наш
// `NewGroup.DefaultTitle` (вкладка tweb без названия группу не создаёт). Итог: ru 1412,
// uk 759, es 756, de 757, fr 751.
// Задача 0а-4 волны 7 (вкладка «Звонки», порт tweb calls.tsx): у ru +4 ключа tweb
// lang.ts:2017-2025 — `NoRecentCalls`, `NoRecentCallsInfo`, `Calls.Status.Group`,
// `CallBack` (`Calls` уже завела 2-2); −1 наш `Calls.Empty` снесённого React-экрана
// `CallsView` (у tweb пустой журнал — `NoRecentCalls`). Итог: ru 1415.
// Задача 0б-10 волны 7 (вкладка «Изменить контакт», порт tweb editContact.tsx +
// popups/deleteContacts.ts): у ru +23 ключа tweb lang.ts — `AddContactTitle`,
// `ContactNoteRow`, `SuggestBirthdayRow`, `EditContact.OriginalName`, `MobileHidden`,
// `MobileHiddenExceptionInfo`, `NewContact.Exception.ShareMyPhoneNumber{,.Desc}`,
// `PeerInfo.DeleteContact`, десять `UserInfo.*` личного фото, `DeleteContact`,
// `AreYouSureDeleteContact`, `DeleteContactsSubtitle` и числовой `DeleteContactsTitle`.
// Врезкой той же задачи снят наш `EditContact.PhotoHint` (подпись снесённого
// React-экрана `EditContactView`; у tweb — `UserInfo.CustomPhotoHelp`).
// Итог (поверх 0а-4): ru 1437 (форм числа 45).
// Задача 0б-11 волны 7 (вкладки «Поиск стикеров» и «Поиск GIF» правой колонки):
// у ru +2 ключа tweb lang.ts — `Stickers.SearchAdd` (кнопка набора, tweb
// `stickers.tsx:49`) и `SearchGifsTitle` (заголовок/плейсхолдер `AppGifsTab`,
// `tabs.ts:460`, `gifs.tsx:92`). Итог: ru 1417.
// Задача 1-4 волны 7 (строка списка чатов на `DialogElement`): «печатает» в строке —
// порт tweb `getPeerTyping` (`lib/appImManager.ts`), +23 ключа tweb lang.ts
// `Peer.Activity.{User,Chat,Chat.Multi,Chat.Pair}.*` в объёме наших действий набора —
// русскому и украинскому. Итог: ru 1438, uk 782.
// Задача 1-2 волны 7 (меню диалога — порт tweb `dialogsContextMenu.ts`,
// `popups/deleteDialog.ts`, `clearHistory.ts`): у ru +20 ключей tweb lang.ts — `MarkAsRead`,
// `ClearHistory`, `ChannelDelete`, `AlertClearHistory`, четыре `AreYouSureClearHistory*`,
// `ChannelDeleteMenu`, `AreYouSureDeleteAndExitChannel`, `DeleteChannelForAll`,
// `LeaveChannelMenu`, `ChannelLeaveAlertWithName`, `LeaveChannel`, `DeleteChatUser`,
// `AreYouSureDeleteThisChatWithUser`, `DeleteMegaMenu`, `AreYouSureDeleteAndExit`,
// `LeaveMegaMenu`, `AreYouSureDeleteAndExitName`. У всех пяти −2: снесённое React-меню строки
// было единственным читателем `MarkAsUnread` (пункт — О-72) и `ChatList.Context.Preview`
// (пункт — О-86). Итог (поверх 1-4): ru 1480, uk 780, es 754, de 755, fr 749.
// Бабл лога звонка (порт tweb wrappers/callBubble.ts): заголовок говорит, чем кончился
// звонок, — +6 ключей tweb lang.ts:2009-2014 (`CallMessageOutgoingMissed`,
// `CallMessageIncomingMissed`, `CallMessageIncomingDeclined` и их `CallMessageVideo*`)
// у ru; у uk/es/de/fr звонковых строк не было вовсе — +10 (те же шесть и четыре
// базовых `CallMessage{Incoming,Outgoing}`, `CallMessageVideo{Incoming,Outgoing}`).
// У ru −2 ключа без читателей: наш выдуманный `CallMessageCancelled` и
// `ChatList.Service.Call.Missed` (их звала только прежняя подпись причины).
// `Chat.CallMessage.TimeAndDuration` — пунктуация, в `NO_TRANSLATION` покрытия.
// Итог: ru 1484, uk 790, es 764, de 765, fr 759.
// Задача 2-5 волны 7 (плашка-подсказка `pendingSuggestion`): наш ключ
// `Suggestion.Notifications.Title` с вшитым «🔔» заменён ключом tweb
// `Suggestion.Notifications` (lang.ts:306, колокольчик — аргументом `%s`) у всех
// пяти: −1 +1, числа те же, набор другой (см. `FINGERPRINT`).
// Задача 0б-6 волны 7 (вкладка прав группы, порт tweb `sidebarRight/tabs/groupPermissions/*`):
// +37 ключей tweb lang.ts всем пяти (запреты и их подписи-исключения `UserRestrictionsNo*`,
// права админа `EditAdmin*` кита `sharedPermissions.ts`, медленный режим `Slowmode*`,
// исключения, «плата за сообщения» `PaidMessages.*`, плюральные `Stars` и
// `Permissions.ExceptionsCount`, подтверждение `UnsavedChangesDescription{,.Group}`). У es/de
// не легли `SlowmodeHours`/`Minutes`/`Seconds`, у fr — `SlowmodeHours`/`Seconds`: перевод
// совпал бы с английским (`%1$dh`…). У ru ещё −4 наших ключа снесённого React-экрана
// `PermissionsScreen`: `GroupPermissions.{PaidMessages,PaidMessages.Hint,StarsPerMessage}` и
// `SlowmodeInfo`. Итог: ru 1517, uk 827, es 798, de 799, fr 794.
// Задача 2-1 волны 7 (класс `AppSidebarLeft`): у ru +1 ключ tweb lang.ts
// `StarsRating.Back` — `aria-label` стрелки «назад» шапки колонки
// (`sidebarLeft/index.ts:163`). Итог: ru 1518.
// Задача 2-4 волны 7 (кнопка `#new-menu`, tweb `sidebarLeft/index.ts:1113-1129`): у ru
// +1 ключ tweb lang.ts:66 `ChatAutomation.NewChats` — `aria-label` кнопки. Итог: ru 1519.
// Задача 1-8 волны 7 (пустой список чатов и секция «Контакты», tweb
// `appDialogsManager.ts:1649-1772`): у ru +6 ключей tweb lang.ts — заголовок и две подписи
// `ChatList.Main.EmptyPlaceholder.*`, плюральный `Contacts.Count`, пустая папка
// `FilterNoChatsToDisplay{,Info}`. Итог: ru 1536, плюральных 49.
const COMPOSITION = {
  ru: { keys: 1536, plural: 49 },
  uk: { keys: 827, plural: 35 },
  es: { keys: 798, plural: 34 },
  de: { keys: 799, plural: 35 },
  fr: { keys: 794, plural: 34 },
}

// es/de/fr совпадают не случайно: у них ОДИН набор ключей и разные переводы —
// снимок считается по ключам, а не по текстам.
// Сдвиг задачей 0б-3 волны 7 у русского: −10 наших ключей снесённого React-экрана
// ссылок (`InviteLinks.{Caption,Description.*,Expires,Limit*,NameLabel,*Help,View}`),
// +21 ключ tweb вкладок ссылок (`chatInviteLink*.solid.tsx`), из них одна форма
// числа — `InviteLink.JoinedNew`.
// Снимок обновлён задачей 6: ключ 'Login.Passkey.Error' переименован в
// 'Error.SomethingWentWrong' — его звали пять мест, и ни одно из них не про вход
// (папки, истории, близкие друзья). Состав словарей не изменился: те же строки под
// другим именем, поэтому числа выше прежние, а снимок НАБОРА — новый.
// Второй сдвиг набора той же задачей 7: наш ПРЕФИКС `DeleteAlsoFor` («Also delete
// for» + имя, склеенное вызывающим) заменён ключом оригинала
// `DeleteMessagesOptionAlso` («Also delete for %1$s», tweb lang.ts:1607). Число
// строк не изменилось — сменилось имя и появился аргумент внутри.
// Сдвиг набора задачей 8 — тот же один ключ `LanguageName` во всех пяти.
// Сдвиг набора задачей #121 — четыре ключа относительных дат у русского. Второй
// сдвиг той же задачей, уже во ВСЕХ пяти: наш обрезок-префикс подписи
// запланированного сообщения заменён ключом оригинала `Chat.Date.ScheduledFor`
// ('Scheduled for %@', tweb lang.ts:3467) — дата едет АРГУМЕНТОМ внутрь строки,
// а не приклеивается к переведённой половине фразы. Число ключей от этого не
// изменилось ни у кого, сменилось имя.
// Сдвиг набора задачей #126 — восемь ключей подписи присутствия у русского
// (`Online` и `Lately` в словаре уже были, :196 и :625).
// Сдвиг набора задачей #128 — ВО ВСЕХ ПЯТИ: наш `Chat.Title.Comments` заменён
// ключом оригинала `Comments` (tweb lang.ts:1357, аргумент позиционный `%1$d`),
// а русскому добавлен `LeaveAComment` — второй ключ футера, которого у нас не
// было вовсе: на нуле комментариев мы писали «Комментарии» вместо «Оставьте
// комментарий». Число строк выросло только у русского, у остальных сменилось
// имя ключа.
// Сдвиг набора порта вкладки «Язык» — ВО ВСЕХ ПЯТИ по одному ключу:
// `AccountSettings.Language` (tweb lang.ts:3385). Это ЗАГОЛОВОК СТРОКИ «Язык» в
// корне настроек; прежде строка была подписана `Telegram.LanguageViewController`,
// которым у оригинала подписана сама ВКЛАДКА, — по-английски обе читаются
// одинаково («Language»), поэтому подмена и держалась незамеченной. Теперь у
// каждой из двух ролей свой ключ, как в оригинале, и оба живые.
// Ревью задачи 5 волны 3 (auth-карточки на Solid): русскому добавлены ТРИ
// ключа 1:1 с tweb langSign.ts, у которых раньше был только наш собственный
// перифраз без стрелки/аргумента — `Login.Passkey` ('Log in by passkey >'),
// `Login.QR.Cancel` ('Log in by phone number >') и
// `Login.ResetPassword.Subtitle` ('...to your email **%s**.', маска почты
// аргументом). Старые ключи (`Login.Passkey.Action`, `Login.ByPhone`,
// `Login.ResetPassword.CodeHint`) тогда не удалялись — ими ещё пользовалась
// React-версия тех же карточек.
// Ревью задачи 6 волны 3: семь мёртвых ключей (см. докблок у `COMPOSITION`
// выше — тот же список) убраны из НАБОРА, отсюда новый снимок у всех пяти;
// `Login.Passkey.Action` при этом ЖИВ (его теперь зовёт Solid
// `SignInCard.solid.tsx`, кнопка входа по ключу доступа) — в списке снесённых
// его нет.
// Сдвиг набора задачей 5 волны «шапка профиля» (раунд правок 1): русскому
// добавлен `SubscribeRequests` (см. докблок у `COMPOSITION` выше — там же
// разбор, почему это правка НЕ задачи 5 по существу, а снятие слепоты скана
// покрытия). У остальных четырёх словарей набор не менялся — их снимок тот же.
// Сдвиг набора задачей «фолбэк без WASM SIMD»: русскому добавлены два ключа
// медиаредактора (`MediaEditor.StickerAnimatedUnsupported`,
// `MediaEditor.StickerNotRendered`) — lottie-стикер без декодера WASM SIMD
// недоступен для добавления, а слой без источника не пропадает молча из
// экспорта (backlogs/frontend/lottie-no-wasm-fallback.md). У остальных
// четырёх словарей набор не менялся — их снимок тот же.
// Сдвиг набора задачей «глухие перехваты на экране входа»: русскому добавлен
// `Login.Passkey.Error` (разбор — у `COMPOSITION` выше). У остальных четырёх
// словарей набор не менялся — их снимок тот же.
// Сдвиг набора задачей «опрос в ленте» (`feat/poll-message-content`): у ВСЕХ
// пяти словарей сняты два ключа, которых нет в оригинале вовсе, —
// `Chat.Poll.VotedSuffix` и `Chat.Quiz.AnsweredSuffix`. Они были нашей
// выдумкой времён React-компонента `PollBubble` (тот снесён вместе с React-
// лентой) и склеивали счётчик руками: «N» + «проголосовало». tweb считает его
// ОДНОЙ строкой с формой числа — `Chat.Poll.MembersVoted` /
// `Chat.Quiz.MembersAnswered`, — и порт тела опроса зовёт именно их, поэтому
// суффиксы стали мёртвыми. Русскому вместе с этой парой множественных форм
// добавлены `Chat.Poll.Type.Public` и `Chat.Poll.SelectAnOption`: −2 +4 = +2
// ключа и +2 множественные формы; остальным четырём — только −2.
// Сдвиг набора задачей «открытие чата по ссылке»: русскому добавлены
// `NoUsernameFound` и `Alert.UserDoesntExists` (разбор — у `COMPOSITION` выше).
// У остальных четырёх словарей набор не менялся — их снимок тот же.
// Сдвиг набора волной 3 shared media (задачи 10-12): русскому добавлены
// `ProfileStories`, шесть ключей меню участника и ранга и два ключа витрины
// подарков (разбор — у `COMPOSITION` выше). У остальных четырёх словарей
// набор не менялся.
// Сдвиг набора задачами 7 и 10 глобального поиска: русскому добавлены
// `Separator.ShowLess` и семь ключей `ChatTypeMenu`/`EmptySearchPlaceholder`
// (разбор — у `COMPOSITION` выше).
// Сдвиг набора задачей 9 глобального поиска: русскому добавлены
// `Presence.YourChat`, `Chat.Search.JoinedChannels` и `Channels` (разбор — у
// `COMPOSITION` выше).
// Сдвиг набора задачей 12 глобального поиска: русскому добавлены
// `SearchAllChatsShort`, `ChannelsTab`, `ClearRecentSearch`, `ClearButton` и
// `AppName` (разбор — у `COMPOSITION` выше).
// Сдвиг набора задачей 14 shared media (копирование медиа, tweb 508acd4f5):
// у русского самодельные `MediaViewer.Context.CopyMedia`,
// `MediaViewer.ImageCopied`, `MediaViewer.CopyError` (выдумка React-меню, ни
// одного читателя) заменены ключами оригинала `MediaViewer.Context.Copy`,
// `MediaCopied`, `MediaCopyFailed`: −3 +3, число строк то же. Следом —
// шесть ключей меню элемента и выделения (разбор — у `COMPOSITION` выше).
// Сдвиг набора портом tweb e96e06c37: +3 ключа попапа замаскированной ссылки
// (разбор — у `COMPOSITION` выше). Портом 72c50bfef — `Notifications.Restricted`.
// Пилотом 2D — заголовок вкладки уведомлений и три имени секций (разбор — у
// `COMPOSITION` выше; de и fr расходятся по одному совпавшему ключу).
// Выравниванием корня настроек по tweb — снят `General.NightMode` у всех пяти,
// у русского ещё −3 +4 (разбор — у `COMPOSITION` выше).
// Задачей 10 плана 2D — десять ключей вкладки «Горячие клавиши» всем пяти и снос
// десяти ключей React-экрана (разбор — у `COMPOSITION` выше).
// Задачей 7 плана 2D — ключи «Данных и памяти» и `Seconds`/`Minutes` (разбор —
// у `COMPOSITION` выше).
// Задачей 11 плана 2D — ключи «Энергосбережения» (разбор — у `COMPOSITION` выше).
// Задачей 14 плана 2D — минус `DoubleTapSettingInfo` у всех пяти.
// Задачей 9 плана 2D — восемь ключей экрана сессии (разбор — у `COMPOSITION`).
// Задачей 12 плана 2D — ключи «Обоев» вместо ключей снесённого React-экрана
// (разбор — у `COMPOSITION` выше), у всех пяти.
// Мастером 2FA — +7 ключей tweb, сносом React-мастера — −6 (у ru −7) наших
// (разбор — у `COMPOSITION` выше).
// Задачей 16 плана 2D — подпись пустой выдачи селектора пиров (разбор — там же).
// Задачей 18 плана 2D — ключи вкладки «Код-пароль» (разбор — у `COMPOSITION` выше).
// Задачей 17 плана 2D — ключи вкладок правил приватности вместо ключей снесённого
// React-экрана правила (разбор — у `COMPOSITION` выше).
// Задачей 13 плана 2D — самодельные `Theme.Light`/`Theme.System`/`Theme.Tinted`
// снесённого React-экрана «Общих» заменены ключами tweb `ThemeDay`/`ThemeTinted`/
// `AutoNightSystemDefault` у всех пяти: −3 +3, число строк то же.
// Задачей 24 плана 2D — ключи вкладок «Папки» вместо ключей снесённых React-экранов
// папок (разбор — там же).
// Портом экрана блокировки — ключи tweb вместо ключей React-экрана (разбор — у
// `COMPOSITION` выше), у всех пяти.
// Портом кнопки замка (`sidebarLeft/lockButton.solid.tsx`) — наш `PasscodeLock.LockNow`
// заменён ключом tweb `PasscodeLock.TapToLock` у всех пяти: −1 +1, число строк то же.
// Особыми чатами — у ru +4 ключа tweb (разбор — у `COMPOSITION` выше).
// Задачей 28 плана 2D — два ключа строк корня настроек у всех пяти, у ru — минус
// ключи снесённого `PremiumManage` (разбор — там же).
// Задачей 21 плана 2D — ключи вкладки «Passkeys» вместо ключей снесённого
// React-экрана, −7 +7 у всех пяти (разбор — у `COMPOSITION` выше).
// Задачей 0а-1 волны 7 — минус `Compose.NewMessage` и `Contacts.NotFound` у всех пяти:
// наши ключи снесённых React-экранов «Новое сообщение» и «Контакты» (вкладка контактов
// tweb пустой выдачи не подписывает, а «Новое сообщение» — это она же).
// Пилюлей предложения даты рождения — у ru +2 ключа tweb (разбор — там же).
// Задачей 20 плана 2D — три ключа вкладки «Автоудаление» у всех пяти (там же).
// Задачей 0б-2 волны 7 — +5 ключей вкладки типа чата у всех пяти, у ru — минус
// `LinkInvalid`/`LinkTaken` снесённого React-экрана (разбор — там же).
// Задачей 15 плана 2D — ключи «Стикеров и эмодзи» вместо ключей снесённого
// React-экрана (разбор — у `COMPOSITION` выше).
// Задачей 22 плана 2D — минус `BlockedEmptyDescription` у всех пяти (разбор — у
// `COMPOSITION` выше).
// Задачей 0а-3 волны 7 — у ru +5 ключей tweb, у всех пяти минус `NewChannel.DefaultTitle`
// снесённого React-экрана (разбор — у `COMPOSITION` выше).
// Задачей 26 плана 2D — ключи вкладки «Динамики и камера» вместо ключей
// «Принимать звонки» (разбор — у `COMPOSITION` выше).
// Задачей 27 плана 2D — минус ключи снесённого React-экрана профиля у всех пяти,
// у ru плюс четыре ключа tweb (разбор — у `COMPOSITION` выше).
// Задачей 2-2 волны 7 — у ru +4 ключа бургера tweb, у всех пяти минус ключи
// снесённого «Кошелька» (разбор — у `COMPOSITION` выше).
// Задачей 23 плана 2D — ключи хаба «Конфиденциальность» и «Hide Read Time» вместо
// ключей снесённого React-экрана и вкладки «Время прочтения» (разбор — у
// `COMPOSITION` выше).
// Задачей 0а-2 волны 7 — у ru +1 ключ tweb `ChatLocation`, у всех пяти минус
// `NewGroup.DefaultTitle` снесённого React-экрана (разбор — там же).
// Задачей 0а-4 волны 7 — у ru +4 ключа вкладки «Звонки» и −1 `Calls.Empty`
// снесённого React-экрана (разбор — там же).
// Задачей 0б-10 волны 7 — у ru +23 ключа вкладки «Изменить контакт» (разбор — там же).
// Задачей 0б-11 волны 7 — у ru +2 ключа tweb (разбор — у `COMPOSITION` выше).
// Задачей 1-4 волны 7 — у ru и uk +23 ключа `Peer.Activity.*` tweb (разбор — у
// `COMPOSITION` выше).
// Задачей 1-2 волны 7 — у ru +20 ключей меню диалога и его попапов, у всех пяти минус
// `MarkAsUnread` и `ChatList.Context.Preview` снесённого React-меню (разбор — у
// `COMPOSITION` выше).
// Баблом лога звонка — ключи исхода звонка (разбор — у `COMPOSITION` выше).
// Задачей 2-5 волны 7 — `Suggestion.Notifications.Title` → ключ tweb
// `Suggestion.Notifications` у всех пяти (разбор — у `COMPOSITION` выше).
// Задачей 0б-6 волны 7 — ключи вкладки прав группы у всех пяти, у ru минус четыре ключа
// снесённого `PermissionsScreen` (разбор — у `COMPOSITION` выше).
// Задачей 2-1 волны 7 — у ru +1 ключ tweb `StarsRating.Back` (разбор — там же).
// Задачей 2-4 волны 7 — у ru +1 ключ tweb `ChatAutomation.NewChats` (разбор — там же).
// Задачей 1-8 волны 7 — у ru +6 ключей пустого списка и контактов (разбор — там же).
const FINGERPRINT = {
  ru: '4c9e806e',
  uk: 'ffe46f66',
  es: '1c8d911a',
  de: 'dcd1c9f9',
  fr: 'b3dccb74',
}

/** FNV-1a по отсортированным ключам: короткий снимок НАБОРА, а не его копия. */
function fingerprint(keys: string[]) {
  let h = 0x811c9dc5
  for (const ch of [...keys].sort().join('\n')) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

describe('состав словарей под пином', () => {
  it('число строк по языкам не менялось', () => {
    const got = Object.fromEntries(Object.entries(DICTS).map(([code, strings]) => [code, {
      keys: strings.length,
      plural: strings.filter((string) => string._ === 'langPackStringPluralized').length,
    }]))
    expect(got).toEqual(COMPOSITION)
  })

  it('набор ключей по языкам не менялся', () => {
    const got = Object.fromEntries(
      Object.entries(DICTS).map(([code, strings]) => [code, fingerprint(strings.map((s) => s.key))]),
    )
    expect(got).toEqual(FINGERPRINT)
  })
})

describe('формы числа выбирает язык, а не вызывающий', () => {
  // Числа выбраны по границам русского правила: 1 — one, 2 — few, 5 — many, 21 — снова
  // one. Именно 21 ловит «взяли форму по последней цифре наоборот» и «few вместо many».
  it('русский склоняет 1/2/5/21', async () => {
    await apply('ru')
    expect([1, 2, 5, 21].map((n) => text('Notifications.Count', [n]))).toEqual([
      '1 уведомление',
      '2 уведомления',
      '5 уведомлений',
      '21 уведомление',
    ])
  })

  // Ключи-ОБРЫВКИ, сведённые задачей 6: интерфейс печатал «5» и «участников» рядом, и
  // слово не склонялось — «1 участников». Проверка держит именно это: единица обязана
  // дать единственное число, а не общую форму.
  it('сведённые обрывки склоняются: участники, подписчики, стикеры, дни', async () => {
    await apply('ru')
    expect([
      text('Members', [1]), text('Members', [2]), text('Members', [5]),
      text('Subscribers', [1]), text('Stickers', [1]), text('Days', [1]), text('Days', [3]),
    ]).toEqual([
      '1 участник', '2 участника', '5 участников',
      '1 подписчик', '1 стикер', '1 день', '3 дня',
    ])
  })

  it('украинский склоняет 1/2/5/21', async () => {
    await apply('uk')
    expect([1, 2, 5, 21].map((n) => text('Notifications.Count', [n]))).toEqual([
      '1 сповіщення',
      '2 сповіщення',
      '5 сповіщень',
      '21 сповіщення',
    ])
  })

  // Слот `other` у славянских языков достаётся ТОЛЬКО дробным, и там родительный
  // единственного, а не форма `many`. Проверка держит это утверждение данными: без неё
  // комментарий у словаря обещал бы больше, чем в нём лежит.
  it('дробное число берёт other, и это не форма many', async () => {
    await apply('ru')
    expect(text('Notifications.Count', [1.5])).toBe('1.5 уведомления')
    await apply('uk')
    expect(text('Notifications.Count', [1.5])).toBe('1.5 сповіщення')
  })

  // У немецкого, испанского и французского форм всего две — и это не «недоперевод»,
  // а правило языка: пятёрка обязана дать ту же форму, что и двойка.
  it('у языков с двумя формами 2 и 5 дают одно и то же', async () => {
    const got: Record<string, string[]> = {}
    for (const code of ['de', 'es', 'fr'] as const) {
      await apply(code)
      got[code] = [1, 2, 5].map((n) => text('Notifications.Count', [n])!)
    }
    expect(got).toEqual({
      de: ['1 Benachrichtigung', '2 Benachrichtigungen', '5 Benachrichtigungen'],
      es: ['1 notificación', '2 notificaciones', '5 notificaciones'],
      fr: ['1 notification', '2 notifications', '5 notifications'],
    })
  })

  // Форму даёт КОД ЯЗЫКА пакета: те же данные под другим кодом склоняются иначе.
  // Без этого «правильный русский» мог бы оказаться правилом прошлого языка.
  it('смена языка меняет правило, а не только слова', async () => {
    await apply('ru')
    const before = text('Notifications.Count', [5])
    await apply('de')
    expect(before).toBe('5 уведомлений')
    expect(text('Notifications.Count', [5])).toBe('5 Benachrichtigungen')
  })

  // ПИН НА ВСЕ ФОРМЫ ЧИСЛА, а не на пять из двадцати одной. Ревью сломало русскую
  // форму `VoiceChat.Status.Members.one_value` — весь набор остался зелёным: точечные
  // проверки покрывали `Notifications.Count` и ещё четыре ключа, остальные шестнадцать
  // не смотрел никто.
  //
  // Утверждения выбраны так, чтобы НЕ переписывать словарь в ожидания (это была бы
  // тавтология), но ловить настоящие ошибки перевода:
  //  • число обязано остаться в КАЖДОЙ форме — «Просмотрено» вместо «21 просмотр»
  //    теряет его ровно так (славянский `one` покрывает 21, 31, 101);
  //  • у русского форма единицы обязана отличаться от формы пятёрки — иначе в `one`
  //    скопировали `many` (ровно мутация ревью);
  //  • 21 обязана дать ту же форму, что 1 — это и есть правило языка, а не текст.
  it('у каждого числового ключа русские формы различают 1, 5 и 21', async () => {
    await apply('ru')
    const bad: string[] = []
    for (const string of DICTS.ru) {
      if (string._ !== 'langPackStringPluralized') continue
      const key = string.key as LangPackKey
      // Ключи, у которых объявлена только общая форма, правилу единицы не подчиняются.
      if (!string.one_value) continue
      // Сравниваются ФОРМЫ, а не отрисованный текст: «1 участников» и «5 участников»
      // различаются числом и на скопированной форме — ровно так мутация и выживала.
      const indeclinable = RU_INDECLINABLE.has(key)
      const same = string.one_value === string.many_value || string.one_value === string.few_value
      if (same && !indeclinable) bad.push(`${key}: форма единицы совпала с формой множества («${string.one_value}»)`)
      // Исключение обязано быть живым: как только слово начнёт склоняться, список
      // протух — иначе в него можно вписать что угодно, и правило выше умрёт молча.
      if (!same && indeclinable) bad.push(`${key}: в списке несклоняемых, но формы различаются — исключение протухло`)
      // 21 обязана дать форму ЕДИНИЦЫ — это правило языка, а не текст словаря.
      // `**жирный**` ядро рисует узлом, и в тексте звёздочек не остаётся.
      const expected = string.one_value.replace(PLACEHOLDER, '21').replace(/\*\*/g, '')
      if (text(key, [21]) !== expected) bad.push(`${key}: 21 не даёт форму единицы («${text(key, [21])}» вместо «${expected}»)`)
    }
    expect(bad).toEqual([])
  })

  // ЧИСЛО В КАЖДОЙ ФОРМЕ — отдельная проверка, и её правило берётся у ЯЗЫКА, а не у
  // английского источника. У английского форма единицы это ровно единица, поэтому
  // «Send Photo» без числа там верно; у русского и украинского та же форма покрывает
  // 21, 31, 101 — и «Отправить файл» на 21 файле теряет число насовсем. Первая
  // редакция пина сверялась с источником и потому УЗАКОНИВАЛА этот дефект.
  it('в языке, где форма единицы покрывает 21, число стоит в каждой форме', () => {
    const bad: string[] = []
    for (const code of Object.keys(DICTS) as Code[]) {
      // Языки различаются не списком, а правилом: форма единицы покрывает больше единицы.
      const rules = new Intl.PluralRules(code)
      const oneCoversMore = rules.select(21) === 'one'
      for (const string of DICTS[code]) {
        if (string._ !== 'langPackStringPluralized') continue
        const source = lang[string.key as LangPackKey] as Record<string, string | undefined>
        // Строка вообще про счёт? Спрашиваем у общей формы источника — она есть всегда.
        if (!source?.other_value || !PLACEHOLDER.test(source.other_value)) continue
        for (const [slot, value] of Object.entries(string)) {
          if (!slot.endsWith('_value') || typeof value !== 'string') continue
          if (PLACEHOLDER.test(value)) continue
          // `one` без числа законен только там, где он покрывает ровно единицу.
          if (slot === 'one_value' && !oneCoversMore) continue
          bad.push(`${code} ${string.key}.${slot}: «${value}» — без числа`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  // Каждая форма, объявленная в словаре, обязана ДОЕХАТЬ до текста: недостающая
  // выдаёт себя тем, что ядро показывает сам ключ или чужой язык.
  it('в каждом словаре все формы всех числовых строк дают перевод', async () => {
    const bad: string[] = []
    for (const code of Object.keys(DICTS) as Code[]) {
      await apply(code)
      for (const string of DICTS[code]) {
        if (string._ !== 'langPackStringPluralized') continue
        const key = string.key as LangPackKey
        for (const n of [1, 2, 5, 21, 101]) {
          const got = text(key, [n])
          if (got === key) bad.push(`${code} ${key} на ${n}: показан ключ`)
          if (got === `${n} ${String(lang[key])}`) bad.push(`${code} ${key} на ${n}: английский текст`)
        }
      }
    }
    expect(bad).toEqual([])
  })
})

// ── НЕПЕРЕВЕДЁННЫЙ КЛЮЧ ЧИТАЕТСЯ ПО-АНГЛИЙСКИ, А НЕ СВОИМ ИМЕНЕМ ────────────────
//
// Это главное правило слияния (`I18n.applyServerLangPack`, порт tweb :237-244), и
// до ревью задачи 9 оно НЕ БЫЛО ЗАПИНЕНО на продуктовом пути: единственная
// целившаяся туда проверка стояла на ключе `Delete`, чьё английское значение
// буквально равно его имени, — «упало на английский» и «вернуло имя ключа» там
// неотличимы. Мутация «снять английский нижний слой» оставляла всю сюиту зелёной.
//
// Отказ, который здесь стережётся, видит пользователь: у украинского, немецкого,
// испанского и французского переведена примерно ПОЛОВИНА словаря, и без нижнего
// слоя вторая половина поехала бы на экран символическими именами
// («PeerInfo.Discussion» вместо «Discussion»).
//
// Проверяются ВСЕ непереведённые ключи каждого языка разом, а не образец, и
// только те, чей английский текст с именем НЕ совпадает: на остальных
// утверждение невыразимо (таких ключей в `lang.ts` шестьдесят один).
describe('нижний английский слой держит непереведённые ключи', () => {
  /** Ключи, у которых «английский текст» отличим от «имени ключа». */
  const EXPRESSIVE = (Object.keys(lang) as LangPackKey[])
    .filter((key) => typeof lang[key] === 'string' && lang[key] !== key)

  /**
   * Эталон считается ИЗ ФАЙЛА `lang.ts`, МИМО применения языка, — и это условие
   * зрячести, а не удобство. Первая редакция брала эталоном выдачу `i18n()` на
   * применённом английском, и проверка ослепла ровно на той мутации, ради которой
   * писалась: снятый нижний слой ломает обе стороны одинаково (и «эталон», и
   * измеряемое становятся именем ключа), сравнение сходится, тест зелёный.
   *
   * Сырое значение эталоном тоже не годится: разметку и плейсхолдеры разбирает
   * `superFormatter` («Do you want to set «%1$s» …» без аргументов даёт «Do you
   * want to set «» …»). Поэтому эталон — то же значение, прогнанное через ТОТ ЖЕ
   * разбор, но взятое из файла, а не из карты строк.
   */
  const flatten = (pieces: ReturnType<typeof I18n.superFormatter>) => pieces
    .map((piece) => (piece instanceof HTMLBRElement ? '\n' : piece instanceof Node ? piece.textContent : String(piece)))
    .join('')
  // Ссылка без адреса — `[текст]()` (ключи tweb `PasscodeLock.ForgotPasscode.*`) —
  // берёт узел из аргументов вызова (`superFormatter`, ветка без url), как у tweb;
  // без аргумента разбор падает. Эталону дают пустой узел на каждую такую ссылку —
  // текст ссылки ляжет в него.
  // Остальным ключам аргументов не дают вовсе: пустой массив превратил бы
  // плейсхолдеры в «undefined».
  const anchorArgs = (text: string) => {
    const args = Array.from(text.matchAll(/\[.+?\]\(\)/g), () => document.createElement('span'))
    return args.length ? args : undefined
  }
  const english = new Map(EXPRESSIVE.map((key) => [key, flatten(I18n.superFormatter(lang[key] as string, anchorArgs(lang[key] as string)))]))

  it('сам набор проверяемых ключей не выродился', () => {
    // Иначе «нарушителей нет» означало бы «проверять было нечего».
    expect(EXPRESSIVE.length).toBeGreaterThan(700)
  })

  for (const code of Object.keys(DICTS) as Code[]) {
    it(`${code}: ключ без перевода показывает английский текст`, async () => {
      await apply(code)
      const translated = new Set(DICTS[code].map((string) => string.key))
      const bad: string[] = []
      for (const key of EXPRESSIVE) {
        if (translated.has(key)) continue
        // Спрашивается СТРОКОВЫЙ режим (`format(key, true)`) — тот самый, которым
        // читает `t()`. Не `i18n(key).textContent`: у узла `<br>` даёт пустоту, а
        // строковый режим — перевод строки, и сверка ломалась бы на пяти
        // многострочных ключах экрана входа, ничего про слой не говоря.
        const got = I18n.format(key, true)
        if (got !== english.get(key)) bad.push(`${code} ${key}: «${got}» вместо «${english.get(key)}»`)
      }
      // Список режется: без нижнего слоя сюда попали бы сотни ключей, и
      // сообщение об ошибке стало бы нечитаемым.
      expect(bad.slice(0, 5)).toEqual([])
      expect(bad.length).toBe(0)
    })
  }
})

// Задача #102: пока английский был сам себе ключом, «строка осталась английской» и
// «перевода нет» были неразличимы. Теперь ключ символический — и совпадение перевода
// с английским источником означает, что переводить забыли.
//
// Совпадение НЕ ВСЕГДА недосмотр: у латиницы десятки слов законно пишутся так же
// («Album», «Navigation», «Discussion», «Spoiler», единицы «KB/MB/GB»). Поэтому список
// поимённый, а не «этот язык не проверяем»: снимок закрыт проверкой «исключения не
// протухли» — вписанный сюда переведённый ключ её краснит, и список не превращается
// в затычку. Новая непереведённая строка в любом из пяти языков теперь красит сборку.
const SAME_AS_ENGLISH: Record<Code, Partial<Record<LangPackKey, string>>> = {
  ru: {
    'Premium.Boarding.Title': 'название продукта — «Telegram Premium» не переводится',
    TelegramStars: 'название валюты — «Telegram Stars» не переводится',
    OK: 'интернационализм: в русском Telegram кнопка тоже «OK»',
    PaymentShippingEmailPlaceholder: '«Email» — заимствование, в русском Telegram так же',
    AttachGif: 'GIF — аббревиатура формата, не переводится',
    AppName: 'название продукта — «Telegram» не переводится (заголовок попапа без своего, tweb peer.ts:58)',
    'Calls.Status.Group': 'чистый шаблон «(N) время» без слов — tweb lang.ts:2020, в русском Telegram тот же',
  },
  uk: {
    'Premium.Boarding.Title': 'назва продукту — «Telegram Premium» не перекладається',
    PaymentShippingEmailPlaceholder: '«Email» — запозичення, в українському Telegram так само',
    AttachGif: 'GIF — абревіатура формату, не перекладається',
  },
  es: {
    'Premium.Boarding.Title': 'nombre del producto — «Telegram Premium» не переводится',
    AutoDownloadVideos: '«videos» — допустимое испанское написание (лат.-амер. норма)',
    ReportChatSpam: '«spam» — заимствование, в испанском Telegram так же',
    FilterChats: '«chats» — заимствование с испанским множественным',
    'SharedMedia.Audio': '«audio» — латинское слово, совпадает',
    'StorageQuota.CacheSizeLimitAuto': '«auto» — сокращение от «automático»',
    'Unit.Bytes': 'B — единица информации, не переводится',
    'Unit.Kilobytes': 'KB — единица информации, не переводится',
    'Unit.Megabytes': 'MB — единица информации, не переводится',
    'Unit.Gigabytes': 'GB — единица информации, не переводится',
    'KeyboardShortcuts.Action.Spoiler': '«spoiler» — заимствование',
    'KeyboardShortcuts.Section.Chat': '«chat» — заимствование',
    AttachGif: 'GIF — аббревиатура формата',
    AttachSticker: '«sticker» — заимствование, в испанском Telegram так же',
  },
  de: {
    Stories: '«Stories» — заимствование, в немецком Telegram так же',
    'KeyboardShortcuts.Section.Stories': '«Stories» — то же заимствование, что и у ключа Stories',
    Online: '«online» — заимствование',
    'Premium.Boarding.Title': 'название продукта — «Telegram Premium» не переводится',
    AutodownloadPrivateChats: '«Private Chats» — немецкое «privat» плюс заимствованное «Chats»',
    AutoDownloadVideos: '«Videos» — немецкое множественное от «Video»',
    ReportChatSpam: '«Spam» — заимствование',
    Info: '«Info» — немецкое сокращение от «Information»',
    SetUrlPlaceholder: '«Link» — немецкое слово',
    UserBio: '«Bio» — сокращение, совпадает',
    SharedLinksTab2: '«Links» — немецкое множественное от «Link»',
    FilterChats: '«Chats» — заимствование',
    'NewPoll.Option': '«Option» — немецкое слово',
    'Chat.Poll.Type.Quiz': '«Quiz» — немецкое слово',
    'SharedMedia.Audio': '«Audio» — совпадает',
    'EditProfile.FirstNameLabel': '«Name» — немецкое слово',
    'EditProfile.BioLabel': '«Bio (optional)» — оба слова немецкие',
    'Settings.Limits': '«Limits» — заимствование, немецкое множественное',
    'Privacy.Passkeys': '«Passkeys» — термин без немецкого эквивалента',
    'StorageQuota.CacheSizeLimitAuto': '«Auto» — сокращение от «automatisch»',
    'Unit.Bytes': 'B — единица информации, не переводится',
    'Unit.Kilobytes': 'KB — единица информации, не переводится',
    'Unit.Megabytes': 'MB — единица информации, не переводится',
    'Unit.Gigabytes': 'GB — единица информации, не переводится',
    'KeyboardShortcuts.Action.Monospace': '«Monospace» — типографский термин',
    'KeyboardShortcuts.Action.Spoiler': '«Spoiler» — немецкое слово',
    'KeyboardShortcuts.Section.Chat': '«Chat» — заимствование',
    'KeyboardShortcuts.Section.Navigation': '«Navigation» — немецкое слово',
    AttachAlbum: '«Album» — немецкое слово',
    AttachVideo: '«Video» — немецкое слово',
    AttachGif: 'GIF — аббревиатура формата',
    AttachSticker: '«Sticker» — немецкое слово',
  },
  fr: {
    Stories: '«Stories» — заимствование, во французском Telegram так же',
    'KeyboardShortcuts.Section.Messages': '«Messages» — французское слово',
    'KeyboardShortcuts.Section.Stories': '«Stories» — то же заимствование, что и у ключа Stories',
    'Premium.Boarding.Title': 'название продукта — «Telegram Premium» не переводится',
    Notifications: '«notifications» — французское слово',
    AutoDownloadPhotos: '«photos» — французское слово',
    'CallSettings.Microphone': '«microphone» — французское слово',
    'CallSettings.InputSection': '«microphone» — французское слово (имя секции, tweb speakersAndCamera.tsx)',
    Contacts: '«contacts» — французское слово',
    Message: '«message» — французское слово',
    ReportChatSpam: '«spam» — заимствование',
    ReportChatViolence: '«violence» — французское слово',
    UserBio: '«bio» — сокращение от «biographie»',
    'PeerInfo.Discussion': '«discussion» — французское слово',
    DescriptionPlaceholder: '«description» — французское слово',
    SearchMessages: '«messages» — французское слово',
    'NewPoll.Option': '«option» — французское слово',
    'Chat.Poll.Type.Quiz': '«quiz» — заимствование',
    AttachContact: '«contact» — французское слово',
    'SharedMedia.Audio': '«audio» — французское слово',
    PrivacyExceptions: '«exceptions» — французское слово',
    PrivacyMessages: '«messages» — французское слово',
    'StorageQuota.CacheSizeLimitAuto': '«auto» — сокращение от «automatique»',
    'KeyboardShortcuts.Action.Monospace': '«monospace» — типографский термин',
    'KeyboardShortcuts.Action.Spoiler': '«spoiler» — заимствование',
    'KeyboardShortcuts.Section.Navigation': '«navigation» — французское слово',
    AttachAlbum: '«album» — французское слово',
    AttachPhoto: '«photo» — французское слово',
    AttachGif: 'GIF — аббревиатура формата',
    AttachSticker: '«sticker» — заимствование',
  },
}

describe('непереведённый ключ виден как отсутствие перевода', () => {
  for (const code of Object.keys(DICTS) as Code[]) {
    it(`в ${code}-словаре нет ключей со значением, равным английскому источнику`, () => {
      const allowed = SAME_AS_ENGLISH[code]
      const suspicious = DICTS[code]
        .filter((string) => string._ === 'langPackString')
        .filter((string) => string.value === lang[string.key as LangPackKey])
        .map((string) => string.key)
        .filter((key) => !(key in allowed))
      expect(suspicious).toEqual([])
    })
  }

  it('исключения не протухли: каждое всё ещё совпадает с источником', () => {
    // Иначе список живёт своей жизнью и прикрывает ключи, которых давно нет.
    const stale: string[] = []
    for (const code of Object.keys(DICTS) as Code[]) {
      const byKey = new Map(DICTS[code].map((string) => [string.key, string]))
      for (const key of Object.keys(SAME_AS_ENGLISH[code])) {
        const string = byKey.get(key)
        if (string?._ !== 'langPackString' || string.value !== lang[key as LangPackKey]) {
          stale.push(`${code} ${key}: исключение больше не нужно`)
        }
      }
    }
    expect(stale).toEqual([])
  })
})

// ── ПОРЯДОК СЛОВ И КАВЫЧКИ ЗАДАЁТ СТРОКА ЯЗЫКА, А НЕ ВЁРСТКА ─────────────────────
//
// Ради этого ключи со склейкой и сводились: пока вызывающий приклеивал имя к префиксу
// («Also delete for» + имя), порядок слов был зашит в КОД и одинаков во всех языках.
// Немецкий ловит это лучше прочих — у него глагол уезжает в конец, то есть верный
// перевод НЕ МОЖЕТ быть префиксом; первая редакция этого перевода была именно
// префиксом («Auch löschen für %1$s»), и поймало её ревью, а не проверка. Теперь —
// проверка.
describe('порядок слов и кавычки живут в строке языка', () => {
  it('немецкий ставит глагол в конец: аргумент ВНУТРИ фразы, а не после неё', async () => {
    await apply('de')
    expect(text('DeleteMessagesOptionAlso', ['Maya'])).toBe('Auch für Maya löschen')
  })

  it('у каждого языка свои кавычки вокруг запроса', async () => {
    await apply('de')
    expect(text('Search.Empty', ['кабачок'])).toBe('Keine Ergebnisse für „кабачок“. Versuche eine neue Suche.')

    await apply('fr')
    // Французская типографика требует УЗКИХ НЕРАЗРЫВНЫХ пробелов внутри гильеметов
    // (U+202F) — обычный пробел здесь такая же ошибка, как его отсутствие.
    expect(text('Search.Empty', ['кабачок'])).toBe('Aucun résultat pour « кабачок ». Essayez une autre recherche.')

    await apply('ru')
    expect(text('Search.Empty', ['кабачок'])).toBe('Ничего не найдено по запросу «кабачок». Попробуйте другой запрос.')
  })
})
