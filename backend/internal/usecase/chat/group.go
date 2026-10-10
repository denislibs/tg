package chat

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// tokenGen is overridable in tests.
var tokenGen = func() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (i *Interactor) requireRight(ctx context.Context, chatID, userID int64, r domain.Rights) error {
	if i.groups == nil {
		return domain.ErrForbidden // no group repo (e.g. private chat) ⇒ no admin rights
	}
	m, err := i.groups.GetMember(ctx, chatID, userID)
	if err != nil {
		return domain.ErrForbidden // not a member ⇒ forbidden
	}
	if !domain.HasRight(m.Role, m.Rights, r) {
		return domain.ErrForbidden
	}
	return nil
}

// postGroupService кладёт служебное сообщение обычным путём Send (seq, журнал
// обновлений, live-веер каждому участнику). Заодно это сигнал «чат появился»:
// только что добавленный участник получает кадр незнакомого чата и
// перезапрашивает диалоги. Best-effort — само изменение состава уже
// закоммичено.
//
// Действие едет КОНСТРУКТОРОМ (schema messageService.action). Прежде здесь
// собирался JSON `{"action": …, "actor_id": …}` и клался в ТЕКСТ, а клиент
// опознавал его по `raw.startsWith('{')` — дискриминатор был подделан дважды.
// actor_id из действия при этом ушёл целиком: автор служебного сообщения и так
// известен, он from_id.
//
// Состав ВЕЩАТЕЛЬНОГО канала служебками не пишется: «вступил», «вышел»,
// «добавил», «исключил» в ленте канала раскрыли бы каждому подписчику, кто
// подписан. Сервер Telegram их там не шлёт (список подписчиков видят только
// админы), а «Вы вступили» tweb рисует локально (insertChannelJoinedService,
// appMessagesManager.ts:9717-9775). Каналу хватает chat_update (число
// подписчиков) и chat_removed выбывшему — их шлют сами мутации состава.
func (i *Interactor) postGroupService(ctx context.Context, chatID, actorID int64, action domain.MessageAction) {
	if i.msgs == nil || i.updates == nil {
		return // wired without a message pipeline (some unit-test setups)
	}
	if isMembershipAction(action) {
		if typ, err := i.chats.ChatType(ctx, chatID); err != nil || typ == domain.ChatTypeChannel {
			return
		}
	}
	_, _ = i.Send(ctx, SendInput{ChatID: chatID, SenderID: actorID, Action: action})
}

// isMembershipAction — служебное действие о СОСТАВЕ чата (кто вошёл или вышел).
func isMembershipAction(a domain.MessageAction) bool {
	switch a.(type) {
	case domain.MessageActionChatAddUser, domain.MessageActionChatDeleteUser, domain.MessageActionChatJoinedByLink,
		domain.MessageActionChatJoinedByRequest:
		return true
	}
	return false
}

// postGroupServiceMedia — postGroupService для действий, несущих фото
// (messageActionChatEditPhoto): аватарка висит на media_id служебного
// сообщения, а на провод уезжает ВНУТРИ действия конструктором photo. Медиа
// обязано принадлежать актору (Send это перепроверяет).
func (i *Interactor) postGroupServiceMedia(ctx context.Context, chatID, actorID, mediaID int64, action domain.MessageAction) {
	if i.msgs == nil || i.updates == nil {
		return // wired without a message pipeline (some unit-test setups)
	}
	mid := mediaID
	_, _ = i.Send(ctx, SendInput{ChatID: chatID, SenderID: actorID, Action: action, MediaID: &mid})
}

// userCard looks up a user for service-message attribution (zero card on miss).
// Карточка БЕЗ зрителя (профильное имя): её имя замораживается в снимок,
// который читают все получатели, а не один.
func (i *Interactor) userCard(ctx context.Context, id int64) domain.UserReal {
	if i.groups == nil {
		return domain.NewUser(id, domain.UserFlags{})
	}
	us, err := i.groups.UsersByIDs(ctx, 0, []int64{id})
	if err != nil || len(us) == 0 {
		return domain.NewUser(id, domain.UserFlags{})
	}
	return us[0]
}

