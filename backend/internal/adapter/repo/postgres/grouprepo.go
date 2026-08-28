package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// GroupRepo is a postgres-backed adapter implementing the chat usecase's GroupRepo
// port: multi-member chat creation, membership/roles/rights, per-chat mute, the
// chat card read model, denormalized member_count maintenance, and a batch user
// lookup. It mirrors ChatsRepo and runs every query through querier(ctx, pool) so
// methods compose inside a TxManager transaction.
type GroupRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.GroupRepo = (*GroupRepo)(nil)

func NewGroupRepo(pool *pgxpool.Pool) *GroupRepo { return &GroupRepo{pool: pool} }

func (r *GroupRepo) CreateMultiMember(ctx context.Context, typ, title, about, username string, isPublic bool, creatorID int64) (int64, error) {
	q := querier(ctx, r.pool)
	var id int64
	var u any
	if username != "" {
		u = username
	}
	err := q.QueryRow(ctx,
		`INSERT INTO chats (type, title, about, username, is_public, creator_id)
		 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		typ, title, about, u, isPublic, creatorID).Scan(&id)
	return id, err
}

func (r *GroupRepo) AddMember(ctx context.Context, chatID, userID int64, role string, rights domain.Rights) error {
	q := querier(ctx, r.pool)
	ct, err := q.Exec(ctx,
		`INSERT INTO chat_members (chat_id, user_id, role, rights)
		 VALUES ($1,$2,$3,$4) ON CONFLICT (chat_id,user_id) DO NOTHING`,
		chatID, userID, role, int(rights))
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 1 {
		_, err = q.Exec(ctx, `UPDATE chats SET member_count = member_count + 1 WHERE id=$1`, chatID)
	}
	return err
}

func (r *GroupRepo) RemoveMember(ctx context.Context, chatID, userID int64) error {
	q := querier(ctx, r.pool)
	ct, err := q.Exec(ctx, `DELETE FROM chat_members WHERE chat_id=$1 AND user_id=$2`, chatID, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 1 {
		_, err = q.Exec(ctx, `UPDATE chats SET member_count = GREATEST(member_count - 1, 0) WHERE id=$1`, chatID)
	}
	return err
}

func (r *GroupRepo) GetMember(ctx context.Context, chatID, userID int64) (domain.Member, error) {
	q := querier(ctx, r.pool)
	var m domain.Member
	var rights int
	err := q.QueryRow(ctx,
		`SELECT chat_id, user_id, role, rights
		   FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID).Scan(&m.ChatID, &m.UserID, &m.Role, &rights)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Member{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Member{}, err
	}
	m.Rights = domain.Rights(rights)
	return m, nil
}

func (r *GroupRepo) SetRole(ctx context.Context, chatID, userID int64, role string, rights domain.Rights) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chat_members SET role=$3, rights=$4 WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID, role, int(rights))
	return err
}

// SetMuted записывает СРОК мьюта: nil снимает его, domain.MuteUntilForever —
// «навсегда». Булева аргумента здесь больше нет — второй способ сказать то же
// самое и был тем, из-за чего «заглушить на час» работало как «навсегда»
// (решение Р4).
func (r *GroupRepo) SetMuted(ctx context.Context, chatID, userID int64, until *time.Time) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chat_members SET muted_until=$3 WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID, until)
	return err
}

// NotifySettings — пер-чатное переопределение уведомлений участника целиком.
// Читается после мутации мьюта, чтобы кадр dialog_mute нёс НАСТОЯЩИЕ настройки,
// а не пересобранный из аргументов огрызок: превью и звук мьют не менял, но в
// конструкторе они есть, и «не знаю» от «переопределения нет» неотличимо.
func (r *GroupRepo) NotifySettings(ctx context.Context, chatID, userID int64) (domain.PeerNotifySettings, error) {
	var muteUntil *time.Time
	var preview *bool
	var sound *string
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT muted_until, notify_preview, notify_sound
		   FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID).Scan(&muteUntil, &preview, &sound)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.PeerNotifySettings{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.PeerNotifySettings{}, err
	}
	return peerNotifySettings(muteUntil, preview, sound, time.Now()), nil
}

// SetNotify обновляет per-chat настройки уведомлений; nil-поля не меняются
// (COALESCE), так что можно править превью и звук по отдельности.
func (r *GroupRepo) SetNotify(ctx context.Context, chatID, userID int64, preview *bool, sound *string) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chat_members
		    SET notify_preview = COALESCE($3, notify_preview),
		        notify_sound   = COALESCE($4, notify_sound)
		  WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID, preview, sound)
	return err
}

