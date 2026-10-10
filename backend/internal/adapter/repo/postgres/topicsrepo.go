package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
)

// TopicsRepo хранит темы форум-групп (forum_topics).
type TopicsRepo struct {
	pool *pgxpool.Pool
}

func NewTopicsRepo(pool *pgxpool.Pool) *TopicsRepo { return &TopicsRepo{pool: pool} }

func (r *TopicsRepo) Create(ctx context.Context, t domain.ForumTopicRecord) (domain.ForumTopicRecord, error) {
	err := querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO forum_topics (chat_id, root_msg_id, title, icon_color, icon_emoji, created_by)
		 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
		t.ChatID, t.RootMsgID, t.Title, t.IconColor, t.IconEmoji, t.CreatedBy).Scan(&t.ID, &t.CreatedAt)
	return t, err
}

// topicCols — колонки темы плюс номер её корня (seq служебки создания; у
// General корня нет — 0). Таблица — t, корень — rm.
const topicCols = `t.id, t.chat_id, t.root_msg_id, COALESCE(rm.seq, 0), t.title, t.icon_color, t.icon_emoji,
	t.closed, t.hidden, t.pinned, t.pos, t.is_general, t.created_by, t.created_at`

func scanTopic(row pgx.Row) (domain.ForumTopicRecord, error) {
	var t domain.ForumTopicRecord
	err := row.Scan(&t.ID, &t.ChatID, &t.RootMsgID, &t.RootMsgSeq, &t.Title, &t.IconColor, &t.IconEmoji,
		&t.Closed, &t.Hidden, &t.Pinned, &t.Pos, &t.IsGeneral, &t.CreatedBy, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ForumTopicRecord{}, domain.ErrNotFound
	}
	return t, err
}

// ByNumber — тема по НОМЕРУ снаружи (domain.ForumTopicRecord.Number): номер
// служебки создания в чате, у General — domain.GeneralTopicID. Псевдоним 1
// побеждает: сообщение №1 форума — служебка создания самого чата, и TG
// адресует им General (tweb appMessagesManager.ts:13414-13420).
func (r *TopicsRepo) ByNumber(ctx context.Context, chatID, number int64) (domain.ForumTopicRecord, error) {
	return scanTopic(querier(ctx, r.pool).QueryRow(ctx, `
		SELECT `+topicCols+`
		  FROM forum_topics t
		  LEFT JOIN messages rm ON rm.id = t.root_msg_id
		 WHERE t.chat_id = $1
		   AND ((t.is_general AND $2::bigint = $3::bigint)
		     OR (NOT t.is_general AND rm.chat_id = $1 AND rm.seq = $2))
		 ORDER BY t.is_general DESC
		 LIMIT 1`, chatID, number, domain.GeneralTopicID))
}

// Update пишет изменяемые поля темы (название, значок, закрыта, скрыта) — одним
// UPDATE, в той же транзакции, что служебка messageActionTopicEdit.
func (r *TopicsRepo) Update(ctx context.Context, t domain.ForumTopicRecord) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE forum_topics SET title=$2, icon_emoji=$3, closed=$4, hidden=$5 WHERE id=$1`,
		t.ID, t.Title, t.IconEmoji, t.Closed, t.Hidden)
	return err
}

func (r *TopicsRepo) SetPinned(ctx context.Context, id int64, pinned bool) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `UPDATE forum_topics SET pinned=$2 WHERE id=$1`, id, pinned)
	return err
}

// TopicRoots — какие из ключей строк rootIDs — корни тем форума (не General:
// у неё корня нет). Отвечает границе вывода сообщений: у сообщения темы на
// проводе флаг messageReplyHeader.pFlags.forum_topic. Один запрос на пачку.
func (r *TopicsRepo) TopicRoots(ctx context.Context, rootIDs []int64) (map[int64]bool, error) {
	out := map[int64]bool{}
	if len(rootIDs) == 0 {
		return out, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT root_msg_id FROM forum_topics WHERE root_msg_id = ANY($1) AND NOT is_general`, rootIDs)
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