// CreateGroup creates a group chat with the creator plus memberIDs and posts the
// "created the group" service message (which fans out live to every member).
//
// missing — позванные, чья настройка «Кто может приглашать меня в группы»
// (или чёрный список) не пускает создателя: их не добавляют, а отдают назад —
// `missing_invitees` ответа `messages.createChat` у оригинала
// (`messages.invitedUsers`). Правило то же, что у AddMember: создание группы с
// участниками — не обход настройки, которую добавление в готовую соблюдает.
func (i *Interactor) CreateGroup(ctx context.Context, creatorID int64, title, about, username string, isPublic bool, memberIDs []int64) (int64, []int64, error) {
	var chatID int64
	invitees, missing, err := i.splitInvitees(ctx, creatorID, memberIDs)
	if err != nil {
		return 0, nil, err
	}
	// added — те, кто РЕАЛЬНО добавлен: без создателя и без повторов. Именно
	// они уезжают в messageActionChatCreate.users; сырой memberIDs отдал бы
	// клиенту список, которого в чате нет.
	var added []int64
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		id, e := i.groups.CreateMultiMember(ctx, domain.ChatTypeGroup, title, about, username, isPublic, creatorID)
		if e != nil {
			return e
		}
		chatID = id
		if e := i.groups.AddMember(ctx, id, creatorID, domain.RoleCreator, domain.AllRights); e != nil {
			return e
		}
		added = added[:0]
		seen := map[int64]bool{creatorID: true}
		for _, uid := range invitees {
			if seen[uid] {
				continue
			}
			seen[uid] = true
			if e := i.groups.AddMember(ctx, id, uid, domain.RoleMember, 0); e != nil {
				return e
			}
			added = append(added, uid)
		}
		return nil
	})
	if err != nil {
		return 0, nil, err
	}
	// Primary-инвайт существует у группы с рождения (tweb exported_invite).
	if i.invites != nil {
		_, _ = i.invites.Create(ctx, chatID, creatorID, tokenGen(), "", nil, false, nil)
	}
	// Название и позванные сразу участники — параметры конструктора: прежде в
	// действии ехал один actor_id, и пилюля читалась «Имя создал(а) группу» без
	// названия и без списка.
	i.postGroupService(ctx, chatID, creatorID, domain.NewMessageActionChatCreate(title, added))
	return chatID, missing, nil
}

// splitInvitees делит позванных на тех, кого настройка приватности пускает, и
// тех, кого нет (missing). Без PrivacyChecker ограничений нет — как у AddMember.
func (i *Interactor) splitInvitees(ctx context.Context, actorID int64, userIDs []int64) (allowed, missing []int64, err error) {
	if i.privacy == nil {
		return userIDs, nil, nil
	}
	for _, uid := range userIDs {
		if uid == actorID {
			allowed = append(allowed, uid)
			continue
		}
		ok, err := i.privacy.Check(ctx, uid, actorID, domain.PrivacyChatInvite)
		if err != nil {
			return nil, nil, err
		}
		if ok {
			allowed = append(allowed, uid)
		} else {
			missing = append(missing, uid)
		}
	}
	return allowed, missing, nil
}

func (i *Interactor) AddMember(ctx context.Context, chatID, actorID, userID int64) error {
	// Обычному участнику добавление разрешает дефолтное право группы, админу —
	// RightInviteUsers (tweb invite_users).
	if err := i.requirePermOrRight(ctx, chatID, actorID, domain.PermAddMembers, domain.RightInviteUsers); err != nil {
		return err
	}
	joined, err := i.admit(ctx, chatID, userID, actorID, admitAdded)
	if err != nil || !joined {
		return err
	}
	i.announceChannelJoin(ctx, chatID, userID)
	_ = i.groups.SetJoinInfo(ctx, chatID, userID, actorID, false)
	targetID := userID
	i.postGroupService(ctx, chatID, actorID, domain.NewMessageActionChatAddUser([]int64{targetID}))
	// Число участников изменилось — рассылаем свежий снимок метаданных чата.
	i.publishChatUpdate(ctx, chatID)
	i.emitParticipant(ctx, chatID, actorID, userID, participantChange{next: i.participantNow(ctx, chatID, userID)})
	return nil
}

// RemoveMember kicks userID (needs BAN_USERS) or self-leave (actor == userID).
// The service message is posted BEFORE the row is deleted so the leaving/kicked
// user still receives the fan-out; afterwards a chat_removed frame tells their
// clients to drop the dialog.
func (i *Interactor) RemoveMember(ctx context.Context, chatID, actorID, userID int64) error {
	prev, err := i.removeMember(ctx, chatID, actorID, userID)
	if err != nil {
		return err
	}
	// Кадр участника админам и актору (выбывшему — chat_removed): ушёл сам или
	// исключён без бана — channelParticipantLeft.
	i.emitParticipant(ctx, chatID, actorID, userID, participantChange{prev: prev, nextLeft: true})
	return nil
}