// SetPinned закрепляет/открепляет диалог для пользователя. pinned_at = момент
// закрепления: свежий пин встаёт первым в списке.
func (r *GroupRepo) SetPinned(ctx context.Context, chatID, userID int64, pinned bool) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chat_members SET pinned_at = CASE WHEN $3 THEN now() ELSE NULL END
		 WHERE chat_id=$1 AND user_id=$2`, chatID, userID, pinned)
	return err
}

// CountPinned — сколько диалогов пользователь закрепил в основном списке
// (архив не считается: у него свой набор пинов, как папки tweb).
func (r *GroupRepo) CountPinned(ctx context.Context, userID int64) (int, error) {
	var n int
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT count(*) FROM chat_members WHERE user_id=$1 AND pinned_at IS NOT NULL AND NOT archived`,
		userID).Scan(&n)
	return n, err
}

// SetForum включает/выключает темы у группы (chats.is_forum).
func (r *GroupRepo) SetForum(ctx context.Context, chatID int64, enabled bool) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `UPDATE chats SET is_forum=$2 WHERE id=$1`, chatID, enabled)
	return err
}

// SetArchived убирает диалог в архив / возвращает из него; пин при переносе
// сбрасывается (в tweb наборы пинов у папок раздельные).
func (r *GroupRepo) SetArchived(ctx context.Context, chatID, userID int64, archived bool) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chat_members SET archived=$3, pinned_at=NULL WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID, archived)
	return err
}

func (r *GroupRepo) EditInfo(ctx context.Context, chatID int64, title, about, username string) error {
	var u any
	if username != "" {
		u = username
	}
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET title=$2, about=$3, username=$4 WHERE id=$1`, chatID, title, about, u)
	return err
}

func (r *GroupRepo) SetPhoto(ctx context.Context, chatID, mediaID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET photo_media_id=$2 WHERE id=$1`, chatID, mediaID)
	return err
}

func (r *GroupRepo) Settings(ctx context.Context, chatID int64) (domain.ChatSettings, error) {
	var s domain.ChatSettings
	var perms int
	var allowed []byte
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT default_permissions, slowmode_seconds, reactions_mode, reactions_allowed, history_for_new, charge_stars
		 FROM chats WHERE id=$1`, chatID).
		Scan(&perms, &s.SlowmodeSeconds, &s.ReactionsMode, &allowed, &s.HistoryForNew, &s.ChargeStars)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ChatSettings{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.ChatSettings{}, err
	}
	s.DefaultPerms = domain.MemberPerms(perms)
	if len(allowed) > 0 {
		_ = json.Unmarshal(allowed, &s.ReactionsAllowed)
	}
	return s, nil
}

// SetType switches private/public. Public requires a username (unique across
// chats); switching to private clears it. domain.ErrConflict on a taken name.
func (r *GroupRepo) SetType(ctx context.Context, chatID int64, isPublic bool, username string) error {
	var u any
	if isPublic && username != "" {
		u = username
	}
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET is_public=$2, username=$3 WHERE id=$1`, chatID, isPublic, u)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
		return domain.ErrConflict
	}
	return err
}

func (r *GroupRepo) SetPermissions(ctx context.Context, chatID int64, perms domain.MemberPerms, slowmodeSeconds int) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET default_permissions=$2, slowmode_seconds=$3 WHERE id=$1`,
		chatID, int(perms), slowmodeSeconds)
	return err
}

func (r *GroupRepo) SetReactions(ctx context.Context, chatID int64, mode string, allowed []string) error {
	var list any
	if len(allowed) > 0 {
		b, err := json.Marshal(allowed)
		if err != nil {
			return err
		}
		list = string(b) // jsonb через string, не []byte (см. CLAUDE.md)
	}
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET reactions_mode=$2, reactions_allowed=$3 WHERE id=$1`, chatID, mode, list)
	return err
}

func (r *GroupRepo) SetHistoryForNew(ctx context.Context, chatID int64, visible bool) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET history_for_new=$2 WHERE id=$1`, chatID, visible)
	return err
}

func (r *GroupRepo) SetChargeStars(ctx context.Context, chatID int64, stars int) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET charge_stars=$2 WHERE id=$1`, chatID, stars)
	return err
}

