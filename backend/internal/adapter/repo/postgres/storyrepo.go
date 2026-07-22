package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	storyusecase "github.com/messenger-denis/backend/internal/usecase/story"
)

// StoryRepo is a postgres-backed adapter implementing the story usecase's
// StoryRepo port: post, the active feed read model (privacy/visibility +
// per-viewer seen state), view tracking, viewers, author lookup, deletion, and
// a single-story visibility check. Every query runs through querier(ctx, pool)
// so methods compose inside a TxManager transaction.
type StoryRepo struct{ pool *pgxpool.Pool }

var _ storyusecase.StoryRepo = (*StoryRepo)(nil)

func NewStoryRepo(pool *pgxpool.Pool) *StoryRepo { return &StoryRepo{pool: pool} }

func (r *StoryRepo) Create(ctx context.Context, s domain.Story, allowIDs []int64) (int64, error) {
	q := querier(ctx, r.pool)
	var id int64
	err := q.QueryRow(ctx,
		`INSERT INTO stories (author_id, media_id, caption, privacy, expires_at)
		 VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		s.AuthorID, s.MediaID, s.Caption, s.Privacy, s.ExpiresAt).Scan(&id)
	if err != nil {
		return 0, err
	}
	if s.Privacy == "selected" {
		for _, uid := range allowIDs {
			if _, err := q.Exec(ctx,
				`INSERT INTO story_allow (story_id, user_id) VALUES ($1,$2)
				 ON CONFLICT DO NOTHING`, id, uid); err != nil {
				return 0, err
			}
		}
	}
	return id, nil
}

func (r *StoryRepo) ActiveFeed(ctx context.Context, viewerID int64, authorIDs []int64) ([]domain.StoryGroup, error) {
	if len(authorIDs) == 0 {
		return []domain.StoryGroup{}, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT s.id, s.author_id, s.media_id, s.caption, s.created_at,
		        u.id, u.display_name, COALESCE(u.avatar_url,''),
		        (sv.viewer_id IS NOT NULL) AS viewed
		   FROM stories s
		   JOIN users u ON u.id = s.author_id
		   LEFT JOIN story_views sv ON sv.story_id = s.id AND sv.viewer_id = $1
		  WHERE s.expires_at > now()
		    AND s.author_id = ANY($2)
		    AND (s.author_id = $1
		         OR s.privacy IN ('everyone','contacts')
		         OR EXISTS (SELECT 1 FROM story_allow sa WHERE sa.story_id = s.id AND sa.user_id = $1))
		  ORDER BY (s.author_id = $1) DESC, u.display_name, s.created_at`,
		viewerID, authorIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.StoryGroup, 0)
	var curAuthor int64
	idx := -1
	for rows.Next() {
		var (
			item    domain.StoryItem
			author  domain.UserCard
			discard int64 // s.author_id (== u.id via JOIN)
		)
		if err := rows.Scan(&item.ID, &discard, &item.MediaID, &item.Caption, &item.CreatedAt,
			&author.ID, &author.DisplayName, &author.AvatarURL, &item.Viewed); err != nil {
			return nil, err
		}
		_ = discard
		if idx < 0 || author.ID != curAuthor {
			out = append(out, domain.StoryGroup{Author: author, Stories: []domain.StoryItem{}})
			idx++
			curAuthor = author.ID
		}
		out[idx].Stories = append(out[idx].Stories, item)
	}
	return out, rows.Err()
}

func (r *StoryRepo) MarkViewed(ctx context.Context, storyID, viewerID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO story_views (story_id, viewer_id) VALUES ($1,$2)
		 ON CONFLICT DO NOTHING`, storyID, viewerID)
	return err
}

func (r *StoryRepo) Viewers(ctx context.Context, storyID int64) ([]domain.UserCard, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT u.id, COALESCE(u.username,''), u.display_name, COALESCE(u.avatar_url,'')
		   FROM story_views sv
		   JOIN users u ON u.id = sv.viewer_id
		  WHERE sv.story_id = $1
		  ORDER BY sv.viewed_at`, storyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.UserCard, 0)
	for rows.Next() {
		var u domain.UserCard
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.AvatarURL); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// Stats считает статистику истории на лету из story_views: всего уникальных
// зрителей и их разбивку по дням (viewed_at). Реакций/пересылок у историй нет.
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
	return st, rows.Err()
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
		           OR EXISTS (SELECT 1 FROM story_allow sa WHERE sa.story_id = s.id AND sa.user_id = $2)))`,
		storyID, viewerID).Scan(&ok)
	return ok, err
}
