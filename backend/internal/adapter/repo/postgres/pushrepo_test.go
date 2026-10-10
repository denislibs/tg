package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func TestPushRepo_SubscriptionLifecycle(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewPushRepo(pool)
	ctx := context.Background()

	var userID, deviceID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (phone, display_name) VALUES ('+700','Alice') RETURNING id`).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO devices (user_id, token_hash) VALUES ($1,'tok1') RETURNING id`, userID).Scan(&deviceID); err != nil {
		t.Fatalf("seed device: %v", err)
	}

	sub := domain.PushSubscription{Endpoint: "https://push/ep1", P256dh: "p1", Auth: "a1"}
	if err := repo.Add(ctx, deviceID, sub); err != nil {
		t.Fatalf("Add: %v", err)
	}

	subs, err := repo.ForUser(ctx, userID)
	if err != nil || len(subs) != 1 {
		t.Fatalf("ForUser = %+v, %v", subs, err)
	}
	if subs[0] != sub {
		t.Fatalf("ForUser sub = %+v, want %+v", subs[0], sub)
	}

	// Upsert: same endpoint, rotated keys, original device kept.
	upd := domain.PushSubscription{Endpoint: "https://push/ep1", P256dh: "p2", Auth: "a2"}
	if err := repo.Add(ctx, deviceID, upd); err != nil {
		t.Fatalf("Add upsert: %v", err)
	}
	subs, _ = repo.ForUser(ctx, userID)
	if len(subs) != 1 || subs[0].P256dh != "p2" || subs[0].Auth != "a2" {
		t.Fatalf("upsert keys not refreshed: %+v", subs)
	}

	if err := repo.DeleteByEndpoint(ctx, "https://push/ep1"); err != nil {
		t.Fatalf("DeleteByEndpoint: %v", err)
	}
	subs, _ = repo.ForUser(ctx, userID)
	if len(subs) != 0 {
		t.Fatalf("expected 0 subs after delete, got %d", len(subs))
	}
}