func (r *GroupRepo) CreatorID(ctx context.Context, chatID int64) (int64, error) {
	var id int64
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT COALESCE(creator_id,0) FROM chats WHERE id=$1`, chatID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return id, err
}

func (r *GroupRepo) Ban(ctx context.Context, chatID, userID, bannedBy int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO chat_bans (chat_id, user_id, banned_by) VALUES ($1,$2,$3)
		 ON CONFLICT (chat_id, user_id) DO NOTHING`, chatID, userID, bannedBy)
	return err
}

func (r *GroupRepo) Unban(ctx context.Context, chatID, userID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM chat_bans WHERE chat_id=$1 AND user_id=$2`, chatID, userID)
	return err
}

func (r *GroupRepo) IsBanned(ctx context.Context, chatID, userID int64) (bool, error) {
	var banned bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM chat_bans WHERE chat_id=$1 AND user_id=$2)`, chatID, userID).Scan(&banned)
	return banned, err
}

func (r *GroupRepo) ListBans(ctx context.Context, chatID int64) ([]domain.BannedUser, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT user_id, COALESCE(banned_by,0) FROM chat_bans WHERE chat_id=$1 ORDER BY created_at DESC`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.BannedUser{}
	for rows.Next() {
		var b domain.BannedUser
		if err := rows.Scan(&b.UserID, &b.BannedBy); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// SetRestriction upserts a per-user granular restriction (Telegram editBanned).
func (r *GroupRepo) SetRestriction(ctx context.Context, res domain.MemberRestriction) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO chat_restrictions (chat_id, user_id, denied_rights, until_date, restricted_by)
		 VALUES ($1,$2,$3,$4,$5)
		 ON CONFLICT (chat_id, user_id)
		 DO UPDATE SET denied_rights=EXCLUDED.denied_rights,
		               until_date=EXCLUDED.until_date,
		               restricted_by=EXCLUDED.restricted_by,
		               created_at=now()`,
		res.ChatID, res.UserID, int(res.DeniedRights), res.UntilDate, res.RestrictedBy)
	return err
}

// GetRestriction returns the raw restriction row (bool=exists); expiry is left
// to the caller via domain.MemberRestriction.Active.
func (r *GroupRepo) GetRestriction(ctx context.Context, chatID, userID int64) (domain.MemberRestriction, bool, error) {
	var res domain.MemberRestriction
	var denied int
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT chat_id, user_id, denied_rights, until_date, restricted_by
		   FROM chat_restrictions WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID).Scan(&res.ChatID, &res.UserID, &denied, &res.UntilDate, &res.RestrictedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.MemberRestriction{}, false, nil
	}
	if err != nil {
		return domain.MemberRestriction{}, false, err
	}
	res.DeniedRights = domain.MemberPerms(denied)
	return res, true, nil
}

func (r *GroupRepo) ListRestrictions(ctx context.Context, chatID int64) ([]domain.MemberRestriction, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT chat_id, user_id, denied_rights, until_date, restricted_by
		   FROM chat_restrictions WHERE chat_id=$1 ORDER BY created_at DESC`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.MemberRestriction{}
	for rows.Next() {
		var res domain.MemberRestriction
		var denied int
		if err := rows.Scan(&res.ChatID, &res.UserID, &denied, &res.UntilDate, &res.RestrictedBy); err != nil {
			return nil, err
		}
		res.DeniedRights = domain.MemberPerms(denied)
		out = append(out, res)
	}
	return out, rows.Err()
}

func (r *GroupRepo) DeleteRestriction(ctx context.Context, chatID, userID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM chat_restrictions WHERE chat_id=$1 AND user_id=$2`, chatID, userID)
	return err
}

func (r *GroupRepo) DeleteChat(ctx context.Context, chatID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `DELETE FROM chats WHERE id=$1`, chatID)
	return err
}