// threadFilter — условие «сообщение alias принадлежит треду param», общее для
// всех выборок треда (история, окно вокруг, медиа, счётчики, число).
// param — выражение ключа строки корня; само корневое сообщение входит в тред,
// если withRoot (лента треда показывает корень первым баблом).
//
// General — страж domain.GeneralThreadRoot: корня у неё нет, её сообщения —
// без треда, кроме служебок создания тем: те принадлежат своим темам (tweb
// getMessageThreadId.ts:20-23).
func threadFilter(alias, param string, withRoot bool) string {
	root := ""
	if withRoot {
		root = fmt.Sprintf(` OR %s.id = %s`, alias, param)
	}
	return fmt.Sprintf(`(%[1]s.thread_root_id = %[2]s%[3]s OR (%[2]s = %[4]d AND %[1]s.thread_root_id IS NULL
		AND NOT EXISTS (SELECT 1 FROM forum_topics gft WHERE gft.root_msg_id = %[1]s.id)))`,
		alias, param, root, domain.GeneralThreadRoot)
}

// EnsureGeneralTopic идемпотентно создаёт системную тему «General» для чата,
// если её ещё нет, и возвращает её. General всегда первая, её нельзя закрыть/удалить.
func (r *TopicsRepo) EnsureGeneralTopic(ctx context.Context, chatID, createdBy int64) (domain.ForumTopicRecord, error) {
	q := querier(ctx, r.pool)
	if _, err := q.Exec(ctx,
		`INSERT INTO forum_topics (chat_id, root_msg_id, title, is_general, created_by)
		 SELECT $1, 0, 'General', true, $2
		  WHERE NOT EXISTS (SELECT 1 FROM forum_topics WHERE chat_id=$1 AND is_general)`,
		chatID, createdBy); err != nil {
		return domain.ForumTopicRecord{}, err
	}
	return scanTopic(q.QueryRow(ctx, `SELECT `+topicCols+`
		  FROM forum_topics t LEFT JOIN messages rm ON rm.id = t.root_msg_id
		 WHERE t.chat_id=$1 AND t.is_general`, chatID))
}

// inTopic — сообщение m принадлежит теме t: у обычной темы — тред её корня,
// у General — сообщения без треда, кроме служебок создания тем (те в своих
// темах, tweb getMessageThreadId.ts:20-23). Строки корня у General нет.
const inTopic = `m.chat_id = t.chat_id AND (
		(NOT t.is_general AND m.thread_root_id = t.root_msg_id)
		OR (t.is_general AND m.thread_root_id IS NULL
		    AND NOT EXISTS (SELECT 1 FROM forum_topics gft WHERE gft.root_msg_id = m.id)))`

