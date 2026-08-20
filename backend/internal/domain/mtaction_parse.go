package domain

import (
	"encoding/json"
	"fmt"
	"time"
)

// Разбор объединения MessageAction — единственное место, где служебное
// действие возвращается из хранилища в конструктор.
//
// Разборщик здесь есть (в отличие от самого сообщения, см. шапку mtmessage.go),
// и причина конкретная: действие ЛЕЖИТ В БАЗЕ. Колонка messages.action хранит
// ровно тот объект, который уезжает на провод, — как entities и reply_markup
// после миграций 0100 и 0101. Постоянного переходника «наша запись → форма
// схемы» не остаётся: он и есть тот второй источник истины, ради устранения
// которого делается переход.
//
// Единственное, чего в колонке нет, — фото (messageActionChatEditPhoto,
// messageActionSuggestProfilePhoto): оно висит на media_id самого сообщения и
// подставляется в действие на границе (Message.ToWire). Класть в jsonb
// собранный конструктор photo нельзя — у него вектор PhotoSize, а это
// объединение, которое encoding/json обратно не соберёт.

// zeroTime — «времени нет». Отдельным именем, потому что unixSeconds(zeroTime)
// это осознанный нуль обязательного параметра, а не забытое значение.
var zeroTime time.Time

// ParseMessageAction разбирает служебное действие из хранилища. nil на пустом
// вводе — «действия нет», то есть сообщение обычное, а не служебное.
func ParseMessageAction(raw []byte) (MessageAction, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var probe struct {
		Underscore string `json:"_"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return nil, err
	}
	switch probe.Underscore {
	case MessageActionChatCreateTag:
		var a MessageActionChatCreate
		return a, unmarshalVectorAction(raw, &a, &a.Users)
	case MessageActionChatEditTitleTag:
		var a MessageActionChatEditTitle
		return a, json.Unmarshal(raw, &a)
	case MessageActionChatEditPhotoTag:
		var a MessageActionChatEditPhoto
		return a, unmarshalPhotolessAction(raw, &a.Underscore)
	case MessageActionChatAddUserTag:
		var a MessageActionChatAddUser
		return a, unmarshalVectorAction(raw, &a, &a.Users)
	case MessageActionChatDeleteUserTag:
		var a MessageActionChatDeleteUser
		return a, json.Unmarshal(raw, &a)
	case MessageActionChatJoinedByLinkTag:
		var a MessageActionChatJoinedByLink
		return a, json.Unmarshal(raw, &a)
	case MessageActionPinMessageTag:
		var a MessageActionPinMessage
		return a, json.Unmarshal(raw, &a)
	case MessageActionSetMessagesTTLTag:
		var a MessageActionSetMessagesTTL
		return a, json.Unmarshal(raw, &a)
	case MessageActionTopicCreateTag:
		var a MessageActionTopicCreate
		return a, json.Unmarshal(raw, &a)
	case MessageActionSuggestProfilePhotoTag:
		var a MessageActionSuggestProfilePhoto
		if err := json.Unmarshal(raw, &a); err != nil {
			return nil, err
		}
		a.Photo = nil // фото приезжает с media_id сообщения, см. шапку файла
		return a, nil
	case MessageActionSuggestedPostApprovalTag:
		var a MessageActionSuggestedPostApproval
		return a, json.Unmarshal(raw, &a)
	case MessageActionRestrictTag:
		var a MessageActionRestrict
		return a, json.Unmarshal(raw, &a)
	case MessageActionPhoneCallTag:
		return parsePhoneCallAction(raw)
	default:
		return nil, fmt.Errorf("неизвестный конструктор действия %q", probe.Underscore)
	}
}

// unmarshalVectorAction разбирает действие и достраивает ОБЯЗАТЕЛЬНЫЙ вектор:
// в схеме пустой Vector<long> это [], а не отсутствие значения, и null из
// строки не должен превратить его в отсутствующий ключ на выходе.
func unmarshalVectorAction(raw []byte, dst any, users *[]int64) error {
	if err := json.Unmarshal(raw, dst); err != nil {
		return err
	}
	*users = orEmpty(*users)
	return nil
}

// unmarshalPhotolessAction — действие, у которого единственный параметр это
// фото: в колонке от него остаётся один дискриминатор.
func unmarshalPhotolessAction(raw []byte, underscore *string) error {
	var v struct {
		Underscore string `json:"_"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return err
	}
	*underscore = v.Underscore
	return nil
}

// parsePhoneCallAction — причина завершения звонка сама является объединением,
// поэтому разбирается отдельно, как from_id у messageFwdHeader.
func parsePhoneCallAction(raw []byte) (MessageAction, error) {
	var v struct {
		Underscore string          `json:"_"`
		PFlags     map[string]bool `json:"pFlags"`
		Reason     json.RawMessage `json:"reason"`
		Duration   int             `json:"duration"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	a := MessageActionPhoneCall{Underscore: v.Underscore, PFlags: v.PFlags, Duration: v.Duration}
	reason, err := parseDiscardReason(v.Reason)
	if err != nil {
		return nil, err
	}
	a.Reason = reason
	return a, nil
}

func parseDiscardReason(raw json.RawMessage) (PhoneCallDiscardReason, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var probe struct {
		Underscore string `json:"_"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return nil, err
	}
	switch probe.Underscore {
	case PhoneCallDiscardReasonMissedTag:
		return NewPhoneCallDiscardReasonMissed(), nil
	case PhoneCallDiscardReasonBusyTag:
		return NewPhoneCallDiscardReasonBusy(), nil
	case PhoneCallDiscardReasonHangupTag:
		return NewPhoneCallDiscardReasonHangup(), nil
	default:
		return nil, fmt.Errorf("неизвестная причина завершения звонка %q", probe.Underscore)
	}
}
