package chat

import (
	"context"
	"encoding/json"
	"slices"
	"time"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// memberCan — порт tweb hasRights для действий, которые обычному участнику
// группы разрешает дефолт чата, а админу — его право (creator может всё):
//   - админ/владелец — бит права;
//   - канал (broadcast) — ничего, кроме админских прав: у подписчика нет
//     дефолтных прав (hasRights для broadcast берёт только admin_rights);
//   - участник группы — дефолт чата ∧ ¬личный запрет (banned_rights ‖
//     default_banned_rights): неистёкшее ограничение MemberRestriction снимает
//     и закреп, и правку инфо, и приглашение, а не только отправку.
func (i *Interactor) memberCan(ctx context.Context, chatID, userID int64, perm domain.MemberPerms, right domain.Rights) (bool, error) {
	if i.groups == nil {
		return false, nil
	}
	m, err := i.groups.GetMember(ctx, chatID, userID)
	if err != nil {
		return false, err
	}
	switch m.Role {
	case domain.RoleCreator, domain.RoleAdmin:
		return domain.HasRight(m.Role, m.Rights, right), nil
	case domain.RoleSubscriber:
		return false, nil
	}
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return false, err
	}
	if typ == domain.ChatTypeChannel {
		return false, nil
	}
	s, err := i.groups.Settings(ctx, chatID)
	if err != nil {
		return false, err
	}
	if s.DefaultPerms&perm != perm {
		return false, nil
	}
	denied, err := i.restricted(ctx, chatID, userID, perm)
	if err != nil {
		return false, err
	}
	return !denied, nil
}

// restricted — запрещает ли perm личное ограничение участника (Telegram
// banned_rights). Истёкшее ограничение не действует и убирается best-effort.
// Сбой чтения — ошибка, а не «не ограничен»: гейт при ней отказывает.
func (i *Interactor) restricted(ctx context.Context, chatID, userID int64, perm domain.MemberPerms) (bool, error) {
	res, ok, err := i.groups.GetRestriction(ctx, chatID, userID)
	if err != nil {
		return false, err
	}
	if !ok {
		return false, nil
	}
	if !res.Active(time.Now()) {
		_ = i.groups.DeleteRestriction(ctx, chatID, userID)
		return false, nil
	}
	return res.DeniedRights.Denies(perm), nil
}

// requireCreator — действие только владельца (tweb hasRights: toggle_forum,
// change_type, delete_chat → false у не-создателя).
func (i *Interactor) requireCreator(ctx context.Context, chatID, userID int64) error {
	if i.groups == nil {
		return domain.ErrForbidden
	}
	m, err := i.groups.GetMember(ctx, chatID, userID)
	if err != nil || m.Role != domain.RoleCreator {
		return domain.ErrForbidden
	}
	return nil
}

// requirePermOrRight is requireRight's member-aware counterpart.
func (i *Interactor) requirePermOrRight(ctx context.Context, chatID, userID int64, perm domain.MemberPerms, right domain.Rights) error {
	ok, err := i.memberCan(ctx, chatID, userID, perm, right)
	if err != nil {
		return domain.ErrForbidden
	}
	if !ok {
		return domain.ErrForbidden
	}
	return nil
}

