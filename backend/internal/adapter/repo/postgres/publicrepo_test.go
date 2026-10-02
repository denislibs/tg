package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func TestPublicRepo_Resolve(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewPublicRepo(pool)
	ctx := context.Background()

	uid := seedUser(t, pool, "+7901")
	if _, err := pool.Exec(ctx,
		`UPDATE users SET username='pub_user', first_name='Паша', bio='обо мне', avatar_media_id=42 WHERE id=$1`, uid); err != nil {
		t.Fatal(err)
	}

	p, err := r.Resolve(ctx, "pub_user")
	if err != nil || p.Kind != "user" || p.Title != "Паша" || p.About != "обо мне" || p.AvatarMediaID != 42 {
		t.Fatalf("user resolve = %+v, %v", p, err)
	}

	var chatID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, about, username, is_public, member_count)
		 VALUES ('channel','Новости','описание','pub_channel',true,7) RETURNING id`).Scan(&chatID); err != nil {
		t.Fatal(err)
	}
	p, err = r.Resolve(ctx, "pub_channel")
	if err != nil || p.Kind != "channel" || p.Title != "Новости" || p.MemberCount != 7 {
		t.Fatalf("channel resolve = %+v, %v", p, err)
	}

	if _, err := r.Resolve(ctx, "nope_nope"); err != domain.ErrNotFound {
		t.Fatalf("missing username: %v, want ErrNotFound", err)
	}

	botID := seedUser(t, pool, "+7902")
	if _, err := pool.Exec(ctx,
		`UPDATE users SET username='pub_bot', first_name='Бот', is_bot=true WHERE id=$1`, botID); err != nil {
		t.Fatal(err)
	}
	if p, err := r.Resolve(ctx, "pub_bot"); err != nil || p.Kind != "bot" {
		t.Fatalf("bot resolve = %+v, %v", p, err)
	}

	// Ссылка-приглашение: чат за ней, флаги ссылки — наружу для проверки usecase'ом.
	var groupID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, about, member_count) VALUES ('group','Закрытая','о группе',3) RETURNING id`).
		Scan(&groupID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO invite_links (chat_id, token, created_by, usage_limit, uses, revoked) VALUES ($1,'inv_tok',$2,5,2,true)`,
		groupID, uid); err != nil {
		t.Fatal(err)
	}
	link, inv, err := r.Invite(ctx, "inv_tok")
	if err != nil || inv.Kind != "group" || inv.Title != "Закрытая" || inv.About != "о группе" || inv.MemberCount != 3 ||
		!link.Revoked || link.Uses != 2 || link.UsageLimit == nil || *link.UsageLimit != 5 {
		t.Fatalf("invite = %+v %+v, %v", link, inv, err)
	}
	if _, _, err := r.Invite(ctx, "no_tok"); err != domain.ErrNotFound {
		t.Fatalf("missing invite: %v, want ErrNotFound", err)
	}

	// Набор стикеров — по короткому имени без учёта регистра.
	if _, err := pool.Exec(ctx,
		`INSERT INTO sticker_sets (slug, title, kind) VALUES ('PubPack','Пак','emoji')`); err != nil {
		t.Fatal(err)
	}
	set, err := r.StickerSet(ctx, "pubpack")
	if err != nil || set.ShortName != "PubPack" || set.Title != "Пак" || !set.Emoji {
		t.Fatalf("sticker set = %+v, %v", set, err)
	}
	if _, err := r.StickerSet(ctx, "nopack"); err != domain.ErrNotFound {
		t.Fatalf("missing set: %v, want ErrNotFound", err)
	}

	// Пост публичного канала: текст с разметкой; удалённый и служебный — не найдены.
	if _, err := pool.Exec(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, entities, views) VALUES
		   ($1, 1, $2, 'text', 'привет', '[{"_":"messageEntityBold","offset":0,"length":6}]', 9),
		   ($1, 2, $2, 'service', '', NULL, 0)`, chatID, uid); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, deleted_at) VALUES ($1, 3, $2, 'text', 'x', now())`,
		chatID, uid); err != nil {
		t.Fatal(err)
	}
	post, err := r.Post(ctx, "PUB_CHANNEL", 1)
	if err != nil || post.Text != "привет" || post.Views != 9 || len(post.Entities) != 1 ||
		post.Channel.Title != "Новости" || post.Channel.Username != "pub_channel" || post.MediaID != 0 {
		t.Fatalf("post = %+v, %v", post, err)
	}
	for _, seq := range []int64{2, 3, 4} {
		if _, err := r.Post(ctx, "pub_channel", seq); err != domain.ErrNotFound {
			t.Fatalf("post seq=%d: %v, want ErrNotFound", seq, err)
		}
	}
}
