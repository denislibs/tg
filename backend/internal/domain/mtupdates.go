package domain

import "time"

// Оболочка кадра на проводе TL — объединение `Updates`.
//
// На JSON-проводе фазы 0 кадр едет конвертом `{t, d, pts}`. Конверта в TL нет:
// поток начинается четырьмя байтами id конструктора, и «рядом с телом» класть
// нечего. Оболочку даёт сама схема — у оригинала апдейты приходят ровно так:
// `updateShort` (один апдейт) или `updates` (пачка + векторы объектов).
//
// Решение Р7 разбора: наш конверт И ЕСТЬ этот контейнер, поэтому курсор кадра,
// чей конструктор `pts` не объявляет, едет параметром `seq` контейнера — тем
// самым, которым оригинал задаёт порядок пачки. Кадр, чей конструктор `pts`
// объявляет, курсор несёт В СЕБЕ, и контейнеру добавить нечего: такому едет
// `updateShort`.
//
// Векторы `users`/`chats` контейнера несут карточки всех, на кого ссылается
// апдейт и кого получатель ещё не видел (A4-05): у оригинала клиент сохраняет
// их ДО применения апдейта (apiUpdatesManager.processUpdateMessage :259-262).
// Доклеивает их соединение на выходе (adapter/delivery/ws), потому что
// карточки — глазами КОНКРЕТНОГО получателя, а публикация одна на всех.

// Значения дискриминатора `_` объединения Updates. Они живут ЗДЕСЬ, а не рядом
// с тегами объединения Update, и это не раскладка по вкусу: контейнер апдейтом
// не является, а список тегов Update читает пин полноты на клиенте
// (updateCatalog.test.ts) — попади оболочка в тот список, клиент обязан был бы
// завести ей обработчик кадра.
const (
	UpdateShortTag = "updateShort"
	UpdatesTag     = "updates"
)

// updateShort#78d4dec1 update:Update date:int = Updates;
//
// Один апдейт без объектов рядом. Курсор у такого кадра — параметр самого
// конструктора апдейта.
func NewUpdateShortPayload(update map[string]any, date int64) map[string]any {
	return map[string]any{
		"_":      UpdateShortTag,
		"update": update,
		"date":   date,
	}
}

// updates#74ae4240 updates:Vector<Update> users:Vector<User> chats:Vector<Chat>
// date:int seq:int = Updates;
//
// Пачка апдейтов. У нас пока всегда из одного — но именно она несёт КУРСОР
// кадра, у которого своего `pts` нет (у оригинала порядок пачке задаёт `seq`), и
// ВЕКТОРЫ карточек. seq = 0 — «порядка нет» (курсор у кадра в теле).
func NewUpdatesPayload(updates []map[string]any, users, chats []any, date, seq int64) map[string]any {
	list := make([]any, 0, len(updates))
	for _, u := range updates {
		list = append(list, u)
	}
	if users == nil {
		users = []any{}
	}
	if chats == nil {
		chats = []any{}
	}
	return map[string]any{
		"_":       UpdatesTag,
		"updates": list,
		"users":   users,
		"chats":   chats,
		"date":    date,
		"seq":     seq,
	}
}

// NewUpdatesEnvelope выбирает оболочку по тому же правилу, по которому витрина
// выбирает место курсора: спрашивает СХЕМУ, а не список имён.
//
// envSeq — курсор из конверта: он есть ровно тогда, когда конструктор кадра
// `pts` не объявляет (см. UpdateDeclaresPts и framePts на выходе витрин).
// users/chats — карточки рядом с апдейтом: у updateShort векторов нет, поэтому
// кадр с карточками едет контейнером `updates` (seq 0, если курсора нет).
func NewUpdatesEnvelope(body map[string]any, envSeq *int64, date int64, users, chats []any) map[string]any {
	if envSeq == nil && len(users) == 0 && len(chats) == 0 {
		return NewUpdateShortPayload(body, date)
	}
	var seq int64
	if envSeq != nil {
		seq = *envSeq
	}
	return NewUpdatesPayload([]map[string]any{body}, users, chats, date, seq)
}

// ── Та же пачка витриной REST ──────────────────────────────────────────────

// updates#74ae4240 updates:Vector<Update> users:Vector<User> chats:Vector<Chat>
// date:int seq:int = Updates;
//
// UpdatesReal — тот же контейнер, собранный из ОБЪЯВЛЕННЫХ конструкторов, а не
// из готовых словарей кадра. Так отвечает витрина, которой оригинал предписал
// контейнер `Updates`: `messages.getAllDrafts` — список тех же кадров, что
// приезжают живыми.
//
// Две сборки одного конструктора рядом — не второе имя предмета, а разница
// МАТЕРИАЛА: тело кадра WS приходит в оболочку уже словарём (его лепит общий
// строитель кадров — NewUpdatesPayload выше), а список черновиков собирается из
// доменных значений. Сойдутся они, когда кадры станут типизированными; это
// названо задачей.
type UpdatesReal struct {
	Underscore string     `json:"_"`
	Updates    []Update   `json:"updates"`
	Users      []UserReal `json:"users"`
	Chats      []Chat     `json:"chats"`
	Date       int        `json:"date"`
	Seq        int        `json:"seq"`
}

// NewUpdates — пачка апдейтов витриной.
//
// `seq` нулевой: порядок пачек мы не ведём вовсе (у оригинала им клиент
// склеивает поток), а витрина отвечает на прямой запрос — порядок в ней задаёт
// сам ответ. Вектор `users` несёт карточки тех, на кого апдейты СОСЛАЛИСЬ:
// ссылка внутри апдейта и карточка рядом — та же раскладка, что у контейнеров
// диалогов и сообщений. Вектор `chats` пока пуст (задача про пиров кадров).
func NewUpdates(list []Update, users []UserReal, date time.Time) UpdatesReal {
	return UpdatesReal{
		Underscore: UpdatesTag,
		Updates:    orEmpty(list),
		Users:      orEmpty(users),
		Chats:      []Chat{},
		Date:       unixSeconds(date),
	}
}
