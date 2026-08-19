package domain

import "encoding/json"

// Атрибуция пересылки в форме оригинала — конструктор messageFwdHeader схемы.
//
// Заводится здесь, а не в подсистеме сообщений, потому что закрывает ДОЛГ шага
// B: снимок пересылки нёс `fwd_from_peer_id` как -chatID безусловно, то есть
// при источнике-ПРИВАТНОМ-чате наружу уезжал внутренний ключ строки chats —
// тот самый, который шаг B из провода убрал. В схеме автор пересылки это
// `from_id:Peer`, и для приватного источника это peerUser: ссылки на приватный
// чат там нет вовсе, потому что и сущности такой нет (решение №1 разбора).
//
// Правила фазы 0 — те же, что у остальных конструкторов (см. шапку mtpeer.go).

// MessageFwdHeaderTag — дискриминатор `_` конструктора messageFwdHeader.
const MessageFwdHeaderTag = "messageFwdHeader"

// messageFwdHeader#4e4df4bb flags:# imported:flags.7?true saved_out:flags.11?true
// from_id:flags.0?Peer from_name:flags.5?string date:int channel_post:flags.2?int
// post_author:flags.3?string saved_from_peer:flags.4?Peer
// saved_from_msg_id:flags.4?int … = MessageFwdHeader;
//
// FromID — АВТОР оригинала: peerUser у пересылки от человека, peerChannel у
// поста канала. FromName — скрытая атрибуция (правило приватности forwards):
// вместо ссылки на аккаунт едет только имя, и тогда from_id отсутствует.
//
// SavedFromPeer/SavedFromMsgID — «откуда именно» (переход к оригиналу). Пара
// заполняется ТОЛЬКО когда источник — группа или канал: у них ключ пира
// публичен и одинаков для всех. У приватного источника пары нет — не потому,
// что мы поленились, а потому что публичного ключа у той строки chats не
// существует; автор при этом не теряется, он в from_id.
//
// Не производятся: pFlags.imported (импорт истории из другого мессенджера),
// pFlags.saved_out, post_author (подпись админа под постом), saved_from_id,
// saved_from_name, saved_date, psa_type — ни колонки, ни механики.
type MessageFwdHeader struct {
	Underscore string `json:"_"`
	FromID     Peer   `json:"from_id,omitempty"`
	FromName   string `json:"from_name,omitempty"`
	// Date обязателен по схеме и сериализуется всегда, даже нулевым.
	Date           int   `json:"date"`
	ChannelPost    int64 `json:"channel_post,omitempty"`
	SavedFromPeer  Peer  `json:"saved_from_peer,omitempty"`
	SavedFromMsgID int64 `json:"saved_from_msg_id,omitempty"`
}

func (h *MessageFwdHeader) UnmarshalJSON(b []byte) error {
	type plain MessageFwdHeader
	var v struct {
		plain
		FromID        json.RawMessage `json:"from_id"`
		SavedFromPeer json.RawMessage `json:"saved_from_peer"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*h = MessageFwdHeader(v.plain)
	from, err := UnmarshalPeer(v.FromID)
	if err != nil {
		return err
	}
	h.FromID = from
	saved, err := UnmarshalPeer(v.SavedFromPeer)
	if err != nil {
		return err
	}
	h.SavedFromPeer = saved
	return nil
}
