# «Изменить номер»: экран без вёрстки, и эталона в tweb у него нет

**Статус:** открыт, нужно решение по судьбе экрана.
Найдено 2026-08-09 при выпиливании framer-motion (фаза 7, волна 4).
**К анимациям отношения не имеет** — всплыло попутно.

## 1. Экран сейчас без вёрстки

`web-client/src/components/settings/ChangePhone.tsx:12` импортирует
`../auth/AuthFlow.module.scss` и использует оттуда 15 классов. **14 из них в
модуле больше не существуют:**

```
accentBtn  accentBtnDisabled  changePhone  codeCell  codeCellFilled  codeRow
confirmChangePhone  countryLabel  countrySelect  countryWrap  fieldWrap
flag  flagSmall  phoneInput
```

Существует только `card`.

Сломалось в `ad99b56 style(auth): порт стилей экрана авторизации + выдержки
base.scss под него` — классы выпилили, когда `AuthFlow` перевели на глобальные
партиалы tweb. `ChangePhone` был единственным сторонним потребителем модуля,
и его не заметили.

## 2. В tweb смены номера нет вообще

Проверено:

```
grep -rn "changePhone|sendChangePhoneCode" по components/ lib/appManagers/ pages/  → 0
                       (совпадения есть только в layer.d.ts и scripts/out/schema.json —
                        автогенерённая схема MTProto, UI её не вызывает)
ls components/sidebarLeft/tabs/  → changeLoginEmail.tsx есть, вкладки под телефон нет
grep "phone" в settings.tsx / editProfile.tsx  → 0
```

То есть метод `account.changePhone` в протоколе описан, но Telegram Web K его не
использует: поменять там можно почту входа, не номер.

У нас же это сквозная намеренная фича: `SettingsView.tsx:122,197` →
`authManager.ts:395,408` → бэкенд `profile_handler.go:175,209` (+ usecase).
Не заблудившийся код.

## 3. Варианты (нужно решение)

**А. Удалить.** Держим планку «1:1 с tweb» — тогда это отсебятина, и заодно
уходит неиспользуемый код на бэке.

**Б. Оставить и одеть по ближайшему аналогу.** Эталон вёрстки в tweb всё-таки
есть — `components/sidebarLeft/tabs/changeLoginEmail.tsx` (69 строк):
`ChangeLoginEmailTab` → `ChangeLoginEmailCodeTab`, две вкладки слайдера
«ввести адрес → ввести код». Наш `ChangePhone` двухшаговый точно так же, так
что раскладку берём оттуда 1:1, подменив поле адреса на телефонное
(`components/auth/TelInput.tsx`, `CountryInput.tsx` уже есть).

Чего делать НЕ надо: подставлять недостающие классы обратно в
`AuthFlow.module.scss` — они выпилены осознанно, экран авторизации теперь на
глобальных партиалах.

## 4. Отдельно: закрыть саму дыру

Обращение к несуществующему ключу CSS-модуля отдаёт `undefined`, класс просто
не проставляется — **ни сборка, ни тайпчек этого не ловят**, экран молча
остаётся голым. Стоит либо генерировать `.d.ts` для `*.module.scss`, либо
завести lint-правило на несуществующие ключи. Иначе следующий такой обрыв
снова пройдёт незамеченным. Это стоит сделать независимо от судьбы
`ChangePhone`.
