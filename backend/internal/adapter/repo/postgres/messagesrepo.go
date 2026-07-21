package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// MessagesRepo is a postgres-backed adapter implementing the chat usecase's MessageRepo port.
type MessagesRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.MessageRepo = (*MessagesRepo)(nil)

func NewMessagesRepo(pool *pgxpool.Pool) *MessagesRepo { return &MessagesRepo{pool: pool} }

// The full ordered column list every message SELECT/RETURNING uses, so the scan
// order in scanMessage stays in sync across all queries.
const messageCols = `id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, media_id, created_at, deleted_at, thread_root_id, edited_at, fwd_from_user_id, fwd_from_chat_id, fwd_from_msg_id, fwd_date, fwd_from_name, entities, views, media_unread, grouped_id, poll_id, geo_lat, geo_lng, contact_user_id, contact_name, contact_phone, gift_id, reply_markup, geo_meta, enc_body, ttl_seconds, destruct_at, forwards, reply_quote_text, reply_quote_offset, web_page`

// messageColsPrefixed returns messageCols with each column qualified by a table
// alias (for JOINs where bare column names like chat_id would be ambiguous).
func messageColsPrefixed(alias string) string {
	cols := strings.Split(messageCols, ", ")
	for i, c := range cols {
		cols[i] = alias + "." + c
	}
	return strings.Join(cols, ", ")
}

// NextSeq atomically increments and returns the chat's sequence counter.
func (r *MessagesRepo) NextSeq(ctx context.Context, chatID int64) (int64, error) {
	q := querier(ctx, r.pool)
	var seq int64
	err := q.QueryRow(ctx,
		`UPDATE chats SET last_seq = last_seq + 1 WHERE id=$1 RETURNING last_seq`,
		chatID).Scan(&seq)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return seq, err
}

// FindByClientMsgID returns an existing message for idempotent sends, or domain.ErrNotFound.
func (r *MessagesRepo) FindByClientMsgID(ctx context.Context, chatID, senderID int64, clientMsgID string) (domain.Message, error) {
	q := querier(ctx, r.pool)
	return scanOneMessage(q.QueryRow(ctx,
		`SELECT `+messageCols+` FROM messages WHERE chat_id=$1 AND sender_id=$2 AND client_msg_id=$3`,
		chatID, senderID, clientMsgID))
}

// GetByID returns a single message by id, or domain.ErrNotFound.
func (r *MessagesRepo) GetByID(ctx context.Context, msgID int64) (domain.Message, error) {
	q := querier(ctx, r.pool)
	return scanOneMessage(q.QueryRow(ctx,
		`SELECT `+messageCols+` FROM messages WHERE id=$1`, msgID))
}