// removeMember — тело RemoveMember без кадра участника: бан (BanMember) шлёт
// свой, с channelParticipantBanned. prev — участник до выхода.
func (i *Interactor) removeMember(ctx context.Context, chatID, actorID, userID int64) (*domain.Participant, error) {
	// Из лички и «Избранного» не выходят: «удалить чат» там — DeleteDialog
	// (tweb deleteDialog.ts → flushHistory). Прежде выход из лички слал
	// собеседнику «удалил из группы», а следующее сообщение заводило второй
	// приватный чат.
	if typ, err := i.chats.ChatType(ctx, chatID); err != nil {
		return nil, err
	} else if typ == domain.ChatTypePrivate || typ == domain.ChatTypeSaved {
		return nil, domain.ErrInvalid
	}
	if actorID != userID {
		// Кик — над подвластной целью: не владелец, чужой админ — только
		// владельцем или назначившим (manageTarget).
		if _, _, err := i.manageTarget(ctx, chatID, actorID, userID, domain.RightBanUsers, true); err != nil {
			return nil, err
		}
	}
	if _, err := i.groups.GetMember(ctx, chatID, userID); err != nil {
		return nil, err // not a member — nothing to remove, no service message
	}
	prev := i.participantNow(ctx, chatID, userID)
	// «Вышел сам» и «выгнали» — ОДИН конструктор: различие выводит клиент по
	// совпадению from_id с user_id, ровно как appMessagesManager уточняет его до
	// синтетического messageActionChatLeave. Сервер сообщает ФАКТ, формулировку
	// выбирает клиент.
	i.postGroupService(ctx, chatID, actorID, domain.NewMessageActionChatDeleteUser(userID))
	// chat_removed бывает только у группы/канала — приватный диалог не
	// «удаляется», поэтому ключ пира здесь один на всех: -chatID.
	payload := map[string]any{"_": domain.UpdateChatRemovedTag,
		"peer": domain.NewPeer(domain.ToPeerID(chatID, true))}
	var pts int64
	var havePts bool
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if e := i.groups.RemoveMember(ctx, chatID, userID); e != nil {
			return e
		}
		// Упоминания выбывшего снимаются: при повторном вступлении старые «@»
		// не возвращаются в счётчик и в «к следующему @».
		if e := i.chats.DropUserMentions(ctx, chatID, userID); e != nil {
			return e
		}
		if i.updates != nil {
			b, e := json.Marshal(payload)
			if e != nil {
				return e
			}
			p, e := i.updates.AppendUpdate(ctx, userID, 1, nowUnix(), "chat_removed", b)
			if e != nil {
				return e
			}
			pts, havePts = p, true
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	// Строка списка выбывшего пропала — сбрасываем его снимок диалогов
	// (оставшимся сбросит кадр chat_update ниже).
	i.invalidateDialogs(ctx, userID)
	// Число участников изменилось — снимок метаданных оставшимся участникам
	// (выбывший их не получает; ему адресован chat_removed ниже, он же последний).
	i.publishChatUpdate(ctx, chatID)
	if i.publisher != nil {
		if havePts {
			_ = i.publisher.PublishToUser(ctx, userID, framePts("chat_removed", payload, pts))
		} else {
			_ = i.publisher.PublishToUser(ctx, userID, frame("chat_removed", payload))
		}
	}
	return prev, nil
}

// PromoteAdmin назначает (или правит) админа (channels.editAdmin). Цель —
// подвластный участник (manageTarget); выдавать можно только то, что есть у
// самого актора (кроме владельца) — у Telegram RIGHT_FORBIDDEN. Назначивший
// запоминается: править этого админа дальше сможет он и владелец.
//
// rank — подпись (Б-117); nil — не менять: клиент без поля (сборка до Ф-3б из
// кэша сервис-воркера) иначе стирал бы подпись при любой правке прав.
// Владелец правит только СВОЮ подпись: роль и права у него неизменны (tweb
// canEditAdmin даёт создателю править себя, поле Chat.OwnerBadge).
func (i *Interactor) PromoteAdmin(ctx context.Context, chatID, actorID, userID int64, rights domain.Rights, rank *string) error {
	if actorID == userID {
		return i.setOwnRank(ctx, chatID, actorID, rank)
	}
	actor, target, err := i.manageTarget(ctx, chatID, actorID, userID, domain.RightManageAdmins, true)
	if err != nil {
		return err
	}
	rights &= domain.AllRights
	if actor.Role != domain.RoleCreator && rights&^actor.Rights != 0 {
		return domain.ErrForbidden
	}
	promotedBy := actorID
	if target.Role == domain.RoleAdmin && target.PromotedBy != 0 {
		promotedBy = target.PromotedBy // правка прав не переназначает админа
	}
	prev := i.participantNow(ctx, chatID, userID)
	if err := i.groups.SetRole(ctx, chatID, userID, domain.RoleAdmin, rights, promotedBy); err != nil {
		return err
	}
	// Повышение снимает личные ограничения, как у Telegram: иначе после
	// разжалования прежнее ограничение «воскресло» бы (ревью #404 п. 11).
	if err := i.groups.DeleteRestriction(ctx, chatID, userID); err != nil {
		return err
	}
	if rank != nil {
		// Подпись админа (channels.editAdmin rank, Б-117): у Telegram до 16 знаков.
		if err := i.groups.SetRank(ctx, chatID, userID, clipRank(*rank)); err != nil {
			return err
		}
	}
	i.publishChatUpdate(ctx, chatID) // состав админов изменился
	i.afterRightsChange(ctx, chatID, actorID, userID, prev)
	return nil
}

// setOwnRank — владелец задаёт себе подпись (ревью #404 п. 5). Кроме
// владельца себя не правит никто (manageTarget).
func (i *Interactor) setOwnRank(ctx context.Context, chatID, actorID int64, rank *string) error {
	if err := i.requireCreator(ctx, chatID, actorID); err != nil {
		return err
	}
	if rank == nil {
		return nil
	}
	prev := i.participantNow(ctx, chatID, actorID)
	if err := i.groups.SetRank(ctx, chatID, actorID, clipRank(*rank)); err != nil {
		return err
	}
	i.afterRightsChange(ctx, chatID, actorID, actorID, prev)
	return nil
}

// clipRank — подпись админа не длиннее 16 символов (Telegram ADMIN_RANK_INVALID).
func clipRank(rank string) string {
	r := []rune(strings.TrimSpace(rank))
	if len(r) > 16 {
		r = r[:16]
	}
	return string(r)
}

// afterRightsChange — права участника сменились (повышение, снятие,
// ограничение): кадр участника актору и админам и пер-зрительский снимок
// чата самому затронутому — его новые admin_rights/banned_rights (A2-05).
func (i *Interactor) afterRightsChange(ctx context.Context, chatID, actorID, userID int64, prev *domain.Participant) {
	i.emitParticipant(ctx, chatID, actorID, userID, participantChange{prev: prev, next: i.participantNow(ctx, chatID, userID)})
	i.publishViewerChat(ctx, chatID, userID)
}

// DemoteAdmin снимает админа: он возвращается в роль вступившего по типу чата
// (в канале — подписчик, а не «участник группы» с её дефолтными правами).
func (i *Interactor) DemoteAdmin(ctx context.Context, chatID, actorID, userID int64) error {
	if _, _, err := i.manageTarget(ctx, chatID, actorID, userID, domain.RightManageAdmins, true); err != nil {
		return err
	}
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return err
	}
	prev := i.participantNow(ctx, chatID, userID)
	if err := i.groups.SetRole(ctx, chatID, userID, domain.JoinRole(typ), 0, 0); err != nil {
		return err
	}
	if err := i.groups.SetRank(ctx, chatID, userID, ""); err != nil {
		return err
	}
	i.publishChatUpdate(ctx, chatID) // состав админов изменился
	i.afterRightsChange(ctx, chatID, actorID, userID, prev)
	return nil
}

