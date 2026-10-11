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

// Update пишет поля правки темы (название, значок, закрыта, скрыта) — одним
// UPDATE, в той же транзакции, что служебка messageActionTopicEdit. Только
// заданные поля (nil — COALESCE оставляет колонку): снимок темы, прочитанный
// до транзакции, не затирает параллельную правку другого поля.
func (r *TopicsRepo) Update(ctx context.Context, id int64, edit domain.MessageActionTopicEdit) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE forum_topics SET title = COALESCE($2, title), icon_emoji = COALESCE($3, icon_emoji),
		        closed = COALESCE($4, closed), hidden = COALESCE($5, hidden)
		  WHERE id = $1`,
		id, edit.Title, edit.IconEmojiEmoticon, edit.Closed, edit.Hidden)
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
// idx_messages_thread_seq. param остаётся в каждом фрагменте — тип параметра
// Postgres выводит из запроса, а аргумент передан всегда:
//   - root == nil — треда нет, условие истинно;
//   - General — страж domain.GeneralThreadRoot: корня у неё нет, её сообщения —
//     всё, что не в темах (generalMember);
//   - иначе — тред корня.
func threadFilter(alias, param string, root *int64, withRoot bool) string {
	switch {
	case root == nil:
		return param + `::bigint IS NULL`
	case *root == domain.GeneralThreadRoot:
		return fmt.Sprintf(`(%[2]s::bigint = %[3]d AND %[4]s)`, alias, param, domain.GeneralThreadRoot, generalMember(alias))
	case withRoot:
		return fmt.Sprintf(`(%[1]s.thread_root_id = %[2]s::bigint OR %[1]s.id = %[2]s::bigint)`, alias, param)
	default:
		return fmt.Sprintf(`%[1]s.thread_root_id = %[2]s::bigint`, alias, param)
	}
}

// generalMember — сообщение alias принадлежит General форума: оно не служебка
// создания темы и его тред (если есть) — не тема. Порт tweb
// getMessageThreadId.ts:17-23: у сообщения форума без forum_topic тред —
// General, и сюда попадают треды, накопленные до включения тем, и
// комментарии к постам канала (форум бывает группой обсуждения) — иначе они
// выпали бы и из General, и из всех тем. Диапазон по (chat_id, seq) плюс
// anti-join по forum_topics_root_idx (0163).
func generalMember(alias string) string {
	return fmt.Sprintf(`NOT EXISTS (SELECT 1 FROM forum_topics gft
		WHERE gft.root_msg_id IN (%[1]s.id, %[1]s.thread_root_id) AND NOT gft.is_general)`, alias)
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
//   - обычная тема — тред её корня (idx_messages_thread_seq, 0164), корень — первым
//     сообщением ленты;
//   - General — всё, что не в темах (generalMember), диапазоном по
//     (chat_id, seq).
//
// Горизонт чтения темы — max(своя запись темы, горизонт чата
// chat_members.last_read_seq): горизонт чата значит «прочитано всё до него»,
// темы в том числе. До этой волны General не считалась, и записей
// topic_user_state у неё нет ни у кого — без горизонта чата после деплоя вся
// её история стала бы непрочитанной; у обычной темы, которую участник ни
// разу не открывал, — тоже, и подсчёт шёл бы по всему треду. read_outbox_max_id
// — тот же максимум по остальным участникам.
//
// Упоминания и реакции темы — подмножество счётчиков чата
// (chat_members.unread_mentions_count / unread_reactions): при нуле в чате
// подзапросы не выполняются. Реакции считаются от частичного индекса
// reactions_unread_idx (0162), а не перебором своих сообщений темы.
func topicRowsSQL(general bool) string {
	inTopic := `m.chat_id = t.chat_id AND m.thread_root_id = t.root_msg_id`
	horizon := `GREATEST(COALESCE(st.last_read_seq, 0), COALESCE(cm.last_read_seq, 0))`
	outbox := `GREATEST(
	             COALESCE((SELECT MAX(o.last_read_seq) FROM topic_user_state o
	                        WHERE o.chat_id = t.chat_id AND o.root_msg_id = t.root_msg_id
	                          AND o.user_id <> $2), 0),
	             COALESCE((SELECT MAX(om.last_read_seq) FROM chat_members om
	                        WHERE om.chat_id = t.chat_id AND om.user_id <> $2), 0))`
	last := `(SELECT m.id, m.created_at, m.seq FROM messages m
	           WHERE ` + inTopic + ` AND ` + messageVisibleTo("m", "$2") + `
	           ORDER BY m.seq DESC LIMIT 1)
	         UNION ALL
	         (SELECT m.id, m.created_at, m.seq FROM messages m
	           WHERE m.id = t.root_msg_id AND ` + messageVisibleTo("m", "$2") + `)`
	where := `t.chat_id = $1 AND NOT t.is_general`
	if general {
		inTopic = `m.chat_id = t.chat_id AND ` + generalMember("m")
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
		    -- непрочитанные темы: чужие сообщения темы выше горизонта; у
		    -- читателя публичного форума без вступления непрочитанного нет.
		    SELECT count(*) AS n FROM messages m
		     WHERE cm.user_id IS NOT NULL
		       AND ` + inTopic + ` AND m.seq > ` + horizon + `
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

// LockThread — транзакционная блокировка треда (chat, root) на время
// прочтения: два параллельных readDiscussion одного треда считают ✓✓ и
// рассылают кадры по очереди, по свежим горизонтам. Снимается коммитом.
func (r *TopicsRepo) LockThread(ctx context.Context, chatID, rootMsgID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtextextended('thread:' || $1::bigint::text || ':' || $2::bigint::text, 0))`,
		chatID, rootMsgID)
	return err
}

