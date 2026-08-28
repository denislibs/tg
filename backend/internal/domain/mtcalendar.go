package domain

// Календарь медиа: чем день ячейки наполняется в пикере даты.
//
// Прежде витрина отдавала СВОЮ выжимку — `{day, id, media_id, type,
// has_thumb}`, — то есть снимок медиа вместо ссылки на сообщение. У оригинала
// ответ устроен иначе: едут САМИ СООБЩЕНИЯ (`messages`), а превью клиент
// рисует из `message.media` — ровно как в ленте и в общих медиа. Проверено по
// исходникам: `datePicker.tsx:437-444` кладёт в ячейку дня объект сообщения
// (`next.set(key, message)`), а `periods` не читает вовсе.

// searchResultsCalendarPeriod#c9b0539f date:int min_msg_id:int max_msg_id:int
// count:int = SearchResultsCalendarPeriod;
//
// ОТРЕЗОК календаря: сколько сообщений в этом дне и какими номерами он
// ограничен. Наш день — сутки; у оригинала период тоже суточный.
type SearchResultsCalendarPeriod struct {
	Underscore string `json:"_"`
	Date       int64  `json:"date"`
	MinMsgID   int64  `json:"min_msg_id"`
	MaxMsgID   int64  `json:"max_msg_id"`
	Count      int    `json:"count"`
}

// NewSearchResultsCalendarPeriod — отрезок одного дня.
func NewSearchResultsCalendarPeriod(date, minMsgID, maxMsgID int64, count int) SearchResultsCalendarPeriod {
	return SearchResultsCalendarPeriod{
		Underscore: "searchResultsCalendarPeriod",
		Date:       date, MinMsgID: minMsgID, MaxMsgID: maxMsgID, Count: count,
	}
}

// messages.searchResultsCalendar#147ee23c flags:# inexact:flags.0?true
// count:int min_date:int min_msg_id:int offset_id_offset:flags.1?int
// periods:Vector<SearchResultsCalendarPeriod> messages:Vector<Message>
// chats:Vector<Chat> users:Vector<User> = messages.SearchResultsCalendar;
//
// `inexact` в pFlags не поднимается: наш `count` точный — он считается по
// самим строкам, а не оценивается. «Выключено» это ОТСУТСТВИЕ ключа.
//
// `offset_id_offset` не производится по той же причине, что у
// `messages.messagesSlice` (задача #60): позиции сообщения-смещения в полном
// наборе мы не считаем.
//
// `chats` едет пустым вектором: календарь спрашивают у ОДНОГО чата, и его
// карточка у клиента уже есть — он же и открыл этот чат. Авторы сообщений
// нужны (`users`), потому что сообщение ссылается на автора, а не несёт его.
type MessagesSearchResultsCalendar struct {
	Underscore string                        `json:"_"`
	PFlags     map[string]bool               `json:"pFlags,omitempty"`
	Count      int                           `json:"count"`
	MinDate    int64                         `json:"min_date"`
	MinMsgID   int64                         `json:"min_msg_id"`
	Periods    []SearchResultsCalendarPeriod `json:"periods"`
	Messages   []MTMessage                   `json:"messages"`
	Chats      []Chat                        `json:"chats"`
	Users      []UserReal                    `json:"users"`
}

// NewMessagesSearchResultsCalendar собирает контейнер календаря.
//
// `min_date`/`min_msg_id` — самая ранняя граница отданного: у оригинала по ним
// продолжают листать календарь назад. Пустой ответ оставляет обе нулями, а не
// выдумывает границу.
func NewMessagesSearchResultsCalendar(periods []SearchResultsCalendarPeriod, messages []MTMessage, users []UserReal) MessagesSearchResultsCalendar {
	out := MessagesSearchResultsCalendar{
		Underscore: "messages.searchResultsCalendar",
		Periods:    periods,
		Messages:   messages,
		Chats:      []Chat{},
		Users:      users,
	}
	if out.Periods == nil {
		out.Periods = []SearchResultsCalendarPeriod{}
	}
	if out.Messages == nil {
		out.Messages = []MTMessage{}
	}
	if out.Users == nil {
		out.Users = []UserReal{}
	}
	for _, p := range out.Periods {
		out.Count += p.Count
		if out.MinDate == 0 || p.Date < out.MinDate {
			out.MinDate = p.Date
		}
		if out.MinMsgID == 0 || (p.MinMsgID != 0 && p.MinMsgID < out.MinMsgID) {
			out.MinMsgID = p.MinMsgID
		}
	}
	return out
}
