package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
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

// ShouldNotify — гейт пуша одним запросом: мьют чата (сроком), мьют темы
// (topic_user_state) и глобальные настройки по типу чата (notify_settings, у
// не сохранявших — дефолты). Упоминание или ответ получателю (mentioned)
// пробивает любой из мьютов — как у Telegram (tweb appMessagesManager
// handleNotifications: `muted && !mentioned` → не уведомлять). Не участник →
// не пушим.
//
// Мьют чата читается СРОКОМ, а решает вопрос «замьючен ли сейчас» единственный
// предикат домена (PeerNotifySettings.Muted) — той же копии условия в SQL здесь
// больше нет.
func (r *PushRepo) ShouldNotify(ctx context.Context, chatID, userID, topicRootID int64, mentioned bool) (bool, bool, error) {
	var muteUntil *time.Time
	var chatType string
	var topicMuted bool
	var pm, pp, gm, gp, cm, cp *bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT m.muted_until, c.type,
		        COALESCE((SELECT ts.muted FROM topic_user_state ts
		                   WHERE ts.chat_id = m.chat_id AND ts.root_msg_id = $3 AND ts.user_id = m.user_id), false),
		        ns.private_muted, ns.private_preview, ns.groups_muted, ns.groups_preview,
		        ns.channels_muted, ns.channels_preview
		 FROM chat_members m
		 JOIN chats c ON c.id = m.chat_id
		 LEFT JOIN notify_settings ns ON ns.user_id = m.user_id
		 WHERE m.chat_id=$1 AND m.user_id=$2`,
		chatID, userID, topicRootID).Scan(&muteUntil, &chatType, &topicMuted, &pm, &pp, &gm, &gp, &cm, &cp)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, false, nil // not a member → no push
	}
	if err != nil {
		return false, false, err
	}
	now := time.Now()
	ns := domain.DefaultNotifySettings()
	if pm != nil { // строка notify_settings существует
		ns.Private = domain.NotifyTypeSettings{Muted: *pm, Preview: *pp}
		ns.Groups = domain.NotifyTypeSettings{Muted: *gm, Preview: *gp}
		ns.Channels = domain.NotifyTypeSettings{Muted: *cm, Preview: *cp}
	}
	t := ns.ForChatType(chatType)
	muted := peerNotifySettings(muteUntil, nil, nil, now).Muted(now) || t.Muted || topicMuted
	if muted && !mentioned {
		return false, false, nil
	}
	return true, t.Preview, nil
}

// SenderName returns the user's display name (empty if unknown).
func (r *PushRepo) SenderName(ctx context.Context, userID int64) (string, error) {
	var name string
	_ = querier(ctx, r.pool).QueryRow(ctx, `SELECT display_name FROM users WHERE id=$1`, userID).Scan(&name)
	return name, nil
}

// UnreadBadge — бейдж иконки в пуше: непрочитанное тех чатов, что видны в
// основном списке и не заглушены. Заглушённые и архивные (у tweb бейдж
// приложения их не считает) и скрытые группы обсуждения каналов (в списке
// чатов их нет вовсе — ChatsRepo.ListDialogs) в сумму не входят: иначе бейдж
// иконки больше суммы бейджей списка.
func (r *PushRepo) UnreadBadge(ctx context.Context, userID int64) (int, error) {
	var badge int
	// Aggregate with COALESCE always returns one row; best-effort on error.
	_ = querier(ctx, r.pool).QueryRow(ctx,
		`SELECT COALESCE(SUM(m.unread_count),0) FROM chat_members m
		  WHERE m.user_id=$1 AND NOT m.archived
		    AND (m.muted_until IS NULL OR m.muted_until <= now())
		    AND m.chat_id NOT IN (SELECT discussion_chat_id FROM chats WHERE discussion_chat_id IS NOT NULL)`,
		userID).Scan(&badge)
	return badge, nil
}
