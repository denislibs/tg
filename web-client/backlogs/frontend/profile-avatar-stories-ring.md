# Кольца историй на аватаре шапки — не портированы (нет `fakeAvatar`/`StoriesSegments`)

**Статус:** открыт, долг назван (не закрыт кодом). Предмета (подсистема
историй профиля пира) частично уже нет, частично отсутствует конкретный узел.
**Дата фиксации:** волна 3 «Solid-миграция», программа `docs/superpowers/
plans/2026-09-05-profile-avatars-class.md`, задача 1/3 (каркас и жесты
`PeerProfileAvatars`), ревью задачи 6 — 2026-09-05.
**Контекст:** `components/peerProfileAvatars.ts` не заводит узел
`.profile-avatars-avatar-fake` вовсе — первый элемент карусели (текущий
аватар пира) рисуется ВНУТРИ `this.avatars` (лента), `isFirst`-веткой
`processItem` (задача 2), а не отдельным оверлей-узлом ПЕРЕД лентой, как в
оригинале. Комментарий у rAF-цикла прогресса (`processItem`/
`updateActiveTabProgress`, докблок метода) уже называет эту разницу явно.

## Что в tweb

Помимо ленты исторических фото (`this.avatars`), `setPeer` (`:396-420`)
заводит ОТДЕЛЬНЫЙ узел `fakeAvatar` — «зеркало» текущего аватара пира,
вставленное ПЕРЕД лентой (`this.avatars.before(this.fakeAvatar.node)`):

```ts
this.fakeAvatar = avatarNew({
  peerId, isBig: true, size: 120, withStories: true,
  onStoriesStatus: (has) => this.container.classList.toggle('has-stories', has),
  storyColors: {read: 'rgba(255, 255, 255, .3)'}
})
this.fakeAvatar.node.classList.add('profile-avatars-avatar-fake')
```

`withStories: true` заводит `StoriesSegments` (`components/avatarNew.tsx:280
-399`, вызывается изнутри `avatarNew` при `withStories`) — цветные
сегменты-кольца вокруг аватара (по одному на историю, непросмотренные ярче)
поверх самого фото; `onStoriesStatus` включает класс `has-stories` на
контейнере, когда у пира есть активные истории. Класс `has-stories`, в свою
очередь, даёт клику по аватару (не по краям-третям) открыть просмотрщик
историй вместо смены слайда карусели (`peerProfileAvatars.ts:175-177`:
`simulateClickEvent(this.fakeAvatar.node)`).

## Чего нет у нас

- Отдельного узла `fakeAvatar` нет вовсе — наш порт СОЗНАТЕЛЬНО (докблок
  `processItem`/rAF-метода) свёл «текущий аватар мирроr» в `isFirst`-ветку
  ленты, а не завёл второй узел: у нас нет ни историй, ни лока сворачивания
  под загрузку (`profile-avatar-upload-progress.md`), ради которых в
  оригинале `fakeAvatar` и нужен как отдельная точка крепления прелоадера/
  колец.
- `StoriesSegments`/`withStories` в `components/avatar.ts` не существует —
  наш `avatarNew` не умеет рисовать кольца сегментов историй ни в одном
  месте приложения (не только здесь).
- Класса `has-stories` нигде в дереве нет — значит и клик-в-центр всегда
  открывает `openMediaViewer` (задача 3), никогда не «историю пира».

## Эффект сегодня

Профиль пира с активными историями в Telegram показывал бы разноцветное
кольцо вокруг аватара шапки и открывал бы просмотрщик историй по клику на
сам аватар. У нас — обычный квадратный/круглый кадр без колец, клик всегда
ведёт в медиавьювер фотографий профиля. Подсистема историй частично
существует В ДРУГОМ месте (`PinnedStoriesSection.tsx` — закреплённые в
профиле истории списком, `useStoryViewer.ts`) — эта карусель с ней никак не
связана.

## Что делать

1. Расширить `components/avatar.ts` (`AvatarOptions`) полем `withStories` +
   портировать `StoriesSegments` (`avatarNew.tsx:280-399`) — сегменты по
   данным `appStoriesManager.getPeerStoriesSegments`/аналогу на нашем
   бэкенде.
2. Завести `has-stories`/`onStoriesStatus` в `avatar.ts` — колбэк наружу о
   наличии активных историй у пира.
3. `components/peerProfileAvatars.ts::setPeer` — вернуть отдельный узел
   `fakeAvatar` (`.profile-avatars-avatar-fake`), вставленный `before`
   лентой (tweb :396-420); клик по нему при `has-stories` — открытие
   просмотрщика историй (`useStoryViewer`/аналог `simulateClickEvent`, tweb
   :175-177) вместо перелистывания.
4. Свести с `profile-avatar-upload-progress.md`: `showUploadProgress`
   вешает прелоадер именно на `fakeAvatar.node` — до этого долга
   восстанавливать узел ради одного только него не требовалось, теперь оба
   долга закрываются вместе.

**Критерий готовности:** профиль пира с активными историями показывает
цветные кольца-сегменты вокруг аватара в шапке, клик по аватару (не по
третям-стрелкам) открывает просмотрщик историй; тест на
`peerProfileAvatars.test.ts` проверяет и класс `has-stories` на фейковых
данных историй, и то, что клик в центр в этом состоянии зовёт открытие
историй, а не `openMediaViewer`.
