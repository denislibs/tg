package domain

import "time"

// CallLogEntry — строка выборки журнала звонков (вкладка «Звонки»): служебные
// сообщения messageActionPhoneCall из личных чатов пользователя.
//
// Проводной формы у неё БОЛЬШЕ НЕТ. Прежде это была десятая форма сообщения на
// проводе: {id, peer_id, peer, out, text, date}, где text — тот же JSON лога
// звонка, что и в бабле, а карточка собеседника ехала вклеенной в каждую
// запись. На проводе журнал звонков теперь это обычный вектор messages плюс
// вектор users — ровно как у оригинала, где вкладка «Звонки» собирается из
// сообщений (messages.search с фильтром phoneCalls).
//
// Out тоже исчез: зритель выводит его сам (решение Р7), как у любого другого
// сообщения.
type CallLogEntry struct {
	// Message — само служебное сообщение о звонке.
	Message Message
	// Peer — собеседник; едет вектором users, а не карточкой внутри записи.
	Peer UserReal
}

// PhoneCall — идущий 1:1 звонок глазами сервера: от call_request до конца.
// Сервер держит его ради ОДНОГО: в конце положить в личный чат лог звонка
// (messageActionPhoneCall) с исходом и длительностью, которые он посчитал сам.
// Медиа и сигналинг сервер по-прежнему только переадресует.
type PhoneCall struct {
	// ID — uuid звонка из сигнальных кадров (call_id).
	ID       string
	CallerID int64
	CalleeID int64
	Video    bool
	// AcceptedAt — когда адресат ответил (кадр call_accept); нулевое значение —
	// ответа не было.
	AcceptedAt time.Time
}

// Answered — состоялся ли разговор.
func (c PhoneCall) Answered() bool { return !c.AcceptedAt.IsZero() }

// IsParty — участник ли звонка пользователь.
func (c PhoneCall) IsParty(userID int64) bool { return userID == c.CallerID || userID == c.CalleeID }
