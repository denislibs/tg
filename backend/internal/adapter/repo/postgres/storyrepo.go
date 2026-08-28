package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	storyusecase "github.com/messenger-denis/backend/internal/usecase/story"
)

// marshalMediaAreas encodes media areas as a jsonb string ("[]" for empty). Per
// CLAUDE.md we pass string(json), not []byte, so pgx stores jsonb (not bytea).
func marshalMediaAreas(areas domain.MediaAreas) (string, error) {
	if len(areas) == 0 {
		return "[]", nil
	}
	b, err := json.Marshal(areas)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// unmarshalMediaAreas decodes the jsonb media_areas column into a slice; an
// empty/NULL column yields a non-nil empty slice so payloads always carry an array.
func unmarshalMediaAreas(raw []byte) (domain.MediaAreas, error) {
	out := make(domain.MediaAreas, 0)
	if len(raw) == 0 {
		return out, nil
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// fwdFrom builds a *domain.StoryFwd from the nullable fwd_from_* columns.
func fwdFrom(author, story *int64) *domain.StoryFwd {
	if author == nil || story == nil {
		return nil
	}
	return &domain.StoryFwd{AuthorID: *author, StoryID: *story}
}

// StoryRepo is a postgres-backed adapter implementing the story usecase's
// StoryRepo port: post, the active feed read model (privacy/visibility +
// per-viewer seen state), view tracking, viewers, author lookup, deletion, and
// a single-story visibility check. Every query runs through querier(ctx, pool)
// so methods compose inside a TxManager transaction.
type StoryRepo struct{ pool *pgxpool.Pool }

var _ storyusecase.StoryRepo = (*StoryRepo)(nil)

func NewStoryRepo(pool *pgxpool.Pool) *StoryRepo { return &StoryRepo{pool: pool} }

// Create возвращает внутренний ключ строки И номер внутри автора: первый нужен
// связанным таблицам (просмотры, реакции, allow-лист), второй — проводу.
func (r *StoryRepo) Create(ctx context.Context, s domain.Story, allowIDs []int64) (int64, int64, error) {
	q := querier(ctx, r.pool)
	areas, err := marshalMediaAreas(s.MediaAreas)
	if err != nil {
		return 0, 0, err
	}
	var fwdAuthor, fwdStory *int64
	if s.FwdFrom != nil {
		fwdAuthor, fwdStory = &s.FwdFrom.AuthorID, &s.FwdFrom.StoryID
	}
	// Номер внутри автора выдаёт его счётчик — тем же приёмом, каким `seq`
	// сообщения выдаёт `chats.last_seq`: инкремент и вставка идут одним
	// запросом, поэтому двух историй с одним номером не бывает.
	var id, seq int64
	if err = q.QueryRow(ctx,
		`UPDATE users SET last_story_seq = last_story_seq + 1 WHERE id=$1 RETURNING last_story_seq`,
		s.AuthorID).Scan(&seq); err != nil {
		return 0, 0, err
	}
	err = q.QueryRow(ctx,
		`INSERT INTO stories (author_id, seq, media_id, caption, privacy, expires_at, media_areas, fwd_from_author_id, fwd_from_story_id)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
		s.AuthorID, seq, s.MediaID, s.Caption, s.Privacy, s.ExpiresAt, areas, fwdAuthor, fwdStory).Scan(&id)
	if err != nil {
		return 0, 0, err
	}
	if s.Privacy == "selected" {
		for _, uid := range allowIDs {
			if _, err := q.Exec(ctx,
				`INSERT INTO story_allow (story_id, user_id) VALUES ($1,$2)
				 ON CONFLICT DO NOTHING`, id, uid); err != nil {
				return 0, 0, err
			}
		}
	}
	return id, seq, nil
}

// IDBySeq — внешний адрес (автор + номер) во внутренний ключ строки. Обычный
// поиск по UNIQUE (author_id, seq) из миграции 0126 — ни кэша, ни переходника;
// тот же приём, что у сообщения (`MessagesRepo.IDBySeq`).
func (r *StoryRepo) IDBySeq(ctx context.Context, authorID, seq int64) (int64, error) {
	var id int64
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT id FROM stories WHERE author_id=$1 AND seq=$2`, authorID, seq).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return id, err
}

// SetRead двигает ГОРИЗОНТ прочтения зрителя у автора: только вперёд, как
// `read_inbox_max_id` у диалога. Возвращает горизонт ПОСЛЕ применения — кадру
// нужно ровно это число, а не то, что прислал клиент.
func (r *StoryRepo) SetRead(ctx context.Context, viewerID, authorID, maxID int64) (int64, error) {
	var out int64
	err := querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO story_read (viewer_id, author_id, max_read_id) VALUES ($1,$2,$3)
		 ON CONFLICT (viewer_id, author_id)
		 DO UPDATE SET max_read_id = GREATEST(story_read.max_read_id, EXCLUDED.max_read_id)
		 RETURNING max_read_id`, viewerID, authorID, maxID).Scan(&out)
	return out, err
}

// ReadHorizons — горизонты зрителя у перечисленных авторов. Отсутствие строки
// значит «не читал ни одной» и в карту не попадает.
func (r *StoryRepo) ReadHorizons(ctx context.Context, viewerID int64, authorIDs []int64) (map[int64]int64, error) {
	out := make(map[int64]int64, len(authorIDs))
	if len(authorIDs) == 0 {
		return out, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT author_id, max_read_id FROM story_read WHERE viewer_id=$1 AND author_id = ANY($2)`,
		viewerID, authorIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var author, maxID int64
		if e := rows.Scan(&author, &maxID); e != nil {
			return nil, e
		}
		out[author] = maxID
	}
	return out, rows.Err()
}

func (r *StoryRepo) ActiveFeed(ctx context.Context, viewerID int64, authorIDs []int64) ([]domain.StoryGroup, error) {
	if len(authorIDs) == 0 {
		return []domain.StoryGroup{}, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT s.id, s.seq, s.author_id, s.media_id, s.caption, s.privacy, s.pinned, s.edited,
		        s.media_areas, s.fwd_from_author_id, s.fwd_from_story_id,
		        s.created_at, s.expires_at,
		        `+userRealCols("u.")+`,
		        (SELECT count(*) FROM story_reactions sr WHERE sr.story_id = s.id) AS reactions_count,
		        COALESCE((SELECT sr.reaction FROM story_reactions sr WHERE sr.story_id = s.id AND sr.user_id = $1), '') AS my_reaction,
		        COALESCE((SELECT rd.max_read_id FROM story_read rd WHERE rd.viewer_id = $1 AND rd.author_id = s.author_id), 0) AS max_read_id
		   FROM stories s
		   JOIN users u ON u.id = s.author_id
		  WHERE s.expires_at > now()
		    -- author set: own + chat partners ($2), плюс авторы, у которых зритель в
		    -- close_friends (их 'close'-истории) или в allow-листе (их 'selected'), даже
		    -- если такой автор не является чат-партнёром зрителя.
		    AND (s.author_id = ANY($2)
		         OR (s.privacy = 'close' AND EXISTS (SELECT 1 FROM close_friends cf WHERE cf.owner_id = s.author_id AND cf.user_id = $1))
		         OR EXISTS (SELECT 1 FROM story_allow sa WHERE sa.story_id = s.id AND sa.user_id = $1))
		    AND (s.author_id = $1
		         OR s.privacy IN ('everyone','contacts')
		         OR (s.privacy = 'close' AND EXISTS (SELECT 1 FROM close_friends cf WHERE cf.owner_id = s.author_id AND cf.user_id = $1))
		         OR EXISTS (SELECT 1 FROM story_allow sa WHERE sa.story_id = s.id AND sa.user_id = $1))
		  ORDER BY (s.author_id = $1) DESC, u.display_name, s.created_at`,
		viewerID, authorIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.StoryGroup, 0)
	// byID maps a story id to a pointer into the built groups, so the reactions
	// breakdown (fetched in a second batched query) can be merged back in.
	byID := make(map[int64]*domain.StoryRecord)
	storyIDs := make([]int64, 0)
	var curAuthor int64
	idx := -1
	for rows.Next() {
		var (
			item                domain.StoryRecord
			au                  userRealScan
			discard             int64 // s.author_id (== u.id via JOIN)
			areasRaw            []byte
			fwdAuthor, fwdStory *int64
		)
		var maxRead int64
		dest := []any{&item.ID, &item.Seq, &discard, &item.MediaID, &item.Caption, &item.Privacy, &item.Pinned, &item.Edited,
			&areasRaw, &fwdAuthor, &fwdStory, &item.CreatedAt, &item.ExpiresAt}
		dest = append(dest, au.dest()...)
		dest = append(dest, &item.ReactionsCount, &item.MyReaction, &maxRead)
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		author := au.user(true)
		areas, err := unmarshalMediaAreas(areasRaw)
		if err != nil {
			return nil, err
		}
		item.MediaAreas = areas
		item.FwdFrom = fwdFrom(fwdAuthor, fwdStory)
		_ = discard
		if idx < 0 || author.ID != curAuthor {
			// Горизонт — свойство ГРУППЫ, а не истории: один номер на автора.
			out = append(out, domain.StoryGroup{Author: author, MaxReadID: maxRead, Stories: []domain.StoryRecord{}})
			idx++
			curAuthor = author.ID
		}
		out[idx].Stories = append(out[idx].Stories, item)
		storyIDs = append(storyIDs, item.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Index the just-appended items (append may have reallocated the slice, so
	// take addresses only after the read loop finished).
	for gi := range out {
		for si := range out[gi].Stories {
			it := &out[gi].Stories[si]
			byID[it.ID] = it
		}
	}
	if err := r.attachReactions(ctx, storyIDs, viewerID, byID); err != nil {
		return nil, err
	}
	return out, nil
}

// attachReactions loads the per-emoji reaction breakdown for the given stories
// in one query and fills each item's Reactions (with Mine set for the viewer's
// own emoji).
func (r *StoryRepo) attachReactions(ctx context.Context, storyIDs []int64, viewerID int64, byID map[int64]*domain.StoryRecord) error {
	if len(storyIDs) == 0 {
		return nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT story_id, reaction, count(*),
		        bool_or(user_id = $2) AS mine
		   FROM story_reactions
		  WHERE story_id = ANY($1)
		  GROUP BY story_id, reaction
		  ORDER BY count(*) DESC, reaction`,
		storyIDs, viewerID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var (
			sid int64
			rc  domain.ReactionCount
		)
		if err := rows.Scan(&sid, &rc.Emoji, &rc.Count, &rc.Mine); err != nil {
			return err
		}
		if it := byID[sid]; it != nil {
			it.Reactions = append(it.Reactions, rc)
		}
	}
	return rows.Err()
}

func (r *StoryRepo) MarkViewed(ctx context.Context, storyID, viewerID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO story_views (story_id, viewer_id) VALUES ($1,$2)
		 ON CONFLICT DO NOTHING`, storyID, viewerID)
	return err
}

// Viewers отдаёт просмотры истории ВМЕСТЕ с карточками зрителей — форма
// контейнера `stories.storyViewsList`.
//
// Дата просмотра и реакция зрителя приезжают тем же запросом: оба параметра
// объявлены у `storyView`, предмет у обоих есть (`story_views.viewed_at` и
// `story_reactions.reaction`), и терялись они только потому, что наружу ехали
// голые карточки.
func (r *StoryRepo) Viewers(ctx context.Context, storyID int64) (domain.StoryViewers, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+userRealCols("u.")+`, sv.viewed_at, COALESCE(sr.reaction,'')
		   FROM story_views sv
		   JOIN users u ON u.id = sv.viewer_id
		   LEFT JOIN story_reactions sr ON sr.story_id = sv.story_id AND sr.user_id = sv.viewer_id
		  WHERE sv.story_id = $1
		  ORDER BY sv.viewed_at`, storyID)
	if err != nil {
		return domain.StoryViewers{}, err
	}
	defer rows.Close()
	out := domain.StoryViewers{Views: []domain.StoryView{}, Users: []domain.UserReal{}}
	for rows.Next() {
		var us userRealScan
		var viewedAt time.Time
		var reaction string
		if err := rows.Scan(append(us.dest(), &viewedAt, &reaction)...); err != nil {
			return domain.StoryViewers{}, err
		}
		var r domain.Reaction
		if reaction != "" {
			r = domain.NewReactionEmoji(reaction)
		}
		out.Views = append(out.Views, domain.NewStoryView(us.id, viewedAt.Unix(), r))
		out.Users = append(out.Users, us.user(true))
	}
	return out, rows.Err()
}

// Stats считает статистику истории на лету: всего уникальных зрителей и их
// разбивку по дням (story_views.viewed_at) плюс реакции (всего + разбивка по
// эмодзи из story_reactions). Пересылок у историй нет.
func (r *StoryRepo) Stats(ctx context.Context, storyID int64) (domain.StoryStats, error) {
	var st domain.StoryStats
	if err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT count(*) FROM story_views WHERE story_id=$1`, storyID,
	).Scan(&st.Views); err != nil {
		return domain.StoryStats{}, err
	}
	rows, err := querier(ctx, r.pool).Query(ctx, `
		SELECT viewed_at::date AS day, count(*)
		FROM story_views WHERE story_id=$1
		GROUP BY day ORDER BY day`, storyID)
	if err != nil {
		return domain.StoryStats{}, err
	}
	defer rows.Close()
	st.ViewsByDay = make([]domain.StatPoint, 0)
	for rows.Next() {
		var p domain.StatPoint
		if err := rows.Scan(&p.Day, &p.Value); err != nil {
			return domain.StoryStats{}, err
		}
		st.ViewsByDay = append(st.ViewsByDay, p)
	}
	if err := rows.Err(); err != nil {
		return domain.StoryStats{}, err
	}

	if err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT count(*) FROM story_reactions WHERE story_id=$1`, storyID,
	).Scan(&st.ReactionsTotal); err != nil {
		return domain.StoryStats{}, err
	}
	rrows, err := querier(ctx, r.pool).Query(ctx, `
		SELECT reaction, count(*)
		FROM story_reactions WHERE story_id=$1
		GROUP BY reaction ORDER BY count(*) DESC, reaction`, storyID)
	if err != nil {
		return domain.StoryStats{}, err
	}
	defer rrows.Close()
	st.Reactions = make([]domain.ReactionCount, 0)
	for rrows.Next() {
		var rc domain.ReactionCount
		if err := rrows.Scan(&rc.Emoji, &rc.Count); err != nil {
			return domain.StoryStats{}, err
		}
		st.Reactions = append(st.Reactions, rc)
	}
	return st, rrows.Err()
}

// SetReaction ставит/меняет реакцию пользователя на историю (upsert).
func (r *StoryRepo) SetReaction(ctx context.Context, storyID, userID int64, reaction string) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO story_reactions (story_id, user_id, reaction) VALUES ($1,$2,$3)
		 ON CONFLICT (story_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction, created_at = now()`,
		storyID, userID, reaction)
	return err
}

