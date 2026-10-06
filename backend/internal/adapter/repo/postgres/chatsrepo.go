package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// ChatsRepo is a postgres-backed adapter implementing the chat usecase's ChatRepo port.
type ChatsRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.ChatRepo = (*ChatsRepo)(nil)

func NewChatsRepo(pool *pgxpool.Pool) *ChatsRepo { return &ChatsRepo{pool: pool} }

// FindPrivate returns the id of the existing private chat between two users, or domain.ErrNotFound.
func (r *ChatsRepo) FindPrivate(ctx context.Context, a, b int64) (int64, error) {
	q := querier(ctx, r.pool)
	var id int64
	err := q.QueryRow(ctx,
		`SELECT c.id FROM chats c
		 JOIN chat_members m1 ON m1.chat_id=c.id AND m1.user_id=$1
		 JOIN chat_members m2 ON m2.chat_id=c.id AND m2.user_id=$2
		 WHERE c.type='private' LIMIT 1`, a, b).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return id, err
}

// CreatePrivate creates a private chat with two members. It takes a tx-scoped
// advisory lock keyed on the sorted user pair so concurrent first-time creation
// is serialized; it must run inside a transaction (via TxManager).
//
// FindSaved returns the id of the user's "Saved Messages" self-chat, or
// domain.ErrNotFound (a single-member chat of type 'saved').
func (r *ChatsRepo) FindSaved(ctx context.Context, userID int64) (int64, error) {
	q := querier(ctx, r.pool)
	var id int64
	err := q.QueryRow(ctx,
		`SELECT c.id FROM chats c
		 JOIN chat_members m ON m.chat_id=c.id AND m.user_id=$1
		 WHERE c.type='saved' LIMIT 1`, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return id, err
}

// CreateSaved creates the user's "Saved Messages" chat (type 'saved', one member).
// A tx-scoped advisory lock keyed on the user serializes concurrent first-time
// creation; it must run inside a transaction (via TxManager).
func (r *ChatsRepo) CreateSaved(ctx context.Context, userID int64) (int64, error) {
	q := querier(ctx, r.pool)
	if _, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, fmt.Sprintf("saved:%d", userID)); err != nil {
		return 0, err
	}
	var chatID int64
	if err := q.QueryRow(ctx, `INSERT INTO chats (type) VALUES ('saved') RETURNING id`).Scan(&chatID); err != nil {
		return 0, err
	}
	if _, err := q.Exec(ctx, `INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2)`, chatID, userID); err != nil {
		return 0, err
	}
	return chatID, nil
}

func (r *ChatsRepo) CreatePrivate(ctx context.Context, a, b int64) (int64, error) {
	q := querier(ctx, r.pool)
	lo, hi := a, b
	if lo > hi {
		lo, hi = hi, lo
	}
	lockKey := fmt.Sprintf("private:%d:%d", lo, hi)
	if _, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, lockKey); err != nil {
		return 0, err
	}
	var chatID int64
	// Новый приватный чат наследует глобальный период автоудаления инициатора
	// (Telegram default history TTL применяется к новым чатам).
	if err := q.QueryRow(ctx,
		`INSERT INTO chats (type, auto_delete_period)
		 VALUES ('private', (SELECT auto_delete_period FROM users WHERE id=$1))
		 RETURNING id`, a).Scan(&chatID); err != nil {
		return 0, err
	}
	if _, err := q.Exec(ctx,
		`INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2),($1,$3)`,
		chatID, a, b); err != nil {
		return 0, err
	}
	return chatID, nil
}

// CreateSecret creates a secret chat (type 'secret') between two users. Unlike
// CreatePrivate there is no dedup/FindPrivate — multiple secret chats per pair
// are allowed — and no auto_delete_period (secret chats manage TTL per-message).
func (r *ChatsRepo) CreateSecret(ctx context.Context, a, b int64) (int64, error) {
	q := querier(ctx, r.pool)
	var chatID int64
	if err := q.QueryRow(ctx,
		`INSERT INTO chats (type) VALUES ('secret') RETURNING id`).Scan(&chatID); err != nil {
		return 0, err
	}
	if _, err := q.Exec(ctx,
		`INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2),($1,$3)`,
		chatID, a, b); err != nil {
		return 0, err
	}
	return chatID, nil
}

// MemberIDs returns the user ids of a chat's members.
func (r *ChatsRepo) MemberIDs(ctx context.Context, chatID int64) ([]int64, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx, `SELECT user_id FROM chat_members WHERE chat_id=$1`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// IsMember reports whether a user belongs to a chat.
// ChatType returns a chat's type ('private'|'group'|'channel'|'saved').
func (r *ChatsRepo) ChatType(ctx context.Context, chatID int64) (string, error) {
	q := querier(ctx, r.pool)
	var t string
	err := q.QueryRow(ctx, `SELECT type FROM chats WHERE id=$1`, chatID).Scan(&t)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", domain.ErrNotFound
	}
	return t, err
}