// Card — строка чата ГЛАЗАМИ зрителя: всё, из чего собираются оба
// конструктора схемы (краткий `channel` и полный `channelFull`). Геометрия
// фото приезжает из media: channelFull.chat_photo это ПОЛНОЕ Photo с лестницей
// размеров — экран информации открывает аватарку в медиавьювере.
func (r *GroupRepo) Card(ctx context.Context, chatID, viewerID int64) (domain.ChatRecord, error) {
	q := querier(ctx, r.pool)
	var c domain.ChatRecord
	c.ViewerID = viewerID
	var rights *int
	var role *string
	var muteUntil *time.Time
	var joinedAt *time.Time
	var notifyPreview *bool
	var notifySound *string
	var perms int
	var allowed []byte
	err := q.QueryRow(ctx,
		`SELECT c.id, c.type, c.title, COALESCE(c.username,''), c.about, c.photo_media_id,
		        pm.blur_preview, COALESCE(pm.width,0), COALESCE(pm.height,0), COALESCE(pm.size,0),
		        COALESCE(c.creator_id,0), c.member_count, c.created_at, c.is_forum,
		        COALESCE(c.discussion_chat_id,0), c.signatures, c.signature_profiles,
		        c.default_permissions, c.slowmode_seconds, c.reactions_mode, c.reactions_allowed,
		        c.history_for_new, c.charge_stars, COALESCE(c.auto_delete_period,0),
		        -- pinned_msg_id: наружу едет НОМЕР сообщения в чате (в схеме
		        -- chatFull.pinned_msg_id адресует сообщение в его пире), а
		        -- pinned_messages.msg_id — внутренний ключ строки.
		        COALESCE((SELECT pinm.seq FROM pinned_messages p JOIN messages pinm ON pinm.id=p.msg_id
		                   WHERE p.chat_id=c.id ORDER BY p.pinned_at DESC LIMIT 1),0),
		        COALESCE(m.last_read_seq,0), COALESCE(m.unread_count,0),
		        COALESCE((SELECT MIN(om.last_read_seq) FROM chat_members om WHERE om.chat_id=c.id AND om.user_id<>$2),0),
		        m.role, m.rights, m.muted_until, m.notify_preview, m.notify_sound,
		        COALESCE(ct.theme_id,''),
		        -- Дата вступления ЗРИТЕЛЯ — из той же строки членства, что role
		        -- и rights; NULL, когда зритель не состоит (LEFT JOIN не нашёл
		        -- строки) или когда зрителя нет вовсе. Наружу уходит
		        -- обязательным channel.date, см. ChatRecord.ChannelDate.
		        m.joined_at
		   FROM chats c
		   LEFT JOIN media pm ON pm.id = c.photo_media_id
		   LEFT JOIN chat_theme ct ON ct.chat_id = c.id
		   LEFT JOIN chat_members m ON m.chat_id=c.id AND m.user_id=$2
		  WHERE c.id=$1`,
		chatID, viewerID).Scan(&c.ID, &c.Type, &c.Title, &c.Username, &c.About, &c.PhotoID,
		&c.PhotoPreview, &c.PhotoW, &c.PhotoH, &c.PhotoSize,
		&c.CreatorID, &c.MemberCount, &c.CreatedAt, &c.IsForum,
		&c.DiscussionChatID, &c.Signatures, &c.SignatureProfiles,
		&perms, &c.Settings.SlowmodeSeconds, &c.Settings.ReactionsMode, &allowed,
		&c.Settings.HistoryForNew, &c.Settings.ChargeStars, &c.Settings.AutoDeletePeriod,
		&c.PinnedMsgID, &c.ReadInboxMaxID, &c.UnreadCount, &c.ReadOutboxMaxID,
		&role, &rights, &muteUntil, &notifyPreview, &notifySound, &c.ThemeEmoticon, &joinedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ChatRecord{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.ChatRecord{}, err
	}
	if role != nil {
		c.MyRole = *role
	}
	if rights != nil {
		c.MyRights = domain.Rights(*rights)
	}
	if joinedAt != nil {
		c.MyJoinedAt = *joinedAt
	}
	// notify_settings зритель-зависимы: без зрителя (снимок chat_update — один
	// на всех участников) их нет вовсе, и пустой конструктор здесь был бы не
	// «неизвестно», а «переопределения нет» — то есть чужой ответ, разосланный
	// всем.
	if viewerID != 0 && role != nil {
		ns := peerNotifySettings(muteUntil, notifyPreview, notifySound, time.Now())
		c.NotifySettings = &ns
	}
	c.Settings.DefaultPerms = domain.MemberPerms(perms)
	if len(allowed) > 0 {
		_ = json.Unmarshal(allowed, &c.Settings.ReactionsAllowed)
	}
	return c, nil
}

func (r *GroupRepo) ListMembers(ctx context.Context, chatID int64, offset, limit int) ([]domain.Member, error) {
	if limit <= 0 || limit > 200 {
		limit = 200
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT chat_id, user_id, role, rights
		   FROM chat_members
		  WHERE chat_id=$1 ORDER BY role DESC, user_id LIMIT $2 OFFSET $3`,
		chatID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.Member, 0)
	for rows.Next() {
		var m domain.Member
		var rights int
		if err := rows.Scan(&m.ChatID, &m.UserID, &m.Role, &rights); err != nil {
			return nil, err
		}
		m.Rights = domain.Rights(rights)
		out = append(out, m)
	}
	return out, rows.Err()
}

// AdminIDs — id владельца и админов чата (role in creator/admin).
func (r *GroupRepo) AdminIDs(ctx context.Context, chatID int64) ([]int64, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT user_id FROM chat_members WHERE chat_id=$1 AND role IN ('creator','admin')`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]int64, 0)
	for rows.Next() {
		var uid int64
		if err := rows.Scan(&uid); err != nil {
			return nil, err
		}
		out = append(out, uid)
	}
	return out, rows.Err()
}