// ThreadHorizon — горизонт чтения треда rootMsgID у userID: max(запись треда,
// горизонт чата) — то же правило, что у строки темы (topicRowsSQL). У General
// rootMsgID = 0. Не участнику горизонт чата — 0.
func (r *TopicsRepo) ThreadHorizon(ctx context.Context, chatID, rootMsgID, userID int64) (int64, error) {
	var h int64
	err := querier(ctx, r.pool).QueryRow(ctx, `
		SELECT GREATEST(
		  COALESCE((SELECT last_read_seq FROM topic_user_state
		             WHERE chat_id = $1 AND root_msg_id = $2 AND user_id = $3), 0),
		  COALESCE((SELECT last_read_seq FROM chat_members WHERE chat_id = $1 AND user_id = $3), 0))`,
		chatID, rootMsgID, userID).Scan(&h)
	return h, err
}

// ThreadHorizons — горизонты треда rootMsgID у всех, кто его читает: у
// участников — max(запись треда, горизонт чата), у не участников (гость
// комментариев, только у зеркала поста) — запись треда. По ним считается ✓✓
// треда (MAX остальных) и кому уходит outbox.
func (r *TopicsRepo) ThreadHorizons(ctx context.Context, chatID, rootMsgID int64) (map[int64]int64, error) {
	rows, err := querier(ctx, r.pool).Query(ctx, `
		SELECT u, MAX(h) FROM (
		  SELECT cm.user_id AS u, GREATEST(cm.last_read_seq, COALESCE(st.last_read_seq, 0)) AS h
		    FROM chat_members cm
		    LEFT JOIN topic_user_state st
		      ON st.chat_id = cm.chat_id AND st.root_msg_id = $2 AND st.user_id = cm.user_id
		   WHERE cm.chat_id = $1
		  UNION ALL
		  -- Не участник — только гость треда комментариев: корень — зеркало
		  -- поста, и он не забанен. Строки бывших участников (выход, кик) и
		  -- строки тем, оставшиеся от них, сюда не попадают.
		  SELECT st.user_id, st.last_read_seq FROM topic_user_state st
		   WHERE st.chat_id = $1 AND st.root_msg_id = $2
		     AND EXISTS (SELECT 1 FROM messages rm WHERE rm.id = $2 AND rm.is_discussion_mirror)
		     AND NOT EXISTS (SELECT 1 FROM chat_bans b WHERE b.chat_id = $1 AND b.user_id = st.user_id)
		) x GROUP BY u`, chatID, rootMsgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]int64{}
	for rows.Next() {
		var u, h int64
		if err := rows.Scan(&u, &h); err != nil {
			return nil, err
		}
		out[u] = h
	}
	return out, rows.Err()
}

