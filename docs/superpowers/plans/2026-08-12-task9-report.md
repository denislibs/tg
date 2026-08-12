# Task 9 — фронт: канвас-блюр stripped-превью (стадия D): отчёт

Ветка: `feat/tweb-media-core`. Коммиты: `fd1bb309` (blur-порт + баблы),
второй — avatar_preview (см. `git log`). Референсы tweb: `src/helpers/blur.ts`,
`src/vendor/fastBlur.js`, `src/environment/canvasFilterSupport.ts`,
`src/helpers/getImageFromStrippedThumb.ts`, `src/components/wrappers/photo.ts`,
`src/components/avatarNew.tsx:574-604,1003`, `base.scss:1244-1248`,
`partials/_chatBubble.scss:694-700`.

## 1. `helpers/blur.ts` — порт

1:1 с tweb: `RADIUS = 2`, `ITERATIONS = 2`, канвас класса `canvas-thumbnail`,
кэш `Map` на 150 записей со сбросом ЦЕЛИКОМ (`cache.clear()` при `size > 150`),
нативный `ctx.filter = blur(2px)` с overdraw на `radius*2` (tweb blur.ts:42),
опция `maxSize` (форк-фича даунскейла перед блюром — понадобится вьюверу)
сохранена. Повторный вызов того же dataUri отдаёт НОВЫЙ канвас (их монтируют в
разные места), синхронно копируя размеры и асинхронно — пиксели из кэшированного.

Адаптации (обе прокомментированы в файле):
- **Фолбэк без canvas-filter** тянет вендорный fastBlur — портирован дословно в
  `src/vendor/fastBlur.ts` (`@ts-nocheck`, как прочие вендоренные островки;
  исключён из oxlint узким паттерном в `.oxlintrc.json` по образцу
  `emojiData.ts`/`dict.ts` — style-шум verbatim-вендора, 83 диагностики).
  `src/environment/canvasFilterSupport.ts` — флаг tweb 1:1.
- **`addHeavyTask` → микро-очередь**: полный tweb `helpers/heavyQueue.ts` не
  портирован (из его потребителей у нас есть только blur), наш
  `core/dom/heavyAnimation` очереди не даёт — только промис «экран успокоился».
  Микро-очередь сохраняет существенные свойства: задача ждёт
  `getHeavyAnimationPromise()`, исполняется в `fastRaf`-кадре по одной, новая
  встаёт в голову (`unshift`, как blur в tweb).
- Строгий tsconfig: `ctx!` (в tweb strict выключен), `const fromCache = cached`
  для замыкания. Форматирование — домовое (без `;`), по прецеденту портов
  Task 4/5 (`components/preloader.ts`, `core/files/cacheStorage.ts`).

## 2. Баблы: канвас вместо background-image

Было (аудит): `RealMediaBubble` и `AlbumGrid` рисовали LQIP строкой
`backgroundImage: url("data:image/jpeg;base64,…")` на контейнере — CSS-блюра не
было вовсе (единственный `backdrop-filter: blur(12px)` — оверлей paid-медиа, он
не про LQIP и оставлен).

Стало (модель tweb `wrapPhoto`): канвас из `blur()` с классами
`media-photo thumbnail canvas-thumbnail` (photo.ts:150,199-201 +
getImageFromStrippedThumb.ts:24) вставляется prepend'ом в контейнер медиа —
превью оказывается ПОД полным медиа и остаётся под ним (в tweb thumbnail не
снимается — картинка проявляется поверх). React-клей —
`components/messages/useBlurThumb.ts` (канвас — vanilla-узел во владении
blur(), как в tweb; React чужой узел не трогает). При синхронно известном URL
(зеркало конвейера Task 7 / localUrl) превью не монтируется — аналог tweb
`cacheContext.downloaded` (getStrippedThumbIfNeeded.ts:23). Paid-медиа
монтирует превью всегда (кроме blur у него ничего нет).