func (i *Interactor) EditInfo(ctx context.Context, chatID, actorID int64, title, about, username string) error {
	if err := i.requirePermOrRight(ctx, chatID, actorID, domain.PermChangeInfo, domain.RightChangeInfo); err != nil {
		return err
	}
	old, _ := i.groups.Card(ctx, chatID, actorID)
	if err := i.groups.EditInfo(ctx, chatID, title, about, username); err != nil {
		return err
	}
	// Смена названия — сервисное сообщение (tweb messageActionChatEditTitle); его
	// fan-out заодно обновляет диалог у всех участников live.
	if old.Title != "" && old.Title != title {
		// Новое название — параметр конструктора: прежде его не ехало вовсе.
		i.postGroupService(ctx, chatID, actorID, domain.NewMessageActionChatEditTitle(title))
	}
	i.publishChatUpdate(ctx, chatID) // title/about/username изменились
	return nil
}

// SetChatPhoto points the chat's photo at an uploaded media object (needs
// CHANGE_INFO; the media must belong to the actor, mirroring Send's check) and
// posts the "updated the group photo" service message (tweb editPhoto →
// messageActionChatEditPhoto).
func (i *Interactor) SetChatPhoto(ctx context.Context, chatID, actorID, mediaID int64) error {
	if err := i.requirePermOrRight(ctx, chatID, actorID, domain.PermChangeInfo, domain.RightChangeInfo); err != nil {
		return err
	}
	ownerID, err := i.mediaAccess.OwnerID(ctx, mediaID)
	if err != nil {
		return err // ErrNotFound for absent media
	}
	if ownerID != actorID {
		return domain.ErrNotFound
	}
	if err := i.groups.SetPhoto(ctx, chatID, mediaID); err != nil {
		return err
	}
	// Фото едет медиа-полем сервисного сообщения (tweb messageActionChatEditPhoto
	// несёт photo) — клиент рисует кликабельную круглую миниатюру под пилюлей.
	// Photo подставляется на границе из media_id сообщения (Message.ToWire):
	// собранный конструктор photo в jsonb колонки не кладётся — его вектор
	// PhotoSize обратно не разобрать.
	i.postGroupServiceMedia(ctx, chatID, actorID, mediaID, domain.NewMessageActionChatEditPhoto(nil))
	i.publishChatUpdate(ctx, chatID) // фото чата изменилось
	return nil
}