// checkSendAllowed enforces group default permissions + slowmode for plain
// members (tweb groupPermissions). Admins/creator are exempt; a resend of an
// already-inserted client_msg_id is exempt too (the dedupe path returns the
// existing message, slowmode must not NACK it).
func (i *Interactor) checkSendAllowed(ctx context.Context, in SendInput) error {
	if i.groups == nil {
		return nil
	}
	m, err := i.groups.GetMember(ctx, in.ChatID, in.SenderID)
	if err != nil || m.Role == domain.RoleCreator || m.Role == domain.RoleAdmin {
		return nil // membership уже проверена; админам можно всё
	}
	s, err := i.groups.Settings(ctx, in.ChatID)
	if err != nil {
		return nil
	}
	media := in.carriesMedia()
	if s.DefaultPerms&domain.PermSendMessages == 0 {
		return domain.ErrForbidden
	}
	if media && s.DefaultPerms&domain.PermSendMedia == 0 {
		return domain.ErrForbidden
	}
	// Пер-юзерное ограничение (Telegram ChatBannedRights) поверх дефолта чата:
	// запрет SendMessages блокирует любую отправку, запрет SendMedia — только
	// медиа.
	for _, perm := range []domain.MemberPerms{domain.PermSendMessages, domain.PermSendMedia} {
		if perm == domain.PermSendMedia && !media {
			continue
		}
		denied, err := i.restricted(ctx, in.ChatID, in.SenderID, perm)
		if err != nil || denied {
			return domain.ErrForbidden // сбой чтения ограничения — отказ, а не пропуск
		}
	}
	if s.SlowmodeSeconds > 0 {
		// Пачку (пересылка нескольких сообщений) в медленном режиме не отправить
		// вовсе — у оригинала SLOWMODE_MULTI_MSGS_DISABLED, tweb предупреждает
		// заранее (showSlowModeTooltipIfNeeded({sendingFew})).
		if in.batchUnits > 1 {
			return domain.ErrSlowmode
		}
		if in.ClientMsgID != "" {
			if _, e := i.msgs.FindByClientMsgID(ctx, in.ChatID, in.SenderID, in.ClientMsgID); e == nil {
				return nil // ретрай уже принятого сообщения
			}
		}
		last, grouped, size, e := i.msgs.LastMessageAt(ctx, in.ChatID, in.SenderID)
		// Альбом — одна единица: у оригинала это один вызов sendMultiMedia, наш
		// клиент шлёт элементы отдельными кадрами с общим grouped_id. Следующий
		// элемент начатого альбома проходит, пока альбом не больше предела.
		if e == nil && in.GroupedID != 0 && grouped == in.GroupedID && size < maxAlbumSize {
			return nil
		}
		if e == nil && time.Since(last) < time.Duration(s.SlowmodeSeconds)*time.Second {
			return domain.ErrSlowmode
		}
	}
	return nil
}

// maxAlbumSize — элементов в одном альбоме (Telegram: до 10 в sendMultiMedia).
const maxAlbumSize = 10

// carriesMedia — несёт ли отправка медиа в смысле запрета send_media. У
// оригинала у опроса своё право send_polls, у гео/контакта/чек-листа — свои
// подтипы send_*; гранулярных битов у нас нет (MemberPerms — пять прав),
// поэтому всё, что не текст, гейтится одним send_media. Прежде запрет медиа
// смотрел только MediaID, и опрос, гео и контакт проходили мимо него.
func (in SendInput) carriesMedia() bool {
	return in.MediaID != nil || in.PollID != nil || in.ChecklistID != nil ||
		in.GeoLat != nil || in.ContactUserID != nil
}

// ChatSettingsFor returns the chat's group settings (any member may read them).
func (i *Interactor) ChatSettingsFor(ctx context.Context, chatID, viewerID int64) (domain.ChatSettings, error) {
	ok, err := i.chats.IsMember(ctx, chatID, viewerID)
	if err != nil {
		return domain.ChatSettings{}, err
	}
	if !ok {
		return domain.ChatSettings{}, domain.ErrForbidden
	}
	return i.groups.Settings(ctx, chatID)
}

// SetChatType switches the group between private and public (tweb chatType
// tab). Только владелец (tweb hasRights 'change_type').
func (i *Interactor) SetChatType(ctx context.Context, chatID, actorID int64, isPublic bool, username string) error {
	if err := i.requireCreator(ctx, chatID, actorID); err != nil {
		return err
	}
	if err := i.groups.SetType(ctx, chatID, isPublic, username); err != nil {
		return err
	}
	i.publishChatUpdate(ctx, chatID)
	return nil
}

// CheckChatUsername — channels.checkUsername: свободно ли публичное имя для
// чата (tweb usernameInputField на вкладке chatType). Проверять вправе тот, кто
// вправе и сохранить (SetChatType — владелец); своё имя чата свободно.
// Форму имени проверяет вызывающий — тем же правилом, что и сохранение.
func (i *Interactor) CheckChatUsername(ctx context.Context, chatID, actorID int64, username string) (bool, error) {
	if err := i.requireCreator(ctx, chatID, actorID); err != nil {
		return false, err
	}
	return i.groups.UsernameAvailable(ctx, username, chatID)
}

// SetChatPermissions stores the default member permissions + slowmode (tweb
// groupPermissions; needs the admin's BAN_USERS, tweb's change_permissions).
func (i *Interactor) SetChatPermissions(ctx context.Context, chatID, actorID int64, perms domain.MemberPerms, slowmodeSeconds int) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); err != nil {
		return err
	}
	perms &= domain.AllMemberPerms
	if !slices.Contains([]int{0, 5, 10, 30, 60, 300, 900, 3600}, slowmodeSeconds) {
		slowmodeSeconds = 0
	}
	if err := i.groups.SetPermissions(ctx, chatID, perms, slowmodeSeconds); err != nil {
		return err
	}
	i.publishChatUpdate(ctx, chatID)
	return nil
}

