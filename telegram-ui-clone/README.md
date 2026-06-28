# Telegram Web — UI Remake

Пиксель-в-пиксель ремейк интерфейса [Telegram Web (K)](https://web.telegram.org/k/) на React.
Стили и размеры элементов сняты с живой сессии Telegram Web, поддерживаются тёмная и светлая темы.

**🔗 Live demo: https://denislibs.github.io/telegram-remake/**

## Стек

- **Vite 6** + **React 18** + **TypeScript** (strict)
- **MUI v6** (`@mui/material`, `@mui/icons-material`) — стилизация через `sx`
- **framer-motion 11** — анимации (переходы, layout-анимации, жесты)
- **@fontsource/roboto** — шрифт Roboto

## Возможности

- Плавающий скруглённый сайдбар со списком чатов, поиском и анимированными табами
- Чат с ограниченной шириной по центру, скролл на `body` (липкие шапка/футер)
- Личные чаты, группы и каналы: стикеры, статусы прочтения, ответы (reply), реакции
- Композер 1:1 с оригиналом (враппер 48px, кнопка отправки 48×40 r20, reply внутри контейнера)
- Поиск внутри чата, контекстные меню по типу чата, меню «⋮» в шапке
- Лента постов канала (`kyzdar.ai`) с фото-плейсхолдерами, реакциями и просмотрами
- Frosted-blur меню (гамбургер / compose / контекстные)
- Экран настроек/профиля, переключение темы с сохранением в `localStorage` (по умолчанию — системная)
- Флоу создания группы / канала / личного чата, экран редактирования

## Запуск

```bash
npm install
npm run dev      # дев-сервер (по умолчанию http://localhost:5173)
```

Прод-сборка:

```bash
npm run build    # tsc -b + vite build → dist/
npm run preview  # локальный предпросмотр сборки
```

## Структура

```
src/
  App.tsx              — корневой Shell, layout, тема, состояние списка чатов
  theme.ts             — токены темы (tg.*), buildTheme(mode), паттерн-фон
  data.ts              — мок-данные чатов и лента постов канала
  index.css            — базовые стили (body-scroll layout)
  components/          — Sidebar, ChatView, ConversationView, ChannelPost,
                         UserInfoPanel, SearchView, меню, флоу и пр.
```

> Все данные — моковые, в проекте нет бэкенда и реальных сетевых запросов.