// ThreadReadOutbox — горизонт ✓✓ треда rootMsgID для зрителя viewerID: MAX
// горизонтов треда всех остальных читающих (read_outbox_max_id
// messages.discussionMessage, tweb appMessagesManager.ts:8852). Тот же круг,
// что ThreadHorizons, но одним MAX в SQL — без строки на каждого участника
// группы обсуждения: у участника горизонт треда = max(запись треда, горизонт
// чата), поэтому MAX по ним — это MAX горизонтов чата и записей треда.
func (r *TopicsRepo) ThreadReadOutbox(ctx context.Context, chatID, rootMsgID, viewerID int64) (int64, error) {
	var h int64
	err := querier(ctx, r.pool).QueryRow(ctx, `
		SELECT GREATEST(
		  COALESCE((SELECT MAX(cm.last_read_seq) FROM chat_members cm
		             WHERE cm.chat_id = $1 AND cm.user_id <> $3), 0),
		  COALESCE((SELECT MAX(st.last_read_seq) FROM topic_user_state st
		             WHERE st.chat_id = $1 AND st.root_msg_id = $2 AND st.user_id <> $3
		               AND (EXISTS (SELECT 1 FROM chat_members cm2
		                             WHERE cm2.chat_id = $1 AND cm2.user_id = st.user_id)
		                    -- гость треда комментариев (см. ThreadHorizons)
		                    OR (EXISTS (SELECT 1 FROM messages rm WHERE rm.id = $2 AND rm.is_discussion_mirror)
		                        AND NOT EXISTS (SELECT 1 FROM chat_bans b
		                                         WHERE b.chat_id = $1 AND b.user_id = st.user_id)))), 0))`,
		chatID, rootMsgID, viewerID).Scan(&h)
	return h, err
}

// ThreadReadStates — состояние тредов roots чата chatID глазами viewerID
// одним запросом (messageReplies.max_id/read_max_id постов страницы): номер
// последнего видимого ему сообщения треда и его горизонт треда (max(запись
// треда, горизонт чата), как ThreadHorizon). Корни без ответов и без
// горизонта в карту не попадают.
func (r *TopicsRepo) ThreadReadStates(ctx context.Context, chatID, viewerID int64, roots []int64) (map[int64]domain.ThreadReadState, error) {
	out := map[int64]domain.ThreadReadState{}
	if len(roots) == 0 {
		return out, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx, `
		SELECT x.root,
		       COALESCE((SELECT MAX(m.seq) FROM messages m
		                  WHERE m.chat_id = $1 AND m.thread_root_id = x.root AND `+messageVisibleTo("m", "$2")+`), 0),
		       GREATEST(COALESCE(st.last_read_seq, 0), COALESCE(cm.last_read_seq, 0))
		  FROM unnest($3::bigint[]) AS x(root)
		  LEFT JOIN topic_user_state st ON st.chat_id = $1 AND st.root_msg_id = x.root AND st.user_id = $2
		  LEFT JOIN chat_members cm ON cm.chat_id = $1 AND cm.user_id = $2`,
		chatID, viewerID, roots)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var root int64
		var st domain.ThreadReadState
		if err := rows.Scan(&root, &st.MaxID, &st.ReadMaxID); err != nil {
			return nil, err
		}
		if st.MaxID > 0 || st.ReadMaxID > 0 {
			out[root] = st
		}
	}
	return out, rows.Err()
}

// ClearThreadMentions снимает непрочитанные упоминания userID в треде root
// (страж General — domain.GeneralThreadRoot) с seq <= upToSeq и пересчитывает
// счётчик «@» чата (у не участника строки chat_members нет — пересчёт пуст).
// Возвращает, сколько упоминаний снято. Порт эффекта readDiscussion: tweb
// гасит упоминания темы и на столько же — родителя
// (appMessagesManager.ts:10880-10890, 10969-10980).
func (r *TopicsRepo) ClearThreadMentions(ctx context.Context, chatID, userID, root, upToSeq int64) (int, error) {
	q := querier(ctx, r.pool)
	tag, err := q.Exec(ctx, `
		UPDATE message_mentions mm SET unread = false
		  FROM messages m
		 WHERE m.id = mm.message_id AND mm.chat_id = $1 AND mm.user_id = $2 AND mm.unread
		   AND mm.seq <= $4 AND `+threadFilter("m", "$3", &root, false),
		chatID, userID, root, upToSeq)
	if err != nil {
		return 0, err
	}
	if tag.RowsAffected() == 0 {
		return 0, nil
	}
	_, err = q.Exec(ctx, `
		UPDATE chat_members SET unread_mentions_count =
		       (SELECT count(*) FROM message_mentions WHERE chat_id = $1 AND user_id = $2 AND unread)
		 WHERE chat_id = $1 AND user_id = $2`, chatID, userID)
	return int(tag.RowsAffected()), err
}