// SetChatReactions stores the reaction policy: 'all' | 'some' (allowed list) | 'none'.
func (i *Interactor) SetChatReactions(ctx context.Context, chatID, actorID int64, mode string, allowed []string) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightChangeInfo); err != nil {
		return err
	}
	if mode != "all" && mode != "some" && mode != "none" {
		return domain.ErrBadReaction
	}
	if mode != "some" {
		allowed = nil
	}
	if len(allowed) > 64 {
		allowed = allowed[:64]
	}
	for _, e := range allowed {
		if e == "" || len(e) > maxEmojiLen || !utf8.ValidString(e) {
			return domain.ErrBadReaction
		}
	}
	if err := i.groups.SetReactions(ctx, chatID, mode, allowed); err != nil {
		return err
	}
	i.publishChatUpdate(ctx, chatID)
	return nil
}

// SetChatHistoryForNew toggles "Chat history for new members" (tweb ChatHistory).
//
// Скрыть историю нельзя у канала (у broadcast её нет: tweb показывает
// переключатель только не-broadcast) и у группы обсуждения канала — Telegram
// отвечает CHAT_LINK_EXISTS, а при привязке история открывается
// (LinkDiscussion). Иначе подписчик, вступивший первым комментарием, терял
// бы все прежние комментарии.
func (i *Interactor) SetChatHistoryForNew(ctx context.Context, chatID, actorID int64, visible bool) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightChangeInfo); err != nil {
		return err
	}
	if !visible {
		typ, err := i.chats.ChatType(ctx, chatID)
		if err != nil {
			return err
		}
		if typ == domain.ChatTypeChannel {
			return domain.ErrForbidden
		}
		linked, err := i.groups.IsDiscussionGroup(ctx, chatID)
		if err != nil {
			return err
		}
		if linked {
			return domain.ErrForbidden
		}
	}
	if err := i.groups.SetHistoryForNew(ctx, chatID, visible); err != nil {
		return err
	}
	i.publishChatUpdate(ctx, chatID)
	return nil
}

// SetChatChargeStars задаёт плату за одно сообщение в звёздах (Telegram paid
// messages); 0 — выключить. Менять может только владелец группы (creator).
func (i *Interactor) SetChatChargeStars(ctx context.Context, chatID, actorID int64, stars int) error {
	if i.groups == nil {
		return domain.ErrNotFound
	}
	m, err := i.groups.GetMember(ctx, chatID, actorID)
	if err != nil || m.Role != domain.RoleCreator {
		return domain.ErrForbidden
	}
	if stars < 0 {
		stars = 0
	}
	if stars > 10000 {
		stars = 10000
	}
	if err := i.groups.SetChargeStars(ctx, chatID, stars); err != nil {
		return err
	}
	i.publishChatUpdate(ctx, chatID)
	return nil
}

// BanMember kicks userID (if a member) and puts them on the removed-users list
// so invite links / re-adding by plain members won't let them back.
// Цель — подвластная актору (manageTarget); бан бывает и не-участнику.
func (i *Interactor) BanMember(ctx context.Context, chatID, actorID, userID int64) error {
	_, target, err := i.manageTarget(ctx, chatID, actorID, userID, domain.RightBanUsers, false)
	if err != nil {
		return err
	}
	if target.Role != "" {
		if e := i.RemoveMember(ctx, chatID, actorID, userID); e != nil {
			return e
		}
	}
	return i.groups.Ban(ctx, chatID, userID, actorID)
}

// UnbanMember removes userID from the removed-users list (they may rejoin).
func (i *Interactor) UnbanMember(ctx context.Context, chatID, actorID, userID int64) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); err != nil {
		return err
	}
	return i.groups.Unban(ctx, chatID, userID)
}

// ListBanned returns the chat's removed users (admins with BAN_USERS only).
func (i *Interactor) ListBanned(ctx context.Context, chatID, actorID int64) ([]domain.BannedUser, error) {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); err != nil {
		return nil, err
	}
	return i.groups.ListBans(ctx, chatID)
}