// SetMute: muted=true без until — навсегда (tweb «Forever»), с until —
// временный mute («For 1 Hour…»); muted=false снимает и то и другое. Смена
// логируется + шлётся dialog_mute на устройства владельца: раньше это был
// клиентский fake-echo (groupsManager), теперь сервер эмитит его сам, так что
// mute доезжает и на другие вкладки/устройства и через getDifference (плотный pts).
//
// «Навсегда» ниже становится СРОКОМ (domain.MuteUntilForever), а не отдельным
// флагом: в схеме мьют выражает peerNotifySettings.mute_until, и второй способ
// сказать то же самое и был тем, из-за чего «на час» работало как «навсегда».
//
// Кадр несёт notify_settings ЦЕЛИКОМ и читает их обратно из базы, а не
// пересобирает из аргументов: превью и звук мьют не менял, но в конструкторе
// они есть, и собранный из аргументов огрызок сказал бы клиенту, что
// переопределений нет.
func (i *Interactor) SetMute(ctx context.Context, chatID, userID int64, muted bool, until *time.Time) error {
	var muteUntil *time.Time
	switch {
	case !muted:
		muteUntil = nil
	case until != nil:
		muteUntil = until
	default:
		forever := time.Unix(domain.MuteUntilForever, 0)
		muteUntil = &forever
	}
	if err := i.groups.SetMuted(ctx, chatID, userID, muteUntil); err != nil {
		return err
	}
	settings, err := i.groups.NotifySettings(ctx, chatID, userID)
	if err != nil {
		return err
	}
	// best-effort: мутация закоммичена — сбой лога/публикации не возвращаем как ошибку.
	_ = i.logAndPublishPerPeer(ctx, chatID, []int64{userID}, "dialog_mute",
		func(peer domain.PeerID) map[string]any { return notifySettingsPayload(peer, settings) })
	return nil
}

// SetChatNotify обновляет per-chat уведомления (показ превью, звук). nil-поля не
// меняются (sound валидируется до 'default'|'none' в хендлере).
func (i *Interactor) SetChatNotify(ctx context.Context, chatID, userID int64, preview *bool, sound *string) error {
	return i.groups.SetNotify(ctx, chatID, userID, preview, sound)
}