// Access — снимок доступа зрителя к чату одним запросом (domain.ChatAccess):
// вид, публичность, членство с ролью, бан. domain.ErrNotFound — чата нет.
func (r *ChatsRepo) Access(ctx context.Context, chatID, userID int64) (domain.ChatAccess, error) {
	var a domain.ChatAccess
	var role *string
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT c.type, c.is_public,
		        (SELECT cm.role FROM chat_members cm WHERE cm.chat_id = c.id AND cm.user_id = $2),
		        EXISTS (SELECT 1 FROM chat_bans b WHERE b.chat_id = c.id AND b.user_id = $2)
		   FROM chats c WHERE c.id = $1`, chatID, userID).Scan(&a.Type, &a.Public, &role, &a.Banned)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ChatAccess{}, domain.ErrNotFound
	}
	if role != nil {
		a.Member, a.Role = true, *role
	}
	return a, err
}

func (r *ChatsRepo) IsMember(ctx context.Context, chatID, userID int64) (bool, error) {
	q := querier(ctx, r.pool)
	var one int
	err := q.QueryRow(ctx,
		`SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2`, chatID, userID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// ChatPartners returns the distinct user ids that share at least one chat with
// the given user.
func (r *ChatsRepo) ChatPartners(ctx context.Context, userID int64) ([]int64, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT DISTINCT m2.user_id FROM chat_members m1
		 JOIN chat_members m2 ON m2.chat_id = m1.chat_id AND m2.user_id <> m1.user_id
		 WHERE m1.user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ListDialogs — строки списка чатов зрителя, свежие сверху.
//
// Последнее сообщение здесь адресуется ЧИСЛОМ (messages.id) и объектом не
// едет: выжимка last_text/last_type/last_sender_name с провода ушла (решение
// Р3), а сам объект достаётся пакетным запросом по странице — см.
// Interactor.DialogsPage. Поэтому LATERAL отдаёт один id вместо девяти полей,
// и вместе с ним ушёл подзапрос sender_name по users: имя автора собирает
// клиент из конструктора `user`, который едет вектором users контейнера.
//
// Пер-юзерная очистка истории (seq > m.cleared_max_seq) и «удалить у себя»
// (message_hides) остаются здесь: без них очищенное или скрытое зрителем
// вернулось бы в превью списка.
func (r *ChatsRepo) ListDialogs(ctx context.Context, userID int64) ([]domain.DialogRecord, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT c.id, c.type, c.title, COALESCE(c.username,''),
		        c.photo_media_id, pm.blur_preview,
		        m.last_read_seq, m.unread_count, m.unread_mentions_count, m.unread_reactions,
		        -- Мьют едет СРОКОМ, а не булевым: предикат «замьючен ли сейчас»
		        -- в домене один (PeerNotifySettings.Muted), и пяти копий условия
		        -- в SQL больше нет.
		        m.muted_until,
		        m.pinned_at IS NOT NULL, m.archived, c.is_forum,
		        m.notify_preview, m.notify_sound,
		        COALESCE(CASE
		          WHEN c.type = 'private' THEN (SELECT om.last_read_seq FROM chat_members om WHERE om.chat_id = c.id AND om.user_id <> $1 LIMIT 1)
		          -- Группа: ✓✓, когда прочитал ХОТЯ БЫ ОДИН (как живой кадр).
		          WHEN c.type = 'group'   THEN (SELECT MAX(om.last_read_seq) FROM chat_members om WHERE om.chat_id = c.id AND om.user_id <> $1)
		          ELSE 0
		        END, 0) AS peer_read_seq,
		        lm.id, COALESCE(lm.seq, 0),
		        -- LEFT JOIN LATERAL: у не-приватного чата собеседника нет, и ВСЕ
		        -- колонки пира приходят NULL — обязательные приводим здесь.
		        peer.id, COALESCE(peer.first_name,''), COALESCE(peer.last_name,''),
		        peer.username, peer.avatar_media_id, peer.avatar_preview,
		        COALESCE(peer.is_bot,false), COALESCE(peer.is_verified,false),
		        COALESCE(peer.is_premium,false), COALESCE(peer.emoji_status,''),
		        COALESCE(peer.deleted,false), COALESCE(peer.is_service,false),
		        -- Собеседник ГЛАЗАМИ ЗРИТЕЛЯ: имя из его книги и pFlags.contact
		        -- (domain.UserReal.SeenBy). Без них строка списка затирала на
		        -- клиенте имя контакта профильным.
		        `+contactViewCols("peer.id", "$1")+`,
		        c.auto_delete_period,
		        -- Дата ВСТУПЛЕНИЯ зрителя — обязательный channel.date краткой
		        -- формы (DialogRecord.ToChannel). Выборка идёт ОТ его строки
		        -- членства, так что она здесь есть всегда.
		        m.joined_at,
		        -- Поля полного channel зрителя (DialogRecord.ToChannel): без них
		        -- строка списка затирала на клиенте карточку чата.
		        c.member_count, m.role, m.rights, c.signatures, c.signature_profiles,
		        COALESCE(c.discussion_chat_id,0), c.default_permissions,
		        c.slowmode_seconds, c.charge_stars
		 FROM chat_members m
		 JOIN chats c ON c.id = m.chat_id
		 -- stripped-превью фото группы/канала — из media по photo_media_id
		 LEFT JOIN media pm ON pm.id = c.photo_media_id
		 -- Последнее ВИДИМОЕ зрителю сообщение: «удалить у себя»
		 -- (message_hides) отсекается тем же условием, что в GetHistory, —
		 -- иначе список показывает последним то, чего в открытом чате нет.
		 -- По lm.created_at идёт и сортировка, так что порядок списка тоже
		 -- считается по видимому последнему.
		 LEFT JOIN LATERAL (
		   SELECT id, seq, created_at
		   FROM messages
		   WHERE chat_id = c.id AND deleted_at IS NULL AND seq > m.cleared_max_seq
		     AND NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.msg_id = messages.id AND h.user_id = $1)
		   ORDER BY seq DESC LIMIT 1
		 ) lm ON true
		 LEFT JOIN LATERAL (
		   SELECT u.id, u.first_name, u.last_name, u.username, u.avatar_media_id, u.avatar_preview,
		          u.is_bot, u.is_verified, u.is_premium, u.emoji_status, u.deleted_at IS NOT NULL AS deleted,
		          u.is_service
		   FROM chat_members om JOIN users u ON u.id = om.user_id
		   WHERE om.chat_id = c.id AND om.user_id <> $1
		   LIMIT 1
		 ) peer ON c.type = 'private'
		 WHERE m.user_id = $1
		   -- «Удалить чат» в личке прячет строку до следующего сообщения
		   -- (ChatRepo.SetDialogHidden / ShowDialogs).
		   AND NOT m.dialog_hidden
		   -- Скрываем служебные группы обсуждения канала: доступ к ним только через
		   -- «Комментарии» (тред), в списке диалогов они не нужны.
		   AND c.id NOT IN (SELECT discussion_chat_id FROM chats WHERE discussion_chat_id IS NOT NULL)
		 -- закреплённые сверху (свежий пин — первым), затем по дате последнего
		 -- сообщения; c.id — тайбрейк, без него порядок при равных ключах не
		 -- определён и курсор пагинации невоспроизводим (см. спеку этапа 2)
		 ORDER BY m.pinned_at DESC NULLS LAST, lm.created_at DESC NULLS LAST, c.id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	now := time.Now()
	var out []domain.DialogRecord
	for rows.Next() {
		var d domain.DialogRecord
		var muteUntil *time.Time
		var archived bool
		var notifyPreview *bool
		var notifySound *string
		var topMessageID *int64
		var peerID *int64
		var peer userSeenScan
		var rights, perms int
		if err := rows.Scan(&d.ChatID, &d.Type, &d.Title, &d.Username, &d.PhotoID, &d.PhotoPreview,
			&d.LastReadSeq, &d.UnreadCount, &d.UnreadMentionsCount, &d.UnreadReactionsCount,
			&muteUntil, &d.Pinned, &archived, &d.IsForum, &notifyPreview, &notifySound, &d.PeerReadSeq,
			&topMessageID, &d.TopMessageSeq,
			&peerID, &peer.firstName, &peer.lastName, &peer.username, &peer.photoID, &peer.photoPreview,
			&peer.isBot, &peer.isVerified, &peer.isPremium, &peer.emojiStatus, &peer.deleted, &peer.isService,
			&peer.contactName, &peer.mutual,
			&d.TTLPeriod, &d.JoinedAt,
			&d.MemberCount, &d.MyRole, &rights, &d.Signatures, &d.SignatureProfiles,
			&d.DiscussionChatID, &perms, &d.Settings.SlowmodeSeconds, &d.Settings.ChargeStars); err != nil {
			return nil, err
		}
		d.MyRights = domain.Rights(rights)
		d.Settings.DefaultPerms = domain.MemberPerms(perms)
		if archived {
			d.Folder = domain.FolderArchive
		}
		d.NotifySettings = peerNotifySettings(muteUntil, notifyPreview, notifySound, now)
		if topMessageID != nil {
			d.TopMessageID = *topMessageID
		}
		if peerID != nil {
			peer.id = *peerID
			u := peer.user(true)
			d.Peer = &u
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// IncUnread bumps a member's unread counter by one and returns the new value.
func (r *ChatsRepo) IncUnread(ctx context.Context, chatID, userID int64) (int, error) {
	q := querier(ctx, r.pool)
	var n int
	err := q.QueryRow(ctx,
		`UPDATE chat_members SET unread_count = unread_count + 1 WHERE chat_id=$1 AND user_id=$2 RETURNING unread_count`,
		chatID, userID).Scan(&n)
	return n, err
}

// ForgetUnread — см. ChatRepo.ForgetUnread. Условие «ещё непрочитано» то же,
// что у пересчёта при прочтении (MessagesRepo.CountUnread: не автор, seq выше
// горизонта), плюс поле зрения участника (messageInViewOf): сообщение, которое
// он не видит — очищенное, скрытое у себя, предыстория до его вступления, —
// в его счётчик не входило, и вычитать его нечего.
func (r *ChatsRepo) ForgetUnread(ctx context.Context, chatID, senderID, seq int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chat_members cm SET unread_count = cm.unread_count - 1
		   FROM messages m
		  WHERE m.chat_id = $1 AND m.seq = $3
		    AND cm.chat_id = $1 AND cm.user_id <> $2 AND cm.last_read_seq < $3
		    AND cm.unread_count > 0
		    AND `+messageInViewOf("m", "cm.user_id"), chatID, senderID, seq)
	return err
}

