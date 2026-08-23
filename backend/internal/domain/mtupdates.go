package domain

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
// Векторы `users`/`chats` контейнера пока пустые. Они решают ту же задачу, что
// порт диалогов решил у `messages.dialogs` (объекты один раз рядом, внутри
// ссылки), и наполнить их — отдельная работа: сейчас каждый кадр тащит пира
// внутри себя, из-за чего у нас и появились свои конструкторы-снимки
// (`updateUserSnapshot`, `updateChatFullSnapshot`).

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
// кадра, у которого своего `pts` нет: у оригинала порядок пачке задаёт `seq`.
func NewUpdatesPayload(updates []map[string]any, date, seq int64) map[string]any {
	list := make([]any, 0, len(updates))
	for _, u := range updates {
		list = append(list, u)
	}
	return map[string]any{
		"_":       UpdatesTag,
		"updates": list,
		"users":   []any{},
		"chats":   []any{},
		"date":    date,
		"seq":     seq,
	}
}

// NewUpdatesEnvelope выбирает оболочку по тому же правилу, по которому витрина
// выбирает место курсора: спрашивает СХЕМУ, а не список имён.
//
// envSeq — курсор из конверта: он есть ровно тогда, когда конструктор кадра
// `pts` не объявляет (см. UpdateDeclaresPts и framePts на выходе витрин).
func NewUpdatesEnvelope(body map[string]any, envSeq *int64, date int64) map[string]any {
	if envSeq == nil {
		return NewUpdateShortPayload(body, date)
	}
	return NewUpdatesPayload([]map[string]any{body}, date, *envSeq)
}
