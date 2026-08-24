package domain

import "time"

// Мелкие витрины чата, у каждой из которых в схеме есть свой конструктор.
//
// Все они ехали безымянными обёртками вокруг одного значения
// (`{period}`, `{read_at}`, `{text, source}`, `{text, pending}`) — то есть
// значением БЕЗ ТИПА. Конструктор у каждого предмета в схеме уже был.

const (
	DefaultHistoryTTLTag        = "defaultHistoryTTL"
	OutboxReadDateTag           = "outboxReadDate"
	MessagesTranscribedAudioTag = "messages.transcribedAudio"
	MessagesTranslateResultTag  = "messages.translateResult"
)

// defaultHistoryTTL#43b46b20 period:int = DefaultHistoryTTL;
//
// Период автоудаления: и глобальный (свой), и чата — один конструктор, потому
// что предмет один.
type DefaultHistoryTTL struct {
	Underscore string `json:"_"`
	Period     int    `json:"period"`
}

func NewDefaultHistoryTTL(period int) DefaultHistoryTTL {
	return DefaultHistoryTTL{Underscore: DefaultHistoryTTLTag, Period: period}
}

// outboxReadDate#3bb842ac date:int = OutboxReadDate;
//
// Когда собеседник прочитал МОЁ сообщение. Дата в секундах эпохи — как у всех
// дат схемы; прежде здесь ехала строка RFC 3339.
type OutboxReadDate struct {
	Underscore string `json:"_"`
	Date       int    `json:"date"`
}

func NewOutboxReadDate(at time.Time) OutboxReadDate {
	return OutboxReadDate{Underscore: OutboxReadDateTag, Date: unixSeconds(at)}
}

// messages.transcribedAudio#cfb9d957 flags:# pending:flags.0?true
// transcription_id:long text:string … = messages.TranscribedAudio;
//
// «Ещё расшифровывается» — ФЛАГ, то есть его отсутствие и есть «готово»;
// прежде ехало булево поле `pending: false`.
//
// `transcription_id` адресует расшифровку у оригинала (по нему шлют жалобу на
// качество). У нас такого адреса нет — расшифровка живёт при сообщении;
// названо в OmittedWithoutSubject.
type MessagesTranscribedAudio struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	Text       string          `json:"text"`
}

func NewMessagesTranscribedAudio(text string, pending bool) MessagesTranscribedAudio {
	out := MessagesTranscribedAudio{Underscore: MessagesTranscribedAudioTag, Text: text}
	setPFlag(&out.PFlags, "pending", pending)
	return out
}

// messages.translateResult#33db32f8 result:Vector<TextWithEntities>
// = messages.TranslatedText;
//
// Перевод — ВЕКТОР строк с разметкой: оригинал переводит пачку сообщений одним
// вызовом. Мы переводим по одному, поэтому вектор из одного элемента.
//
// Язык-источник (`source` нашей витрины) у конструктора не предусмотрен вовсе:
// оригинал его не возвращает, потому что о нём не спрашивают — перевод просят
// НА язык. Наше поле уходит.
type MessagesTranslateResult struct {
	Underscore string             `json:"_"`
	Result     []TextWithEntities `json:"result"`
}

func NewMessagesTranslateResult(text string) MessagesTranslateResult {
	return MessagesTranslateResult{
		Underscore: MessagesTranslateResultTag,
		Result:     []TextWithEntities{*NewTextWithEntities(text, nil)},
	}
}

// readParticipantDate#4a4ff172 user_id:long date:int = ReadParticipantDate;
//
// СТРОКА списка «кто прочитал сообщение». Прежде витрина отдавала голые числа
// под именем поля (`{"user_ids": […]}`) — форма без объявленного типа.
//
// `date` — когда прочитал. Времени прочтения мы не храним вовсе (колонки нет),
// поэтому параметр назван в OmittedWithoutSubject: у нас есть ФАКТ прочтения,
// но не его момент.
type ReadParticipantDate struct {
	Underscore string `json:"_"`
	UserID     int64  `json:"user_id"`
}

// NewReadParticipantDate — строка списка прочитавших.
func NewReadParticipantDate(userID int64) ReadParticipantDate {
	return ReadParticipantDate{Underscore: "readParticipantDate", UserID: userID}
}