// IncUnreadBulk bumps unread_count by one for many members of a chat in a single
// query (vs IncUnread × N). Returns the new count per user.
func (r *ChatsRepo) IncUnreadBulk(ctx context.Context, chatID int64, userIDs []int64) (map[int64]int64, error) {
	out := make(map[int64]int64, len(userIDs))
	if len(userIDs) == 0 {
		return out, nil
	}
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`UPDATE chat_members SET unread_count = unread_count + 1
		 WHERE chat_id=$1 AND user_id = ANY($2::bigint[])
		 RETURNING user_id, unread_count`, chatID, userIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var uid, n int64
		if err := rows.Scan(&uid, &n); err != nil {
			return nil, err
		}
		out[uid] = n
	}
	return out, rows.Err()
}

// RecountUnreadReactions — см. ChatRepo.RecountUnreadReactions: число
// СООБЩЕНИЙ участника с непрочитанной реакцией (Telegram
// unread_reactions_count), а не число событий. Удалённое и невидимое ему
// (очищенное, скрытое у себя) не в счёт — по тому же предикату, что лента.
func (r *ChatsRepo) RecountUnreadReactions(ctx context.Context, chatID, userID int64) (int, error) {
	var n int
	err := querier(ctx, r.pool).QueryRow(ctx, recountUnreadReactionsSQL+` RETURNING unread_reactions`,
		chatID, userID).Scan(&n)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil // не участник — счётчика нет
	}
	return n, err
}

