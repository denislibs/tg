# DOM-diff харнес

Приёмка программы «фронт 1:1 с tweb»: сравнение DOM нашего стенда с **живым**
деревом tweb, а не на глаз. План — `docs/superpowers/plans/2026-08-08-tweb-structure-first.md`.

```
serialize.js        сериализатор (уезжает в страницу через evaluate)
parseDump.js        разбор текстовых дампов docs/research/tweb-dom/*.json
extract-expected.js генерация эталонов → expected/
diff.js             сравнение двух деревьев
run.js              CLI
config.json         ignoreClasses / attrKeys / tolerance
expected/           эталоны (генерируемые — руками не править)
snapshots/          снимки нашего стенда
baseline-bubbles.txt отчёт на старте фазы 2
```

## Процедура сверки

**1. Снять дерево нашего стенда.** Стенд — `https://localhost:38443` (проект
`msgrverify`), dev-вход по OTP `12345`. Получить выражение для `evaluate`:

```bash
node scripts/domdiff/run.js --snippet '.bubbles-inner'
```

Отдать его в `evaluate_script` (chrome-devtools MCP) с `filePath` в
`scripts/domdiff/snapshots/`. Пока лента не перестроена, селектор — наш
(`div[class*="_scroll_1vhji"]`); после фазы 2 это `.bubbles-inner`.

Нужны computed-свойства — добавить флаги:

```bash
node scripts/domdiff/run.js --snippet '.bubbles-inner' \
  --computed-for bubble,bubble-content --props border-radius,max-width,box-shadow
```

**2. Сдиффить.**

```bash
node scripts/domdiff/run.js --list                       # какие эталоны есть
node scripts/domdiff/run.js --actual snapshots/x.json --all              # сводка по всем типам
node scripts/domdiff/run.js --actual snapshots/x.json --all --detail photo-out-mid-21393
node scripts/domdiff/run.js --actual snapshots/one-bubble.json --key photo-out-mid-21393
```

`--all` для каждого эталона берёт из снимка бабл с наименьшим числом расхождений
(«какой тип узнан») — это метрика прогресса. Точная приёмка — `--key` по снимку
конкретного бабла.

**3. Читать findings.**

| kind | значение |
|---|---|
| `missing-class` | класс tweb, которого у нас нет на этом узле |
| `extra-class` | наш класс, которого нет в tweb (обычно хвост CSS-модуля) |
| `wrong-tag` | другой тег — в tweb теги значимы (`span.time`, `svg.bubble-tail`) |
| `missing-node` / `extra-node` | узла нет / узел лишний в этой позиции |
| `missing-attr` | нет ключевого атрибута (значения не сравниваются) |
| `computed` | разошлось вычисленное свойство сверх допуска |

Дети сопоставляются **по индексу**: порядок узлов в tweb значим (`:first-child`,
`+`, `~`, `order`), поэтому перестановка обязана быть расхождением. `missing-node`
вглубь не раскрывается — целое непортированное поддерево даёт одну строку, так что
абсолютное число findings меньше объёма работы.

## Эталоны

Все — из живого DOM tweb (`docs/research/tweb-dom/*.json`, снято 2026-08-08 с
работающего клиента):

| файл | что |
|---|---|
| `expected/bubbles.json` | 20 деревьев баблов ленты (фаза 2) |
| `expected/viewers.json` | отдельные поверхности: медиавьюер и сториз-вьюер (фаза 5), композер, эмодзи-дропдаун и attach-меню (фаза 6), экран авторизации — 9 деревьев (`13-auth-*.json`) |
| `expected/computed.json` | блоки замеров (`--computed`) |
| `expected/anims.json` | списки бегущих анимаций (сверяются глазами по отчёту) |

Перегенерация:

```bash
node scripts/domdiff/extract-expected.js
```

Править эталоны руками нельзя: они производные. Нужен новый тип бабла — досняли
дамп в `docs/research/tweb-dom/`, добавили файл в `BUBBLE_SOURCES`; новая
полноэкранная поверхность — в `VIEWER_SOURCES` (`extract-expected.js`).

### Отдельные поверхности

`--list` печатает для каждой её селектор и режим; снять снимок —
`--snippet-for <ключ>` (подставит нужный селектор), сверить — `--key <ключ>`.

```bash
node scripts/domdiff/run.js --snippet-for media-viewer-whole-full-depth-12
node scripts/domdiff/run.js --actual snapshots/09-media-viewer-photo.json --key media-viewer-whole-full-depth-12
node scripts/domdiff/run.js --actual snapshots/09-media-viewer-computed.json --computed '09-media-viewer.json:computed'
```

Режимы:

- **`classes`** (медиавьюер) — обычная сверка: имена классов в tweb написаны руками
  и обязаны совпадать.
