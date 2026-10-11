package chat

import (
	"context"
	"encoding/json"
	"log"
	"slices"
	"sync"
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
	// Публикация отложенного медленный режим не проходит: он проверен при
	// постановке (В-2, tweb input.ts:4587-4593 — без оглядки на scheduleDate).
	if s.SlowmodeSeconds > 0 && !in.fromSchedule {
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
		// элемент начатого альбома проходит, пока альбом не больше предела
		// (размер считается со снятыми элементами) и пока он догружается (окно
		// albumWindow от предыдущего элемента) — иначе общий ключ превращался
		// бы в постоянный обход медленного режима. Ключ альбома бывает только
		// у медиа (Send сбрасывает его у прочего).
		if e == nil && in.GroupedID != 0 && in.MediaID != nil && grouped == in.GroupedID &&
			size < maxAlbumSize && time.Since(last) < albumWindow {
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

// albumWindow — сколько после предыдущего элемента ещё ждём следующий элемент
// того же альбома (кадры одной отправки идут подряд, медиа уже загружено).
const albumWindow = 30 * time.Second

// carriesMedia — несёт ли отправка медиа в смысле запрета send_media. У
// оригинала у опроса своё право send_polls, у гео/контакта/чек-листа — свои
// подтипы send_*; гранулярных битов у нас нет (MemberPerms — пять прав),
// поэтому всё, что не текст, гейтится одним send_media. Прежде запрет медиа
// смотрел только MediaID, и опрос, гео и контакт проходили мимо него.
func (in SendInput) carriesMedia() bool {
	return in.MediaID != nil || in.PollID != nil || in.ChecklistID != nil ||
		in.GeoLat != nil || in.ContactUserID != nil || in.GiveawayID != nil
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
	before, err := i.groups.Settings(ctx, chatID)
	if err != nil {
		return err
	}
	if err := i.groups.SetPermissions(ctx, chatID, perms, slowmodeSeconds); err != nil {
		return err
	}
	i.publishChatUpdate(ctx, chatID)
	// banned_rights ограниченного — объединение с правами по умолчанию
	// (ViewerBannedRights), а общий снимок min, и клиент на нём прежний
	// banned_rights сохраняет. Ограниченным — свой снимок; фоном, не в запросе.
	if before.DefaultPerms != perms {
		i.scheduleRepublish(chatID)
	}
	return nil
}

// republishTimeout — потолок одного прохода фоновой рассылки ограниченным.
const republishTimeout = 5 * time.Minute

// republishRuns — фоновые рассылки снимков ограниченным, по одной на чат:
// running — проход идёт; dirty — права по умолчанию сменились ещё раз, и по
// окончании прохода он начнётся заново (новый замещает старый, а не идёт
// рядом с ним — иначе снимок по прежним правам мог доехать последним).
type republishRuns struct {
	mu    sync.Mutex
	chats map[int64]*republishRun
}

type republishRun struct{ dirty bool }

// scheduleRepublish — запустить рассылку по чату или пометить идущую
// «грязной» (ревью #411 п. 1).
func (i *Interactor) scheduleRepublish(chatID int64) {
	r := &i.republish
	r.mu.Lock()
	if r.chats == nil {
		r.chats = map[int64]*republishRun{}
	}
	if run, ok := r.chats[chatID]; ok {
		run.dirty = true
		r.mu.Unlock()
		return
	}
	r.chats[chatID] = &republishRun{}
	r.mu.Unlock()
	i.goBG("republishRestricted", func(ctx context.Context) {
		for {
			pctx, cancel := context.WithTimeout(ctx, republishTimeout)
			i.republishRestricted(pctx, chatID)
			cancel()
			r.mu.Lock()
			run := r.chats[chatID]
			if !run.dirty {
				delete(r.chats, chatID)
				r.mu.Unlock()
				return
			}
			run.dirty = false
			r.mu.Unlock()
		}
	})
}

// republishRestricted — пер-зрительский снимок каждому лично ограниченному
// после смены прав чата по умолчанию. Обход — ключевым курсором по user_id
// (снятие ограничений во время обхода страниц не сдвигает), а снимок каждому
// собирается по ТЕКУЩЕМУ состоянию в момент отправки (publishViewerChatErr):
// снятое посреди прохода ограничение старых запретов не вернёт. Ошибки — в
// лог: недоставленный снимок иначе пропал бы молча.
func (i *Interactor) republishRestricted(ctx context.Context, chatID int64) {
	const page = 200
	var after int64
	for ctx.Err() == nil {
		ids, err := i.groups.RestrictedMemberIDs(ctx, chatID, after, page)
		if err != nil {
			log.Printf("chat: рассылка ограниченным чата %d: страница после %d: %v", chatID, after, err)
			return
		}
		for _, uid := range ids {
			if err := i.publishViewerChatErr(ctx, chatID, uid); err != nil {
				log.Printf("chat: рассылка ограниченным чата %d: снимок %d не ушёл: %v", chatID, uid, err)
			}
			after = uid
		}
		if len(ids) < page {
			return
		}
	}
	if err := ctx.Err(); err != nil {
		log.Printf("chat: рассылка ограниченным чата %d прервана после %d: %v", chatID, after, err)
	}
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
	prev := i.participantNow(ctx, chatID, userID)
	if target.Role != "" {
		if prev, err = i.removeMember(ctx, chatID, actorID, userID); err != nil {
			return err
		}
	}
	if err := i.groups.Ban(ctx, chatID, userID, actorID); err != nil {
		return err
	}
	// Кадр участника админам (A2-05): список удалённых у них живой.
	i.emitParticipant(ctx, chatID, actorID, userID, participantChange{prev: prev, next: i.participantNow(ctx, chatID, userID)})
	return nil
}

// UnbanMember removes userID from the removed-users list (they may rejoin).
func (i *Interactor) UnbanMember(ctx context.Context, chatID, actorID, userID int64) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); err != nil {
		return err
	}
	prev := i.participantNow(ctx, chatID, userID)
	if err := i.groups.Unban(ctx, chatID, userID); err != nil {
		return err
	}
	// Разбан — new_participant нет: из списка удалённых ушёл (A2-05).
	i.emitParticipant(ctx, chatID, actorID, userID, participantChange{prev: prev, next: i.participantNow(ctx, chatID, userID)})
	return nil
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
	prev := i.participantNow(ctx, chatID, targetID)
	if err := i.groups.SetRestriction(ctx, domain.MemberRestriction{
		ChatID: chatID, UserID: targetID, DeniedRights: deniedRights,
		UntilDate: until, RestrictedBy: actorID,
	}); err != nil {
		return err
	}
	// Служебки в ленте нет: у оригинала ограничение уходит только в журнал
	// администратора (channelAdminLogEventActionParticipantToggleBan), а
	// пилюля в общей ленте раскрывала бы всем читателям цель, автора, запреты
	// и срок (ревью #409 п. 1).
	// Ограниченный видит запрет живьём (скрепка гаснет), админы — список
	// ограниченных (A2-05, A1-06).
	i.afterRightsChange(ctx, chatID, actorID, targetID, prev)
	return nil
}

// UnrestrictMember lifts a member's granular restriction.
func (i *Interactor) UnrestrictMember(ctx context.Context, chatID, actorID, targetID int64) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); err != nil {
		return err
	}
	prev := i.participantNow(ctx, chatID, targetID)
	if err := i.groups.DeleteRestriction(ctx, chatID, targetID); err != nil {
		return err
	}
	i.afterRightsChange(ctx, chatID, actorID, targetID, prev)
	return nil
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
			date := nowUnix()
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
	// Чат пропал из списка у всех участников — их снимки диалогов устарели.
	i.invalidateDialogs(ctx, members...)
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
