# Fallback-фото своего профиля («публичное» фото) — не портировано

**Статус:** открыт, долг назван (не закрыт кодом). Предмета (Telegram
`fallback_photo`) в нашей модели нет вовсе.
**Дата фиксации:** волна 3 «Solid-миграция», программа `docs/superpowers/
plans/2026-09-05-profile-avatars-class.md`, задача 2 (данные и лента
`PeerProfileAvatars`), ревью задачи 6 — 2026-09-05.
**Контекст:** `components/peerProfileAvatars.ts::setPeer` — ветка
`isUser(peerId)`, сборка `ListLoader`. Полей `fallbackPhotoId`/
`fallbackAppended` у класса нет вовсе.

## Что в tweb

Telegram позволяет владельцу приватного профиля выбрать «публичное» фото
(`fallback_photo`) — то, что видят люди, у которых сам пользователь скрыл
реальный аватар настройками приватности. `setPeer` (`peerProfileAvatars.ts
:422-431`) резолвит его ТОЛЬКО для своего профиля (`peerId ===
rootScope.myId`) и только когда у пира вообще есть фото (`!this.hasNoPhoto`):

```ts
if(peerId === rootScope.myId && peerId.isUser() && !this.hasNoPhoto) {
  const userFull = await this.managers.appProfileManager.getProfile(peerId.toUserId())
  const fallback = (userFull as UserFull.userFull)?.fallback_photo as Photo.photo
  if(fallback?._ === 'photo') this.fallbackPhotoId = fallback.id
}
```

Дальше `loadMore` (`:443-451`) добавляет этот id ОДНИМ ЛИШНИМ элементом в
конец списка, ровно один раз, на последней (короткой) странице пагинации:
`items.push(this.fallbackPhotoId)`, `count += 1`. Визуально это даёт
дополнительную «последнюю» карточку в конце карусели СВОЕГО профиля —
то самое публичное фото, каким его видят люди со скрытой приватностью.

## Чего нет у нас

- Понятия `fallback_photo` нет ни в модели пользователя (`core/models.ts`),
  ни на проводе (`GET /me`/`GET /users/{id}` его не отдают) — фичи
  «публичное фото при скрытой приватности» на бэкенде не существует вовсе.
- `appProfileManager.getProfile` (полный профиль с приватными полями) —
  аналог у нас `managers.privacy.profile`/`useUserProfile`, но и туда
  `fallback_photo` дойти не может: поля нет на проводе.

## Эффект сегодня

Лента карусели СВОЕГО профиля никогда не получает дополнительный последний
элемент — все N элементов это N реальных фото из галереи, без лишнего
«публичного» фото в конце. Для чужих профилей расхождения нет: ветка и в
оригинале выполняется только для `rootScope.myId`.

## Что делать

1. Завести `fallback_photo` на бэкенде — поле у пользователя (какое фото
   показывать людям со скрытой приватностью аватара) + ручка/поле в ответе
   `GET /me` (или отдельная `PATCH /me/fallback-photo`, аналог Telegram
   `photos.updateProfilePhoto` с флагом `fallback`).
2. `core/managers/profileManager.ts` — прокинуть поле в модель профиля.
3. `components/peerProfileAvatars.ts::setPeer` — портировать резолв
   `fallbackPhotoId`/`fallbackAppended` (tweb :422-431) и добавление в
   `loadMore` (:443-451), гейт «только свой профиль, только если есть фото»
   — дословно.

**Критерий готовности:** свой профиль с настроенным публичным фото и
скрытой приватностью реального аватара показывает лишний элемент в конце
карусели; тест на `peerProfileAvatars.test.ts` заводит фейковый
`fallback_photo` для `myId` и проверяет, что число узлов карусели на 1
больше числа элементов `listPhotos`, и что для чужого `peerId` фолбэк не
добавляется никогда.