func TestPushRepo_ShouldNotify(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewPushRepo(pool)
	ctx := context.Background()

	var userID, chatID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (phone, display_name) VALUES ('+701','Bob') RETURNING id`).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type) VALUES ('group') RETURNING id`).Scan(&chatID); err != nil {
		t.Fatalf("seed chat: %v", err)
	}

	checkAt := func(label string, topic int64, mentioned, wantNotify, wantPreview bool) {
		t.Helper()
		notify, preview, err := repo.ShouldNotify(ctx, chatID, userID, topic, mentioned)
		if err != nil || notify != wantNotify || preview != wantPreview {
			t.Fatalf("%s: ShouldNotify = %v,%v,%v; want %v,%v,nil", label, notify, preview, err, wantNotify, wantPreview)
		}
	}
	check := func(label string, wantNotify, wantPreview bool) {
		t.Helper()
		checkAt(label, 0, false, wantNotify, wantPreview)
	}

	// Not a member → no push.
	check("non-member", false, false)

	if _, err := pool.Exec(ctx,
		`INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2)`, chatID, userID); err != nil {
		t.Fatalf("seed member: %v", err)
	}
	// Member without saved settings → defaults: push with preview.
	check("defaults", true, true)

	// Per-chat mute «навсегда» — это СРОК в далёком будущем, а не отдельный
	// флаг: колонки muted больше нет вовсе (миграция 0104).
	if _, err := pool.Exec(ctx,
		`UPDATE chat_members SET muted_until=to_timestamp($3) WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID, domain.MuteUntilForever); err != nil {
		t.Fatalf("update muted_until: %v", err)
	}
	check("muted forever", false, false)
	// A3-21: упоминание или ответ пробивает мьют чата.
	checkAt("muted forever, mentioned", 0, true, true, true)

	// Временный mute в будущем / истёкший.
	if _, err := pool.Exec(ctx,
		`UPDATE chat_members SET muted_until=now()+interval '1 hour' WHERE chat_id=$1 AND user_id=$2`, chatID, userID); err != nil {
		t.Fatalf("update muted_until: %v", err)
	}
	check("muted until future", false, false)
	if _, err := pool.Exec(ctx,
		`UPDATE chat_members SET muted_until=now()-interval '1 hour' WHERE chat_id=$1 AND user_id=$2`, chatID, userID); err != nil {
		t.Fatalf("expire muted_until: %v", err)
	}
	check("mute expired", true, true)

	// A3-21: мьют темы гасит пуш в этой теме (и только в ней); упоминание
	// пробивает и его.
	const topicRoot int64 = 4242
	if _, err := pool.Exec(ctx,
		`INSERT INTO topic_user_state (chat_id, root_msg_id, user_id, muted) VALUES ($1,$2,$3,true)`,
		chatID, topicRoot, userID); err != nil {
		t.Fatalf("seed topic mute: %v", err)
	}
	checkAt("topic muted", topicRoot, false, false, false)
	checkAt("other topic", topicRoot+1, false, true, true)
	checkAt("topic muted, mentioned", topicRoot, true, true, true)

	// Глобальные настройки: группы замьючены.
	if _, err := pool.Exec(ctx,
		`INSERT INTO notify_settings (user_id, groups_muted) VALUES ($1, true)`, userID); err != nil {
		t.Fatalf("seed notify_settings: %v", err)
	}
	check("groups muted globally", false, false)
	checkAt("groups muted globally, mentioned", 0, true, true, true)

	// Группы включены, но без превью.
	if _, err := pool.Exec(ctx,
		`UPDATE notify_settings SET groups_muted=false, groups_preview=false WHERE user_id=$1`, userID); err != nil {
		t.Fatalf("update notify_settings: %v", err)
	}
	check("groups no preview", true, false)
}

func TestPushRepo_Enricher(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewPushRepo(pool)
	ctx := context.Background()

	var senderID, userID, chatID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (phone, display_name) VALUES ('+702','Carol') RETURNING id`).Scan(&senderID); err != nil {
		t.Fatalf("seed sender: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (phone, display_name) VALUES ('+703','Dave') RETURNING id`).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type) VALUES ('group') RETURNING id`).Scan(&chatID); err != nil {
		t.Fatalf("seed chat: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO chat_members (chat_id, user_id, unread_count) VALUES ($1,$2,3)`, chatID, userID); err != nil {
		t.Fatalf("seed member: %v", err)
	}

	name, err := repo.SenderName(ctx, senderID)
	if err != nil || name != "Carol" {
		t.Fatalf("SenderName = %q, %v; want Carol", name, err)
	}

	badge, err := repo.UnreadBadge(ctx, userID)
	if err != nil || badge != 3 {
		t.Fatalf("UnreadBadge = %d, %v; want 3", badge, err)
	}

	// A3-38: заглушённые и архивные в бейдж не входят. Группа обсуждения, в
	// которой пользователь состоит, — обычный чат списка (Ф-5) и входит.
	seedChatUnread := func(typ string, unread int, extra string) int64 {
		t.Helper()
		var id int64
		if err := pool.QueryRow(ctx, `INSERT INTO chats (type) VALUES ($1) RETURNING id`, typ).Scan(&id); err != nil {
			t.Fatalf("seed chat: %v", err)
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO chat_members (chat_id, user_id, unread_count) VALUES ($1,$2,$3)`, id, userID, unread); err != nil {
			t.Fatalf("seed member: %v", err)
		}
		if extra != "" {
			if _, err := pool.Exec(ctx, `UPDATE chat_members SET `+extra+` WHERE chat_id=$1 AND user_id=$2`, id, userID); err != nil {
				t.Fatalf("update member: %v", err)
			}
		}
		return id
	}
	seedChatUnread("group", 5, "muted_until = now() + interval '1 hour'")
	seedChatUnread("group", 7, "archived = true")
	disc := seedChatUnread("group", 11, "")
	var channelID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, discussion_chat_id) VALUES ('channel', $1) RETURNING id`, disc).Scan(&channelID); err != nil {
		t.Fatalf("seed channel: %v", err)
	}
	if badge, err := repo.UnreadBadge(ctx, userID); err != nil || badge != 3+11 {
		t.Fatalf("UnreadBadge с заглушённым/архивным/обсуждением = %d, %v; want 14", badge, err)
	}

	// User with no memberships → 0.
	if badge, err := repo.UnreadBadge(ctx, senderID); err != nil || badge != 0 {
		t.Fatalf("UnreadBadge(none) = %d, %v; want 0", badge, err)
	}
}
