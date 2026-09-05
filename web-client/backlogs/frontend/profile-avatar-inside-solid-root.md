# Аватар-хост — сиблинг `.profile-content`, а не его ребёнок

**Статус:** открыт, объявленное отступление (не баг). Живёт до сведения
персистентности `PeerProfileAvatars` с пересозданием Solid-корня.
**Дата фиксации:** волна 3 «Solid-миграция», программа `docs/superpowers/
plans/2026-09-05-profile-card-solid.md`, задача 2 (каркас `peerProfile.solid.tsx`
и шов с панелью), ревью 2026-09-05.
**Контекст:** `components/UserInfoPanel.tsx:524-556` — узел `avatarsHostRef`
(хост класса `PeerProfileAvatars`) стоит РЯДОМ с `profileContentHostRef` (хост
Solid-корня `.profile-content`), оба — прямые дети `.sidebar-content`.

## Что в tweb

Дерево `PeerProfile` (`peerProfile.tsx:194-214`, разбор — `docs/tweb/
right-sidebar.md:236-246`):

```jsx
<div class="profile-content [has-music] [is-me]">
  <PeerProfile.AutoAvatar />            {/* карусель + имя + статус */}
  <div class="profile-content-delimiter" />
  <PeerProfile.UnofficialWarning />
  <PeerProfile.PersonalChannel />
  <PeerProfile.MainSection />
  ...
</div>
```

`AutoAvatar` (аналог нашего `PeerProfileAvatars`) — ПЕРВЫЙ ребёнок
`.profile-content`, один Solid-компонент, живущий и пересоздающийся в одном
ритме с остальным деревом карточки.

## Чего нет у нас

`avatarsHostRef` (шапка-аватары) и `profileContentHostRef` (грид секций) —
два независимых хоста-сиблинга в `UserInfoPanel.tsx`, а не родитель/ребёнок:

```tsx
<div ref={avatarsHostRef} />          {/* PeerProfileAvatars, useImperativeIsland */}
...
<div ref={profileContentHostRef} />   {/* Solid-корень .profile-content */}
```

Причина — конфликт двух решений, оба приняты РАНЬШЕ этой задачи и оба сами
по себе верны:

- `PeerProfileAvatars` (класс, порт `AvatarNew`+`AutoAvatar`) **переживает
  смену пира** — не пересоздаётся, инстанс живёт дольше одного `peerId`
  (см. докблок класса, раздел «Осознанное отступление», `peerProfileAvatars.ts`);
- Solid-корень `.profile-content`, наоборот, **пересоздаётся на каждый
  `peerId`** — это 1:1 с оригиналом (в tweb `<Show keyed>` тоже размонтирует
  и монтирует поддерево заново, см. докблок `peerProfile.solid.tsx`).

Если бы `avatarsHostRef` был ребёнком пересоздаваемого Solid-корня, каждая
смена пира отрывала бы живой инстанс `PeerProfileAvatars` от DOM (он не
пересоздан, а его хост — да). Задача 2 разрешила конфликт, вынеся хост
аватарок НАРУЖУ Solid-корня, сознательно разойдясь с порядком узлов
оригинала.

### Что это ломает (найдено ревью, не было очевидно на момент задачи 2)

`styles/tweb/_profile.scss` — правила вида `.has-music &`, **descendant-
селекторы**, требующие, чтобы `.has-music` был ПРЕДКОМ узла:

- строка 221: `.has-music & { bottom: 1.9375rem; }` внутри `&-info`
  (`.profile-avatars-info`);
- строка 830: `.has-music & { bottom: 2.1875rem; }` внутри
  `&-story-previews-container`;
- строка 968: `.has-music & { transform: translateY(0); }` внутри
  `&-story-previews`.

Класс `.has-music` вешается на `.profile-content` (когда `hasSavedMusic`
истинен). При нынешней вложенности `.profile-avatars-info` и
`.profile-avatars-story-previews(-container)` живут СНАРУЖИ
`.profile-content` — `.has-music &` не сработает НИКОГДА, даже когда
`.has-music` появится на дереве.

Сегодня это визуально безвредно и незаметно: `hasSavedMusic` у нас нечем
взвести (в модели профиля нет поля `saved_music`, см. докблок
`fullPeers.solid.ts`), поэтому `.has-music` не появляется на `.profile-content`
вообще. Находка ревью — не в том, что где-то виден баг, а в том, что правило
CSS уже сегодня НЕ МОЖЕТ сработать в принципе — и когда `saved_music` заведут,
эта поломка не проявится ошибкой, а просто молча не даст того эффекта (сдвиг
инфо-блока и превью историй, когда у пира играет привязанная музыка).

## Что делать

Свести к устройству оригинала (аватар-хост — ребёнок `.profile-content`)
можно только вместе со сведением персистентности:

1. Выбрать один из двух путей:
   - **а.** Перевести `PeerProfileAvatars` на ту же модель жизненного цикла,
     что у `.profile-content` — пересоздавать инстанс на каждый `peerId`
     (ближе к оригиналу, но требует пересмотреть «Осознанное отступление» в
     докблоке класса — там персистентность объявлена сознательным выбором ради
     чего-то конкретного; сначала перечитать причину и убедиться, что её больше
     нет или она перевешивается этим требованием);
   - **б.** Научить Solid-корень `.profile-content` НЕ пересоздаваться целиком
     на смену пира, а обновлять поддерево реактивно (сложнее: путь противоречит
     нынешнему `<Show keyed>`-подобному повторному монтированию, которое само
     1:1 с оригиналом).
2. После выбора — переставить `avatarsHostRef` внутрь Solid-корня ПЕРВЫМ
   ребёнком `.profile-content`, как в оригинале (`peerProfile.tsx:196`), убрав
   отдельный `useImperativeIsland(host: avatarsHostRef, ...)` снаружи узла.
3. Проверить, что `.has-music &`-правила (три строки выше) начинают
   применяться, когда `saved_music` будет заведён в модели (сам `saved_music`
   — отдельный долг, не входит в объём этой задачи).

**Критерий готовности:** аватар-хост — ребёнок `.profile-content`, порядок
узлов 1:1 с оригиналом (`AutoAvatar` → delimiter → остальные секции), и правила
`.has-music` из `_profile.scss:221,830,968` применяются к
`.profile-avatars-info`/`-story-previews(-container)`.