// GetAround returns a window of messages centered on centerSeq (older + the
// message + newer), ascending, excluding deleted/self-hidden, plus whether the
// real top/bottom of history was reached. Used for jump-to-message.
// clearedSeq — персональный горизонт «очистки истории»: сообщения с seq<=clearedSeq
// скрыты для этого читателя (0 — ничего не очищено).
func (r *MessagesRepo) GetAround(ctx context.Context, chatID, userID, centerSeq int64, limit int, threadRootID *int64, clearedSeq int64) ([]domain.Message, bool, bool, error) {
	if limit <= 0 {
		limit = 40
	}
	half := limit / 2
	q := querier(ctx, r.pool)
	const excl = ` AND deleted_at IS NULL AND messages.seq>$6 AND NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.msg_id=messages.id AND h.user_id=$4) AND ((SELECT history_for_new FROM chats WHERE id=$1) OR messages.created_at >= COALESCE((SELECT cm.joined_at FROM chat_members cm WHERE cm.chat_id=$1 AND cm.user_id=$4 AND cm.role='member'), 'epoch'::timestamptz)) AND ($5::bigint IS NULL OR thread_root_id=$5 OR id=$5)`
	scan := func(rows pgx.Rows, err error) ([]domain.Message, error) {
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
	// Fetch up to `limit` on each side (older incl. center DESC, newer ASC), then
	// keep `limit` total centered on the message. When one side is short (a jump
	// near the very top/bottom of history), the deficit is filled from the other
	// side so the window is always ~limit messages — otherwise an edge jump returns
	// a tiny window with no room to scroll, and scroll-to-load can't engage (tweb
	// keeps the focused message centered but still returns a full page).
	older, err := scan(q.Query(ctx,
		`SELECT `+messageCols+` FROM messages WHERE chat_id=$1 AND seq<=$2`+excl+` ORDER BY seq DESC LIMIT $3`,
		chatID, centerSeq, limit, userID, threadRootID, clearedSeq))
	if err != nil {
		return nil, false, false, err
	}
	newer, err := scan(q.Query(ctx,
		`SELECT `+messageCols+` FROM messages WHERE chat_id=$1 AND seq>$2`+excl+` ORDER BY seq ASC LIMIT $3`,
		chatID, centerSeq, limit, userID, threadRootID, clearedSeq))
	if err != nil {
		return nil, false, false, err
	}
	wantOlder := half + 1          // older includes the centered message
	wantNewer := limit - wantOlder // the rest below it
	takeOlder := min(len(older), wantOlder)
	takeNewer := min(len(newer), wantNewer)
	if d := wantOlder - takeOlder; d > 0 { // short on top → take more below
		takeNewer = min(len(newer), takeNewer+d)
	}
	if d := wantNewer - takeNewer; d > 0 { // short on bottom → take more above
		takeOlder = min(len(older), takeOlder+d)
	}
	// We hit the real top/bottom when we took everything that side returned AND
	// that query wasn't capped at `limit` (so nothing more exists beyond it).
	reachedTop := takeOlder == len(older) && len(older) < limit
	reachedBottom := takeNewer == len(newer) && len(newer) < limit
	// older is DESC → reverse the taken slice to ASC, then append the taken newer.
	out := make([]domain.Message, 0, takeOlder+takeNewer)
	for i := takeOlder - 1; i >= 0; i-- {
		out = append(out, older[i])
	}
	out = append(out, newer[:takeNewer]...)
	return out, reachedTop, reachedBottom, nil
}

// SearchMessages returns messages in a chat whose text OR attached media filename
// matches q (case-insensitive substring), newest first, plus the total match
// count. Excludes deleted. The LEFT JOIN on media lets a query like "report.pdf"
// or "song" find media messages by their file name, not just text/captions.
func (r *MessagesRepo) SearchMessages(ctx context.Context, chatID int64, q string, offset, limit int) ([]domain.Message, int, error) {
	qq := querier(ctx, r.pool)
	pattern := "%" + q + "%"
	const where = ` FROM messages m LEFT JOIN media md ON md.id = m.media_id
		WHERE m.chat_id=$1 AND m.deleted_at IS NULL AND (m.text ILIKE $2 OR md.file_name ILIKE $2)`
	var count int
	if err := qq.QueryRow(ctx, `SELECT count(*)`+where, chatID, pattern).Scan(&count); err != nil {
		return nil, 0, err
	}
	rows, err := qq.Query(ctx,
		`SELECT `+messageColsPrefixed("m")+where+`
		 ORDER BY m.seq DESC LIMIT $3 OFFSET $4`, chatID, pattern, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []domain.Message
	for rows.Next() {
		m, e := scanMessage(rows)
		if e != nil {
			return nil, 0, e
		}
		out = append(out, m)
	}
	return out, count, rows.Err()
}

// GlobalSearchMessages searches messages across every chat the user is a member
// of (tweb global search: «Сообщения» section + Media/Links/Files/Music/Voice
// tabs). q matches text or attached file name (case-insensitive substring);
// filter narrows by shared-media kind (same kinds as MediaHistory, "" = any
// type). Visibility mirrors GetHistory: deleted, per-user hides and hidden
// pre-join history are excluded. Newest first + total count.
func (r *MessagesRepo) GlobalSearchMessages(ctx context.Context, userID int64, q, filter string, offset, limit int) ([]domain.Message, int, error) {
	qq := querier(ctx, r.pool)
	where := ` FROM messages m
		JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $1
		LEFT JOIN media md ON md.id = m.media_id
		WHERE m.deleted_at IS NULL
		  AND NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.msg_id = m.id AND h.user_id = $1)
		  AND ((SELECT c.history_for_new FROM chats c WHERE c.id = m.chat_id)
		       OR cm.role <> 'member' OR m.created_at >= cm.joined_at)`
	switch filter {
	case "":
	case "media":
		where += ` AND m.type IN ('photo','video')`
	case "files":
		where += ` AND m.type = 'document'`
	case "music":
		where += ` AND m.type = 'audio'`
	case "voice":
		where += ` AND m.type IN ('voice','roundVideo')`
	case "links":
		where += ` AND m.type = 'text' AND m.text ~* 'https?://'`
	default:
		return nil, 0, nil
	}
	args := []any{userID}
	if q != "" {
		where += ` AND (m.text ILIKE $2 OR md.file_name ILIKE $2)`
		args = append(args, "%"+q+"%")
	}
	var count int
	if err := qq.QueryRow(ctx, `SELECT count(*)`+where, args...).Scan(&count); err != nil {
		return nil, 0, err
	}
	lim := fmt.Sprintf(` ORDER BY m.id DESC LIMIT $%d OFFSET $%d`, len(args)+1, len(args)+2)
	rows, err := qq.Query(ctx, `SELECT `+messageColsPrefixed("m")+where+lim, append(args, limit, offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []domain.Message
	for rows.Next() {
		m, e := scanMessage(rows)
		if e != nil {
			return nil, 0, e
		}
		out = append(out, m)
	}
	return out, count, rows.Err()
}

// MediaHistory returns a chat's messages of one shared-media kind (the
// profile's Media/Files/Links/Music/Voice tabs — tweb inputMessagesFilter*),
// newest first. "links" is text messages containing a URL; the rest filter by
// message type.
func (r *MessagesRepo) MediaHistory(ctx context.Context, chatID int64, filter string, offset, limit int) ([]domain.Message, int, error) {
	qq := querier(ctx, r.pool)
	var cond string
	switch filter {
	case "media":
		cond = `m.type IN ('photo','video')`
	case "files":
		cond = `m.type = 'document'`
	case "music":
		cond = `m.type = 'audio'`
	case "voice":
		cond = `m.type IN ('voice','roundVideo')`
	case "links":
		cond = `m.type = 'text' AND m.text ~* 'https?://'`
	default:
		return nil, 0, nil
	}
	where := ` FROM messages m WHERE m.chat_id=$1 AND m.deleted_at IS NULL AND ` + cond
	var count int
	if err := qq.QueryRow(ctx, `SELECT count(*)`+where, chatID).Scan(&count); err != nil {
		return nil, 0, err
	}
	rows, err := qq.Query(ctx,
		`SELECT `+messageColsPrefixed("m")+where+` ORDER BY m.seq DESC LIMIT $2 OFFSET $3`,
		chatID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []domain.Message
	for rows.Next() {
		m, e := scanMessage(rows)
		if e != nil {
			return nil, 0, e
		}
		out = append(out, m)
	}
	return out, count, rows.Err()
}

// ByPollID возвращает сообщения, ссылающиеся на опрос (обычно одно).
func (r *MessagesRepo) ByPollID(ctx context.Context, pollID int64) ([]domain.Message, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+messageCols+` FROM messages WHERE poll_id=$1 AND deleted_at IS NULL`, pollID)
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

// GetByIDs returns messages for the given ids (order unspecified); missing ids
// are simply absent. Empty input → empty result.
func (r *MessagesRepo) GetByIDs(ctx context.Context, ids []int64) ([]domain.Message, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx, `SELECT `+messageCols+` FROM messages WHERE id = ANY($1)`, ids)
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

// RegisterChannelViews records that userID has seen every channel post in chatID
// up to upToSeq, incrementing messages.views once per (post, user) pair. The
// message_views PK dedups re-reads (ON CONFLICT DO NOTHING), and the JOIN to
// chats gates this to channels — for non-channel chats it matches no rows and is
// a no-op, so callers can invoke it unconditionally on read.
func (r *MessagesRepo) RegisterChannelViews(ctx context.Context, chatID, userID, upToSeq int64) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx, `
		WITH ins AS (
			INSERT INTO message_views (message_id, user_id)
			SELECT m.id, $2
			FROM messages m
			JOIN chats c ON c.id = m.chat_id AND c.type = 'channel'
			WHERE m.chat_id = $1 AND m.seq <= $3 AND m.deleted_at IS NULL
			ON CONFLICT DO NOTHING
			RETURNING message_id
		)
		UPDATE messages m SET views = views + 1
		FROM ins WHERE m.id = ins.message_id`,
		chatID, userID, upToSeq)
	return err
}

// ViewCounts returns the current view count for each of the given message ids
// (missing ids are absent). Empty input → empty map.
func (r *MessagesRepo) ViewCounts(ctx context.Context, ids []int64) (map[int64]int64, error) {
	out := map[int64]int64{}
	if len(ids) == 0 {
		return out, nil
	}
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx, `SELECT id, views FROM messages WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, views int64
		if e := rows.Scan(&id, &views); e != nil {
			return nil, e
		}
		out[id] = views
	}
	return out, rows.Err()
}

// IncrementForwards bumps a post's forward counter (Telegram message.forwards)
// by one; called on each forward of the source message.
func (r *MessagesRepo) IncrementForwards(ctx context.Context, msgID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `UPDATE messages SET forwards = forwards + 1 WHERE id=$1`, msgID)
	return err
}

// Insert writes a new message row (incl. forward attribution when set).
func (r *MessagesRepo) Insert(ctx context.Context, m domain.Message) (domain.Message, error) {
	q := querier(ctx, r.pool)
	return scanOneMessage(q.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, media_id, thread_root_id, fwd_from_user_id, fwd_from_chat_id, fwd_from_msg_id, fwd_date, fwd_from_name, entities, media_unread, grouped_id, poll_id, geo_lat, geo_lng, contact_user_id, contact_name, contact_phone, gift_id, reply_markup, geo_meta, enc_body, ttl_seconds, destruct_at, reply_quote_text, reply_quote_offset, auto_delete_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,
		         (SELECT CASE WHEN auto_delete_period > 0
		                 THEN now() + make_interval(secs => auto_delete_period) END
		            FROM chats WHERE id=$1))
		 RETURNING `+messageCols,
		m.ChatID, m.Seq, m.SenderID, m.Type, m.Text, m.ReplyToID, m.ClientMsgID, m.MediaID, m.ThreadRootID,
		m.FwdFromUserID, m.FwdFromChatID, m.FwdFromMsgID, m.FwdDate, m.FwdFromName, entitiesParam(m.Entities), m.MediaUnread, m.GroupedID, m.PollID,
		m.GeoLat, m.GeoLng, m.ContactUserID, m.ContactName, m.ContactPhone, m.GiftID, replyMarkupParam(m.ReplyMarkup), geoMetaParam(m), m.EncBody, m.TTLSeconds, m.DestructAt, m.ReplyQuoteText, m.ReplyQuoteOffset))
}

// SetWebPage пишет серверное превью ссылки (jsonb web_page) отдельным UPDATE
// после коммита отправки; удалённое сообщение не трогаем.
func (r *MessagesRepo) SetWebPage(ctx context.Context, msgID int64, wp *domain.WebPagePreview) error {
	var param any // jsonb — строкой (см. entitiesParam); nil → NULL
	if wp != nil {
		b, err := json.Marshal(wp)
		if err != nil {
			return err
		}
		param = string(b)
	}
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE messages SET web_page=$2 WHERE id=$1 AND deleted_at IS NULL`, msgID, param)
	return err
}

// ClearMediaUnread drops the media_unread flag; reports whether the row
// actually changed (so the caller can skip fan-out on repeat plays).
func (r *MessagesRepo) ClearMediaUnread(ctx context.Context, msgID int64) (bool, error) {
	q := querier(ctx, r.pool)
	tag, err := q.Exec(ctx, `UPDATE messages SET media_unread=false WHERE id=$1 AND media_unread`, msgID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// UpdateText replaces a message's text and stamps edited_at=now(); returns the
// updated row.
func (r *MessagesRepo) UpdateText(ctx context.Context, msgID int64, text string, entities []domain.MessageEntity) (domain.Message, error) {
	q := querier(ctx, r.pool)
	return scanOneMessage(q.QueryRow(ctx,
		`UPDATE messages SET text=$2, entities=$3, edited_at=now() WHERE id=$1 RETURNING `+messageCols,
		msgID, text, entitiesParam(entities)))
}

// UpdateReplyMarkup replaces a message's inline/reply keyboard (edited_at=now());
// returns the updated row. Used by the Bot API editMessageReplyMarkup.
func (r *MessagesRepo) UpdateReplyMarkup(ctx context.Context, msgID int64, markup *domain.ReplyMarkup) (domain.Message, error) {
	q := querier(ctx, r.pool)
	return scanOneMessage(q.QueryRow(ctx,
		`UPDATE messages SET reply_markup=$2, edited_at=now() WHERE id=$1 RETURNING `+messageCols,
		msgID, replyMarkupParam(markup)))
}

// UpdateGeoLive обновляет координаты live-локации (+ heading/stopped в geo_meta),
// бампит edited_at (время последнего обновления). Остальные поля geo_meta
// (title/address/live_period) сохраняются jsonb-слиянием.
func (r *MessagesRepo) UpdateGeoLive(ctx context.Context, msgID int64, lat, lng float64, heading *int, stopped bool) (domain.Message, error) {
	q := querier(ctx, r.pool)
	return scanOneMessage(q.QueryRow(ctx,
		`UPDATE messages
		    SET geo_lat=$2, geo_lng=$3, edited_at=now(),
		        geo_meta = COALESCE(geo_meta,'{}'::jsonb)
		                   || jsonb_strip_nulls(jsonb_build_object('heading',$4::int,'stopped',$5::bool))
		  WHERE id=$1
		 RETURNING `+messageCols,
		msgID, lat, lng, heading, stopped))
}

// SoftDelete marks a message deleted for everyone (deleted_at=now()) и стирает
// шифртекст секретных сообщений (enc_body).
func (r *MessagesRepo) SoftDelete(ctx context.Context, msgID int64) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx, `UPDATE messages SET deleted_at=now(), text='', enc_body=NULL WHERE id=$1`, msgID)
	return err
}

// SetDestructOnRead ставит destruct_at = now()+ttl для секретных сообщений,
// которые читатель ПОЛУЧИЛ (sender_id <> readerID) до readSeq включительно и у
// которых задан ttl и таймер ещё не запущен. Идемпотентно; для не-секретных
// чатов no-op (там ttl_seconds всегда NULL).
func (r *MessagesRepo) SetDestructOnRead(ctx context.Context, chatID, readerID, readSeq int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE messages SET destruct_at = now() + make_interval(secs => ttl_seconds)
		  WHERE chat_id=$1 AND seq<=$2 AND sender_id<>$3
		    AND ttl_seconds IS NOT NULL AND destruct_at IS NULL AND deleted_at IS NULL`,
		chatID, readSeq, readerID)
	return err
}

