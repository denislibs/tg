package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// chatUpdatePayload — АБСОЛЮТНЫЙ снимок метаданных чата (не дифф): title/photo/
// username/публичность/число участников + групповые настройки (и подписи для
// канала). Как и у reaction/poll, абсолютное представление делает catch-up через
// /sync идемпотентным — клиент просто заменяет карточку чата на этот снимок,
// в каком бы порядке апдейты ни доехали.
func chatUpdatePayload(c domain.ChatCard) map[string]any {
	var photo any
	if c.PhotoMediaID != nil {
		photo = *c.PhotoMediaID
	}
	p := map[string]any{
		"chat_id":        c.ID,
		"type":           c.Type,
		"title":          c.Title,
		"about":          c.About,
		"username":       c.Username,
		"is_public":      c.IsPublic,
		"member_count":   c.MemberCount,
		"photo_media_id": photo, // nil — фото снято
		"settings": map[string]any{
			"default_perms":     int(c.Settings.DefaultPerms),
			"slowmode_seconds":  c.Settings.SlowmodeSeconds,
			"reactions_mode":    c.Settings.ReactionsMode,
			"reactions_allowed": c.Settings.ReactionsAllowed,
			"history_for_new":   c.Settings.HistoryForNew,
			"charge_stars":      c.Settings.ChargeStars,
		},
	}
	if c.Type == "channel" {
		p["signatures"] = c.Signatures
		p["signature_profiles"] = c.SignatureProfiles
	}
	return p
}

// publishChatUpdate логирует и рассылает участникам chat_update — абсолютный
// снимок метаданных чата после мутации (title/photo/member/admin/settings), так
// что изменение доезжает и через /sync (плотный pts-курсор), а не только живым
// кадром. Снимок viewer-agnostic (viewerID=0): один payload всем и в лог.
// Best-effort — метаданные косметические, ошибка рассылки не должна валить мутацию.
func (i *Interactor) publishChatUpdate(ctx context.Context, chatID int64) {
	if i.groups == nil {
		return
	}
	card, err := i.groups.Card(ctx, chatID, 0)
	if err != nil {
		return
	}
	payload := chatUpdatePayload(card)
	// Канал: один channel-broadcast (O(1)) по channel-конверту вместо N+1 fan-out
	// в per-user лог каждого подписчика. Подписчики получают кадр живым, остальные
	// добирают снимок при открытии через /channels/{id}/difference. Группа —
	// прежний per-user путь (у групп нет channel_pts/топика).
	if card.Type == "channel" {
		_ = i.logAndPublishChannel(ctx, chatID, "chat_update", payload)
		return
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return
	}
	_ = i.logAndPublish(ctx, members, "chat_update", payload)
}
