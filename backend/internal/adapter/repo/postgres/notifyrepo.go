package postgres

import (
	"context"
	"errors"
	"fmt"

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

// PatchType меняет переданные поля одного типа чатов одним выражением
// (INSERT … ON CONFLICT DO UPDATE с COALESCE): параллельные правки разных
// типов или полей не затирают друг друга. Имена колонок берутся из закрытого
// набора, не из ввода.
func (r *NotifyRepo) PatchType(ctx context.Context, userID int64, t domain.NotifyType, muted, preview *bool) error {
	var mutedCol, previewCol string
	switch t {
	case domain.NotifyTypeUsers:
		mutedCol, previewCol = "private_muted", "private_preview"
	case domain.NotifyTypeChats:
		mutedCol, previewCol = "groups_muted", "groups_preview"
	case domain.NotifyTypeBroadcasts:
		mutedCol, previewCol = "channels_muted", "channels_preview"
	default:
		return domain.ErrInvalid
	}
	_, err := querier(ctx, r.pool).Exec(ctx, fmt.Sprintf(
		`INSERT INTO notify_settings (user_id, %[1]s, %[2]s)
		 VALUES ($1, COALESCE($2::boolean, false), COALESCE($3::boolean, true))
		 ON CONFLICT (user_id) DO UPDATE SET
		   %[1]s = COALESCE($2::boolean, notify_settings.%[1]s),
		   %[2]s = COALESCE($3::boolean, notify_settings.%[2]s)`, mutedCol, previewCol),
		userID, muted, preview)
	return err
}