- `AlbumGrid`: элемент вынесен в компонент `AlbumItem` (хук на элемент),
  `AlbumItemMedia` влит в него; мёртвый класс `s.item`
  (background-size/position) удалён.
- `MessageContent` отдельного LQIP не имеет — передаёт `blur` в
  `RealMediaBubble` (проверено grep'ом: других `base64`-LQIP в components нет).
- Стили: `.thumbnail`/`.canvas-thumbnail` бабла уже были в
  `_chatBubble.scss:694-700`; глобальное правило `.canvas-thumbnail`
  (absolute, 100%×100%) из **base.scss:1244-1248** отсутствовало — добавлено в
  `styles/tweb/_bridge.scss` (дом выдержек base.scss).

## 3. Аватарки: `avatar_preview` КАК ЕСТЬ (без блюра)

1:1 tweb `avatarNew.tsx:574-590`: слой-превью — обычный `<img
class="avatar-photo avatar-photo-thumbnail" src="data:image/jpeg;base64,…">`
ПОД полной картинкой; корень несёт `avatar-relative`, пока слой виден
(avatarNew.tsx:1003 → `_avatar.scss:439-445` стакает слои). Снимается по
фазовому механизму Avatar.tsx: после `onLoad` полной + `FADE_IN_DURATION`
(в tweb `setThumb()` живёт в том же setTimeout, что снимает fade-in,
avatarNew.tsx:598-604); кэшированная полная превью не показывает
(avatarNew.tsx:584), ошибка полной — превью остаётся.

Прокладка поля (норма владения соблюдена — поле едет существующими каналами,
второго пути нет):
- **peersManager** (`Peer.avatarPreview`): маппинг `/users`, сравнение `same()`
  (иначе смена превью не публиковалась бы `rt:peer_op`), офлайн-подъём
  нормализует старые записи; `peersStore.upsert` — то же сравнение;
  `persist.PersistUser.avatarPreview?` (записи до Task 9 поля не имеют).
- **authManager** `User.avatarPreview` (`mapUser` ← `/me` и др.); `loadMe`
  нормализует старый персист.
- **models.ts**: строка диалога `/chats` — `photo_preview` (группы/каналы,
  media.blur_preview джойном) и `peer.avatar_preview` → `Dialog.photoPreview` /
  `Dialog.peer.avatarPreview`; **dialogToChat** → `Chat.avatarPreview` тем же
  правилом, что `avatarUrl` (peer || photo).
- **contactsManager** `Contact.avatarPreview` (`/contacts`),
  **privacyManager** `UserProfile.avatarPreview` (`/users/{id}`, гасится
  privacy вместе с URL — гасит бэк, Task 8).
- **Avatar.tsx** — проп `preview`; проведён в 15 вызовов с моделью, несущей
  поле: ChatListItem (осн.+мини), ChatHeader, SettingsView, EditProfile,
  SearchView, NewPrivateChat, Edit/AddContactView, MentionsHelper,
  useChatPopups, FolderEditor/FolderChatsPicker, ChatDialogs (share/recent).
  `useAvatarSrc` не менялся: превью — data-URI, резолв конвейером не нужен.

Непроведённые вызовы Avatar (поля в их моделях нет — бэк не отдаёт превью на
этих поверхностях, см. отчёт Task 8 «непроложенные второстепенные»):
CallsView/CallScreen (callStore), MainMenu (реестр аккаунтов), TopbarSearch
(выдача поиска по чату), ContactsView (вообще без фото — существующий гэп).

## 4. Тесты

Новые: `helpers/blur.test.ts` (2), `components/messages/
RealMediaBubble.blur.test.tsx` (3), `shared/ui/Avatar/Avatar.test.tsx` (+4).
happy-dom канвас не умеет — `getContext` замокан стабом со счётчиком
drawImage-вызовов, `Image` — фейком (onload по установке src),
`@environment/canvasFilterSupport` замокан в true (в happy-dom вычислился бы
в false → фолбэк-путь).

- blur: повторный вызов того же URL не рисует заново (1 отрисовка исходника,
  копия из кэшированного канваса); кэш жив на ровно 150 записях и сбрасывается
  целиком на 151-й (граница `> CACHE_SIZE`).
- бабл: canvas `.media-photo.thumbnail.canvas-thumbnail` первым ребёнком
  контейнера до прихода URL; при синхронном URL — канваса нет; paid — всегда.
- аватар: слой `avatar-photo-thumbnail` (raw img, без фильтра/канваса) +
  `avatar-relative` на корне; после onLoad полной + 200мс — снят; при onError —
  остаётся; без preview не рендерится.

Обновлены фикстуры существующих тестов под новые обязательные поля
(`avatarPreview` в Peer/User): peersManager(.persist).test,
storeProjection.(me|peers).test, workerCore.test, useAuthGate.test,
usePeers.request.test, profileManager.test; маппинг-тест `/users` теперь
доказывает и `avatar_preview → avatarPreview`.

**Мутации (красный прогон — реальный вывод vitest):**

1. `blur.ts`: `cache.set(dataUri, cached = {…})` → `cached = {…}` (кэш не
   наполняется):
   ```
   FAIL  src/helpers/blur.test.ts > helpers/blur — порт tweb blur.ts > кэш живёт до 150 записей включительно, на 151-й сбрасывается целиком
   AssertionError: expected 300 to be 40 // Object.is equality
    ❯ src/helpers/blur.test.ts:91:36
   Test Files  1 failed (1)   Tests  2 failed (2)
   ```
   (второй тест падал там же — копия из кэша не находилась)
2. `Avatar.tsx`: `thumbVisible = !!preview && phase !== 'shown'` → `!!preview`
   (превью не снимается):
   ```
   FAIL  src/shared/ui/Avatar/Avatar.test.tsx > Avatar: слой avatar_preview (stripped-превью) > после onLoad полной картинки превью снимается фазовым механизмом (вместе с fade-in, через 200мс)
   AssertionError: expected <img …(3)></img> to be null
    ❯ src/shared/ui/Avatar/Avatar.test.tsx:158:24
   Test Files  1 failed (1)   Tests  1 failed | 10 passed (11)
   ```
   Обе мутации откачены, прогон снова зелёный.

## 5. Проверка

- `npx vitest run`: **223 файла, 1520 passed / 2 skipped** — зелёный.
- `npm run typecheck` (tsc --noEmit, TS7 native) — чисто.
- oxlint: диагностик **ровно как на базовом коммите** (замер diff'ом полного
  вывода до/после: +0; единственные два новых — semi в canvasFilterSupport —
  устранены). Абсолютное число по нашему замеру 2593 (базлайн-число 2673 из
  постановки получено, видимо, другим способом подсчёта; важна дельта = 0).
- `npx vite build --outDir /tmp/media-task9-build` — успешно (предупреждения о
  размере чанков — довоенные).

## 6. Замечания

- Вьювер (стадия E) получит блюр из того же `helpers/blur.ts` (с `maxSize`) —
  задел готов, Task 10+ ничего перепортировать не нужно.
- Канвас в бабле — vanilla-узел вне дерева React (prepend в контейнер);
  это осознанный перенос владения tweb (blur() владеет канвасом), риск
  реконсиляции нулевой: React чужие узлы не трогает, cleanup удаляет канвас.
- `avatar-relative` уходит с корня вместе со снятием слоя (реактивно, как в
  tweb `innerClassList`), а не остаётся навсегда.
- Превью «моих» аватарок в реестре аккаунтов (MainMenu) и в callStore не
  проложено — поля нет в их DTO (бэк, Task 8: «непроложенные второстепенные
  поверхности»); добавится тем же приёмом при надобности.
