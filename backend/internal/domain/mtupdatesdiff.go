package domain

import "encoding/json"

// Догонка апдейтов в форме схемы — updates.getState / updates.getDifference /
// updates.getChannelDifference, ровно те конструкторы, которые разбирает tweb
// apiUpdatesManager (:316-392 getDifference, :418-488 getChannelDifference,
// :895 getState). Прежние наши формы — кадр hello, ответ getDifference с конвертами
// {t, pts, d} и /channels/{id}/difference — ушли вместе с ними.
//
// Модель ящиков у нас своя (один плотный пер-юзерный pts на все журналируемые
// события, seq нет — расхождение Д-1 матрицы контракта), поэтому seq в
// состоянии всегда 0, а qts не используется (tweb шлёт qts: -1).

// Дискриминаторы `_` конструкторов догонки.
const (
	UpdatesStateTag                    = "updates.state"
	UpdatesDifferenceEmptyTag          = "updates.differenceEmpty"
	UpdatesDifferenceTag               = "updates.difference"
	UpdatesDifferenceSliceTag          = "updates.differenceSlice"
	UpdatesDifferenceTooLongTag        = "updates.differenceTooLong"
	UpdatesChannelDifferenceEmptyTag   = "updates.channelDifferenceEmpty"
	UpdatesChannelDifferenceTooLongTag = "updates.channelDifferenceTooLong"
	UpdatesChannelDifferenceTag        = "updates.channelDifference"
	MessagesChannelMessagesTag         = "messages.channelMessages"
)

// updates.state#a56c2a3e pts:int qts:int date:int seq:int unread_count:int
// = updates.State;
type UpdatesState struct {
	Underscore  string `json:"_"`
	Pts         int64  `json:"pts"`
	Qts         int64  `json:"qts"`
	Date        int64  `json:"date"`
	Seq         int64  `json:"seq"`
	UnreadCount int    `json:"unread_count"`
}

func NewUpdatesState(pts, date int64, unread int) UpdatesState {
	return UpdatesState{Underscore: UpdatesStateTag, Pts: pts, Date: date, UnreadCount: unread}
}

// UpdatesDifference — объединение updates.Difference.
type UpdatesDifference interface {
	isUpdatesDifference()
	Tag() string
}

// updates.differenceEmpty#5d75a138 date:int seq:int = updates.Difference;
type UpdatesDifferenceEmpty struct {
	Underscore string `json:"_"`
	Date       int64  `json:"date"`
	Seq        int64  `json:"seq"`
}

func (UpdatesDifferenceEmpty) isUpdatesDifference() {}
func (d UpdatesDifferenceEmpty) Tag() string        { return d.Underscore }

// updates.difference#f49ca0 new_messages:Vector<Message>
// new_encrypted_messages:Vector<EncryptedMessage> other_updates:Vector<Update>
// chats:Vector<Chat> users:Vector<User> state:updates.State = updates.Difference;
//
// updates.differenceSlice#a8fb1981 — то же с intermediate_state вместо state:
// разница отдана кусками, клиент запрашивает следующий.
//
// Элементы векторов сообщений и апдейтов — уже собранные конструкторы схемы
// (json.RawMessage): сообщение — глазами зрителя (MessagesContainer), апдейт —
// тело журнала, в которое дописан его pts.
type UpdatesDifferenceReal struct {
	Underscore           string            `json:"_"`
	NewMessages          []json.RawMessage `json:"new_messages"`
	NewEncryptedMessages []json.RawMessage `json:"new_encrypted_messages"`
	OtherUpdates         []json.RawMessage `json:"other_updates"`
	Chats                []Chat            `json:"chats"`
	Users                []UserReal        `json:"users"`
	State                *UpdatesState     `json:"state,omitempty"`
	IntermediateState    *UpdatesState     `json:"intermediate_state,omitempty"`
}

func (UpdatesDifferenceReal) isUpdatesDifference() {}
func (d UpdatesDifferenceReal) Tag() string        { return d.Underscore }

// NewUpdatesDifference — разница: целиком (slice=false, state) или куском
// (slice=true, intermediate_state).
func NewUpdatesDifference(msgs, others []json.RawMessage, chats []Chat, users []UserReal, state UpdatesState, slice bool) UpdatesDifferenceReal {
	d := UpdatesDifferenceReal{
		Underscore:           UpdatesDifferenceTag,
		NewMessages:          orEmpty(msgs),
		NewEncryptedMessages: []json.RawMessage{},
		OtherUpdates:         orEmpty(others),
		Chats:                orEmpty(chats),
		Users:                orEmpty(users),
	}
	if slice {
		d.Underscore = UpdatesDifferenceSliceTag
		d.IntermediateState = &state
	} else {
		d.State = &state
	}
	return d
}

// updates.differenceTooLong#4afe8f6d pts:int = updates.Difference;
type UpdatesDifferenceTooLong struct {
	Underscore string `json:"_"`
	Pts        int64  `json:"pts"`
}

func (UpdatesDifferenceTooLong) isUpdatesDifference() {}
func (d UpdatesDifferenceTooLong) Tag() string        { return d.Underscore }

// UpdatesChannelDifference — объединение updates.ChannelDifference.
type UpdatesChannelDifference interface {
	isUpdatesChannelDifference()
	Tag() string
}

// updates.channelDifferenceEmpty#3e11affb flags:# final:flags.0?true pts:int
// timeout:flags.1?int = updates.ChannelDifference;
type UpdatesChannelDifferenceEmpty struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	Pts        int64           `json:"pts"`
}