// RemoveReaction снимает реакцию пользователя с истории.
func (r *StoryRepo) RemoveReaction(ctx context.Context, storyID, userID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM story_reactions WHERE story_id=$1 AND user_id=$2`, storyID, userID)
	return err
}

// ReactionsCount — всего реакций на историю.
func (r *StoryRepo) ReactionsCount(ctx context.Context, storyID int64) (int, error) {
	var n int
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT count(*) FROM story_reactions WHERE story_id=$1`, storyID).Scan(&n)
	return n, err
}

func (r *StoryRepo) GetAuthor(ctx context.Context, storyID int64) (int64, error) {
	var author int64
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT author_id FROM stories WHERE id=$1`, storyID).Scan(&author)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return author, err
}

// Origin returns a story's author id, author display name and media id — used by
// Repost (reuse media, fwd_from) and Share (attribution caption). domain.ErrNotFound
// when the story is gone.
func (r *StoryRepo) Origin(ctx context.Context, storyID int64) (domain.StoryOrigin, error) {
	var o domain.StoryOrigin
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT s.author_id, u.display_name, s.media_id
		   FROM stories s JOIN users u ON u.id = s.author_id
		  WHERE s.id=$1`, storyID).Scan(&o.AuthorID, &o.AuthorName, &o.MediaID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.StoryOrigin{}, domain.ErrNotFound
	}
	return o, err
}

