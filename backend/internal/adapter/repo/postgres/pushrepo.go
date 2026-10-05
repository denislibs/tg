package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasepush "github.com/messenger-denis/backend/internal/usecase/push"
)

// PushRepo implements the push usecase's SubRepo, NotifyChecker, and Enricher
// ports — all are push-support queries over the same postgres tables.
type PushRepo struct{ pool *pgxpool.Pool }

func NewPushRepo(pool *pgxpool.Pool) *PushRepo { return &PushRepo{pool: pool} }

var (
	_ usecasepush.SubRepo       = (*PushRepo)(nil)
	_ usecasepush.NotifyChecker = (*PushRepo)(nil)
	_ usecasepush.Enricher      = (*PushRepo)(nil)
)

// Add upserts a subscription for a device (keyed by endpoint). On conflict the
// original device_id is kept (the endpoint is owned by whoever first registered
// it) — only the rotating keys are refreshed.
func (r *PushRepo) Add(ctx context.Context, deviceID int64, s domain.PushSubscription) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO push_subscriptions (device_id, endpoint, p256dh, auth)
		 VALUES ($1,$2,$3,$4)
		 ON CONFLICT (endpoint) DO UPDATE SET p256dh=$3, auth=$4`,
		deviceID, s.Endpoint, s.P256dh, s.Auth)
	return err
}

// ForUser returns all push subscriptions across a user's devices.
func (r *PushRepo) ForUser(ctx context.Context, userID int64) ([]domain.PushSubscription, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps
		 JOIN devices d ON d.id = ps.device_id WHERE d.user_id=$1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.PushSubscription
	for rows.Next() {
		var s domain.PushSubscription
		if err := rows.Scan(&s.Endpoint, &s.P256dh, &s.Auth); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// DeleteByEndpoint removes a (likely expired) subscription.
func (r *PushRepo) DeleteByEndpoint(ctx context.Context, endpoint string) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint=$1`, endpoint)
	return err
}

// ShouldNotify — гейт пуша одним запросом: per-chat mute приоритетнее,
// глобальные настройки по типу чата (notify_settings) — fallback; у не
// сохранявших настройки действуют дефолты. Не участник → не пушим.
//
// Мьют чата читается СРОКОМ, а решает вопрос «замьючен ли сейчас» единственный
// предикат домена (PeerNotifySettings.Muted) — той же копии условия в SQL здесь
// больше нет.
func (r *PushRepo) ShouldNotify(ctx context.Context, chatID, userID int64) (bool, bool, error) {
	targets, err := r.NotifyTargets(ctx, chatID, []int64{userID})
	if err != nil {
		return false, false, err
	}
	preview, ok := targets[userID]
	return ok, preview, nil
}

// NotifyTargets — решение ShouldNotify пачкой по участникам одного чата:
// ключ карты — кому пушить, значение — с текстом ли (Message Preview). Не
// участник и замьюченный в карту не попадают. Один запрос на пачку — пуш поста
// канала решается для всех подписчиков разом.
func (r *PushRepo) NotifyTargets(ctx context.Context, chatID int64, userIDs []int64) (map[int64]bool, error) {
	out := make(map[int64]bool, len(userIDs))
	if len(userIDs) == 0 {
		return out, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT m.user_id, m.muted_until, c.type,
		        ns.private_muted, ns.private_preview, ns.groups_muted, ns.groups_preview,
		        ns.channels_muted, ns.channels_preview
		 FROM chat_members m
		 JOIN chats c ON c.id = m.chat_id
		 LEFT JOIN notify_settings ns ON ns.user_id = m.user_id
		 WHERE m.chat_id=$1 AND m.user_id = ANY($2)`,
		chatID, userIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	now := time.Now()
	for rows.Next() {
		var uid int64
		var muteUntil *time.Time
		var chatType string
		var pm, pp, gm, gp, cm, cp *bool
		if err := rows.Scan(&uid, &muteUntil, &chatType, &pm, &pp, &gm, &gp, &cm, &cp); err != nil {
			return nil, err
		}
		if peerNotifySettings(muteUntil, nil, nil, now).Muted(now) {
			continue
		}
		ns := domain.DefaultNotifySettings()
		if pm != nil { // строка notify_settings существует
			ns.Private = domain.NotifyTypeSettings{Muted: *pm, Preview: *pp}
			ns.Groups = domain.NotifyTypeSettings{Muted: *gm, Preview: *gp}
			ns.Channels = domain.NotifyTypeSettings{Muted: *cm, Preview: *cp}
		}
		t := ns.ForChatType(chatType)
		if t.Muted {
			continue
		}
		out[uid] = t.Preview
	}
	return out, rows.Err()
}

// SenderName returns the user's display name (empty if unknown).
func (r *PushRepo) SenderName(ctx context.Context, userID int64) (string, error) {
	var name string
	_ = querier(ctx, r.pool).QueryRow(ctx, `SELECT display_name FROM users WHERE id=$1`, userID).Scan(&name)
	return name, nil
}

// UnreadBadge returns the total unread count across the user's chats.
func (r *PushRepo) UnreadBadge(ctx context.Context, userID int64) (int, error) {
	var badge int
	// Aggregate with COALESCE always returns one row; best-effort on error.
	_ = querier(ctx, r.pool).QueryRow(ctx,
		`SELECT COALESCE(SUM(`+dialogUnreadCount("m", "c")+`),0)
		   FROM chat_members m JOIN chats c ON c.id = m.chat_id WHERE m.user_id=$1`,
		userID).Scan(&badge)
	return badge, nil
}
