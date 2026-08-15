package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BackfillDiscussionMirrors переводит треды комментариев, написанные по СТАРОЙ
// схеме (thread_root_id = id поста в канале), на Telegram-модель: создаёт
// зеркало поста в группе обсуждения и перевешивает тред на него.
//
// Идемпотентна: пары, у которых зеркало КОРНЯ уже есть, отбрасываются (NOT
// EXISTS), поэтому повторный запуск на старте приложения ничего не делает и
// возвращает 0. Бэкфиллятся только посты, у которых есть хотя бы один
// комментарий — полная история каналов в группы не переносится (решение
// спеки).
//
// Альбом (grouped_id): правило «один тред на альбом» (см. MessagesRepo.
// MirrorByPost) работает в терминах КОРНЯ альбома — зеркала ПЕРВОГО элемента
// группы. Комментарий по старой схеме мог висеть на id ЛЮБОГО кадра альбома
// (клиент отвечал на тот кадр, который видел), поэтому бэкфилл обязан:
//  1. по посту, на который висит старый комментарий, найти корень его
//     альбома (MIN(id) среди сообщений с тем же grouped_id в том же чате,
//     как и в MirrorByPost — без фильтра deleted_at, та же политика
//     стабильности корня, что и у MirrorByPost/AlbumMessages);
//  2. зеркалить ВЕСЬ альбом (иначе он приедет в группу обрезанным), но
//     считать «уже сделано» по наличию зеркала именно у КОРНЯ — если корень
//     ещё не зеркалирован, обрабатываем группу, даже если у НЕКОТОРЫХ её
//     кадров зеркало уже есть (пропускаем их индивидуально — уникальный
//     индекс не даёт вставить второе зеркало на тот же кадр);
//  3. перевесить на зеркало корня ЛЮБОЙ старый комментарий, чей
//     thread_root_id указывает на ЛЮБОЙ кадр этого альбома — не только на
//     тот кадр, который случайно попал в исходную выборку candidates.
//
// Без этого альбом с комментарием на НЕ-первом кадре мигрировал бы неверно:
// зеркало создавалось бы только для этого кадра, MirrorByPost (резолвящий
// ЛЮБОЙ кадр в зеркало ПЕРВОГО) продолжал бы отдавать 0 — старые комментарии
// становились бы невидимы, а первый новый комментарий дозеркалировал бы
// альбом и лёг на другой (настоящий) корень — переписка расходилась на два
// треда. Идемпотентность по факту существования зеркала делает эту ошибку
// неисправимой повторным прогоном (см. историю багфикса) — поэтому важно,
// чтобы «уже сделано» проверялось по КОРНЮ, а не по кадру из выборки.
//
// Гонка при параллельном старте двух инстансов: обе транзакции могут отобрать
// одну и ту же пару (корень, группа) и попытаться вставить зеркало — вторая
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

	// 1. Корни (пост-«первый кадр альбома» либо сам одиночный пост), которым
	// нужно зеркало, + группа обсуждения. cm.deleted_at/p.deleted_at IS NULL —
	// не бэкфиллим по удалённым комментариям/постам, на которые они
	// буквально ссылаются (см. TestBackfillDiscussionMirrors_SkipsDeletedPost);
	// сам корень альбома при этом мог быть другим (возможно удалённым) кадром
	// — его собственный deleted_at сознательно не фильтруется ниже, как и в
	// MirrorByPost/AlbumMessages (комментарий к её политике см. там).
	// NOT EXISTS проверяет зеркало ИМЕННО КОРНЯ — см. комментарий функции.
	rows, err := tx.Query(ctx, `
		WITH candidates AS (
			SELECT DISTINCT p.id AS post_id, p.chat_id AS chan_id, p.grouped_id,
			       c.discussion_chat_id AS disc_id
			  FROM messages cm
			  JOIN messages p ON p.id = cm.thread_root_id
			  JOIN chats c ON c.id = p.chat_id
			 WHERE cm.thread_root_id IS NOT NULL
			   AND cm.deleted_at IS NULL
			   AND p.deleted_at IS NULL
			   AND c.type = 'channel'
			   AND c.discussion_chat_id IS NOT NULL
		), roots AS (
			SELECT DISTINCT
			       COALESCE(
			           (SELECT MIN(g.id) FROM messages g
			             WHERE g.chat_id = cand.chan_id AND g.grouped_id = cand.grouped_id
			               AND cand.grouped_id IS NOT NULL),
			           cand.post_id
			       ) AS root_id,
			       cand.chan_id, cand.disc_id
			  FROM candidates cand
		)
		SELECT r.root_id, r.chan_id, r.disc_id
		  FROM roots r
		 WHERE NOT EXISTS (
		         SELECT 1 FROM messages m
		          WHERE m.is_discussion_mirror
		            AND m.fwd_from_chat_id = r.chan_id
		            AND m.fwd_from_msg_id = r.root_id)`)
	if err != nil {
		return 0, err
	}
	type root struct {
		rootID, chanID, discID int64
	}
	var roots []root
	for rows.Next() {
		var r root
		if err := rows.Scan(&r.rootID, &r.chanID, &r.discID); err != nil {
			rows.Close()
			return 0, err
		}
		roots = append(roots, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	type frame struct {
		id, senderID    int64
		typ, text       string
		entities        []byte
		mediaID, pollID *int64
		groupedID       *string
		createdAt       time.Time
	}
	created := 0
	for _, r := range roots {
		// 2. Все кадры альбома корня (сам корень + прочие сообщения с тем же
		// grouped_id в том же чате) — либо один-единственный кадр, если это
		// не альбом. По id ASC: корень идёт первым (он и есть MIN(id)).
		frows, err := tx.Query(ctx, `
			SELECT id, sender_id, type, text, entities, media_id, grouped_id, poll_id, created_at
			  FROM messages
			 WHERE chat_id = $2
			   AND (id = $1 OR grouped_id = (SELECT grouped_id FROM messages WHERE id = $1))
			 ORDER BY id`, r.rootID, r.chanID)
		if err != nil {
			return 0, err
		}
		var frames []frame
		for frows.Next() {
			var f frame
			if err := frows.Scan(&f.id, &f.senderID, &f.typ, &f.text, &f.entities,
				&f.mediaID, &f.groupedID, &f.pollID, &f.createdAt); err != nil {
				frows.Close()
				return 0, err
			}
			frames = append(frames, f)
		}
		frows.Close()
		if err := frows.Err(); err != nil {
			return 0, err
		}

		var rootMirrorID int64
		frameIDs := make([]int64, 0, len(frames))
		for _, f := range frames {
			frameIDs = append(frameIDs, f.id)

			// Идемпотентность НА УРОВНЕ КАДРА: у альбома отдельные кадры могли
			// уже получить зеркало на предыдущем (в т.ч. более старом,
			// некорректном) прогоне — вставлять второе зеркало на тот же
			// кадр нельзя (уникальный индекс), просто переиспользуем его id.
			var mirrorID int64
			err := tx.QueryRow(ctx, `
				SELECT id FROM messages
				 WHERE chat_id = $1 AND is_discussion_mirror AND fwd_from_chat_id = $2 AND fwd_from_msg_id = $3`,
				r.discID, r.chanID, f.id).Scan(&mirrorID)
			switch {
			case err == nil:
				// уже есть — переиспользуем
			case errors.Is(err, pgx.ErrNoRows):
				// 3. seq — тот же атомарный механизм, что и MessagesRepo.NextSeq
				// (инкремент chats.last_seq с RETURNING в одном UPDATE), а не
				// SELECT MAX(seq)+1: тот способ не трогает last_seq, и первая
				// же обычная отправка в эту группу после бэкфилла получала бы
				// уже занятый seq и падала на UNIQUE(chat_id, seq). GREATEST —
				// защита от рассинхрона last_seq с реальным максимумом (см.
				// исходный комментарий этой функции в истории).
				var seq int64
				if err := tx.QueryRow(ctx, `
					UPDATE chats
					   SET last_seq = GREATEST(last_seq, (SELECT COALESCE(MAX(seq), 0) FROM messages WHERE chat_id = $1)) + 1
					 WHERE id = $1
					 RETURNING last_seq`, r.discID).Scan(&seq); err != nil {
					return 0, err
				}
				// jsonb-колонка: пишем строкой, не []byte — иначе pgx
				// закодирует как bytea (см. backend/CLAUDE.md, entitiesParam
				// в messagesrepo.go).
				var entitiesParam any
				if len(f.entities) > 0 {
					entitiesParam = string(f.entities)
				}
				if err := tx.QueryRow(ctx, `
					INSERT INTO messages (chat_id, seq, sender_id, type, text, entities, media_id,
					                      grouped_id, poll_id, send_as_chat_id, fwd_from_chat_id, fwd_from_msg_id,
					                      fwd_date, is_discussion_mirror)
					VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,TRUE) RETURNING id`,
					r.discID, seq, f.senderID, f.typ, f.text, entitiesParam, f.mediaID,
					f.groupedID, f.pollID, r.chanID, f.id, f.createdAt).Scan(&mirrorID); err != nil {
					return 0, err
				}
				created++
			default:
				return 0, err
			}
			if f.id == r.rootID {
				rootMirrorID = mirrorID
			}
		}

		// 4. Перевесить тред на зеркало КОРНЯ — для ЛЮБОГО старого
		// комментария, чей thread_root_id указывает на ЛЮБОЙ кадр этого
		// альбома (не только на кадр из исходной выборки candidates, см.
		// комментарий функции), и физически лежащего в ТОЙ ЖЕ группе
		// r.discID: если канал был перепривязан к другой группе обсуждения
		// ПОСЛЕ того, как в прежней группе накопились старые комментарии,
		// они остаются в чужом (по нынешним меркам) chat_id — трогать их
		// нельзя, тред читается парой (chat_id, thread_root_id), см.
		// TestBackfillDiscussionMirrors_DoesNotStealCommentsFromPreviousGroup.
		if _, err := tx.Exec(ctx,
			`UPDATE messages SET thread_root_id=$1 WHERE thread_root_id = ANY($2) AND chat_id=$3`,
			rootMirrorID, frameIDs, r.discID); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return created, nil
}