// ListByChat — темы чата с последним сообщением треда и состоянием темы для
// зрителя userID (горизонты, непрочитанное, упоминания, реакции, мьют — как
// строка диалога). Порядок (как в tweb): General первой, затем закреплённые
// (по pos), затем остальные (свежие сверху).
//
// Последнее сообщение темы и её счётчики — только из видимого зрителю
// (messageVisibleTo): после «очистить историю» тема не держит старое превью и
// бейджи, скрытое у себя и скрытая предыстория в них тоже не входят.
func (r *TopicsRepo) ListByChat(ctx context.Context, chatID, userID int64) ([]domain.TopicRow, error) {
	rows, err := querier(ctx, r.pool).Query(ctx, `
		SELECT `+topicCols+`,
		       -- Последнее сообщение темы адресуется ССЫЛКОЙ: ключ строки (по нему
		       -- контейнер достанет объект) и номер в чате (top_message).
		       lm.id, lm.seq,
		       COALESCE(st.last_read_seq, 0),
		       -- read_outbox_max_id: горизонт ОСТАЛЬНЫХ по теме — правило
		       -- «✓✓ группы — MAX», что и у чата (A1-19).
		       COALESCE((SELECT MAX(o.last_read_seq) FROM topic_user_state o
		                  WHERE o.chat_id = t.chat_id AND o.root_msg_id = t.root_msg_id
		                    AND o.user_id <> $2), 0),
		       st.muted_until,
		       COALESCE(unr.n, 0),
		       COALESCE(men.n, 0),
		       COALESCE(rea.n, 0)
		  FROM forum_topics t
		  -- Номер корня темы (номер служебки создания); у General корня нет — 0.
		  LEFT JOIN messages rm ON rm.id = t.root_msg_id
		  LEFT JOIN topic_user_state st
		    ON st.chat_id = t.chat_id AND st.root_msg_id = t.root_msg_id AND st.user_id = $2
		  LEFT JOIN LATERAL (
		    SELECT m.id, m.created_at, m.seq FROM messages m
		     WHERE (`+inTopic+` OR (NOT t.is_general AND m.id = t.root_msg_id))
		       AND `+messageVisibleTo("m", "$2")+`
		     ORDER BY m.seq DESC LIMIT 1
		  ) lm ON true
		  LEFT JOIN LATERAL (
		    -- непрочитанные темы: чужие сообщения треда с seq > last_read_seq
		    SELECT count(*) AS n FROM messages m
		     WHERE `+inTopic+`
		       AND `+messageVisibleTo("m", "$2")+` AND m.sender_id <> $2
		       AND m.seq > COALESCE(st.last_read_seq, 0)
		  ) unr ON true
		  LEFT JOIN LATERAL (
		    -- непрочитанные упоминания зрителя в этой теме (message_mentions +
		    -- тред сообщения); text_mention детектится при вставке.
		    SELECT count(*) AS n FROM message_mentions mm
		     JOIN messages m ON m.id = mm.message_id
		     WHERE mm.chat_id = t.chat_id AND mm.user_id = $2 AND mm.unread
		       AND `+inTopic+` AND `+messageVisibleTo("m", "$2")+`
		       AND mm.seq > COALESCE(st.last_read_seq, 0)
		  ) men ON true
		  LEFT JOIN LATERAL (
		    -- unread_reactions_count: СООБЩЕНИЯ зрителя в теме с непрочитанной
		    -- реакцией — предикат чата из 0160 (reactions.unread), сужённый темой.
		    SELECT count(*) AS n FROM messages m
		     WHERE `+inTopic+` AND m.sender_id = $2 AND `+messageVisibleTo("m", "$2")+`
		       AND EXISTS (SELECT 1 FROM reactions rr WHERE rr.message_id = m.id AND rr.unread)
		  ) rea ON true
		 WHERE t.chat_id = $1
		 ORDER BY t.is_general DESC,
		          t.pinned DESC,
		          CASE WHEN t.pinned THEN t.pos ELSE 0 END ASC,
		          COALESCE(lm.created_at, t.created_at) DESC`, chatID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.TopicRow
	for rows.Next() {
		var row domain.TopicRow
		var lastID, lastSeq *int64
		t := &row.Topic
		if err := rows.Scan(&t.ID, &t.ChatID, &t.RootMsgID, &t.RootMsgSeq, &t.Title, &t.IconColor, &t.IconEmoji,
			&t.Closed, &t.Hidden, &t.Pinned, &t.Pos, &t.IsGeneral, &t.CreatedBy, &t.CreatedAt,
			&lastID, &lastSeq, &row.LastReadSeq, &row.ReadOutboxSeq, &row.MuteUntil,
			&row.UnreadCount, &row.UnreadMentions, &row.UnreadReactions); err != nil {
			return nil, err
		}
		if lastID != nil {
			row.LastMsgID = *lastID
		}
		if lastSeq != nil {
			row.LastMsgSeq = *lastSeq
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// SetTopicRead поднимает last_read_seq темы до max(old, upToSeq) — UPSERT в
// topic_user_state (аналог chat_members.read_seq для конкретной темы).
func (r *TopicsRepo) SetTopicRead(ctx context.Context, chatID, rootMsgID, userID, upToSeq int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `
		INSERT INTO topic_user_state (chat_id, root_msg_id, user_id, last_read_seq)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (chat_id, root_msg_id, user_id)
		DO UPDATE SET last_read_seq = GREATEST(topic_user_state.last_read_seq, EXCLUDED.last_read_seq)`,
		chatID, rootMsgID, userID, upToSeq)
	return err
}

// SetTopicMuteUntil ставит срок мьюта темы (peerNotifySettings.mute_until —
// СРОК, а не булево: «на час» обязано кончиться через час) — UPSERT в
// topic_user_state. nil — мьют снят.
func (r *TopicsRepo) SetTopicMuteUntil(ctx context.Context, chatID, rootMsgID, userID int64, until *time.Time) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `
		INSERT INTO topic_user_state (chat_id, root_msg_id, user_id, muted_until)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (chat_id, root_msg_id, user_id)
		DO UPDATE SET muted_until = EXCLUDED.muted_until`,
		chatID, rootMsgID, userID, until)
	return err
}

// ByRoot — тема по корню треда (Send в тему проверяет её флаг closed).
func (r *TopicsRepo) ByRoot(ctx context.Context, chatID, rootMsgID int64) (domain.ForumTopicRecord, error) {
	return scanTopic(querier(ctx, r.pool).QueryRow(ctx, `SELECT `+topicCols+`
		  FROM forum_topics t LEFT JOIN messages rm ON rm.id = t.root_msg_id
		 WHERE t.chat_id=$1 AND t.root_msg_id=$2 AND NOT t.is_general`, chatID, rootMsgID))
}
