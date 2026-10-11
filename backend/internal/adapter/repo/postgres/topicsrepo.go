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

// threadFilter — условие «сообщение alias принадлежит треду root», общее для
// всех выборок треда (история, окно вокруг, медиа, счётчики, число, /threads).
// param — плейсхолдер того же значения root в запросе; само корневое
// сообщение входит в тред, если withRoot (лента треда показывает корень
// первым баблом).
//
// Фрагмент выбирается ЗДЕСЬ, по значению root, а не OR-ом в SQL: план
// подготовленного запроса (pgx кэширует statement, Postgres переходит на
// generic plan) не умеет отбросить ветку General и терял бы индекс
// idx_messages_thread. param остаётся в каждом фрагменте — тип параметра
// Postgres выводит из запроса, а аргумент передан всегда:
//   - root == nil — треда нет, условие истинно;
//   - General — страж domain.GeneralThreadRoot: корня у неё нет, её сообщения —
//     без треда, кроме служебок создания тем (они в своих темах, tweb
//     getMessageThreadId.ts:20-23);
//   - иначе — тред корня.
func threadFilter(alias, param string, root *int64, withRoot bool) string {
	switch {
	case root == nil:
		return param + `::bigint IS NULL`
	case *root == domain.GeneralThreadRoot:
		return fmt.Sprintf(`(%[2]s::bigint = %[3]d AND %[1]s.thread_root_id IS NULL
			AND NOT EXISTS (SELECT 1 FROM forum_topics gft WHERE gft.root_msg_id = %[1]s.id))`,
			alias, param, domain.GeneralThreadRoot)
	case withRoot:
		return fmt.Sprintf(`(%[1]s.thread_root_id = %[2]s::bigint OR %[1]s.id = %[2]s::bigint)`, alias, param)
	default:
		return fmt.Sprintf(`%[1]s.thread_root_id = %[2]s::bigint`, alias, param)
	}
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

// topicRowsSQL — выборка строк списка тем для зрителя $2 в чате $1, ОТДЕЛЬНО
// для General и для обычных тем: принадлежность сообщения теме у них разная,
// и OR этих веток в одном запросе (по флагу строки внутри LATERAL) лишал бы
// план индексов. Ветка выбирается здесь, в Go:
//   - обычная тема — тред её корня (idx_messages_thread), корень — первым
//     сообщением ленты;
//   - General — сообщения без треда, кроме служебок создания тем (те в своих
//     темах, tweb getMessageThreadId.ts:20-23), диапазоном по
//     (chat_id, seq).
//
// Горизонт чтения General — max(своя запись темы, горизонт чата
// chat_members.last_read_seq): до этой волны General не считалась, и записей
// topic_user_state у неё нет ни у кого — без горизонта чата после деплоя вся
// её история стала бы непрочитанной. Горизонт чата значит «прочитано всё до
// него», General в том числе. Так же — read_outbox_max_id General.
//
// Упоминания и реакции темы — подмножество счётчиков чата
// (chat_members.unread_mentions_count / unread_reactions): при нуле в чате
// подзапросы не выполняются. Реакции считаются от частичного индекса
// reactions_unread_idx (0162), а не перебором своих сообщений темы.
func topicRowsSQL(general bool) string {
	inTopic := `m.chat_id = t.chat_id AND m.thread_root_id = t.root_msg_id`
	horizon := `COALESCE(st.last_read_seq, 0)`
	outbox := `COALESCE((SELECT MAX(o.last_read_seq) FROM topic_user_state o
	                     WHERE o.chat_id = t.chat_id AND o.root_msg_id = t.root_msg_id
	                       AND o.user_id <> $2), 0)`
	last := `(SELECT m.id, m.created_at, m.seq FROM messages m
	           WHERE ` + inTopic + ` AND ` + messageVisibleTo("m", "$2") + `
	           ORDER BY m.seq DESC LIMIT 1)
	         UNION ALL
	         (SELECT m.id, m.created_at, m.seq FROM messages m
	           WHERE m.id = t.root_msg_id AND ` + messageVisibleTo("m", "$2") + `)`
	where := `t.chat_id = $1 AND NOT t.is_general`
	if general {
		inTopic = `m.chat_id = t.chat_id AND m.thread_root_id IS NULL
		       AND NOT EXISTS (SELECT 1 FROM forum_topics gft WHERE gft.root_msg_id = m.id)`
		horizon = `GREATEST(COALESCE(st.last_read_seq, 0), COALESCE(cm.last_read_seq, 0))`
		outbox = `GREATEST(` + outbox + `,
		           COALESCE((SELECT MAX(om.last_read_seq) FROM chat_members om
		                      WHERE om.chat_id = t.chat_id AND om.user_id <> $2), 0))`
		last = `SELECT m.id, m.created_at, m.seq FROM messages m
		         WHERE ` + inTopic + ` AND ` + messageVisibleTo("m", "$2") + `
		         ORDER BY m.seq DESC LIMIT 1`
		where = `t.chat_id = $1 AND t.is_general`
	}
	return `
		SELECT ` + topicCols + `,
		       -- Последнее сообщение темы адресуется ССЫЛКОЙ: ключ строки (по нему
		       -- контейнер достанет объект) и номер в чате (top_message).
		       lm.id, lm.seq,
		       ` + horizon + `,
		       -- read_outbox_max_id: горизонт ОСТАЛЬНЫХ по теме — правило
		       -- «✓✓ группы — MAX», что и у чата (A1-19).
		       ` + outbox + `,
		       st.muted_until,
		       COALESCE(unr.n, 0),
		       COALESCE(men.n, 0),
		       COALESCE(rea.n, 0)
		  FROM forum_topics t
		  -- Номер корня темы (номер служебки создания); у General корня нет — 0.
		  LEFT JOIN messages rm ON rm.id = t.root_msg_id
		  LEFT JOIN topic_user_state st
		    ON st.chat_id = t.chat_id AND st.root_msg_id = t.root_msg_id AND st.user_id = $2
		  LEFT JOIN chat_members cm ON cm.chat_id = t.chat_id AND cm.user_id = $2
		  LEFT JOIN LATERAL (
		    SELECT x.id, x.created_at, x.seq FROM (` + last + `) x
		     ORDER BY x.seq DESC LIMIT 1
		  ) lm ON true
		  LEFT JOIN LATERAL (
		    -- непрочитанные темы: чужие сообщения темы выше горизонта
		    SELECT count(*) AS n FROM messages m
		     WHERE ` + inTopic + ` AND m.seq > ` + horizon + `
		       AND ` + messageVisibleTo("m", "$2") + ` AND m.sender_id <> $2
		  ) unr ON true
		  LEFT JOIN LATERAL (
		    -- непрочитанные упоминания зрителя в этой теме (message_mentions +
		    -- тема сообщения); text_mention детектится при вставке.
		    SELECT count(*) AS n FROM message_mentions mm
		     JOIN messages m ON m.id = mm.message_id
		     WHERE COALESCE(cm.unread_mentions_count, 0) > 0
		       AND mm.chat_id = t.chat_id AND mm.user_id = $2 AND mm.unread
		       AND mm.seq > ` + horizon + `
		       AND ` + inTopic + ` AND ` + messageVisibleTo("m", "$2") + `
		  ) men ON true
		  LEFT JOIN LATERAL (
		    -- unread_reactions_count: СООБЩЕНИЯ зрителя в теме с непрочитанной
		    -- реакцией — предикат чата (recountUnreadReactionsSQL), сужённый темой.
		    SELECT count(DISTINCT m.id) AS n FROM reactions rr
		     JOIN messages m ON m.id = rr.message_id
		     WHERE COALESCE(cm.unread_reactions, 0) > 0 AND rr.unread
		       AND ` + inTopic + ` AND m.sender_id = $2 AND ` + messageVisibleTo("m", "$2") + `
		  ) rea ON true
		 WHERE ` + where + `
		 ORDER BY t.pinned DESC,
		          CASE WHEN t.pinned THEN t.pos ELSE 0 END ASC,
		          COALESCE(lm.created_at, t.created_at) DESC`
}

// ListByChat — темы чата с последним сообщением темы и состоянием темы для
// зрителя userID (горизонты, непрочитанное, упоминания, реакции, мьют — как
// строка диалога). Порядок (как в tweb): General первой, затем закреплённые
// (по pos), затем остальные (свежие сверху). General и обычные темы — двумя
// запросами (topicRowsSQL).
//
// Последнее сообщение темы и её счётчики — только из видимого зрителю
// (messageVisibleTo): после «очистить историю» тема не держит старое превью и
// бейджи, скрытое у себя и скрытая предыстория в них тоже не входят.
func (r *TopicsRepo) ListByChat(ctx context.Context, chatID, userID int64) ([]domain.TopicRow, error) {
	var out []domain.TopicRow
	for _, general := range []bool{true, false} {
		rows, err := querier(ctx, r.pool).Query(ctx, topicRowsSQL(general), chatID, userID)
		if err != nil {
			return nil, err
		}
		page, err := scanTopicRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, page...)
	}
	return out, nil
}

func scanTopicRows(rows pgx.Rows) ([]domain.TopicRow, error) {
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

// SetTopicMuteUntil пишет явную настройку уведомлений темы — UPSERT в
// topic_user_state.muted_until: срок мьюта либо time.Unix(0) («уведомлять»).
// NULL в колонке — тема не тронута, наследует мьют чата (три состояния, tweb
// appNotificationsManager.ts:398-405).
func (r *TopicsRepo) SetTopicMuteUntil(ctx context.Context, chatID, rootMsgID, userID int64, until time.Time) error {
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
