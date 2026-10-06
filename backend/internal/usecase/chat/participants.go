package chat

import (
	"context"
	"encoding/json"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Участники и права зрителя (Ф-3б, Б-115/Б-86/Б-84, A2-05/A2-06/A2-07).
//
// Мутации состава и прав — Ф-1б (admit, manageTarget, memberCan); здесь то,
// что ПОСЛЕ них: кадры участника (updateChannelParticipant), заявок
// (updatePendingJoinRequests) и пер-зрительский снимок чата затронутому, плюс
// выборки channels.getParticipants/getParticipant/messages.getOnlines.

// ParticipantsPage — страница channels.channelParticipants: конструкторы глазами
// зрителя, всего по фильтру и чьи карточки нужны вектору users.
type ParticipantsPage struct {
	Participants []domain.ChannelParticipant
	Count        int
	UserIDs      []int64
}

// requireParticipantsView — кто вправе смотреть состав (tweb hasRights
// view_participants): broadcast-канал — только владелец и админы (иначе
// CHAT_ADMIN_REQUIRED); группа — читатель, а группу обсуждения ещё и
// подписчик канала, не забаненный в ней (RequireDiscussionRead). Удалённых и
// ограниченных — только админ с ban_users.
func (i *Interactor) requireParticipantsView(ctx context.Context, chatID, viewerID int64, kind domain.ParticipantsFilterKind) (domain.ChatAccess, error) {
	a, err := i.chats.Access(ctx, chatID, viewerID)
	if err != nil {
		return a, err
	}
	if kind == domain.ParticipantsKicked || kind == domain.ParticipantsBanned {
		return a, i.requireRight(ctx, chatID, viewerID, domain.RightBanUsers)
	}
	if a.Type == domain.ChatTypeChannel && !a.IsAdmin() {
		return a, domain.ErrForbidden
	}
	if !a.CanRead() && i.RequireDiscussionRead(ctx, chatID, viewerID) != nil {
		return a, domain.ErrForbidden
	}
	return a, nil
}

// ListParticipants — channels.getParticipants: страница по фильтру и ВСЕГО по
// фильтру (count — не длина страницы, A4-07). «Недавние» — свежие сверху,
// админы — отдельным фильтром, создатель первым (A6-06).
func (i *Interactor) ListParticipants(ctx context.Context, chatID, viewerID int64, f domain.ParticipantsFilter, offset, limit int) (ParticipantsPage, error) {
	if !f.Kind.Valid() {
		f.Kind = domain.ParticipantsRecent
	}
	a, err := i.requireParticipantsView(ctx, chatID, viewerID, f.Kind)
	if err != nil {
		return ParticipantsPage{}, err
	}
	rows, total, err := i.groups.ListParticipants(ctx, chatID, viewerID, f, offset, limit)
	if err != nil {
		return ParticipantsPage{}, err
	}
	v := i.participantViewer(ctx, chatID, viewerID, a)
	page := ParticipantsPage{Count: total, Participants: make([]domain.ChannelParticipant, 0, len(rows))}
	for _, p := range rows {
		page.Participants = append(page.Participants, p.ToChannelParticipant(v))
	}
	// Карточки — по ССЫЛКАМ самого провода (domain.CollectPeerRefs, сборщик
	// векторов Ф-3а): user_id/peer строки, promoted_by, inviter_id, kicked_by.
	// Что маскировано для зрителя (кем ограничен или исключён), в теле не
	// названо — и в вектор не попадает (ревью #409 п. 5).
	page.UserIDs = domain.CollectPeerRefs(page.Participants).Users
	return page, nil
}

// GetParticipant — channels.getParticipant. Себя видит любой читатель;
// другого — тот, кому виден состав; удалённого — только админ с ban_users.
// Не участник и не удалённый — domain.ErrNotFound (USER_NOT_PARTICIPANT).
func (i *Interactor) GetParticipant(ctx context.Context, chatID, viewerID, userID int64) (domain.ChannelParticipant, []int64, error) {
	var a domain.ChatAccess
	var err error
	if userID == viewerID {
		a, err = i.chats.Access(ctx, chatID, viewerID)
		if err == nil && !a.CanRead() && i.RequireDiscussionRead(ctx, chatID, viewerID) != nil {
			err = domain.ErrForbidden
		}
	} else {
		a, err = i.requireParticipantsView(ctx, chatID, viewerID, domain.ParticipantsRecent)
	}
	if err != nil {
		return nil, nil, err
	}
	p, err := i.groups.GetParticipant(ctx, chatID, userID)
	if err != nil {
		return nil, nil, err
	}
	if p.Kicked && userID != viewerID && i.requireRight(ctx, chatID, viewerID, domain.RightBanUsers) != nil {
		return nil, nil, domain.ErrNotFound
	}
	v := i.participantViewer(ctx, chatID, viewerID, a)
	wire := p.ToChannelParticipant(v)
	return wire, domain.CollectPeerRefs(wire).Users, nil
}

// participantViewer — зритель выдачи: создатель ли он и есть ли у него
// ban_users (только ему видны чужие ограничения).
func (i *Interactor) participantViewer(ctx context.Context, chatID, viewerID int64, a domain.ChatAccess) domain.ParticipantViewer {
	return domain.ParticipantViewer{
		ID:        viewerID,
		IsCreator: a.Member && a.Role == domain.RoleCreator,
		CanBan:    a.Member && i.requireRight(ctx, chatID, viewerID, domain.RightBanUsers) == nil,
	}
}

// OnlineCandidates — messages.getOnlines: гейт и загрузчик состава, по
// которому считать онлайн. Загрузчик ленивый: при свежем серверном кэше
// (presence, 60 с) состав из базы не читается вовсе (ревью #404 п. 8).
// broadcast — у канала онлайн не считается (tweb getOnlines: канал → 1).
// Гейт — как у списка участников.
func (i *Interactor) OnlineCandidates(ctx context.Context, chatID, viewerID int64) (load func(context.Context) ([]int64, error), broadcast bool, err error) {
	a, err := i.chats.Access(ctx, chatID, viewerID)
	if err != nil {
		return nil, false, err
	}
	if a.Type == domain.ChatTypeChannel {
		if !a.CanRead() {
			return nil, false, domain.ErrForbidden
		}
		return nil, true, nil
	}
	if !a.CanRead() && i.RequireDiscussionRead(ctx, chatID, viewerID) != nil {
		return nil, false, domain.ErrForbidden
	}
	return func(ctx context.Context) ([]int64, error) { return i.chats.MemberIDs(ctx, chatID) }, false, nil
}

// viewerCounters — счётчики участников, положенные зрителю (Б-115): число
// админов — тому, кому виден состав; удалённые и ограниченные — админу с
// ban_users; заявки — админу с invite_users. nil — зритель не участник.
func (i *Interactor) viewerCounters(ctx context.Context, c domain.ChatRecord) *domain.ParticipantCounters {
	if c.ViewerID == 0 || c.MyRole == "" || i.groups == nil {
		return nil
	}
	if c.Type != domain.ChatTypeGroup && c.Type != domain.ChatTypeChannel {
		return nil
	}
	isAdmin := c.MyRole == domain.RoleCreator || c.MyRole == domain.RoleAdmin
	k := &domain.ParticipantCounters{CanViewParticipants: c.Type == domain.ChatTypeGroup || isAdmin}
	admins, kicked, banned, err := i.groups.ParticipantCounters(ctx, c.ID)
	if err != nil {
		return nil
	}
	if k.CanViewParticipants {
		k.Admins = admins
	}
	if domain.HasRight(c.MyRole, c.MyRights, domain.RightBanUsers) {
		k.Kicked, k.Banned = &kicked, &banned
	}
	if i.joinReqs != nil && domain.HasRight(c.MyRole, c.MyRights, domain.RightInviteUsers) {
		if n, recent, e := i.joinReqs.Pending(ctx, c.ID); e == nil {
			k.RequestsPending, k.RecentRequesters = &n, recent
		}
	}
	return k
}

// viewerCard — карточка чата глазами зрителя со счётчиками: то же, что отдаёт
// ручка карточки, и то, что уходит затронутому пер-зрительским снимком.
func (i *Interactor) viewerCard(ctx context.Context, chatID, viewerID int64) (domain.ChatRecord, error) {
	c, err := i.groups.Card(ctx, chatID, viewerID)
	if err != nil {
		return c, err
	}
	c.Counters = i.viewerCounters(ctx, c)
	return c, nil
}

// publishViewerChat — пер-зрительский (НЕ min) снимок чата в журнал
// затронутого: его admin_rights после повышения и banned_rights после
// ограничения (A2-05). Общий chat_update — min без зрителя, и клиент на нём
// сохраняет прежние права, поэтому новый админ не видел своих прав, а
// ограниченный — запрета, до перезагрузки. У оригинала это updateChannel с
// полным channel зрителя. Best-effort.
func (i *Interactor) publishViewerChat(ctx context.Context, chatID, userID int64) {
	if i.groups == nil {
		return
	}
	c, err := i.viewerCard(ctx, chatID, userID)
	if err != nil {
		return
	}
	_ = i.logAndPublishPerPeer(ctx, chatID, []int64{userID}, "chat_update",
		func(peer domain.PeerID) map[string]any { return chatUpdatePayload(peer, c) })
}

// participantNow — участник сейчас (nil — не участник и не удалён).
func (i *Interactor) participantNow(ctx context.Context, chatID, userID int64) *domain.Participant {
	if i.groups == nil {
		return nil
	}
	p, err := i.groups.GetParticipant(ctx, chatID, userID)
	if err != nil {
		return nil
	}
	return &p
}

// participantChange — смена участника для кадра updateChannelParticipant.
// prev/next — строки до и после (nil — «не было» / «больше нет»); nextLeft —
// ушёл или исключён без бана (channelParticipantLeft).
type participantChange struct {
	prev, next *domain.Participant
	nextLeft   bool
	invite     *domain.ChatInviteExported
}

func (c participantChange) wire(p *domain.Participant, v domain.ParticipantViewer) domain.ChannelParticipant {
	if p == nil {
		return nil
	}
	return p.ToChannelParticipant(v)
}

// emitParticipant — кадр updateChannelParticipant затронутому, актору и
// админам чата. Устройство актора, применившее смену местным апдейтом (tweb
// generateUpdateChannelParticipant), отбрасывает серверный дубль в воркере
// (groupsManager.isLocalParticipantEcho); прочие его устройства кадр получают. Чужое личное ограничение в
// кадре видят только админы с ban_users и сам затронутый; остальным строка —
// обычный участник (как в выдаче участников, ревью #404 п. 2). Выбывший кадр
// не получает: ему адресован chat_removed. Best-effort — мутация уже
// закоммичена.
func (i *Interactor) emitParticipant(ctx context.Context, chatID, actorID, userID int64, ch participantChange) {
	if i.groups == nil {
		return
	}
	staff, _, err := i.groups.ListParticipants(ctx, chatID, 0, domain.ParticipantsFilter{Kind: domain.ParticipantsAdmins}, 0, 200)
	if err != nil {
		return
	}
	var full, masked []int64
	seen := map[int64]bool{}
	add := func(id int64, canBan bool) {
		if id == 0 || seen[id] {
			return
		}
		seen[id] = true
		if canBan {
			full = append(full, id)
		} else {
			masked = append(masked, id)
		}
	}
	member := false
	if _, e := i.groups.GetMember(ctx, chatID, userID); e == nil {
		member = true
		add(userID, true) // своё ограничение затронутый видит
	}
	for _, p := range staff {
		if p.UserID == userID && !member {
			continue
		}
		add(p.UserID, domain.HasRight(p.Role, p.Rights, domain.RightBanUsers))
	}
	if actorID != userID || member {
		add(actorID, false)
	}
	body := func(v domain.ParticipantViewer) map[string]any {
		var next domain.ChannelParticipant = ch.wire(ch.next, v)
		if ch.nextLeft {
			next = domain.NewChannelParticipantLeft(userID)
		}
		return structPayload(domain.NewUpdateChannelParticipant(chatID, actorID, userID, time.Now(),
			ch.wire(ch.prev, v), next, ch.invite))
	}
	if len(full) > 0 {
		b := body(domain.ParticipantViewer{CanBan: true})
		_ = i.logAndPublishPerPeer(ctx, chatID, full, "chat_participant",
			func(domain.PeerID) map[string]any { return b })
	}
	if len(masked) > 0 {
		b := body(domain.ParticipantViewer{})
		_ = i.logAndPublishPerPeer(ctx, chatID, masked, "chat_participant",
			func(domain.PeerID) map[string]any { return b })
	}
}

// emitPendingRequests — кадр updatePendingJoinRequests админам с invite_users
// (плашка заявок в шапке и строка «Заявки» редактора, Б-86/A2-06).
func (i *Interactor) emitPendingRequests(ctx context.Context, chatID int64) {
	if i.groups == nil || i.joinReqs == nil {
		return
	}
	n, recent, err := i.joinReqs.Pending(ctx, chatID)
	if err != nil {
		return
	}
	staff, _, err := i.groups.ListParticipants(ctx, chatID, 0, domain.ParticipantsFilter{Kind: domain.ParticipantsAdmins}, 0, 200)
	if err != nil {
		return
	}
	var recipients []int64
	for _, p := range staff {
		if domain.HasRight(p.Role, p.Rights, domain.RightInviteUsers) {
			recipients = append(recipients, p.UserID)
		}
	}
	_ = i.logAndPublishPerPeer(ctx, chatID, recipients, "pending_join_requests",
		func(peer domain.PeerID) map[string]any {
			return structPayload(domain.NewUpdatePendingJoinRequests(domain.NewPeer(peer), n, recent))
		})
}

// structPayload — тело кадра из конструктора: журнал и веер принимают словарь
// (framePts решает по нему, где ехать курсору).
func structPayload(v any) map[string]any {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	var m map[string]any
	if json.Unmarshal(b, &m) != nil {
		return nil
	}
	return m
}