// ChatCard — полная карточка чата (channels.getFullChannel) тому, кто чат
// читает (RequireChatRead): участнику либо любому для публичного чата.
// Карточку чужого приватного чата — название, описание, фото, число
// участников, обсуждение — не получить, перебирая id подряд. Создание и
// вступление зовут её уже после вступления, им гейт не мешает.
//
// Карточка бывает только у группы и канала: у лички и «Избранного» пир — это
// человек (users.getFullUser), и `channel` с внутренним id строки лички
// выдавал наружу наш ключ (A4-15) — domain.ErrInvalid.
func (i *Interactor) ChatCard(ctx context.Context, chatID, viewerID int64) (domain.ChatRecord, error) {
	if err := i.RequireChatRead(ctx, chatID, viewerID); err != nil {
		return domain.ChatRecord{}, err
	}
	// Счётчики участников (Б-115) — по правам зрителя: viewerCounters.
	c, err := i.viewerCard(ctx, chatID, viewerID)
	if err != nil {
		return domain.ChatRecord{}, err
	}
	if c.Type != domain.ChatTypeGroup && c.Type != domain.ChatTypeChannel {
		return domain.ChatRecord{}, domain.ErrInvalid
	}
	return c, nil
}

// ChatFullContainer — ответ channels.getFullChannel: messages.chatFull, где
// `chats` везёт сам чат И связанный (группу обсуждения у канала, канал у
// группы): строка «Обсуждение» и вход в него рисуются по linked_chat_id
// (tweb topbar.ts:516-519, editChat.tsx:753-755), а группы обсуждения в
// списке диалогов нет (A4-12).
func (i *Interactor) ChatFullContainer(ctx context.Context, chatID, viewerID int64) (domain.MessagesChatFull, error) {
	c, err := i.ChatCard(ctx, chatID, viewerID)
	if err != nil {
		return domain.MessagesChatFull{}, err
	}
	full := c.ToChannelFull()
	out := domain.NewMessagesChatFull(full, c.ToChannel())
	out.Chats = i.withChats(ctx, viewerID, out.Chats, full.LinkedChatID)
	// Карточки заявителей плашки заявок (recent_requesters, Б-86).
	if c.Counters != nil && len(c.Counters.RecentRequesters) > 0 && i.groups != nil {
		if cards, err := i.groups.UsersByIDs(ctx, viewerID, c.Counters.RecentRequesters); err == nil {
			i.viewUsers(ctx, viewerID, cards)
			out.Users = cards
		}
	}
	return out, nil
}

// UsersByIDs — карточки глазами viewerID (имя из его книги, pFlags.contact).
func (i *Interactor) UsersByIDs(ctx context.Context, viewerID int64, ids []int64) ([]domain.UserReal, error) {
	return i.groups.UsersByIDs(ctx, viewerID, ids)
}

// KnownUsersByIDs — карточки по голым id для внешней ручки (/users?ids=,
// аналог users.getUsers): только тех, кто зрителю известен (KnownUserIDs).
// Неизвестный id молча выпадает из вектора — как у оригинала, где чужой
// access_hash не даёт пользователя вовсе. Перебрать каталог по подряд идущим
// id так нельзя.
func (i *Interactor) KnownUsersByIDs(ctx context.Context, viewerID int64, ids []int64) ([]domain.UserReal, error) {
	known, err := i.groups.KnownUserIDs(ctx, viewerID, ids)
	if err != nil {
		return nil, err
	}
	keep := make([]int64, 0, len(ids))
	for _, id := range ids {
		if known[id] {
			keep = append(keep, id)
		}
	}
	return i.groups.UsersByIDs(ctx, viewerID, keep)
}

func (i *Interactor) CreateInvite(ctx context.Context, chatID, actorID int64, title string, usageLimit *int, requiresApproval bool, expiresAt *time.Time) (domain.InviteLink, error) {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil {
		return domain.InviteLink{}, err
	}
	return i.invites.Create(ctx, chatID, actorID, tokenGen(), title, usageLimit, requiresApproval, expiresAt)
}

// ListInvites returns the chat's invite links: active ones by default, or the
// revoked ones when revoked is true (Telegram getExportedChatInvites revoked flag).
func (i *Interactor) ListInvites(ctx context.Context, chatID, actorID int64, revoked bool) ([]domain.InviteLink, error) {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil {
		return nil, err
	}
	return i.invites.List(ctx, chatID, revoked)
}

