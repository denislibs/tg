package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// BackfillDiscussionMirrors переводит треды комментариев, написанные по СТАРОЙ
// схеме (thread_root_id = id поста в канале), на Telegram-модель: создаёт
// зеркало поста в группе обсуждения и перевешивает тред на него.
//
// Идемпотентна: пары, у которых зеркало уже есть, отбрасываются (NOT EXISTS),
// поэтому повторный запуск на старте приложения ничего не делает и возвращает 0.
// Бэкфиллятся только посты, у которых есть хотя бы один комментарий — полная
// история каналов в группы не переносится (решение спеки).
func BackfillDiscussionMirrors(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	// 1. Пары (пост, группа обсуждения), которым нужно зеркало, + сам пост.
	rows, err := tx.Query(ctx, `
		SELECT DISTINCT p.id, p.chat_id, c.discussion_chat_id, p.sender_id, p.type,
		       p.text, p.entities, p.media_id, p.grouped_id, p.created_at
		  FROM messages cm
		  JOIN messages p ON p.id = cm.thread_root_id
		  JOIN chats c ON c.id = p.chat_id
		 WHERE cm.thread_root_id IS NOT NULL
		   AND cm.deleted_at IS NULL
		   AND c.type = 'channel'
		   AND c.discussion_chat_id IS NOT NULL
		   AND NOT EXISTS (
		         SELECT 1 FROM messages m
		          WHERE m.is_discussion_mirror
		            AND m.fwd_from_chat_id = p.chat_id
		            AND m.fwd_from_msg_id = p.id)`)
	if err != nil {
		return 0, err
	}
	type post struct {
		id, chatID, disc, senderID int64
		typ, text                  string
		entities                   []byte
		mediaID                    *int64
		groupedID                  *string
		createdAt                  time.Time
	}
	var posts []post
	for rows.Next() {
		var p post
		if err := rows.Scan(&p.id, &p.chatID, &p.disc, &p.senderID, &p.typ,
			&p.text, &p.entities, &p.mediaID, &p.groupedID, &p.createdAt); err != nil {
			rows.Close()
			return 0, err
		}
		posts = append(posts, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	created := 0
	for _, p := range posts {
		// 2. seq — продолжение счётчика группы, чтобы не столкнуться с уже
		// существующими сообщениями обсуждения.
		var seq int64
		if err := tx.QueryRow(ctx,
			`SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE chat_id=$1`, p.disc).Scan(&seq); err != nil {
			return 0, err
		}
		// jsonb-колонка: пишем строкой, не []byte — иначе pgx закодирует как
		// bytea (см. backend/CLAUDE.md, entitiesParam в messagesrepo.go).
		var entitiesParam any
		if len(p.entities) > 0 {
			entitiesParam = string(p.entities)
		}
		var mirrorID int64
		if err := tx.QueryRow(ctx, `
			INSERT INTO messages (chat_id, seq, sender_id, type, text, entities, media_id,
			                      grouped_id, send_as_chat_id, fwd_from_chat_id, fwd_from_msg_id,
			                      fwd_date, is_discussion_mirror)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,TRUE) RETURNING id`,
			p.disc, seq, p.senderID, p.typ, p.text, entitiesParam, p.mediaID,
			p.groupedID, p.chatID, p.id, p.createdAt).Scan(&mirrorID); err != nil {
			return 0, err
		}
		// 3. Перевесить тред на зеркало.
		if _, err := tx.Exec(ctx,
			`UPDATE messages SET thread_root_id=$1 WHERE thread_root_id=$2`, mirrorID, p.id); err != nil {
			return 0, err
		}
		created++
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return created, nil
}