// ApplyThreadReadToGroup — прочтение треда ВНЕ форума (комментарии к посту,
// тред группы) правит и диалог группы, как tweb на месте: у треда вне форума
// курсор сведён с горизонтом группы, и onUpdateReadHistory правит диалог
// группы (appMessagesManager.ts:10814-10816, 5107-5131):
//   - горизонт группы — read_max_id (:10918-10920; вниз не идёт: tweb читает
//     только выше сведённого курсора, :9133-9156);
//   - unread_count минус чужие видимые сообщения треда в (merged, readMaxID]
//     (:10846-10881); readMaxID >= последнего номера или merged = 0 → 0
//     (:10924-10944), не ниже 0;
//   - счётчик стал 0 — гаснут и упоминания группы (:10941-10943).
//
// merged — сведённый курсор до прочтения (max(горизонт группы, треда)),
// lastSeq — последний номер чата. Не участнику (гостю) — ничего. raised —
// горизонт группы вырос (тогда остальным участникам уходит ✓✓ группы тем же
// путём, что у прочтения группы); readSeq — горизонт группы после.
func (r *TopicsRepo) ApplyThreadReadToGroup(ctx context.Context, chatID, userID, root, merged, readMaxID, lastSeq int64) (raised bool, readSeq int64, err error) {
	q := querier(ctx, r.pool)
	var unread int
	var oldSeq int64
	err = q.QueryRow(ctx, `
		WITH prev AS (
		  SELECT last_read_seq FROM chat_members WHERE chat_id = $1 AND user_id = $2 FOR UPDATE)
		UPDATE chat_members cm SET
		       last_read_seq = GREATEST(cm.last_read_seq, $5),
		       unread_count = CASE WHEN $5::bigint >= $6::bigint OR $4::bigint = 0 THEN 0
		         ELSE GREATEST(0, cm.unread_count - (
		           SELECT count(*) FROM messages m
		            WHERE m.chat_id = $1 AND `+threadFilter("m", "$3", &root, false)+`
		              AND m.seq > $4 AND m.seq <= $5 AND m.sender_id <> $2
		              AND `+messageVisibleTo("m", "$2")+`)) END
		  FROM prev
		 WHERE cm.chat_id = $1 AND cm.user_id = $2
		 RETURNING prev.last_read_seq, cm.last_read_seq, cm.unread_count`,
		chatID, userID, root, merged, readMaxID, lastSeq).Scan(&oldSeq, &readSeq, &unread)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, 0, nil // не участник
	}
	if err != nil {
		return false, 0, err
	}
	raised = readSeq > oldSeq
	if unread > 0 {
		return raised, readSeq, nil
	}
	if _, err := q.Exec(ctx,
		`UPDATE message_mentions SET unread = false WHERE chat_id = $1 AND user_id = $2 AND unread`, chatID, userID); err != nil {
		return false, 0, err
	}
	_, err = q.Exec(ctx,
		`UPDATE chat_members SET unread_mentions_count = 0 WHERE chat_id = $1 AND user_id = $2`, chatID, userID)
	return raised, readSeq, err
}