// recountUnreadReactionsSQL — пересчёт ❤ участника $2 в чате $1: число его
// видимых ему сообщений с непрочитанной реакцией. Одна формула на все пути
// (реакция, прочтение, удаление у всех и у себя).
var recountUnreadReactionsSQL = `UPDATE chat_members SET unread_reactions = (
     SELECT count(DISTINCT m.id) FROM messages m
       JOIN reactions re ON re.message_id = m.id AND re.unread
      WHERE m.chat_id = $1 AND m.sender_id = $2 AND ` + messageVisibleTo("m", "$2") + `)
  WHERE chat_id = $1 AND user_id = $2`

// ReadReactions — см. ChatRepo.ReadReactions.
func (r *ChatsRepo) ReadReactions(ctx context.Context, chatID, userID, uptoSeq int64) ([]domain.Message, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`WITH hit AS (
		   UPDATE reactions re SET unread = false
		     FROM messages m
		    WHERE re.message_id = m.id AND re.unread
		      AND m.chat_id = $1 AND m.sender_id = $2 AND m.seq <= $3
		   RETURNING m.id)
		 SELECT `+messageColsPrefixed("m")+`
		   FROM messages m WHERE m.id IN (SELECT id FROM hit) AND `+messageVisibleTo("m", "$2")+`
		  ORDER BY m.seq`, chatID, userID, uptoSeq)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Message
	for rows.Next() {
		m, e := scanMessage(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if _, err := r.RecountUnreadReactions(ctx, chatID, userID); err != nil {
		return nil, err
	}
	return out, nil
}

// CurrentReadSeq returns a member's current last_read_seq.
func (r *ChatsRepo) CurrentReadSeq(ctx context.Context, chatID, userID int64) (int64, error) {
	q := querier(ctx, r.pool)
	var cur int64
	err := q.QueryRow(ctx,
		`SELECT last_read_seq FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID).Scan(&cur)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return cur, err
}

// SetRead sets a member's last_read_seq and unread_count. last_read_at is bumped
// to now() only when the horizon actually advances (seq > old last_read_seq), so
// the read-date reflects when the last message was read, not every chat re-open.
func (r *ChatsRepo) SetRead(ctx context.Context, chatID, userID, seq int64, unread int) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx,
		`UPDATE chat_members
		    SET last_read_at = CASE WHEN $3 > last_read_seq THEN now() ELSE last_read_at END,
		        last_read_seq = $3,
		        unread_count = $4
		  WHERE chat_id=$1 AND user_id=$2`, chatID, userID, seq, unread)
	return err
}

// ReadMarkRetention — насколько назад держим историю горизонта чтения. Дата
// прочтения нужна только у свежих сообщений (как в Telegram), а таблица при
// этом не растёт бесконечно.
const ReadMarkRetention = 30 * 24 * time.Hour

// AppendReadMark записывает продвижение горизонта чтения (up_to_seq на момент
// read_at) и подчищает отметки старше ReadMarkRetention у той же пары. Вызывать
// ТОЛЬКО когда горизонт реально сдвинулся — иначе таблица наберёт дубли времени
// на каждое переоткрытие чата.
func (r *ChatsRepo) AppendReadMark(ctx context.Context, chatID, userID, upToSeq int64) error {
	q := querier(ctx, r.pool)
	if _, err := q.Exec(ctx,
		`INSERT INTO chat_read_marks (chat_id, user_id, up_to_seq) VALUES ($1, $2, $3)
		 ON CONFLICT (chat_id, user_id, up_to_seq) DO NOTHING`,
		chatID, userID, upToSeq); err != nil {
		return err
	}
	_, err := q.Exec(ctx,
		`DELETE FROM chat_read_marks WHERE chat_id=$1 AND user_id=$2 AND read_at < now() - $3::interval`,
		chatID, userID, ReadMarkRetention.String())
	return err
}

// ReadAtForSeq возвращает, когда userID прочитал сообщение с данным seq:
// read_at ближайшей сверху отметки горизонта (минимальный up_to_seq >= seq).
// ok=false — такой отметки нет (сообщение ещё не прочитано либо его отметка уже
// вышла за retention).
func (r *ChatsRepo) ReadAtForSeq(ctx context.Context, chatID, userID, seq int64) (time.Time, bool, error) {
	q := querier(ctx, r.pool)
	var at time.Time
	err := q.QueryRow(ctx,
		`SELECT read_at FROM chat_read_marks
		  WHERE chat_id=$1 AND user_id=$2 AND up_to_seq >= $3
		  ORDER BY up_to_seq ASC LIMIT 1`,
		chatID, userID, seq).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, false, nil
	}
	if err != nil {
		return time.Time{}, false, err
	}
	return at, true, nil
}

// LastReadAt returns when userID last advanced their read horizon in the chat.
// ok=false when last_read_at is NULL (member has never read anything).
func (r *ChatsRepo) LastReadAt(ctx context.Context, chatID, userID int64) (time.Time, bool, error) {
	q := querier(ctx, r.pool)
	var at *time.Time
	err := q.QueryRow(ctx,
		`SELECT last_read_at FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, false, domain.ErrNotFound
	}
	if err != nil {
		return time.Time{}, false, err
	}
	if at == nil {
		return time.Time{}, false, nil
	}
	return *at, true, nil
}

// AddMention records that userID is mentioned in a message (chat/msg/seq) and
// bumps their unread-mentions counter. Idempotent on (message_id, user_id): a
// re-send with the same message never double-counts.
func (r *ChatsRepo) AddMention(ctx context.Context, chatID, msgID, seq, userID int64) error {
	q := querier(ctx, r.pool)
	tag, err := q.Exec(ctx,
		`INSERT INTO message_mentions (chat_id, message_id, seq, user_id)
		 VALUES ($1,$2,$3,$4) ON CONFLICT (message_id, user_id) DO NOTHING`,
		chatID, msgID, seq, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return nil // already recorded — don't double-bump the counter
	}
	_, err = q.Exec(ctx,
		`UPDATE chat_members SET unread_mentions_count = unread_mentions_count + 1
		 WHERE chat_id=$1 AND user_id=$2`, chatID, userID)
	return err
}

// MemberIDsByUsernames resolves @username mentions to the chat's members
// (case-insensitive: users.username is CITEXT). Chat usernames share the
// namespace (0134) but name a chat, not a user, so they never match here.
func (r *ChatsRepo) MemberIDsByUsernames(ctx context.Context, chatID int64, usernames []string) ([]int64, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT u.id FROM users u
		 JOIN chat_members m ON m.user_id = u.id AND m.chat_id = $1
		 WHERE u.username = ANY($2::citext[])`, chatID, usernames)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ClearMentions marks the member's mentions with seq<=uptoSeq read (the row —
// the fact of the mention, message.mentioned — stays) and re-syncs
// unread_mentions_count to the still-unread rows, which it returns.
func (r *ChatsRepo) ClearMentions(ctx context.Context, chatID, userID, uptoSeq int64) (int, error) {
	q := querier(ctx, r.pool)
	if _, err := q.Exec(ctx,
		`UPDATE message_mentions SET unread=false
		 WHERE chat_id=$1 AND user_id=$2 AND seq<=$3 AND unread`,
		chatID, userID, uptoSeq); err != nil {
		return 0, err
	}
	return r.syncUnreadMentions(ctx, chatID, userID)
}

// syncUnreadMentions пересчитывает unread_mentions_count участника по
// непрочитанным строкам message_mentions (их и возвращает).
func (r *ChatsRepo) syncUnreadMentions(ctx context.Context, chatID, userID int64) (int, error) {
	q := querier(ctx, r.pool)
	var remaining int
	if err := q.QueryRow(ctx,
		`SELECT count(*) FROM message_mentions WHERE chat_id=$1 AND user_id=$2 AND unread`,
		chatID, userID).Scan(&remaining); err != nil {
		return 0, err
	}
	_, err := q.Exec(ctx,
		`UPDATE chat_members SET unread_mentions_count=$3 WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID, remaining)
	return remaining, err
}