func (r *StoryRepo) Delete(ctx context.Context, storyID, authorID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM stories WHERE id=$1 AND author_id=$2`, storyID, authorID)
	return err
}

func (r *StoryRepo) Visible(ctx context.Context, storyID, viewerID int64, partnerIDs []int64) (bool, error) {
	var ok bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT EXISTS (
		   SELECT 1 FROM stories s
		    WHERE s.id = $1
		      AND s.expires_at > now()
		      AND (s.author_id = $2
		           OR s.privacy IN ('everyone','contacts')
		           OR (s.privacy = 'close' AND EXISTS (SELECT 1 FROM close_friends cf WHERE cf.owner_id = s.author_id AND cf.user_id = $2))
		           OR EXISTS (SELECT 1 FROM story_allow sa WHERE sa.story_id = s.id AND sa.user_id = $2)))`,
		storyID, viewerID).Scan(&ok)
	return ok, err
}

// storyItemCols is the column list + reaction subqueries shared by Archive and
// Pinned (flat single-peer lists, no author grouping). $1 is the viewer.
const storyItemCols = `s.id, s.seq, s.media_id, s.caption, s.privacy, s.pinned, s.edited,
	s.media_areas, s.fwd_from_author_id, s.fwd_from_story_id, s.created_at, s.expires_at,
	(SELECT count(*) FROM story_reactions sr WHERE sr.story_id = s.id) AS reactions_count,
	COALESCE((SELECT sr.reaction FROM story_reactions sr WHERE sr.story_id = s.id AND sr.user_id = $1), '') AS my_reaction`