// EditInvite updates an invite link's editable fields (Telegram
// messages.editExportedChatInvite). Same right as revoke/list (INVITE_USERS).
func (i *Interactor) EditInvite(ctx context.Context, chatID, actorID int64, token string, edit domain.InviteEdit) (domain.InviteLink, error) {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil {
		return domain.InviteLink{}, err
	}
	return i.invites.Update(ctx, chatID, token, edit)
}

// InviteImporters lists the users who joined via a specific link (newest first,
// capped) plus the total count. Same right as ListInvites.
func (i *Interactor) InviteImporters(ctx context.Context, chatID, actorID int64, token string) ([]domain.InviteImporter, int, error) {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil {
		return nil, 0, err
	}
	return i.invites.Importers(ctx, chatID, token, 50)
}

// DeleteInvite hard-deletes a single link (Telegram deleteExportedChatInvite).
// The token is scoped to chatID by the repo, so an actor can't delete another
// chat's link through this chat's endpoint. Same right as revoke/list.
func (i *Interactor) DeleteInvite(ctx context.Context, chatID, actorID int64, token string) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil {
		return err
	}
	return i.invites.Delete(ctx, chatID, token)
}

// DeleteAllRevoked hard-deletes every revoked link of the chat (Telegram
// deleteRevokedExportedChatInvites). Same right as revoke/list.
func (i *Interactor) DeleteAllRevoked(ctx context.Context, chatID, actorID int64) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil {
		return err
	}
	return i.invites.DeleteAllRevoked(ctx, chatID)
}

// JoinByToken resolves an invite link and either joins the user immediately or,
// for approval-required links, records a pending join request. The returned
// requested bool is true when a request was filed (approval needed) and false
// when the user was added as a member. chatID — чат ссылки: по нему ручка
// отдаёт его карточку (`messages.importChatInvite` оригинала возвращает
// `Updates` с чатом в `chats[0]`, tweb `appChatInvitesManager.ts:92-104`).
//
// Уже участник — не ошибка: у оригинала это `chatInviteAlready`, по которому
// клиент просто открывает чат (tweb `internalLinkProcessor.ts:1129-1137`), —
// поэтому без повторного вступления, служебного сообщения и счёта использований.
func (i *Interactor) JoinByToken(ctx context.Context, token string, userID int64) (chatID int64, requested bool, err error) {
	link, err := i.invites.GetByToken(ctx, token)
	if err != nil {
		return 0, false, err
	}
	if _, e := i.groups.GetMember(ctx, link.ChatID, userID); e == nil {
		return link.ChatID, false, nil
	}
	requested, err = i.joinByLink(ctx, link, token, userID)
	return link.ChatID, requested, err
}

func (i *Interactor) joinByLink(ctx context.Context, link domain.InviteLink, token string, userID int64) (requested bool, err error) {
	// Просроченная ссылка недействительна (tweb: expired invite → нельзя войти).
	if link.ExpiresAt != nil && link.ExpiresAt.Before(time.Now()) {
		return false, domain.ErrForbidden
	}
	// Лимит использований исчерпан — ссылка мертва (Telegram USERS_TOO_MUCH).
	// Окончательно его держит условный IncUses ниже (гонка за последнее место).
	if link.UsageLimit != nil && link.Uses >= *link.UsageLimit {
		return false, domain.ErrForbidden
	}
	if banned, e := i.groups.IsBanned(ctx, link.ChatID, userID); e != nil || banned {
		if e != nil {
			return false, e
		}
		return false, domain.ErrForbidden // из чёрного списка по ссылке не возвращаются
	}
	if link.RequiresApproval {
		inserted, e := i.joinReqs.Create(ctx, link.ChatID, userID, token)
		if e != nil {
			return false, e
		}
		// Админы с invite_users видят заявку живьём: плашка в шапке (A2-06).
		// Повторная подача ничего не меняет — и кадра нет.
		if inserted {
			i.emitPendingRequests(ctx, link.ChatID)
		}
		return true, nil
	}
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if _, e := i.admit(ctx, link.ChatID, userID, userID, admitSelf); e != nil {
			return e
		}
		if e := i.invites.IncUses(ctx, link.ID); e != nil {
			return e
		}
		if e := i.invites.RecordJoin(ctx, link.ChatID, token, userID); e != nil {
			return e
		}
		// Пригласивший — создатель ссылки (channelParticipantSelf.inviter_id).
		return i.groups.SetJoinInfo(ctx, link.ChatID, userID, link.CreatedBy, false)
	})
	if err != nil {
		return false, err
	}
	i.announceChannelJoin(ctx, link.ChatID, userID)
	// Вступление по инвайт-ссылке — отдельный конструктор
	// (messageActionChatJoinedByLink), а не add_user: добавил не админ,
	// пользователь вошёл сам.
	//
	// В действии едет СОЗДАТЕЛЬ ССЫЛКИ, а не вошедший — долг шага A. Прежде
	// подставлялся actor_id, то есть вошедший, хотя он и так известен: он
	// from_id самого служебного сообщения, и параметр inviter_id дублировал его
	// вместо того, чтобы назвать пригласившего.
	i.postGroupService(ctx, link.ChatID, userID, domain.NewMessageActionChatJoinedByLink(link.CreatedBy))
	// Число участников и списки — живьём (A2-07): chat_update всем, кадр
	// участника со ссылкой админам.
	i.publishChatUpdate(ctx, link.ChatID)
	// Вступившему — личный снимок в журнал (ревью #404 п. 7): канальный
	// chat_update его прочим устройствам не дойдёт, они на топик ещё не
	// подписаны, и канал на них не появился бы.
	i.publishViewerChat(ctx, link.ChatID, userID)
	invite := domain.NewChatInviteExported(link)
	i.emitParticipant(ctx, link.ChatID, userID, userID, participantChange{next: i.participantNow(ctx, link.ChatID, userID), invite: &invite})
	return false, nil
}