func (r *GroupRepo) SetDiscussion(ctx context.Context, channelID, groupID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET discussion_chat_id=$2 WHERE id=$1`, channelID, groupID)
	return err
}

func (r *GroupRepo) GetDiscussion(ctx context.Context, channelID int64) (int64, error) {
	var id int64
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT COALESCE(discussion_chat_id,0) FROM chats WHERE id=$1`, channelID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return id, err
}

// IsDiscussionGroup reports whether chatID is some channel's discussion group.
func (r *GroupRepo) IsDiscussionGroup(ctx context.Context, chatID int64) (bool, error) {
	var ok bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM chats WHERE discussion_chat_id=$1)`, chatID).Scan(&ok)
	return ok, err
}

// IsForum reports whether chatID has forum topics enabled.
func (r *GroupRepo) IsForum(ctx context.Context, chatID int64) (bool, error) {
	var ok bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT is_forum FROM chats WHERE id=$1`, chatID).Scan(&ok)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, domain.ErrNotFound
	}
	return ok, err
}

// DiscussionCandidates lists non-forum 'group' chats where actorID is
// creator/admin and which aren't already some channel's discussion group.
func (r *GroupRepo) DiscussionCandidates(ctx context.Context, actorID int64) ([]domain.ChatRecord, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT c.id, c.title, COALESCE(c.username,''), c.member_count
		   FROM chats c
		   JOIN chat_members m ON m.chat_id=c.id AND m.user_id=$1 AND m.role IN ('creator','admin')
		  WHERE c.type='group' AND c.is_forum=false
		    AND NOT EXISTS (SELECT 1 FROM chats ch WHERE ch.discussion_chat_id=c.id)
		  ORDER BY c.id DESC`, actorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.ChatRecord, 0)
	for rows.Next() {
		var c domain.ChatRecord
		c.Type = "group"
		if err := rows.Scan(&c.ID, &c.Title, &c.Username, &c.MemberCount); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// SetSignatures toggles channel post signatures; profiles is forced off when
// signatures is off (Telegram invariant).
func (r *GroupRepo) SetSignatures(ctx context.Context, chatID int64, signatures, profiles bool) error {
	if !signatures {
		profiles = false
	}
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET signatures=$2, signature_profiles=$3 WHERE id=$1`, chatID, signatures, profiles)
	return err
}

// DiscussionChannel — обратный поиск GetDiscussion: канал, чья группа-обсуждение
// это groupID (0, если groupID ничьей группой не является). Нужен send-as: в
// discussion-группе админ привязанного канала может писать от его имени.
func (r *GroupRepo) DiscussionChannel(ctx context.Context, groupID int64) (int64, error) {
	var id int64
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT COALESCE(MIN(id),0) FROM chats WHERE discussion_chat_id=$1`, groupID).Scan(&id)
	return id, err
}

// ChatBriefs — лёгкие снимки чатов по id (id/type/title/photo) для отображения
// «личности отправителя» send-as и её автора в бабле. Отсутствующие id просто
// не попадают в мапу.
func (r *GroupRepo) ChatBriefs(ctx context.Context, ids []int64) (map[int64]domain.ChatBrief, error) {
	out := map[int64]domain.ChatBrief{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT c.id, c.type, COALESCE(c.title,''), c.photo_media_id, m.blur_preview
		   FROM chats c LEFT JOIN media m ON m.id = c.photo_media_id
		  WHERE c.id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var b domain.ChatBrief
		if err := rows.Scan(&b.ID, &b.Type, &b.Title, &b.PhotoID, &b.PhotoPreview); err != nil {
			return nil, err
		}
		out[b.ID] = b
	}
	return out, rows.Err()
}

func (r *GroupRepo) UsersByIDs(ctx context.Context, ids []int64) ([]domain.UserReal, error) {
	if len(ids) == 0 {
		return []domain.UserReal{}, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+userRealCols("u.")+` FROM users u WHERE u.id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.UserReal
	for rows.Next() {
		u, err := scanUserReal(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
