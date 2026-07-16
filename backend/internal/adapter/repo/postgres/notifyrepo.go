package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasenotify "github.com/messenger-denis/backend/internal/usecase/notify"
)

// NotifyRepo реализует notify.Repo поверх таблицы notify_settings.
type NotifyRepo struct{ pool *pgxpool.Pool }

func NewNotifyRepo(pool *pgxpool.Pool) *NotifyRepo { return &NotifyRepo{pool: pool} }

var _ usecasenotify.Repo = (*NotifyRepo)(nil)

func (r *NotifyRepo) Get(ctx context.Context, userID int64) (domain.NotifySettings, error) {
	var s domain.NotifySettings
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT private_muted, private_preview, groups_muted, groups_preview,
		        channels_muted, channels_preview
		 FROM notify_settings WHERE user_id=$1`, userID).Scan(
		&s.Private.Muted, &s.Private.Preview, &s.Groups.Muted, &s.Groups.Preview,
		&s.Channels.Muted, &s.Channels.Preview)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.NotifySettings{}, domain.ErrNotFound
	}
	return s, err
}

func (r *NotifyRepo) Upsert(ctx context.Context, userID int64, s domain.NotifySettings) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO notify_settings
		   (user_id, private_muted, private_preview, groups_muted, groups_preview, channels_muted, channels_preview)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)
		 ON CONFLICT (user_id) DO UPDATE SET
		   private_muted=$2, private_preview=$3, groups_muted=$4, groups_preview=$5,
		   channels_muted=$6, channels_preview=$7`,
		userID, s.Private.Muted, s.Private.Preview, s.Groups.Muted, s.Groups.Preview,
		s.Channels.Muted, s.Channels.Preview)
	return err
}