// ReadMention marks one mention read (Telegram readMessageContents on a
// mention): reports whether it was unread, and then re-syncs the counter.
func (r *ChatsRepo) ReadMention(ctx context.Context, chatID, msgID, userID int64) (bool, error) {
	q := querier(ctx, r.pool)
	tag, err := q.Exec(ctx,
		`UPDATE message_mentions SET unread=false WHERE message_id=$1 AND user_id=$2 AND unread`,
		msgID, userID)
	if err != nil || tag.RowsAffected() == 0 {
		return false, err
	}
	_, err = r.syncUnreadMentions(ctx, chatID, userID)
	return true, err
}

// RemoveMention drops a mention the message no longer carries (an edit removed
// it) and re-syncs the member's counter.
func (r *ChatsRepo) RemoveMention(ctx context.Context, chatID, msgID, userID int64) error {
	q := querier(ctx, r.pool)
	tag, err := q.Exec(ctx,
		`DELETE FROM message_mentions WHERE message_id=$1 AND user_id=$2`, msgID, userID)
	if err != nil || tag.RowsAffected() == 0 {
		return err
	}
	_, err = r.syncUnreadMentions(ctx, chatID, userID)
	return err
}

// MessageMentions — who a message mentions: userID -> still unread.
func (r *ChatsRepo) MessageMentions(ctx context.Context, msgID int64) (map[int64]bool, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT user_id, unread FROM message_mentions WHERE message_id=$1`, msgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]bool{}
	for rows.Next() {
		var uid int64
		var unread bool
		if err := rows.Scan(&uid, &unread); err != nil {
			return nil, err
		}
		out[uid] = unread
	}
	return out, rows.Err()
}

// ViewerMentions — which of msgIDs mention userID: msgID -> still unread.
func (r *ChatsRepo) ViewerMentions(ctx context.Context, userID int64, msgIDs []int64) (map[int64]bool, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT message_id, unread FROM message_mentions
		 WHERE user_id=$1 AND message_id = ANY($2::bigint[])`, userID, msgIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]bool{}
	for rows.Next() {
		var mid int64
		var unread bool
		if err := rows.Scan(&mid, &unread); err != nil {
			return nil, err
		}
		out[mid] = unread
	}
	return out, rows.Err()
}