func (UpdatesChannelDifferenceEmpty) isUpdatesChannelDifference() {}
func (d UpdatesChannelDifferenceEmpty) Tag() string               { return d.Underscore }

func NewUpdatesChannelDifferenceEmpty(pts int64) UpdatesChannelDifferenceEmpty {
	return UpdatesChannelDifferenceEmpty{Underscore: UpdatesChannelDifferenceEmptyTag,
		PFlags: map[string]bool{"final": true}, Pts: pts}
}

// updates.channelDifferenceTooLong#a4bcc6fe flags:# final:flags.0?true
// timeout:flags.1?int dialog:Dialog messages:Vector<Message> chats:Vector<Chat>
// users:Vector<User> = updates.ChannelDifference;
type UpdatesChannelDifferenceTooLong struct {
	Underscore string            `json:"_"`
	PFlags     map[string]bool   `json:"pFlags,omitempty"`
	Dialog     Dialog            `json:"dialog"`
	Messages   []json.RawMessage `json:"messages"`
	Chats      []Chat            `json:"chats"`
	Users      []UserReal        `json:"users"`
}

func (UpdatesChannelDifferenceTooLong) isUpdatesChannelDifference() {}
func (d UpdatesChannelDifferenceTooLong) Tag() string               { return d.Underscore }

func NewUpdatesChannelDifferenceTooLong(dialog Dialog, msgs []json.RawMessage, chats []Chat, users []UserReal) UpdatesChannelDifferenceTooLong {
	return UpdatesChannelDifferenceTooLong{Underscore: UpdatesChannelDifferenceTooLongTag,
		PFlags: map[string]bool{"final": true}, Dialog: dialog, Messages: orEmpty(msgs),
		Chats: orEmpty(chats), Users: orEmpty(users)}
}

// updates.channelDifference#2064674e flags:# final:flags.0?true pts:int
// timeout:flags.1?int new_messages:Vector<Message> other_updates:Vector<Update>
// chats:Vector<Chat> users:Vector<User> = updates.ChannelDifference;
type UpdatesChannelDifferenceReal struct {
	Underscore   string            `json:"_"`
	PFlags       map[string]bool   `json:"pFlags,omitempty"`
	Pts          int64             `json:"pts"`
	NewMessages  []json.RawMessage `json:"new_messages"`
	OtherUpdates []json.RawMessage `json:"other_updates"`
	Chats        []Chat            `json:"chats"`
	Users        []UserReal        `json:"users"`
}

func (UpdatesChannelDifferenceReal) isUpdatesChannelDifference() {}
func (d UpdatesChannelDifferenceReal) Tag() string               { return d.Underscore }

func NewUpdatesChannelDifference(pts int64, final bool, msgs, others []json.RawMessage, chats []Chat, users []UserReal) UpdatesChannelDifferenceReal {
	d := UpdatesChannelDifferenceReal{Underscore: UpdatesChannelDifferenceTag, Pts: pts,
		NewMessages: orEmpty(msgs), OtherUpdates: orEmpty(others), Chats: orEmpty(chats), Users: orEmpty(users)}
	if final {
		d.PFlags = map[string]bool{"final": true}
	}
	return d
}

// updateChannelTooLong#108d941f flags:# channel_id:long pts:flags.0?int = Update;
//
// «Канал сдвинулся, пока тебя не было» — в other_updates разницы: клиент с
// известным состоянием канала идёт в getChannelDifference (tweb
// apiUpdatesManager.ts:354, :658-662). pts — текущий pts журнала канала.
type UpdateChannelTooLong struct {
	Underscore string `json:"_"`
	ChannelID  int64  `json:"channel_id"`
	Pts        int64  `json:"pts,omitempty"`
}

func (UpdateChannelTooLong) isUpdate()     {}
func (u UpdateChannelTooLong) Tag() string { return u.Underscore }

func NewUpdateChannelTooLong(channelID, pts int64) UpdateChannelTooLong {
	return UpdateChannelTooLong{Underscore: UpdateChannelTooLongTag, ChannelID: channelID, Pts: pts}
}

// messages.channelMessages#c776ba4e flags:# inexact:flags.1?true pts:int
// count:int offset_id_offset:flags.2?int messages:Vector<Message>
// topics:Vector<ForumTopic> chats:Vector<Chat> users:Vector<User>
// = messages.Messages;
//
// История broadcast-канала: тот же кусок, что messages.messagesSlice, плюс pts
// журнала канала — из него клиент заводит состояние канала, когда диалога нет
// (открыт чужой публичный канал): tweb appMessagesManager.ts:13503-13505.
type MessagesChannelMessages struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	Pts        int64           `json:"pts"`
	Count      int             `json:"count"`
	Messages   []MTMessage     `json:"messages"`
	Topics     []any           `json:"topics"`
	Chats      []Chat          `json:"chats"`
	Users      []UserReal      `json:"users"`
}

func (MessagesChannelMessages) isMessagesMessages() {}
func (m MessagesChannelMessages) Tag() string       { return m.Underscore }

func NewMessagesChannelMessages(pts int64, count int, messages []MTMessage, chats []Chat, users []UserReal) MessagesChannelMessages {
	return MessagesChannelMessages{Underscore: MessagesChannelMessagesTag, Pts: pts, Count: count,
		Messages: orEmpty(messages), Topics: []any{}, Chats: orEmpty(chats), Users: orEmpty(users)}
}
