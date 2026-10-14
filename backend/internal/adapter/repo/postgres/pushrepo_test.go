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
	// пробивает и его. Мьют темы — СРОК (Ф-5): до срока молчит, после —
	// пробивается.
	const topicRoot int64 = 4242
	if _, err := pool.Exec(ctx, `UPDATE chats SET is_forum = true WHERE id = $1`, chatID); err != nil {
		t.Fatalf("forum on: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO topic_user_state (chat_id, root_msg_id, user_id, muted_until) VALUES ($1,$2,$3,now()+interval '1 hour')`,
		chatID, topicRoot, userID); err != nil {
		t.Fatalf("seed topic mute: %v", err)
	}
	checkAt("topic muted", topicRoot, false, false, false)
	checkAt("other topic", topicRoot+1, false, true, true)
	checkAt("topic muted, mentioned", topicRoot, true, true, true)
	if _, err := pool.Exec(ctx,
		`UPDATE topic_user_state SET muted_until=now()-interval '1 minute' WHERE chat_id=$1 AND root_msg_id=$2 AND user_id=$3`,
		chatID, topicRoot, userID); err != nil {
		t.Fatalf("expire topic mute: %v", err)
	}
	checkAt("topic mute expired", topicRoot, false, true, true)

	// Три состояния мьюта темы (tweb appNotificationsManager.ts:398-405):
	// нетронутая тема наследует мьют чата, а явная запись темы (0 или
	// истёкший срок) уведомляет даже в заглушённом чате.
	if _, err := pool.Exec(ctx,
		`UPDATE chat_members SET muted_until=to_timestamp($3) WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID, domain.MuteUntilForever); err != nil {
		t.Fatalf("mute chat: %v", err)
	}
	checkAt("chat muted, untouched topic inherits", topicRoot+1, false, false, false)
	checkAt("chat muted, topic expired = explicit on", topicRoot, false, true, true)
	if _, err := pool.Exec(ctx,
		`UPDATE topic_user_state SET muted_until=to_timestamp(0) WHERE chat_id=$1 AND root_msg_id=$2 AND user_id=$3`,
		chatID, topicRoot, userID); err != nil {
		t.Fatalf("topic explicit on: %v", err)
	}
	checkAt("chat muted, topic explicit on", topicRoot, false, true, true)
	// Темы выключены — записи тем за чат не решают (tweb validatePeerSettings,
	// appNotificationsManager.ts:389-392).
	if _, err := pool.Exec(ctx, `UPDATE chats SET is_forum = false WHERE id = $1`, chatID); err != nil {
		t.Fatalf("forum off: %v", err)
	}
	checkAt("not a forum, stale topic explicit on, chat muted", topicRoot, false, false, false)
	if _, err := pool.Exec(ctx, `UPDATE chats SET is_forum = true WHERE id = $1`, chatID); err != nil {
		t.Fatalf("forum on: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE chat_members SET muted_until=NULL WHERE chat_id=$1 AND user_id=$2`, chatID, userID); err != nil {
		t.Fatalf("unmute chat: %v", err)
	}

	// Глобальные настройки: группы замьючены.
	if _, err := pool.Exec(ctx,
		`INSERT INTO notify_settings (user_id, groups_muted) VALUES ($1, true)`, userID); err != nil {
		t.Fatalf("seed notify_settings: %v", err)
	}
	check("groups muted globally", false, false)
	// Явная запись темы решает и против мьюта типа чата (respectType: false,
	// tweb appNotificationsManager.ts:400).
	checkAt("groups muted globally, topic explicit on", topicRoot, false, true, true)
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

// Р-1: мьют чата трёхзначный. Выключенный тип чатов заглушает только чаты, у
// которых мьют не задан (NULL); явное «уведомлять» (0 или истёкший срок) —
// исключение из типа, как в tweb (appNotificationsManager.ts:342-384).
func TestPushRepo_ChatMuteOverridesType(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewPushRepo(pool)
	chats := NewChatsRepo(pool)
	ctx := context.Background()
	user := seedUser(t, pool, "+7960")
	other := seedUser(t, pool, "+7961")
	mustExec(t, pool, `INSERT INTO notify_settings (user_id, groups_muted, channels_muted) VALUES ($1, true, true)`, user)

	inherit := createGroupLike(t, pool, "group", user)   // NULL
	explicit := createGroupLike(t, pool, "group", user)  // 0 — «включил»
	expired := createGroupLike(t, pool, "group", user)   // истёкший срок
	mutedSelf := createGroupLike(t, pool, "group", user) // срок в будущем
	mustExec(t, pool, `UPDATE chat_members SET muted_until = to_timestamp(0) WHERE chat_id=$1 AND user_id=$2`, explicit, user)
	mustExec(t, pool, `UPDATE chat_members SET muted_until = now() - interval '1 hour' WHERE chat_id=$1 AND user_id=$2`, expired, user)
	mustExec(t, pool, `UPDATE chat_members SET muted_until = now() + interval '1 hour' WHERE chat_id=$1 AND user_id=$2`, mutedSelf, user)

	for name, c := range map[string]struct {
		chat int64
		want bool
	}{"наследует выключенный тип": {inherit, false}, "явно включён": {explicit, true},
		"истёкший срок": {expired, true}, "заглушён сам": {mutedSelf, false}} {
		if ok, _, err := repo.ShouldNotify(ctx, c.chat, user, 0, false); err != nil || ok != c.want {
			t.Errorf("ShouldNotify %s = %v,%v; want %v", name, ok, err, c.want)
		}
	}

	// Канал (NotifyTargets): тот же закон.
	chInherit := createGroupLike(t, pool, "channel", other)
	chExplicit := createGroupLike(t, pool, "channel", other)
	for _, ch := range []int64{chInherit, chExplicit} {
		if err := NewGroupRepo(pool).AddMember(ctx, ch, user, domain.RoleSubscriber, 0); err != nil {
			t.Fatal(err)
		}
	}
	mustExec(t, pool, `UPDATE chat_members SET muted_until = to_timestamp(0) WHERE chat_id=$1 AND user_id=$2`, chExplicit, user)
	if got, err := repo.NotifyTargets(ctx, chInherit, []int64{user}); err != nil || len(got) != 0 {
		t.Errorf("NotifyTargets(наследует выключенный тип) = %v, %v; want пусто", got, err)
	}
	if got, err := repo.NotifyTargets(ctx, chExplicit, []int64{user}); err != nil || len(got) != 1 {
		t.Errorf("NotifyTargets(явно включён) = %v, %v; want пользователь", got, err)
	}

	// Архив: новое сообщение возвращает из архива только эффективно незаглушённых.
	for _, c := range []int64{inherit, explicit, expired, mutedSelf} {
		mustExec(t, pool, `UPDATE chat_members SET archived = true WHERE chat_id=$1 AND user_id=$2`, c, user)
	}
	for c, want := range map[int64]bool{inherit: false, explicit: true, expired: true, mutedSelf: false} {
		back, err := chats.UnarchiveUnmuted(ctx, c, []int64{user})
		if err != nil || (len(back) == 1) != want {
			t.Errorf("UnarchiveUnmuted(chat %d) = %v, %v; want вернуть=%v", c, back, err, want)
		}
	}

	// Бейдж: считаются только эффективно незаглушённые, неархивные.
	mustExec(t, pool, `UPDATE chat_members SET archived = false, unread_count = 2 WHERE user_id=$1`, user)
	if badge, err := repo.UnreadBadge(ctx, user); err != nil || badge != 4 { // explicit + expired
		t.Errorf("UnreadBadge = %d, %v; want 4", badge, err)
	}
}
