package postgres_test

// Тест живёт в отдельном пакете, чтобы звать BackfillDiscussionMirrors как
// внешний API и не тянуть внутренности.

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Старая схема: комментарий висит на id ПОСТА КАНАЛА. Бэкфилл обязан создать
// зеркало в группе обсуждения и перевести тред на него.
func TestBackfillDiscussionMirrors(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()

	// сид «старой формы» — сырым SQL, потому что usecase так писать уже не умеет
	var userID, ch, disc, postID, commentID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (phone) VALUES ('+79990000001') RETURNING id`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, is_public) VALUES ('channel','Chan',true) RETURNING id`).Scan(&ch); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, is_public) VALUES ('group','Disc',false) RETURNING id`).Scan(&disc); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE chats SET discussion_chat_id=$2 WHERE id=$1`, ch, disc); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text) VALUES ($1,1,$2,'text','post') RETURNING id`,
		ch, userID).Scan(&postID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, thread_root_id) VALUES ($1,1,$2,'text','comment',$3) RETURNING id`,
		disc, userID, postID).Scan(&commentID); err != nil {
		t.Fatal(err)
	}

	n, err := storepostgres.BackfillDiscussionMirrors(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("создано зеркал: %d, ожидалось 1", n)
	}

	var mirrorID, rootID int64
	if err := pool.QueryRow(ctx,
		`SELECT id FROM messages WHERE chat_id=$1 AND is_discussion_mirror AND fwd_from_msg_id=$2`,
		disc, postID).Scan(&mirrorID); err != nil {
		t.Fatalf("зеркало не создано: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT thread_root_id FROM messages WHERE id=$1`, commentID).Scan(&rootID); err != nil {
		t.Fatal(err)
	}
	if rootID != mirrorID {
		t.Fatalf("тред остался на %d, ожидалось зеркало %d", rootID, mirrorID)
	}

	// идемпотентность: второй прогон ничего не создаёт и не ломает
	n2, err := storepostgres.BackfillDiscussionMirrors(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if n2 != 0 {
		t.Fatalf("повторный прогон создал %d зеркал, ожидалось 0", n2)
	}
}

// Критика ревью: seq зеркала раньше выделялся SELECT MAX(seq)+1, который не
// трогает chats.last_seq. После бэкфилла счётчик группы оставался «в
// прошлом», и первая же обычная отправка (через NextSeq — тот же атомарный
// UPDATE last_seq=last_seq+1 RETURNING) получала уже занятый seq и падала на
// UNIQUE(chat_id, seq). Тест воспроизводит именно этот сценарий: обычная
// отправка сразу после бэкфилла.
func TestBackfillDiscussionMirrors_SeqDoesNotCollideWithNextSeq(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()

	var userID, ch, disc, postID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (phone) VALUES ('+79990000002') RETURNING id`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, is_public) VALUES ('channel','Chan',true) RETURNING id`).Scan(&ch); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, is_public) VALUES ('group','Disc',false) RETURNING id`).Scan(&disc); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE chats SET discussion_chat_id=$2 WHERE id=$1`, ch, disc); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text) VALUES ($1,1,$2,'text','post') RETURNING id`,
		ch, userID).Scan(&postID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, thread_root_id) VALUES ($1,1,$2,'text','comment',$3)`,
		disc, userID, postID); err != nil {
		t.Fatal(err)
	}

	n, err := storepostgres.BackfillDiscussionMirrors(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("создано зеркал: %d, ожидалось 1", n)
	}

	var mirrorSeq int64
	if err := pool.QueryRow(ctx,
		`SELECT seq FROM messages WHERE chat_id=$1 AND is_discussion_mirror AND fwd_from_msg_id=$2`,
		disc, postID).Scan(&mirrorSeq); err != nil {
		t.Fatalf("зеркало не создано: %v", err)
	}

	// обычная отправка в ту же группу — тем же атомарным механизмом, что и
	// MessagesRepo.NextSeq
	var nextSeq int64
	if err := pool.QueryRow(ctx,
		`UPDATE chats SET last_seq = last_seq + 1 WHERE id=$1 RETURNING last_seq`, disc).Scan(&nextSeq); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text) VALUES ($1,$2,$3,'text','next')`,
		disc, nextSeq, userID); err != nil {
		t.Fatalf("обычная отправка после бэкфилла столкнулась с занятым seq: %v", err)
	}
	if nextSeq <= mirrorSeq {
		t.Fatalf("следующий seq (%d) не больше seq зеркала (%d)", nextSeq, mirrorSeq)
	}
}

// Критика ревью: в SELECT не было p.deleted_at IS NULL — удалённый пост
// канала получал «призрачное» пустое зеркало в группе, а идемпотентность
// держится на факте существования зеркала, так что повторный прогон это уже
// не чинил.
func TestBackfillDiscussionMirrors_SkipsDeletedPost(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()

	var userID, ch, disc, postID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (phone) VALUES ('+79990000003') RETURNING id`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, is_public) VALUES ('channel','Chan',true) RETURNING id`).Scan(&ch); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, is_public) VALUES ('group','Disc',false) RETURNING id`).Scan(&disc); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE chats SET discussion_chat_id=$2 WHERE id=$1`, ch, disc); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text) VALUES ($1,1,$2,'text','post') RETURNING id`,
		ch, userID).Scan(&postID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, thread_root_id) VALUES ($1,1,$2,'text','comment',$3)`,
		disc, userID, postID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE messages SET deleted_at=now() WHERE id=$1`, postID); err != nil {
		t.Fatal(err)
	}

	n, err := storepostgres.BackfillDiscussionMirrors(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("создано зеркал: %d, ожидалось 0 (пост удалён)", n)
	}

	var cnt int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM messages WHERE chat_id=$1 AND is_discussion_mirror AND fwd_from_msg_id=$2`,
		disc, postID).Scan(&cnt); err != nil {
		t.Fatal(err)
	}
	if cnt != 0 {
		t.Fatalf("зеркало создано для удалённого поста: %d", cnt)
	}
}

// Критика ревью: финальный UPDATE thread_root_id не был ограничен чатом.
// Если канал был перепривязан к другой группе обсуждения ПОСЛЕ того, как в
// ПРЕЖНЕЙ группе накопились старые комментарии, они физически остаются в
// прежнем chat_id. Бэкфилл создаёт зеркало в НОВОЙ (текущей) группе — старые
// комментарии из прежней группы перевешивать на него нельзя: тред читается
// парой (chat_id, thread_root_id), так что комментарий стал бы невидим и
// там, и здесь. Тест: комментарий в прежней группе не тронут.
func TestBackfillDiscussionMirrors_DoesNotStealCommentsFromPreviousGroup(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()

	var userID, ch, groupA, groupB, postID, commentID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (phone) VALUES ('+79990000004') RETURNING id`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, is_public) VALUES ('channel','Chan',true) RETURNING id`).Scan(&ch); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, is_public) VALUES ('group','GroupA',false) RETURNING id`).Scan(&groupA); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, is_public) VALUES ('group','GroupB',false) RETURNING id`).Scan(&groupB); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text) VALUES ($1,1,$2,'text','post') RETURNING id`,
		ch, userID).Scan(&postID); err != nil {
		t.Fatal(err)
	}
	// канал был привязан к groupA, туда написали старый-схемный комментарий
	if _, err := pool.Exec(ctx, `UPDATE chats SET discussion_chat_id=$2 WHERE id=$1`, ch, groupA); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, thread_root_id) VALUES ($1,1,$2,'text','old comment',$3) RETURNING id`,
		groupA, userID, postID).Scan(&commentID); err != nil {
		t.Fatal(err)
	}
	// канал перепривязан на groupB ДО того, как накопленные комментарии
	// успели мигрировать
	if _, err := pool.Exec(ctx, `UPDATE chats SET discussion_chat_id=$2 WHERE id=$1`, ch, groupB); err != nil {
		t.Fatal(err)
	}

	n, err := storepostgres.BackfillDiscussionMirrors(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("создано зеркал: %d, ожидалось 1", n)
	}

	var mirrorID int64
	if err := pool.QueryRow(ctx,
		`SELECT id FROM messages WHERE chat_id=$1 AND is_discussion_mirror AND fwd_from_msg_id=$2`,
		groupB, postID).Scan(&mirrorID); err != nil {
		t.Fatalf("зеркало не создано в текущей (groupB) группе: %v", err)
	}

	var rootID int64
	if err := pool.QueryRow(ctx, `SELECT thread_root_id FROM messages WHERE id=$1`, commentID).Scan(&rootID); err != nil {
		t.Fatal(err)
	}
	if rootID != postID {
		t.Fatalf("комментарий из прежней группы перевешен на %d, ожидалось нетронутое значение %d (id поста)", rootID, postID)
	}

	// идемпотентность: старая пара больше не появится (зеркало для (ch,postID) уже есть)
	n2, err := storepostgres.BackfillDiscussionMirrors(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if n2 != 0 {
		t.Fatalf("повторный прогон создал %d зеркал, ожидалось 0", n2)
	}
}

// Критика ревью: продовый mirrorChannelPost копирует poll_id, бэкфилл — нет.
// Пост-опрос получал бы зеркало без опроса, и повторный прогон это уже не
// чинил (идемпотентность по факту существования зеркала).
func TestBackfillDiscussionMirrors_CopiesPollID(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()

	var userID, ch, disc, pollID, postID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (phone) VALUES ('+79990000005') RETURNING id`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, is_public) VALUES ('channel','Chan',true) RETURNING id`).Scan(&ch); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, is_public) VALUES ('group','Disc',false) RETURNING id`).Scan(&disc); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE chats SET discussion_chat_id=$2 WHERE id=$1`, ch, disc); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO polls (chat_id, question, options) VALUES ($1,'q?','["a","b"]'::jsonb) RETURNING id`,
		ch).Scan(&pollID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, poll_id) VALUES ($1,1,$2,'poll','',$3) RETURNING id`,
		ch, userID, pollID).Scan(&postID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, thread_root_id) VALUES ($1,1,$2,'text','comment',$3)`,
		disc, userID, postID); err != nil {
		t.Fatal(err)
	}

	n, err := storepostgres.BackfillDiscussionMirrors(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("создано зеркал: %d, ожидалось 1", n)
	}

	var mirrorPollID int64
	if err := pool.QueryRow(ctx,
		`SELECT poll_id FROM messages WHERE chat_id=$1 AND is_discussion_mirror AND fwd_from_msg_id=$2`,
		disc, postID).Scan(&mirrorPollID); err != nil {
		t.Fatalf("зеркало не создано: %v", err)
	}
	if mirrorPollID != pollID {
		t.Fatalf("poll_id зеркала = %d, ожидалось %d", mirrorPollID, pollID)
	}
}