// NextMention returns the number (seq) of the member's earliest unread mention
// past afterSeq; domain.ErrNotFound when there is none.
func (r *ChatsRepo) NextMention(ctx context.Context, chatID, userID, afterSeq int64) (int64, error) {
	q := querier(ctx, r.pool)
	var seq int64
	err := q.QueryRow(ctx,
		`SELECT seq FROM message_mentions
		 WHERE chat_id=$1 AND user_id=$2 AND seq>$3 AND unread
		 ORDER BY seq ASC LIMIT 1`, chatID, userID, afterSeq).Scan(&seq)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return seq, err
}

// MaxSeq returns the chat's current maximum sequence (chats.last_seq), i.e. the
// horizon «Очистить историю» clamps to; domain.ErrNotFound if the chat is gone.
func (r *ChatsRepo) MaxSeq(ctx context.Context, chatID int64) (int64, error) {
	q := querier(ctx, r.pool)
	var seq int64
	err := q.QueryRow(ctx, `SELECT last_seq FROM chats WHERE id=$1`, chatID).Scan(&seq)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return seq, err
}

// UnarchiveUnmuted — см. ChatRepo.UnarchiveUnmuted. «Заглушён» — мьют чата
// сроком в будущем (тот же срок, что читает PeerNotifySettings.Muted).
func (r *ChatsRepo) UnarchiveUnmuted(ctx context.Context, chatID int64, userIDs []int64) ([]int64, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`UPDATE chat_members SET archived = false
		  WHERE chat_id = $1 AND user_id = ANY($2::bigint[]) AND archived
		    AND (muted_until IS NULL OR muted_until <= now())
		  RETURNING user_id`, chatID, userIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// VisibleSeqsUpTo — номера сообщений чата с seq<=maxSeq, видимых участнику
// (messageVisibleTo), по возрастанию: что именно пропадёт у него при очистке
// истории и удалении диалога — по ним уходят кадры удаления его устройствам.
func (r *ChatsRepo) VisibleSeqsUpTo(ctx context.Context, chatID, userID, maxSeq int64) ([]int64, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT m.seq FROM messages m
		  WHERE m.chat_id = $1 AND m.seq <= $3 AND `+messageVisibleTo("m", "$2")+`
		  ORDER BY m.seq`, chatID, userID, maxSeq)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var seq int64
		if err := rows.Scan(&seq); err != nil {
			return nil, err
		}
		out = append(out, seq)
	}
	return out, rows.Err()
}

// SetDialogHidden — см. ChatRepo.SetDialogHidden.
func (r *ChatsRepo) SetDialogHidden(ctx context.Context, chatID, userID int64, hidden bool) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chat_members SET dialog_hidden = $3 WHERE chat_id = $1 AND user_id = $2`, chatID, userID, hidden)
	return err
}

