package domain

// MessagesChatInviteJoinResultOkTag — успешный ответ messages.importChatInvite.
const MessagesChatInviteJoinResultOkTag = "messages.chatInviteJoinResultOk"

// messages.chatInviteJoinResultOk#445663a7 updates:Updates
// = messages.ChatInviteJoinResult;
//
// Ответ `messages.importChatInvite` (layer 228): пачка апдейтов с чатом ссылки
// в `updates.chats[0]`. tweb снимает обёртку в `processChatInviteJoinResult`
// (appChatsManager.ts:664-679) и открывает `chats[0]`
// (appChatInvitesManager.ts:92-104).
//
// Вариант `messages.chatInviteJoinResultWebView` (вход через бота-модератора)
// не производим: такого бота у нас нет.
type MessagesChatInviteJoinResultOk struct {
	Underscore string      `json:"_"`
	Updates    UpdatesReal `json:"updates"`
}

// NewMessagesChatInviteJoinResultOk оборачивает пачку апдейтов вступления.
func NewMessagesChatInviteJoinResultOk(u UpdatesReal) MessagesChatInviteJoinResultOk {
	return MessagesChatInviteJoinResultOk{Underscore: MessagesChatInviteJoinResultOkTag, Updates: u}
}