// scanStoryItems reads a flat story-item list (Archive/Pinned) and attaches the
// per-emoji reaction breakdown for viewerID in one extra batched query.
func (r *StoryRepo) scanStoryItems(ctx context.Context, rows pgx.Rows, viewerID int64) ([]domain.StoryRecord, error) {
	defer rows.Close()
	out := make([]domain.StoryRecord, 0)
	for rows.Next() {
		var (
			it                  domain.StoryRecord
			areasRaw            []byte
			fwdAuthor, fwdStory *int64
		)
		if err := rows.Scan(&it.ID, &it.Seq, &it.MediaID, &it.Caption, &it.Privacy, &it.Pinned, &it.Edited,
			&areasRaw, &fwdAuthor, &fwdStory, &it.CreatedAt, &it.ExpiresAt,
			&it.ReactionsCount, &it.MyReaction); err != nil {
			return nil, err
		}
		areas, err := unmarshalMediaAreas(areasRaw)
		if err != nil {
			return nil, err
		}
		it.MediaAreas = areas
		it.FwdFrom = fwdFrom(fwdAuthor, fwdStory)
		out = append(out, it)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	byID := make(map[int64]*domain.StoryRecord, len(out))
	storyIDs := make([]int64, 0, len(out))
	for i := range out {
		byID[out[i].ID] = &out[i]
		storyIDs = append(storyIDs, out[i].ID)
	}
	if err := r.attachReactions(ctx, storyIDs, viewerID, byID); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *StoryRepo) CloseFriends(ctx context.Context, ownerID int64) ([]int64, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT user_id FROM close_friends WHERE owner_id=$1 ORDER BY created_at`, ownerID)
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

// SetCloseFriends replaces the owner's list wholesale (delete-all + insert).
// Runs through querier so it composes inside a TxManager transaction.
func (r *StoryRepo) SetCloseFriends(ctx context.Context, ownerID int64, userIDs []int64) error {
	q := querier(ctx, r.pool)
	if _, err := q.Exec(ctx, `DELETE FROM close_friends WHERE owner_id=$1`, ownerID); err != nil {
		return err
	}
	for _, uid := range userIDs {
		if _, err := q.Exec(ctx,
			`INSERT INTO close_friends (owner_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
			ownerID, uid); err != nil {
			return err
		}
	}
	return nil
}