// HideForUser hides a message for a single user ("delete for me"); idempotent.
func (r *MessagesRepo) HideForUser(ctx context.Context, userID, msgID int64) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx,
		`INSERT INTO message_hides (user_id, msg_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, msgID)
	return err
}

// GetHistory returns up to limit messages around offsetSeq, excluding messages
// the user hid for themselves. addOffset>0 fetches older messages (seq <
// offsetSeq); addOffset<=0 fetches newer (seq > offsetSeq); offsetSeq==0 means
// "from the newest".
// threadRootID != nil ограничивает окно тредом (форум-топик / комментарии):
// сообщения с этим thread_root_id плюс само корневое сообщение.
// clearedSeq — персональный горизонт «очистки истории»: сообщения с seq<=clearedSeq
// скрыты для этого читателя (0 — ничего не очищено).
func (r *MessagesRepo) GetHistory(ctx context.Context, chatID, userID, offsetSeq int64, addOffset, limit int, threadRootID *int64, clearedSeq int64) ([]domain.Message, error) {
	q := querier(ctx, r.pool)
	// Skip deleted (never shown) and rows this user hid for themselves. Placeholder
	// differs per query shape.
	// exclN also enforces hidden history (chats.history_for_new=false): a plain
	// member sees only messages sent after they joined; admins/creator see all.
	// The %[2]d placeholder is the per-member cleared horizon (seq>clearedSeq).
	const exclN = ` AND deleted_at IS NULL AND seq>$%[2]d AND NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.msg_id=messages.id AND h.user_id=$%[1]d) AND ((SELECT history_for_new FROM chats WHERE id=$1) OR messages.created_at >= COALESCE((SELECT cm.joined_at FROM chat_members cm WHERE cm.chat_id=$1 AND cm.user_id=$%[1]d AND cm.role='member'), 'epoch'::timestamptz))`
	const thrN = ` AND ($%d::bigint IS NULL OR thread_root_id=$%[1]d OR id=$%[1]d)`
	var rows pgx.Rows
	var err error
	switch {
	case offsetSeq == 0:
		rows, err = q.Query(ctx,
			`SELECT `+messageCols+` FROM messages WHERE chat_id=$1`+fmt.Sprintf(exclN, 3, 5)+fmt.Sprintf(thrN, 4)+` ORDER BY seq DESC LIMIT $2`,
			chatID, limit, userID, threadRootID, clearedSeq)
	case addOffset <= 0: // newer than offset
		rows, err = q.Query(ctx,
			`SELECT `+messageCols+` FROM messages WHERE chat_id=$1 AND seq>$2`+fmt.Sprintf(exclN, 4, 6)+fmt.Sprintf(thrN, 5)+` ORDER BY seq ASC LIMIT $3`,
			chatID, offsetSeq, limit, userID, threadRootID, clearedSeq)
	default: // older, inclusive of offset
		rows, err = q.Query(ctx,
			`SELECT `+messageCols+` FROM messages WHERE chat_id=$1 AND seq<=$2`+fmt.Sprintf(exclN, 4, 6)+fmt.Sprintf(thrN, 5)+` ORDER BY seq DESC LIMIT $3`,
			chatID, offsetSeq, limit, userID, threadRootID, clearedSeq)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Message
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// LastMessageAt is the newest non-deleted message time by senderID in chatID
// (slowmode check); domain.ErrNotFound when they haven't posted yet.
func (r *MessagesRepo) LastMessageAt(ctx context.Context, chatID, senderID int64) (time.Time, error) {
	var at time.Time
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT created_at FROM messages WHERE chat_id=$1 AND sender_id=$2 AND deleted_at IS NULL
		 ORDER BY seq DESC LIMIT 1`, chatID, senderID).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, domain.ErrNotFound
	}
	return at, err
}