// ListJoinRequests returns the pending join requests for a chat. The actor must
// hold INVITE_USERS.
func (i *Interactor) ListJoinRequests(ctx context.Context, chatID, actorID int64, q string, offsetDate time.Time, offsetUser int64, limit int) ([]domain.JoinRequest, int, error) {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil {
		return nil, 0, err
	}
	return i.joinReqs.List(ctx, chatID, q, offsetDate, offsetUser, limit)
}

// ApproveJoinRequest adds the requesting user as a member and clears the pending
// request. The actor must hold INVITE_USERS. Одобрить можно только СУЩЕСТВУЮЩУЮ
// заявку (у Telegram HIDE_REQUESTER_MISSING): прежде «одобрение» добавляло
// любого пользователя мимо бана и его приватности «кто может звать в группы».
func (i *Interactor) ApproveJoinRequest(ctx context.Context, chatID, actorID, userID int64) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil {
		return err
	}
	// Заявка могла прийти по конкретной ссылке — вступивший должен попасть в её
	// список importers в момент фактического добавления в участники.
	token, ok, err := i.joinReqs.TokenFor(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	var joined bool
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		j, e := i.admit(ctx, chatID, userID, actorID, admitApproved)
		if e != nil {
			return e
		}
		joined = j
		if token != "" {
			if e := i.invites.RecordJoin(ctx, chatID, token, userID); e != nil {
				return e
			}
		}
		if j {
			// Привёл одобривший; вошёл заявкой (channelParticipantSelf.via_request).
			if e := i.groups.SetJoinInfo(ctx, chatID, userID, actorID, true); e != nil {
				return e
			}
		}
		return i.joinReqs.Delete(ctx, chatID, userID)
	})
	if err != nil {
		return err
	}
	// A6-04/A2-06: служебка «вступил по заявке» (автор — вступивший, как у
	// оригинала; в broadcast-канале состав служебками не пишется), снимок
	// чата всем — одобренный по нему видит чат, — кадр участника и заявок.
	if joined {
		i.announceChannelJoin(ctx, chatID, userID)
		i.postGroupService(ctx, chatID, userID, domain.NewMessageActionChatJoinedByRequest())
		i.publishChatUpdate(ctx, chatID)
		i.publishViewerChat(ctx, chatID, userID)
		i.emitParticipant(ctx, chatID, actorID, userID, participantChange{next: i.participantNow(ctx, chatID, userID)})
	}
	i.emitPendingRequests(ctx, chatID)
	return nil
}

// DeclineJoinRequest drops a pending join request. The actor must hold
// INVITE_USERS.
func (i *Interactor) DeclineJoinRequest(ctx context.Context, chatID, actorID, userID int64) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil {
		return err
	}
	if err := i.joinReqs.Delete(ctx, chatID, userID); err != nil {
		return err
	}
	i.emitPendingRequests(ctx, chatID) // A2-06: отклонение — кадр админам
	return nil
}