// forumUnreadSQL — непрочитанное участника viewer в форуме chat: сумма по
// темам (В-8 спецификации). У каждой темы свой горизонт — max(горизонт чата
// readSeq, запись темы), и считается она по своему диапазону: обычная тема —
// по idx_messages_thread_seq (тред корня) плюс сама служебка создания,
// General — по (chat_id, seq) с generalMember. Просматриваются только строки
// выше горизонта темы, а не вся история выше горизонта чата: в форуме tweb
// читает readDiscussion (appMessagesManager.ts:9186-9193), и горизонт чата
// почти не двигается. Чужое и видимое зрителю, потолок UnreadCountCap — тот
// же предикат, что unreadPostsCount.
func forumUnreadSQL(chat, readSeq, viewer string) string {
	cap := fmt.Sprint(UnreadCountCap)
	topicHorizon := `GREATEST(` + readSeq + `, COALESCE(fst.last_read_seq, 0))`
	generalHorizon := `GREATEST(` + readSeq + `, COALESCE((SELECT gst.last_read_seq FROM topic_user_state gst
		 WHERE gst.chat_id = ` + chat + ` AND gst.root_msg_id = 0 AND gst.user_id = ` + viewer + `), 0))`
	return `LEAST(` + cap + `, (
		SELECT COALESCE(SUM(
		  (SELECT count(*) FROM (SELECT 1 FROM messages um
		    WHERE um.chat_id = ft.chat_id AND um.thread_root_id = ft.root_msg_id AND um.seq > ` + topicHorizon + `
		      AND um.sender_id <> ` + viewer + ` AND ` + messageVisibleTo("um", viewer) + ` LIMIT ` + cap + `) tu)
		  + (SELECT count(*) FROM messages ur
		    WHERE ur.id = ft.root_msg_id AND ur.seq > ` + topicHorizon + `
		      AND ur.sender_id <> ` + viewer + ` AND ` + messageVisibleTo("ur", viewer) + `)), 0)
		  FROM forum_topics ft
		  LEFT JOIN topic_user_state fst
		    ON fst.chat_id = ft.chat_id AND fst.root_msg_id = ft.root_msg_id AND fst.user_id = ` + viewer + `
		 WHERE ft.chat_id = ` + chat + ` AND NOT ft.is_general)
		+ (SELECT count(*) FROM (SELECT 1 FROM messages gm
		    WHERE gm.chat_id = ` + chat + ` AND gm.seq > ` + generalHorizon + ` AND ` + generalMember("gm") + `
		      AND gm.sender_id <> ` + viewer + ` AND ` + messageVisibleTo("gm", viewer) + ` LIMIT ` + cap + `) gu))::int`
}

// forumThreadUnread — сообщение m выше горизонта СВОЕЙ темы у viewer (запись
// topic_user_state темы: корень — по generalMember-правилу, General — 0). Для
// точечных правок счётчика (удаление, скрытие, пересчёт): в форуме
// непрочитанное — сумма по темам (forumUnreadSQL), и сообщение прочитанной
// темы в счётчике не числится.
func forumThreadUnread(m, viewer string) string {
	return `COALESCE((SELECT tst.last_read_seq FROM topic_user_state tst
		 WHERE tst.chat_id = ` + m + `.chat_id AND tst.user_id = ` + viewer + `
		   AND tst.root_msg_id = COALESCE((SELECT tft.root_msg_id FROM forum_topics tft
		        WHERE tft.chat_id = ` + m + `.chat_id AND NOT tft.is_general
		          AND tft.root_msg_id IN (` + m + `.id, ` + m + `.thread_root_id) LIMIT 1), 0)), 0) < ` + m + `.seq`
}

// notReadInForum — условие для точечных правок unread_count: вне форума
// истинно, в форуме — сообщение m не покрыто горизонтом своей темы.
func notReadInForum(m, viewer string) string {
	return `(NOT EXISTS (SELECT 1 FROM chats nfc WHERE nfc.id = ` + m + `.chat_id AND nfc.is_forum) OR ` +
		forumThreadUnread(m, viewer) + `)`
}

// CountChatUnread — непрочитанное участника при горизонте чата readSeq для
// chat_members.unread_count (MarkRead): у форума — сумма по темам
// (forumUnreadSQL), у остального — unreadPostsCount. Один запрос: ветку
// выбирает CASE по chats.is_forum, подзапрос другой ветки не выполняется.
func (r *TopicsRepo) CountChatUnread(ctx context.Context, chatID, userID, readSeq int64) (int, error) {
	var n int
	err := querier(ctx, r.pool).QueryRow(ctx, `
		SELECT CASE WHEN c.is_forum THEN `+forumUnreadSQL("c.id", "$2::bigint", "$3::bigint")+`
		            ELSE `+unreadPostsCount("c.id", "$2::bigint", "$3::bigint")+` END
		  FROM chats c WHERE c.id = $1`, chatID, readSeq, userID).Scan(&n)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return n, err
}

// RecountForumUnread пересчитывает chat_members.unread_count участника в
// форуме (сумма по темам при его горизонте чата) — после прочтения темы.
// Не участник — 0 строк, ответ 0.
func (r *TopicsRepo) RecountForumUnread(ctx context.Context, chatID, userID int64) (int, error) {
	var n int
	err := querier(ctx, r.pool).QueryRow(ctx, `
		UPDATE chat_members cm SET unread_count = `+forumUnreadSQL("cm.chat_id", "cm.last_read_seq", "cm.user_id")+`
		 WHERE cm.chat_id = $1 AND cm.user_id = $2
		 RETURNING unread_count`, chatID, userID).Scan(&n)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return n, err
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