// SavedDialogs groups the saved-messages chat by forward origin («Избранное» →
// таб «Чаты», tweb saved dialogs): origin group/channel → that chat, origin
// private → that user, own non-forwarded notes (или пересланное от себя) → 'self'.
// One row per group: the newest message + total count, newest group first.
func (r *MessagesRepo) SavedDialogs(ctx context.Context, chatID, userID int64) ([]domain.SavedDialog, error) {
	rows, err := querier(ctx, r.pool).Query(ctx, `
		WITH src AS (
			SELECT m.id, m.seq, m.type, m.text, m.media_id, m.created_at,
				CASE
					WHEN m.fwd_from_chat_id IS NULL THEN 'self'
					WHEN fc.type IN ('group','channel') THEN 'chat'
					WHEN COALESCE(m.fwd_from_user_id, $2) = $2 THEN 'self'
					ELSE 'user'
				END AS kind,
				CASE
					WHEN m.fwd_from_chat_id IS NULL THEN 0
					WHEN fc.type IN ('group','channel') THEN m.fwd_from_chat_id
					WHEN COALESCE(m.fwd_from_user_id, $2) = $2 THEN 0
					ELSE m.fwd_from_user_id
				END AS peer_id
			FROM messages m
			LEFT JOIN chats fc ON fc.id = m.fwd_from_chat_id
			WHERE m.chat_id = $1 AND m.deleted_at IS NULL
				AND NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.msg_id = m.id AND h.user_id = $2)
		),
		grouped AS (
			SELECT DISTINCT ON (kind, peer_id)
				kind, peer_id, id, type, text, media_id, created_at,
				count(*) OVER (PARTITION BY kind, peer_id) AS cnt
			FROM src ORDER BY kind, peer_id, seq DESC
		)
		SELECT g.kind, g.peer_id, g.id, g.type, g.text, g.media_id, g.created_at, g.cnt,
			CASE WHEN g.kind='chat' THEN c.title
			     WHEN g.kind='user' THEN COALESCE(NULLIF(u.first_name,''), u.display_name)
			     ELSE '' END,
			CASE WHEN g.kind='chat' THEN COALESCE('/media/'||c.photo_media_id||'/content','')
			     WHEN g.kind='user' THEN u.avatar_url
			     ELSE '' END
		FROM grouped g
		LEFT JOIN chats c ON g.kind='chat' AND c.id = g.peer_id
		LEFT JOIN users u ON g.kind='user' AND u.id = g.peer_id
		ORDER BY g.created_at DESC`, chatID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.SavedDialog{}
	for rows.Next() {
		var d domain.SavedDialog
		var title, photo *string
		if err := rows.Scan(&d.Kind, &d.PeerID, &d.Last.ID, &d.Last.Type, &d.Last.Text,
			&d.Last.MediaID, &d.Last.CreatedAt, &d.Count, &title, &photo); err != nil {
			return nil, err
		}
		if title != nil {
			d.Title = *title
		}
		if photo != nil {
			d.PhotoURL = *photo
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ListThread returns messages belonging to a thread (thread_root_id) in a chat,
// ascending by seq, excluding deleted messages.
func (r *MessagesRepo) ListThread(ctx context.Context, chatID, threadRootID int64, offset, limit int) ([]domain.Message, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT `+messageCols+`
		 FROM messages WHERE chat_id=$1 AND thread_root_id=$2 AND deleted_at IS NULL ORDER BY seq ASC LIMIT $3 OFFSET $4`,
		chatID, threadRootID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Message
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// CountThread returns the number of non-deleted messages in a thread.
func (r *MessagesRepo) CountThread(ctx context.Context, chatID, threadRootID int64) (int, error) {
	q := querier(ctx, r.pool)
	var n int
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM messages WHERE chat_id=$1 AND thread_root_id=$2 AND deleted_at IS NULL`,
		chatID, threadRootID).Scan(&n)
	return n, err
}

// CountMessages returns the total number of messages in a chat.
func (r *MessagesRepo) CountMessages(ctx context.Context, chatID int64) (int, error) {
	q := querier(ctx, r.pool)
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM messages WHERE chat_id=$1 AND deleted_at IS NULL`, chatID).Scan(&n)
	return n, err
}

// CountUnread returns messages in a chat with seq>afterSeq not sent by the user.
func (r *MessagesRepo) CountUnread(ctx context.Context, chatID, userID, afterSeq int64) (int, error) {
	q := querier(ctx, r.pool)
	var n int
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM messages WHERE chat_id=$1 AND seq>$2 AND sender_id<>$3 AND deleted_at IS NULL`,
		chatID, afterSeq, userID).Scan(&n)
	return n, err
}

// MessageChatID resolves a message id to its chat id. Returns domain.ErrNotFound
// if the message does not exist.
func (r *MessagesRepo) MessageChatID(ctx context.Context, messageID int64) (int64, error) {
	q := querier(ctx, r.pool)
	var chatID int64
	err := q.QueryRow(ctx, `SELECT chat_id FROM messages WHERE id=$1`, messageID).Scan(&chatID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return chatID, err
}

type scanner interface {
	Scan(dest ...any) error
}

// entitiesParam encodes message entities for the jsonb column: nil/empty → SQL
// NULL, otherwise the JSON text passed as a string so pgx stores it as jsonb
// (a []byte would be encoded as bytea).
func entitiesParam(es []domain.MessageEntity) any {
	if len(es) == 0 {
		return nil
	}
	b, err := json.Marshal(es)
	if err != nil {
		return nil
	}
	return string(b)
}

// replyMarkupParam кодирует клавиатуру в jsonb-строку (nil → NULL).
func replyMarkupParam(rm *domain.ReplyMarkup) any {
	if rm == nil {
		return nil
	}
	b, err := json.Marshal(rm)
	if err != nil {
		return nil
	}
	return string(b)
}

// geoMeta — jsonb-представление расширения гео (venue + live location).
type geoMeta struct {
	Title      *string `json:"title,omitempty"`
	Address    *string `json:"address,omitempty"`
	LivePeriod *int    `json:"live_period,omitempty"`
	Heading    *int    `json:"heading,omitempty"`
	Stopped    bool    `json:"stopped,omitempty"`
}

// geoMetaParam кодирует venue/live-поля в jsonb (nil, если ничего нет).
func geoMetaParam(m domain.Message) any {
	if m.GeoTitle == nil && m.GeoAddress == nil && m.GeoLivePeriod == nil && m.GeoHeading == nil && !m.GeoLiveStopped {
		return nil
	}
	b, err := json.Marshal(geoMeta{
		Title: m.GeoTitle, Address: m.GeoAddress, LivePeriod: m.GeoLivePeriod,
		Heading: m.GeoHeading, Stopped: m.GeoLiveStopped,
	})
	if err != nil {
		return nil
	}
	return string(b)
}

func scanMessage(s scanner) (domain.Message, error) {
	var m domain.Message
	var deletedAt *time.Time
	var entitiesRaw []byte
	var markupRaw []byte
	var geoMetaRaw []byte
	var webPageRaw []byte
	err := s.Scan(&m.ID, &m.ChatID, &m.Seq, &m.SenderID, &m.Type, &m.Text,
		&m.ReplyToID, &m.ClientMsgID, &m.MediaID, &m.CreatedAt, &deletedAt, &m.ThreadRootID,
		&m.EditedAt, &m.FwdFromUserID, &m.FwdFromChatID, &m.FwdFromMsgID, &m.FwdDate, &m.FwdFromName, &entitiesRaw, &m.Views, &m.MediaUnread, &m.GroupedID, &m.PollID,
		&m.GeoLat, &m.GeoLng, &m.ContactUserID, &m.ContactName, &m.ContactPhone, &m.GiftID, &markupRaw, &geoMetaRaw,
		&m.EncBody, &m.TTLSeconds, &m.DestructAt, &m.Forwards, &m.ReplyQuoteText, &m.ReplyQuoteOffset, &webPageRaw)
	m.Deleted = deletedAt != nil
	if err == nil && len(entitiesRaw) > 0 && string(entitiesRaw) != "null" {
		_ = json.Unmarshal(entitiesRaw, &m.Entities)
	}
	if err == nil && len(markupRaw) > 0 && string(markupRaw) != "null" {
		var rm domain.ReplyMarkup
		if json.Unmarshal(markupRaw, &rm) == nil {
			m.ReplyMarkup = &rm
		}
	}
	if err == nil && len(geoMetaRaw) > 0 && string(geoMetaRaw) != "null" {
		var gm geoMeta
		if json.Unmarshal(geoMetaRaw, &gm) == nil {
			m.GeoTitle, m.GeoAddress = gm.Title, gm.Address
			m.GeoLivePeriod, m.GeoHeading, m.GeoLiveStopped = gm.LivePeriod, gm.Heading, gm.Stopped
		}
	}
	if err == nil && len(webPageRaw) > 0 && string(webPageRaw) != "null" {
		var wp domain.WebPagePreview
		if json.Unmarshal(webPageRaw, &wp) == nil {
			m.WebPage = &wp
		}
	}
	return m, err
}

func scanOneMessage(row pgx.Row) (domain.Message, error) {
	m, err := scanMessage(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Message{}, domain.ErrNotFound
	}
	return m, err
}

// ExpiredMessages возвращает просроченные автоудалением сообщения (id, chat, seq)
// для фонового воркера.
func (r *MessagesRepo) ExpiredMessages(ctx context.Context, limit int) ([]domain.Message, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT id, chat_id, seq FROM messages
		  WHERE deleted_at IS NULL AND (
		        (auto_delete_at IS NOT NULL AND auto_delete_at <= now())
		     OR (destruct_at IS NOT NULL AND destruct_at <= now())
		  )
		  ORDER BY id LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Message
	for rows.Next() {
		var m domain.Message
		if err := rows.Scan(&m.ID, &m.ChatID, &m.Seq); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