// RestrictMember applies a granular per-user restriction (Telegram editBanned /
// ChatBannedRights): deniedRights is a MemberPerms bitmask of what the target
// may NOT do, in effect until now+untilSeconds (untilSeconds<=0 — forever). The
// member stays in the chat (unlike a ban). Gated by the ban/restrict admin
// right; the creator can't be restricted. Announced as a `restrict` service msg.
func (i *Interactor) RestrictMember(ctx context.Context, chatID, actorID, targetID int64, deniedRights domain.MemberPerms, untilSeconds int) error {
	_, target, err := i.manageTarget(ctx, chatID, actorID, targetID, domain.RightBanUsers, true)
	if err != nil {
		return err
	}
	if target.Role == domain.RoleAdmin {
		return domain.ErrForbidden // ограничения действуют на участника; админа сперва снимают
	}
	deniedRights &= domain.AllMemberPerms
	var until *time.Time
	if untilSeconds > 0 {
		t := time.Now().Add(time.Duration(untilSeconds) * time.Second)
		until = &t
	}
	if err := i.groups.SetRestriction(ctx, domain.MemberRestriction{
		ChatID: chatID, UserID: targetID, DeniedRights: deniedRights,
		UntilDate: until, RestrictedBy: actorID,
	}); err != nil {
		return err
	}
	// Содержимое действия — сам набор запретов конструктором chatBannedRights,
	// а не битмаск `denied_rights` числом, которого не читал ни один клиент.
	// Срок ограничения там же (until_date): прежде он хранился, но наружу не
	// ехал вовсе. Нулевое время — «навсегда», ровно как у прав чата.
	var untilTime time.Time
	if until != nil {
		untilTime = *until
	}
	i.postGroupService(ctx, chatID, actorID, domain.NewMessageActionRestrict(
		targetID, domain.NewChatBannedRights(domain.AllMemberPerms&^deniedRights, untilTime)))
	return nil
}

// UnrestrictMember lifts a member's granular restriction.
func (i *Interactor) UnrestrictMember(ctx context.Context, chatID, actorID, targetID int64) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); err != nil {
		return err
	}
	return i.groups.DeleteRestriction(ctx, chatID, targetID)
}

// ListRestricted returns the chat's granularly-restricted members (admins with
// BAN_USERS only). Expired restrictions are filtered out.
func (i *Interactor) ListRestricted(ctx context.Context, chatID, actorID int64) ([]domain.MemberRestriction, error) {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); err != nil {
		return nil, err
	}
	all, err := i.groups.ListRestrictions(ctx, chatID)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	out := make([]domain.MemberRestriction, 0, len(all))
	for _, r := range all {
		if r.Active(now) {
			out = append(out, r)
		}
	}
	return out, nil
}

// DeleteGroup deletes the whole group for everyone (creator only, tweb
// «Delete and Leave Group» for the owner): every member gets a chat_removed
// frame, then the chat row (members/messages cascade) is dropped.
func (i *Interactor) DeleteGroup(ctx context.Context, chatID, actorID int64) error {
	m, err := i.groups.GetMember(ctx, chatID, actorID)
	if err != nil {
		return domain.ErrForbidden
	}
	if m.Role != domain.RoleCreator {
		return domain.ErrForbidden
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return err
	}
	slices.Sort(members)
	// chat_removed бывает только у группы/канала — приватный диалог не
	// «удаляется», поэтому ключ пира здесь один на всех: -chatID.
	payload := map[string]any{"_": domain.UpdateChatRemovedTag,
		"peer": domain.NewPeer(domain.ToPeerID(chatID, true))}
	ptsByUser := map[int64]int64{}
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if i.updates != nil {
			b, e := json.Marshal(payload)
			if e != nil {
				return e
			}
			date := nowMillis()
			for _, uid := range members {
				pts, e := i.updates.AppendUpdate(ctx, uid, 1, date, "chat_removed", b)
				if e != nil {
					return e
				}
				ptsByUser[uid] = pts
			}
		}
		return i.groups.DeleteChat(ctx, chatID)
	})
	if err != nil {
		return err
	}
	if i.publisher != nil {
		for _, uid := range members {
			if pts, ok := ptsByUser[uid]; ok {
				_ = i.publisher.PublishToUser(ctx, uid, framePts("chat_removed", payload, pts))
			} else {
				_ = i.publisher.PublishToUser(ctx, uid, frame("chat_removed", payload))
			}
		}
	}
	return nil
}