// Блокер 1 (финальное ревью 2026-08-14): альбом × бэкфилл. Старый комментарий
// висит на ВТОРОМ (не первом) кадре альбома g1 — так тред читается «по
// старой схеме». Правило «один тред на альбом» (MirrorByPost) резолвит
// ЛЮБОЙ кадр в зеркало ПЕРВОГО — если бы бэкфилл зеркалировал только кадр,
// упомянутый в исходной выборке (второй), MirrorByPost(любой кадр) искал бы
// fwd_from_msg_id=<id первого кадра> и не находил бы ничего: старый
// комментарий стал бы невидим, а первый НОВЫЙ комментарий дозеркалировал бы
// альбом и лёг на другой (настоящий) корень — переписка разъехалась бы на
// два треда. Идемпотентность по факту существования зеркала делает такую
// ошибку неисправимой повторным прогоном.
//
// Проверяем: после ОДНОГО прогона бэкфилла (а) у обоих кадров есть
// собственное зеркало (альбом не обрезан), (б) MirrorByPost для ЛЮБОГО из
// двух кадров отдаёт ОДИН И ТОТ ЖЕ корень, (в) старый комментарий виден и
// висит именно на этом корне.
func TestBackfillDiscussionMirrors_Album_CommentOnNonFirstFrame(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()

	var userID, ch, disc, frame1, frame2, commentID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (phone) VALUES ('+79990000006') RETURNING id`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, is_public) VALUES ('channel','Chan',true) RETURNING id`).Scan(&ch); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, is_public) VALUES ('group','Disc',false) RETURNING id`).Scan(&disc); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE chats SET discussion_chat_id=$2 WHERE id=$1`, ch, disc); err != nil {
		t.Fatal(err)
	}
	// альбом (grouped_id = схемный long 111): два кадра в канале, frame1 — первый.
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, grouped_id) VALUES ($1,1,$2,'photo','',111) RETURNING id`,
		ch, userID).Scan(&frame1); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, grouped_id) VALUES ($1,2,$2,'photo','',111) RETURNING id`,
		ch, userID).Scan(&frame2); err != nil {
		t.Fatal(err)
	}
	if frame1 >= frame2 {
		t.Fatalf("ожидался frame1 < frame2 (frame1 — первый кадр альбома), получено %d/%d", frame1, frame2)
	}
	// старый комментарий висит на ВТОРОМ кадре — не на корне альбома.
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, thread_root_id) VALUES ($1,1,$2,'text','к второму кадру',$3) RETURNING id`,
		disc, userID, frame2).Scan(&commentID); err != nil {
		t.Fatal(err)
	}

	n, err := storepostgres.BackfillDiscussionMirrors(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("создано зеркал: %d, ожидалось 2 (оба кадра альбома)", n)
	}

	// (а) у обоих кадров есть собственное зеркало.
	var mirror1, mirror2 int64
	if err := pool.QueryRow(ctx,
		`SELECT id FROM messages WHERE chat_id=$1 AND is_discussion_mirror AND fwd_from_msg_id=$2`,
		disc, frame1).Scan(&mirror1); err != nil {
		t.Fatalf("зеркало первого кадра не создано: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT id FROM messages WHERE chat_id=$1 AND is_discussion_mirror AND fwd_from_msg_id=$2`,
		disc, frame2).Scan(&mirror2); err != nil {
		t.Fatalf("зеркало второго кадра не создано: %v", err)
	}
	if mirror1 == mirror2 {
		t.Fatalf("оба кадра альбома делят одну строку-зеркало (%d) — альбом в группе обрезан", mirror1)
	}

	// (б) MirrorByPost для ЛЮБОГО кадра отдаёт один и тот же корень — зеркало
	// первого кадра (mirror1), в точности как резолвит usecase-порт (тот же
	// SQL — CTE root=MIN(id) по grouped_id, см. MessagesRepo.MirrorByPost).
	rootFor := func(postID int64) int64 {
		t.Helper()
		var id int64
		err := pool.QueryRow(ctx, `
			WITH root AS (
				SELECT COALESCE(
					(SELECT MIN(g.id) FROM messages g
					  WHERE g.chat_id = p.chat_id AND g.grouped_id = p.grouped_id AND p.grouped_id IS NOT NULL),
					p.id) AS id
				FROM messages p WHERE p.id = $2
			)
			SELECT m.id FROM messages m, root
			 WHERE m.fwd_from_chat_id=$1 AND m.fwd_from_msg_id=root.id AND m.is_discussion_mirror AND m.deleted_at IS NULL
			   AND m.chat_id = (SELECT discussion_chat_id FROM chats WHERE id=$1)`, ch, postID).Scan(&id)
		if err != nil {
			t.Fatalf("MirrorByPost(%d): %v", postID, err)
		}
		return id
	}
	rootViaFrame1 := rootFor(frame1)
	rootViaFrame2 := rootFor(frame2)
	if rootViaFrame1 == 0 {
		t.Fatal("MirrorByPost(frame1) = 0, корень альбома не резолвится")
	}
	if rootViaFrame1 != rootViaFrame2 {
		t.Fatalf("MirrorByPost(frame1)=%d, MirrorByPost(frame2)=%d — два разных корня у одного альбома", rootViaFrame1, rootViaFrame2)
	}
	if rootViaFrame1 != mirror1 {
		t.Fatalf("корень треда (%d) — не зеркало первого кадра (%d)", rootViaFrame1, mirror1)
	}

	// (в) старый комментарий виден и висит на этом самом корне.
	var commentRoot int64
	if err := pool.QueryRow(ctx, `SELECT thread_root_id FROM messages WHERE id=$1`, commentID).Scan(&commentRoot); err != nil {
		t.Fatal(err)
	}
	if commentRoot != rootViaFrame1 {
		t.Fatalf("комментарий висит на %d, ожидался корень треда %d", commentRoot, rootViaFrame1)
	}

	// идемпотентность: второй прогон ничего не создаёт.
	n2, err := storepostgres.BackfillDiscussionMirrors(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if n2 != 0 {
		t.Fatalf("повторный прогон создал %d зеркал, ожидалось 0", n2)
	}
}
