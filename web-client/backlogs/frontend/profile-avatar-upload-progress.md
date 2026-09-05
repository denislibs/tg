# Прогресс загрузки своей аватарки — не портирован (нет `avatarUploads`-стора)

**Статус:** открыт, долг назван (не закрыт кодом).
**Дата фиксации:** волна 3 «Solid-миграция», программа `docs/superpowers/
plans/2026-09-05-profile-avatars-class.md`, задача 4 (контракт сворачивания
`PeerProfileAvatars`), ревью задачи 6 — 2026-09-05.
**Контекст:** `components/peerProfileAvatars.ts` — поля `uploadInProgress`,
`uploadPreloader`, методы `watchAvatarUpload`/`showUploadProgress`/
`hideUploadProgress` не заведены вовсе. `shouldIgnore` у `useCollapsable`
(докблок класса, «Сигналы») передаётся без значения — «у нас предмета нет».

## Что в tweb

`watchAvatarUpload()` (`peerProfileAvatars.ts:544-561`) следит за
Solid-стором `avatarUploads` (`@stores/avatarUpload`) — картой
`peerId → {promise}` активных загрузок своего аватара:

```ts
createEffect(() => {
  const entry = avatarUploads().get(this.peerId)
  if(entry) this.showUploadProgress(entry.promise)
  else this.hideUploadProgress()
})
```

`showUploadProgress` (:562-577): пока для ТЕКУЩЕГО пира идёт загрузка —
принудительно сворачивает шапку (`this.fold?.()`, шапка залочена и
недоступна для разворачивания, пока грузится), ставит класс
`is-avatar-uploading` на контейнер и вешает `ProgressivePreloader` (кольцо с
прогрессом, отменяемое) на `fakeAvatar.node` (аватар в фас, см. долг
`profile-avatar-stories-ring.md`) или на сам контейнер, если `fakeAvatar`
ещё не создан. `hideUploadProgress` (:579-583) снимает класс и прелоадер.
`shouldIgnore: () => this.uploadInProgress` у `useCollapsable` (:322-328) —
пока грузится, колесо/скролл не могут развернуть шапку поверх залоченного
состояния.

## Чего нет у нас

- Стора `avatarUploads` (карта «пир → активная загрузка своего аватара») не
  существует нигде в дереве — свой аватар грузится другим путём
  (`managers.profile.*`/`AddPhoto`), без промежуточного observable-стора,
  который мог бы дёрнуть UI карусели.
- `ProgressivePreloader` (`components/preloader.ts`) — портирован и уже
  используется в других местах (загрузка медиа в ленте), но сюда не
  подключён.
- `fold` внутрь класса не заведён вовсе (см. `collapsable-solid-owner.md`) —
  у него сегодня нет вызывающего, а единственный вызывающий в оригинале —
  именно `showUploadProgress`.

## Эффект сегодня

Пока идёт загрузка своей новой аватарки, шапка профиля не даёт пользователю
никакой обратной связи в самой карусели: нет кольца прогресса, нет
принудительного сворачивания/лока шапки на время загрузки. Если у загрузки
где-то в другом месте приложения есть свой индикатор — он не связан с этим
классом никак.

## Что делать

1. Завести стор `avatarUploads` (карта `peerId → {promise}`/прогресс) —
   первый писатель — тот путь, которым сегодня грузится свой аватар
   (найти вызывающего `AddPhoto`/аплоад медиа для своего профиля).
2. `components/peerProfileAvatars.ts` — портировать `watchAvatarUpload`/
   `showUploadProgress`/`hideUploadProgress` (tweb :544-583), подключить
   `ProgressivePreloader` (`components/preloader.ts`, уже есть в дереве).
3. Завести `fold` в конструктор класса (см. `collapsable-solid-owner.md`,
   п.2 «Что делать») — единственный вызывающий появится вместе с
   `showUploadProgress`.
4. Передать `shouldIgnore: () => instance.uploadInProgress` во внешний
   `useCollapsable()` (`UserInfoPanel.tsx`, задача 5 этого же плана) — до
   этого долга геттер там не заводился («у нас предмета нет», докблок
   класса).

**Критерий готовности:** во время загрузки новой аватарки шапка профиля
принудительно свёрнута и залочена (колесо/скролл её не разворачивают),
на аватаре — кольцо прогресса; тест на `peerProfileAvatars.test.ts`
заводит фейковый `avatarUploads`-стор с активной записью и проверяет класс
`is-avatar-uploading` + недоступность разворачивания.