// ShowDialogs — см. ChatRepo.ShowDialogs.
func (r *ChatsRepo) ShowDialogs(ctx context.Context, chatID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chat_members SET dialog_hidden = false WHERE chat_id = $1 AND dialog_hidden`, chatID)
	return err
}

// RecountCounters — см. ChatRepo.RecountCounters. Формулы те же, что у
// пересчёта при прочтении (CountUnread), у syncUnreadMentions и у
// RecountUnreadReactions; упоминания удалённых сообщений чата выбрасываются
// первыми. Непрочитанное broadcast-канала считается на чтении
// (dialogUnreadCount), его хранимый счётчик не трогается.
func (r *ChatsRepo) RecountCounters(ctx context.Context, chatID int64, userIDs []int64) error {
	if len(userIDs) == 0 {
		return nil
	}
	q := querier(ctx, r.pool)
	if _, err := q.Exec(ctx,
		`DELETE FROM message_mentions mm USING messages m
		  WHERE mm.chat_id = $1 AND m.id = mm.message_id AND m.deleted_at IS NOT NULL`, chatID); err != nil {
		return err
	}
	_, err := q.Exec(ctx,
		`UPDATE chat_members cm SET
		    unread_count = CASE WHEN c.type = 'channel' THEN cm.unread_count ELSE (
		        SELECT count(*) FROM messages m
		         WHERE m.chat_id = cm.chat_id AND m.seq > cm.last_read_seq AND m.sender_id <> cm.user_id
		           AND `+messageVisibleTo("m", "cm.user_id")+`) END,
		    unread_mentions_count = (
		        SELECT count(*) FROM message_mentions mm JOIN messages m ON m.id = mm.message_id
		         WHERE mm.chat_id = cm.chat_id AND mm.user_id = cm.user_id AND mm.unread
		           AND `+messageVisibleTo("m", "cm.user_id")+`),
		    unread_reactions = (
		        SELECT count(DISTINCT m.id) FROM messages m
		          JOIN reactions re ON re.message_id = m.id AND re.unread
		         WHERE m.chat_id = cm.chat_id AND m.sender_id = cm.user_id
		           AND `+messageVisibleTo("m", "cm.user_id")+`)
		   FROM chats c
		  WHERE c.id = cm.chat_id AND cm.chat_id = $1 AND cm.user_id = ANY($2::bigint[])`, chatID, userIDs)
	return err
}

// DropMessageMentions — см. ChatRepo.DropMessageMentions.
func (r *ChatsRepo) DropMessageMentions(ctx context.Context, chatID, msgID int64) error {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`DELETE FROM message_mentions WHERE message_id = $1 RETURNING user_id`, msgID)
	if err != nil {
		return err
	}
	var users []int64
	for rows.Next() {
		var uid int64
		if err := rows.Scan(&uid); err != nil {
			rows.Close()
			return err
		}
		users = append(users, uid)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, uid := range users {
		if _, err := r.syncUnreadMentions(ctx, chatID, uid); err != nil {
			return err
		}
	}
	return nil
}

// DropUserMentions — см. ChatRepo.DropUserMentions.
func (r *ChatsRepo) DropUserMentions(ctx context.Context, chatID, userID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM message_mentions WHERE chat_id = $1 AND user_id = $2`, chatID, userID)
	return err
}

