package postgres

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0100 переписывает разметку из плоской формы {"type":"bold",…} в
// конструкторы схемы TL {"_":"messageEntityBold",…}. Переходника на чтении нет
// намеренно, поэтому цена ошибки в миграции — молча потерянное форматирование
// во ВСЕЙ истории: проверяем на настоящих строках в настоящем Postgres.
//
// Схема проверки: откатываемся на версию назад (там ещё старая форма), пишем
// строки как их писал прежний код, накатываем 0100 и читаем ОБЫЧНЫМИ
// репозиториями — они знают только новую форму, поэтому «прочиталось» и значит
// «сконвертировалось».
const entitiesMigrationPrevVersion = 99

// assertFramePayload читает замороженный кадр журнала апдейтов и сверяет его
// разметку — верхнюю и вложенную в factcheck (nil, если её в кадре нет).
func assertFramePayload(t *testing.T, pool *pgxpool.Pool, query string, arg any,
	wantTop, wantFactCheck domain.MessageEntities) {
	t.Helper()
	var raw []byte
	if err := pool.QueryRow(context.Background(), query, arg).Scan(&raw); err != nil {
		t.Fatalf("чтение кадра: %v", err)
	}
	var payload struct {
		Entities  domain.MessageEntities `json:"entities"`
		FactCheck *struct {
			Entities domain.MessageEntities `json:"entities"`
		} `json:"factcheck"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("разбор кадра %s: %v", raw, err)
	}
	if !reflect.DeepEqual(payload.Entities, wantTop) {
		t.Errorf("разметка кадра = %#v, ждали %#v (сырой кадр: %s)", payload.Entities, wantTop, raw)
	}
	if wantFactCheck == nil {
		return
	}
	if payload.FactCheck == nil || !reflect.DeepEqual(payload.FactCheck.Entities, wantFactCheck) {
		t.Errorf("разметка factcheck в кадре = %+v, ждали %#v (сырой кадр: %s)", payload.FactCheck, wantFactCheck, raw)
	}
}

func TestMigration0100_ConvertsStoredEntities(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, entitiesMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", entitiesMigrationPrevVersion, err)
	}

	user := seedUser(t, pool, "+79990000100")
	var chatID int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type) VALUES ('private') RETURNING id`).Scan(&chatID); err != nil {
		t.Fatalf("seed chat: %v", err)
	}

	// Ровно то, что писал прежний код: плоская запись со своим набором строк-типов.
	const flat = `[
		{"type":"bold","offset":0,"length":4},
		{"type":"italic","offset":4,"length":2},
		{"type":"underline","offset":6,"length":1},
		{"type":"strikethrough","offset":7,"length":1},
		{"type":"code","offset":8,"length":1},
		{"type":"spoiler","offset":9,"length":1},
		{"type":"blockquote","offset":10,"length":1},
		{"type":"pre","offset":11,"length":3,"language":"go"},
		{"type":"pre","offset":14,"length":3},
		{"type":"text_link","offset":17,"length":2,"url":"https://example.com/a"},
		{"type":"text_mention","offset":19,"length":2,"user_id":77},
		{"type":"custom_emoji","offset":21,"length":2,"document_id":42}
	]`

	var msgID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, entities, factcheck)
		 VALUES ($1, 1, $2, 'text', 'жирный и прочее', $3::jsonb,
		         jsonb_build_object('text','проверка','entities',$4::jsonb,'country','DE'))
		 RETURNING id`,
		chatID, user, flat,
		`[{"type":"text_link","offset":0,"length":3,"url":"https://fact.example/x"}]`,
	).Scan(&msgID); err != nil {
		t.Fatalf("seed message: %v", err)
	}

	// Строка, УЖЕ записанная в новой форме: так выглядит база, куда 0100 доехала
	// после того, как часть строк записал новый код. Конвертер обязан её узнать
	// по дискриминатору и не тронуть.
	var alreadyTLID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, entities)
		 VALUES ($1, 2, $2, 'text', 'уже TL', $3::jsonb) RETURNING id`,
		chatID, user, `[{"_":"messageEntityBold","offset":0,"length":2}]`).Scan(&alreadyTLID); err != nil {
		t.Fatalf("seed already-TL message: %v", err)
	}

	if _, err := pool.Exec(ctx,
		`INSERT INTO drafts (chat_id, user_id, text, entities) VALUES ($1,$2,'черновик',$3::jsonb)`,
		chatID, user, `[{"type":"bold","offset":0,"length":4}]`); err != nil {
		t.Fatalf("seed draft: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO scheduled_messages (chat_id, sender_id, type, text, entities, send_at)
		 VALUES ($1,$2,'text','позже',$3::jsonb, now() + interval '1 hour')`,
		chatID, user, `[{"type":"italic","offset":1,"length":2}]`); err != nil {
		t.Fatalf("seed scheduled: %v", err)
	}
	var suggestedID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO suggested_posts (chat_id, author_id, text, entities) VALUES ($1,$2,'предложка',$3::jsonb) RETURNING id`,
		chatID, user, `[{"type":"custom_emoji","offset":0,"length":2,"document_id":9}]`).Scan(&suggestedID); err != nil {
		t.Fatalf("seed suggested: %v", err)
	}

	// Замороженный кадр в журнале апдейтов: его клиент переигрывает при /sync.
	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload)
		 VALUES ($1, 1, 'new_message', jsonb_build_object(
		           'chat_id', $2::bigint, 'msg_id', $3::bigint, 'text', 'жирный',
		           'entities', $4::jsonb,
		           'factcheck', jsonb_build_object('text','проверка','entities',$5::jsonb)))`,
		user, chatID, msgID,
		`[{"type":"bold","offset":0,"length":6}]`,
		`[{"type":"italic","offset":0,"length":3}]`); err != nil {
		t.Fatalf("seed update: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO channel_updates (channel_id, pts, pts_count, type, payload)
		 VALUES ($1, 1, 1, 'new_message', jsonb_build_object('chat_id', $1::bigint, 'entities', $2::jsonb))`,
		chatID, `[{"type":"text_link","offset":0,"length":2,"url":"https://chan.example/x"}]`); err != nil {
		t.Fatalf("seed channel update: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0100: %v", err)
	}

	// messages.entities — все одиннадцать конструкторов объединения.
	msgs, err := NewMessagesRepo(pool).GetByIDs(ctx, []int64{msgID})
	if err != nil || len(msgs) != 1 {
		t.Fatalf("GetByIDs: %v, %d строк", err, len(msgs))
	}
	got := msgs[0].Entities
	want := domain.MessageEntities{
		domain.NewMessageEntityBold(0, 4),
		domain.NewMessageEntityItalic(4, 2),
		domain.NewMessageEntityUnderline(6, 1),
		domain.NewMessageEntityStrike(7, 1),
		domain.NewMessageEntityCode(8, 1),
		domain.NewMessageEntitySpoiler(9, 1),
		domain.NewMessageEntityBlockquote(10, 1, false),
		domain.NewMessageEntityPre(11, 3, "go"),
		// Подсказки языка не было — messageEntityPre.language обязателен и едет
		// пустой строкой, а не пропадает.
		domain.NewMessageEntityPre(14, 3, ""),
		domain.NewMessageEntityTextURL(17, 2, "https://example.com/a"),
		domain.NewMessageEntityMentionName(19, 2, 77),
		domain.NewMessageEntityCustomEmoji(21, 2, 42),
	}
	if len(got) != len(want) {
		t.Fatalf("сущностей после конвертации %d, ждали %d: %+v", len(got), len(want), got)
	}
	for i := range want {
		if !reflect.DeepEqual(got[i], want[i]) {
			t.Errorf("сущность %d = %#v, ждали %#v", i, got[i], want[i])
		}
	}

	// messages.factcheck->entities — вложенная разметка тоже переписана.
	fc := msgs[0].FactCheck
	if fc == nil || len(fc.Entities) != 1 {
		t.Fatalf("factcheck после конвертации = %+v", fc)
	}
	if !reflect.DeepEqual(fc.Entities[0], domain.NewMessageEntityTextURL(0, 3, "https://fact.example/x")) {
		t.Errorf("factcheck-сущность = %#v", fc.Entities[0])
	}

	drafts, err := NewDraftsRepo(pool).ListByUser(ctx, user)
	if err != nil || len(drafts) != 1 || len(drafts[0].Entities) != 1 ||
		!reflect.DeepEqual(drafts[0].Entities[0], domain.NewMessageEntityBold(0, 4)) {
		t.Fatalf("drafts.entities = %+v, %v", drafts, err)
	}

	sched, err := NewScheduledRepo(pool).ListByChat(ctx, chatID, user)
	if err != nil || len(sched) != 1 || len(sched[0].Entities) != 1 ||
		!reflect.DeepEqual(sched[0].Entities[0], domain.NewMessageEntityItalic(1, 2)) {
		t.Fatalf("scheduled_messages.entities = %+v, %v", sched, err)
	}

	sp, err := NewSuggestedPostsRepo(pool).ByID(ctx, suggestedID)
	if err != nil || len(sp.Entities) != 1 ||
		!reflect.DeepEqual(sp.Entities[0], domain.NewMessageEntityCustomEmoji(0, 2, 9)) {
		t.Fatalf("suggested_posts.entities = %+v, %v", sp, err)
	}

	// Журналы апдейтов: замороженные кадры переписаны так же, иначе догоняющий
	// клиент получил бы разметку в форме, которую больше не понимает.
	assertFramePayload(t, pool, `SELECT payload FROM updates WHERE user_id=$1 AND pts=1`, user,
		domain.MessageEntities{domain.NewMessageEntityBold(0, 6)},
		domain.MessageEntities{domain.NewMessageEntityItalic(0, 3)})
	assertFramePayload(t, pool, `SELECT payload FROM channel_updates WHERE channel_id=$1 AND pts=1`, chatID,
		domain.MessageEntities{domain.NewMessageEntityTextURL(0, 2, "https://chan.example/x")}, nil)

	// Строка, лежавшая в новой форме до наката, осталась собой.
	tlMsgs, err := NewMessagesRepo(pool).GetByIDs(ctx, []int64{alreadyTLID})
	if err != nil || len(tlMsgs) != 1 || len(tlMsgs[0].Entities) != 1 ||
		!reflect.DeepEqual(tlMsgs[0].Entities[0], domain.NewMessageEntityBold(0, 2)) {
		t.Fatalf("уже переписанная строка испорчена конвертацией: %+v, %v", tlMsgs, err)
	}

	// Круг вниз-вверх: Down возвращает плоскую форму, повторный Up переводит её
	// снова — откат миграции не должен стоить истории форматирования.
	if err := storepostgres.MigrateDownTo(url, entitiesMigrationPrevVersion); err != nil {
		t.Fatalf("повторный откат: %v", err)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	msgs, err = NewMessagesRepo(pool).GetByIDs(ctx, []int64{msgID})
	if err != nil || len(msgs) != 1 {
		t.Fatalf("GetByIDs после круга вниз-вверх: %v", err)
	}
	for i := range want {
		if !reflect.DeepEqual(msgs[0].Entities[i], want[i]) {
			t.Errorf("после круга вниз-вверх сущность %d = %#v, ждали %#v", i, msgs[0].Entities[i], want[i])
		}
	}
}