// AllowIDs returns the story's explicit allowlist (story_allow), ascending.
func (r *StoryRepo) AllowIDs(ctx context.Context, storyID int64) ([]int64, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT user_id FROM story_allow WHERE story_id=$1 ORDER BY user_id`, storyID)
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

func (r *StoryRepo) SetPinned(ctx context.Context, storyID, authorID int64, pinned bool) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE stories SET pinned=$3 WHERE id=$1 AND author_id=$2`, storyID, authorID, pinned)
	return err
}

// Edit updates caption/privacy (COALESCE keeps unset fields), flags edited, and
// re-syncs story_allow: for 'selected' it replaces the allowlist, for any other
// explicit privacy it clears it; an unchanged privacy leaves the allowlist as-is.
func (r *StoryRepo) Edit(ctx context.Context, storyID, authorID int64, caption, privacy *string, allowIDs []int64, mediaAreas *domain.MediaAreas) error {
	q := querier(ctx, r.pool)
	// media_areas: nil — не трогаем (COALESCE оставляет прежнее); иначе полностью
	// заменяем набор областей (tweb editStory заменяет media_areas).
	var areas *string
	if mediaAreas != nil {
		s, err := marshalMediaAreas(*mediaAreas)
		if err != nil {
			return err
		}
		areas = &s
	}
	if _, err := q.Exec(ctx,
		`UPDATE stories SET caption = COALESCE($3, caption), privacy = COALESCE($4, privacy),
		         media_areas = COALESCE($5::jsonb, media_areas), edited = true
		  WHERE id=$1 AND author_id=$2`,
		storyID, authorID, caption, privacy, areas); err != nil {
		return err
	}
	if privacy == nil {
		return nil
	}
	if _, err := q.Exec(ctx, `DELETE FROM story_allow WHERE story_id=$1`, storyID); err != nil {
		return err
	}
	if *privacy == "selected" {
		for _, uid := range allowIDs {
			if _, err := q.Exec(ctx,
				`INSERT INTO story_allow (story_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
				storyID, uid); err != nil {
				return err
			}
		}
	}
	return nil
}

func (r *StoryRepo) Archive(ctx context.Context, ownerID, limit, offsetID int64) ([]domain.StoryRecord, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+storyItemCols+`
		   FROM stories s
		   LEFT JOIN story_views sv ON sv.story_id = s.id AND sv.viewer_id = $1
		  WHERE s.author_id = $1
		    AND s.expires_at <= now()
		    AND ($3 = 0 OR s.id < $3)
		  ORDER BY s.id DESC
		  LIMIT $2`,
		ownerID, limit, offsetID)
	if err != nil {
		return nil, err
	}
	return r.scanStoryItems(ctx, rows, ownerID)
}

func (r *StoryRepo) Pinned(ctx context.Context, peerID, viewerID int64) ([]domain.StoryRecord, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+storyItemCols+`
		   FROM stories s
		   LEFT JOIN story_views sv ON sv.story_id = s.id AND sv.viewer_id = $1
		  WHERE s.author_id = $2
		    AND s.pinned
		    AND (s.author_id = $1
		         OR s.privacy IN ('everyone','contacts')
		         OR (s.privacy = 'close' AND EXISTS (SELECT 1 FROM close_friends cf WHERE cf.owner_id = s.author_id AND cf.user_id = $1))
		         OR EXISTS (SELECT 1 FROM story_allow sa WHERE sa.story_id = s.id AND sa.user_id = $1))
		  ORDER BY s.id DESC`,
		viewerID, peerID)
	if err != nil {
		return nil, err
	}
	return r.scanStoryItems(ctx, rows, viewerID)
}

// ByID — ОДНА история глазами зрителя по ВНУТРЕННЕМУ ключу. Нужна кадру
// `updateStory`: история едет в нём целиком, тем же конструктором, что и на
// витрине, — плоский кадр прошлой формы историю построить не мог (в нём был
// только номер файла).
//
// Видимость здесь НЕ проверяется: кадр адресуется тому, кто историю и так
// видит (автору либо получателю рассылки), а проверка живёт в usecase.
func (r *StoryRepo) ByID(ctx context.Context, storyID, viewerID int64) (domain.StoryRecord, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+storyItemCols+`
		   FROM stories s
		   LEFT JOIN story_views sv ON sv.story_id = s.id AND sv.viewer_id = $1
		  WHERE s.id = $2`,
		viewerID, storyID)
	if err != nil {
		return domain.StoryRecord{}, err
	}
	items, err := r.scanStoryItems(ctx, rows, viewerID)
	if err != nil {
		return domain.StoryRecord{}, err
	}
	if len(items) == 0 {
		return domain.StoryRecord{}, domain.ErrNotFound
	}
	return items[0], nil
}

func (r *StoryRepo) PurgeRecentViews(ctx context.Context, viewerID int64, since time.Time) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM story_views WHERE viewer_id=$1 AND viewed_at >= $2`, viewerID, since)
	return err
}