// SetClearedSeq raises a member's cleared horizon: messages with seq<=seq are
// hidden from that member's history reads (non-destructive «clear for me»).
func (r *ChatsRepo) SetClearedSeq(ctx context.Context, chatID, userID, seq int64) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx,
		`UPDATE chat_members SET cleared_max_seq=$3 WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID, seq)
	return err
}

// PinMessage pins a message in a chat (idempotent).
func (r *ChatsRepo) PinMessage(ctx context.Context, chatID, msgID, byUser int64) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx,
		`INSERT INTO pinned_messages (chat_id, msg_id, pinned_by) VALUES ($1,$2,$3)
		 ON CONFLICT (chat_id, msg_id) DO NOTHING`, chatID, msgID, byUser)
	return err
}

// UnpinMessage removes a pin.
func (r *ChatsRepo) UnpinMessage(ctx context.Context, chatID, msgID int64) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx, `DELETE FROM pinned_messages WHERE chat_id=$1 AND msg_id=$2`, chatID, msgID)
	return err
}

// PinnedIDs — см. ChatRepo.PinnedIDs.
func (r *ChatsRepo) PinnedIDs(ctx context.Context, msgIDs []int64) (map[int64]bool, error) {
	out := make(map[int64]bool)
	if len(msgIDs) == 0 {
		return out, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT msg_id FROM pinned_messages WHERE msg_id = ANY($1::bigint[])`, msgIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// ListPins returns the chat's pinned messages, newest pin first.
func (r *ChatsRepo) ListPins(ctx context.Context, chatID int64) ([]domain.Message, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT `+messageColsPrefixed("m")+`
		 FROM pinned_messages p JOIN messages m ON m.id=p.msg_id
		 WHERE p.chat_id=$1 AND m.deleted_at IS NULL ORDER BY p.pinned_at DESC`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Message
	for rows.Next() {
		m, e := scanMessage(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Viewers returns the ids of members who have read up to at least seq, excluding
// the message's sender (the "seen by" list for a message).
func (r *ChatsRepo) Viewers(ctx context.Context, chatID, seq, excludeUser int64) ([]int64, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT user_id FROM chat_members WHERE chat_id=$1 AND last_read_seq>=$2 AND user_id<>$3 ORDER BY user_id`,
		chatID, seq, excludeUser)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if e := rows.Scan(&id); e != nil {
			return nil, e
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// SetAutoDelete задаёт период автоудаления чата (0 — выключить).
func (r *ChatsRepo) SetAutoDelete(ctx context.Context, chatID int64, seconds int) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET auto_delete_period=$2 WHERE id=$1`, chatID, seconds)
	return err
}

// SetChatTheme задаёт тему оформления чата (upsert); themeID="" — сброс (удаление).
func (r *ChatsRepo) SetChatTheme(ctx context.Context, chatID int64, themeID string, setBy int64) error {
	q := querier(ctx, r.pool)
	if themeID == "" {
		_, err := q.Exec(ctx, `DELETE FROM chat_theme WHERE chat_id=$1`, chatID)
		return err
	}
	_, err := q.Exec(ctx,
		`INSERT INTO chat_theme (chat_id, theme_id, set_by, updated_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (chat_id) DO UPDATE SET theme_id=EXCLUDED.theme_id, set_by=EXCLUDED.set_by, updated_at=now()`,
		chatID, themeID, setBy)
	return err
}

// UserAutoDelete — глобальный период автоудаления пользователя (для новых чатов).
func (r *ChatsRepo) UserAutoDelete(ctx context.Context, userID int64) (int, error) {
	var p int
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT auto_delete_period FROM users WHERE id=$1`, userID).Scan(&p)
	return p, err
}

// SetUserAutoDelete сохраняет глобальный период автоудаления пользователя.
func (r *ChatsRepo) SetUserAutoDelete(ctx context.Context, userID int64, seconds int) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE users SET auto_delete_period=$2 WHERE id=$1`, userID, seconds)
	return err
}
