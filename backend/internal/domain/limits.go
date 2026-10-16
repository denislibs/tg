package domain

import "time"

// Лимиты, которые сервер ПРИМЕНЯЕТ и которые клиент читает из конфига
// приложения (`help.getAppConfig` / `help.getConfig`, ручки
// `adapter/delivery/http/help_handler.go`). Одно место на оба конца: правило
// сервера и число в конфиге не могут разойтись, потому что это одна константа.
//
// Единицы длины текста: сервер считает РУНЫ (`MaxMessageRunes`), клиент сравнивает
// `config.message_length_max` с длиной JS-строки (UTF-16). Для символов вне BMP клиент
// строже сервера — так и задумано, число одно.
//
// Ключ конфига и адрес в tweb 812502980 — у каждой константы. Единицы в конфиге
// переводит ручка, здесь — типы Go (`time.Duration` там, где число задаёт время).
const (
	// EditTimeLimit — сколько своё сообщение правится в личке; `config.edit_time_limit`
	// (секунды), `appMessagesManager.ts:8382-8386`. В группе и канале срока нет.
	EditTimeLimit = 48 * time.Hour

	// MaxMessageRunes — длина текста сообщения и подписи в рунах;
	// `config.message_length_max` и `config.caption_length_max`.
	MaxMessageRunes = 4096

	// MaxPinnedDialogs — закреплённых диалогов в основном списке;
	// `dialogs_pinned_limit_default` / `_premium` (`apiManagerMethods.ts:372`, ключ `pin`).
	MaxPinnedDialogs = 5

	// FavedStickersLimit — избранные стикеры; `stickers_faved_limit_default` / `_premium`.
	FavedStickersLimit = 10

	// RecentStickersLimit — недавние стикеры; `config.stickers_recent_limit`.
	RecentStickersLimit = 20

	// SavedGifsLimit — сохранённые GIF; `saved_gifs_limit_default` / `_premium`.
	SavedGifsLimit = 200

	// MaxFoldersPerUser — число папок; `dialog_filters_limit_default` / `_premium`.
	MaxFoldersPerUser = 10

	// MaxPasskeys — ключей входа на аккаунт; `passkeys_account_passkeys_max`
	// (`sidebarLeft/tabs/passkeys.tsx:116`).
	MaxPasskeys = 10

	// StealthPastPeriod / StealthFuturePeriod — окна режима «невидимка» для историй;
	// `stories_stealth_past_period` / `_future_period`, секунды
	// (`popups/storiesStealthMode.tsx:58`, `:65`).
	StealthPastPeriod   = 5 * time.Minute
	StealthFuturePeriod = 25 * time.Minute

	// ReactionsUserMaxDefault / ReactionsUserMaxPremium — сколько реакций ставит
	// один пользователь на одно сообщение; `reactions_user_max_default` / `_premium`
	// (`apiManagerMethods.ts:375`). Те же числа лежат литералами в миграции
	// 0130_reactions_user_limit.sql — она описывает однажды применённую чистку
	// и меняться не должна.
	ReactionsUserMaxDefault = 1
	ReactionsUserMaxPremium = 3

	// ChatReadMarkSizeThreshold / ChatReadMarkExpirePeriod — «кто прочитал»:
	// чат не больше порога участников и сообщение не старше срока;
	// `chat_read_mark_size_threshold` и `chat_read_mark_expire_period` (секунды),
	// `appMessagesManager.ts:12334-12339`.
	ChatReadMarkSizeThreshold = 100
	ChatReadMarkExpirePeriod  = 7 * 24 * time.Hour

	// GroupCallMaxParticipants — участников видеочата группы (mesh, К3);
	// `groupcall_video_participants_max` (`appConfig.d.ts:9`). У Telegram это
	// предел участников С ВИДЕО в звонке через SFU; у нас каждый участник mesh —
	// отправитель видео каждому, поэтому предел на всех.
	//
	// Число — из квоты coturn (`coturn/turnserver.conf`): `user-quota=32`
	// аллокации на пользователя, pc держит A = 2 TURN-URL (udp, tcp) × сетевые
	// интерфейсы = 4 аллокации (замер на стенде, М3-2). Участник держит N−1 pc, а
	// аллокации упавшей вкладки живут ещё 600 с (libwebrtc не шлёт LIFETIME), так
	// что повторный вход после падения удваивает счёт: 2·(N−1)·A ≤ 32 → N ≤ 5.
	// Сверх квоты coturn отвечает 486, и pc молча не соединяется.
	GroupCallMaxParticipants = 5
)
