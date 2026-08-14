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
//
// Гонка при параллельном старте двух инстансов: обе транзакции могут отобрать
// одну и ту же пару (пост, группа) и попытаться вставить зеркало — вторая
// упадёт на уникальном индексе uq_messages_discussion_mirror, вся её
// транзакция откатится (defer tx.Rollback), BackfillDiscussionMirrors вернёт
// ошибку вызывающему (в providePool она логируется, не глотается). Отдельной
// защиты (advisory lock и т.п.) нет: на старте только один инстанс — не
// оптимизируем то, чего в текущем деплое не бывает; если это когда-нибудь
// изменится, ошибка не потеряет данные (транзакция атомарна), просто один из
// инстансов не досчитает свои n.
func BackfillDiscussionMirrors(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	// 1. Пары (пост, группа обсуждения), которым нужно зеркало, + сам пост.
	// p.deleted_at IS NULL — удалённый пост не зеркалим (иначе в группе
	// появляется пустое «зеркало-призрак», а идемпотентность держится на его
	// существовании — повторный прогон уже не даст исправить).
	rows, err := tx.Query(ctx, `
		SELECT DISTINCT p.id, p.chat_id, c.discussion_chat_id, p.sender_id, p.type,
		       p.text, p.entities, p.media_id, p.grouped_id, p.poll_id, p.created_at
		  FROM messages cm
		  JOIN messages p ON p.id = cm.thread_root_id
		  JOIN chats c ON c.id = p.chat_id
		 WHERE cm.thread_root_id IS NOT NULL
		   AND cm.deleted_at IS NULL
		   AND p.deleted_at IS NULL
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
		mediaID, pollID            *int64
		groupedID                  *string
		createdAt                  time.Time
	}
	var posts []post
	for rows.Next() {
		var p post
		if err := rows.Scan(&p.id, &p.chatID, &p.disc, &p.senderID, &p.typ,
			&p.text, &p.entities, &p.mediaID, &p.groupedID, &p.pollID, &p.createdAt); err != nil {
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
		// 2. seq — тот же атомарный механизм, что и MessagesRepo.NextSeq
		// (инкремент chats.last_seq с RETURNING в одном UPDATE), а не
		// SELECT MAX(seq)+1: тот способ не трогает last_seq, и первая же
		// обычная отправка в эту группу после бэкфилла получала бы уже
		// занятый seq и падала на UNIQUE(chat_id, seq). GREATEST(last_seq,
		// MAX(seq)) — защита от рассинхрона last_seq с реальным максимумом
		// (не должно происходить на живых данных, где seq всегда выделялся
		// через NextSeq, но бэкфилл — миграционный код над потенциально
		// неидеальными историческими данными, лишняя защита не мешает).
		var seq int64
		if err := tx.QueryRow(ctx, `
			UPDATE chats
			   SET last_seq = GREATEST(last_seq, (SELECT COALESCE(MAX(seq), 0) FROM messages WHERE chat_id = $1)) + 1
			 WHERE id = $1
			 RETURNING last_seq`, p.disc).Scan(&seq); err != nil {
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
			                      grouped_id, poll_id, send_as_chat_id, fwd_from_chat_id, fwd_from_msg_id,
			                      fwd_date, is_discussion_mirror)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,TRUE) RETURNING id`,
			p.disc, seq, p.senderID, p.typ, p.text, entitiesParam, p.mediaID,
			p.groupedID, p.pollID, p.chatID, p.id, p.createdAt).Scan(&mirrorID); err != nil {
			return 0, err
		}
		// 3. Перевесить тред на зеркало — только для комментариев,
		// физически лежащих в ТОЙ ЖЕ группе, куда только что вставлено
		// зеркало (chat_id=p.disc). Если канал был перепривязан к другой
		// группе обсуждения ПОСЛЕ того, как в прежней группе накопились
		// старые комментарии, они остаются в чужом (по нынешним меркам)
		// chat_id — трогать их нельзя: тред читается парой (chat_id,
		// thread_root_id), и перевод корня без переноса самих строк сделал
		// бы их ненаходимыми что там, что здесь. Без этого фильтра
		// комментарии из ПРЕЖНЕЙ группы получали бы thread_root_id зеркала
		// из НОВОЙ группы, оставаясь физически в прежней.
		if _, err := tx.Exec(ctx,
			`UPDATE messages SET thread_root_id=$1 WHERE thread_root_id=$2 AND chat_id=$3`,
			mirrorID, p.id, p.disc); err != nil {
			return 0, err
		}
		created++
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return created, nil
}