- **`structure`** (сториз-вьюер) — в tweb это solid-js + CSS-модули
  (`_Viewer_hvblb_1`), дословный перенос имён невозможен. Differ гасит модульные
  хеши **с обеих сторон** (`config.moduleClasses`) и сверяет теги, порядок,
  вложенность, немодульные классы (`night`, `peer-title`, `avatar-32`, `btn-icon`)
  и computed.

Эталон сториз начинается с `._Viewer…`: маунт `#stories-viewer` (он есть и у tweb,
и у нас) и обёртка solid-js Portal в дерево не входят — у React-портала обёртки нет.

### Экран авторизации (`13-auth-*.json`)

Снято живьём 2026-08-09 с работающего tweb в **изолированном** браузерном контексте
`tweb-auth-recon` (чистые cookies/IndexedDB → приложение стартует с экрана входа).
Справочник — [`docs/research/2026-08-09-tweb-auth-dom-reference.md`](../../../docs/research/2026-08-09-tweb-auth-dom-reference.md).

| ключ | что |
|---|---|
| `auth-signqr-card` | вход по QR-коду (стартовая карточка на десктопе) |
| `auth-signin-card-country-list-collapsed` | ввод номера; поддерево `.select-wrapper` срезано (у tweb внутри 236 `li` от сервера — построчная сверка бессмысленна) |
| `auth-country-dropdown-select-wrapper` | каркас выпадающего списка стран (открыт) |
| `auth-country-dropdown-li` | одна строка списка стран |
| `auth-authcode-card-empty` / `auth-authcode-card-3-of-5-digits` | ввод кода: пустое поле и 3 цифры из 5 |
| `auth-password-card` | облачный пароль (2FA) |
| `auth-signup-card` | регистрация |
| `auth-emailrecover-card` | восстановление по e-mail |
| `auth-signimport-card` | импорт сессии (прелоадер) |

Все — `mode: 'structure'`: auth-флоу в tweb **целиком на CSS-модулях**
(`pages/authFlow.module.scss`, `components/mediaHeader.module.scss`,
`components/codeInputField.module.scss`), хеши вида `_card_1b0yp_73` дословно не
переносимы. Сверяются теги, порядок, вложенность, computed и **глобальные** классы
tweb, которых в auth-флоу немало и которые мы обязаны воспроизвести дословно:
`whole`, `btn-icon`, `rp`, `c-ripple`, `tgico`, `button-icon`, `scrollable`,
`scrollable-y`, `no-scrollbar`, `input-wrapper`, `input-field`, `input-select`,
`input-field-input`, `input-field-border`, `input-field-phone`,
`input-field-password`, `select-wrapper`, `z-depth-3`, `hide`/`active`,
`arrow`/`arrow-down`, `phone-code`, `emoji`/`emoji-native`, `btn-primary`,
`btn-color-primary`, `btn-secondary`, `btn-primary-transparent`, `primary`,
`i18n`, `inline-icon`, `text-center`, `text-overflow-wrap`, `secondary`,
`stealthy`, `toggle-visible`, `is-empty`, `media-sticker-wrapper`, `lottie`,
`preloader`, `preloader-circular`, `preloader-path`, `avatar-edit`,
`avatar-edit-canvas`, `avatar-edit-icon`, `bluff-spoiler`, `bluff-spoiler-letter`.

Корень всех «карточных» эталонов — `#auth-pages` (маунт `<AuthCardsHost>`; тот же
id нужен и у нас). Для секций со своим корнем в источнике объявлено поле
`selectors` — карта `слаг секции → селектор снимка`; без неё берётся общий
`selector` источника.

## config.json

- **`ignoreClasses`** — классы, которые differ не считает расхождением. Держим
  список коротким: только то, чему в tweb нет и не будет аналога, каждый пункт —
  с обоснованием ниже. Строка вида `/^_re_/` трактуется как регулярка.
  Сейчас список **пуст**: хвосты CSS-модулей (`_row_1bz90_1`) намеренно
  показываются как `extra-class` — это и есть индикатор непортированной поверхности.
- **`moduleClasses`** — регулярка под хеш CSS-модуля (`_Viewer_hvblb_1`). Гасится
  **только** у эталонов с `mode: "structure"` (сториз-вьюер), где такие имена и в
  tweb, и у нас; на баблы и медиавьюер не влияет.
- **`attrKeys`** — атрибуты, наличие которых сверяем (`data-mid`, `data-peer-id`).
  Значения не сравниваем: id сообщений у нас и в tweb разные по определению.
- **`tolerance`** — допуск в px для computed-свойств (сабпиксельная раскладка).

## Тесты

`domdiff.test.js` гоняется общим `npm test` (в `vitest.config.ts` добавлен паттерн
`scripts/**/*.test.js`). Кроме парсера и differ-а он фиксирует инвариант живого
tweb: у **всех** типов баблов каркас `.bubble > .bubble-content-wrapper >
.bubble-content` — это и есть основание P0 №2 (reply/имя/forward одинаково
вставляются в любой тип).
