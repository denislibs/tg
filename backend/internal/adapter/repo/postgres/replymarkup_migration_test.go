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

// Миграция 0101 переписывает клавиатуры из собственной плоской записи
// {"inline":[[{"text":…,"callback":…}]]} в конструкторы схемы TL
// {"_":"replyInlineMarkup","rows":[…]}. Переходника на чтении нет намеренно,
// поэтому цена ошибки в миграции — молча пропавшие кнопки у всех сообщений
// ботов: проверяем на настоящих строках в настоящем Postgres.
//
// Схема проверки та же, что у 0100: откатываемся на версию назад (там ещё
// старая форма), пишем строки как их писал прежний код, накатываем 0101 и
// читаем ОБЫЧНЫМИ репозиториями — они знают только новую форму, поэтому
// «прочиталось» и значит «сконвертировалось».
const replyMarkupMigrationPrevVersion = 100

// assertFrameMarkup читает замороженный кадр журнала апдейтов и сверяет его
// клавиатуру.
func assertFrameMarkup(t *testing.T, pool *pgxpool.Pool, query string, arg any, want domain.ReplyMarkup) {
	t.Helper()
	var raw []byte
	if err := pool.QueryRow(context.Background(), query, arg).Scan(&raw); err != nil {
		t.Fatalf("чтение кадра: %v", err)
	}
	var payload struct {
		ReplyMarkup json.RawMessage `json:"reply_markup"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("разбор кадра %s: %v", raw, err)
	}
	got, err := domain.UnmarshalReplyMarkup(payload.ReplyMarkup)
	if err != nil {
		t.Fatalf("разбор клавиатуры кадра %s: %v", raw, err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("клавиатура кадра = %#v, ждали %#v (сырой кадр: %s)", got, want, raw)
	}
}

func TestMigration0101_ConvertsStoredReplyMarkup(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, replyMarkupMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", replyMarkupMigrationPrevVersion, err)
	}

	user := seedUser(t, pool, "+79990000101")
	var chatID int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type) VALUES ('private') RETURNING id`).Scan(&chatID); err != nil {
		t.Fatalf("seed chat: %v", err)
	}

	insert := func(seq int64, markup string) int64 {
		t.Helper()
		var id int64
		if err := pool.QueryRow(ctx,
			`INSERT INTO messages (chat_id, seq, sender_id, type, text, reply_markup)
			 VALUES ($1, $2, $3, 'text', 'от бота', $4::jsonb) RETURNING id`,
			chatID, seq, user, markup).Scan(&id); err != nil {
			t.Fatalf("seed message: %v", err)
		}
		return id
	}

	// Ровно то, что писал прежний код: «ровно один из callback/url/webapp» на
	// кнопке, две клавиатуры в одном объекте, плоские resize/one_time.
	inlineID := insert(1, `{"inline":[
		[{"text":"алерт","callback":"alert"},{"text":"сайт","url":"https://telegram.org"}],
		[{"text":"mini-app","webapp":"/webapp-demo.html"}]
	]}`)
	keyboardID := insert(2, `{"keyboard":[["Кнопка A","Кнопка B"],["/hide"]],"resize":true,"one_time":true}`)
	// «Скрыть клавиатуру» прежняя форма кодировала пустым срезом, а из-за
	// omitempty он не сериализовался вовсе — в базе такая строка лежит как «{}».
	hideID := insert(3, `{}`)
	// Строка, УЖЕ записанная в новой форме: так выглядит база, куда 0101 доехала
	// после того, как часть строк записал новый код. Конвертер обязан узнать её
	// по дискриминатору и не тронуть.
	alreadyTLID := insert(4, `{"_":"replyKeyboardHide","pFlags":{"selective":true}}`)

	// Замороженные кадры журналов апдейтов: их клиент переигрывает при /sync и
	// difference. Не переписать — значит отдать догоняющему клиенту клавиатуру
	// в форме, которую он уже не понимает.
	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload)
		 VALUES ($1, 1, 'new_message', jsonb_build_object(
		           'chat_id', $2::bigint, 'msg_id', $3::bigint, 'text', 'от бота',
		           'reply_markup', $4::jsonb))`,
		user, chatID, inlineID, `{"inline":[[{"text":"эхо","callback":"echo"}]]}`); err != nil {
		t.Fatalf("seed update: %v", err)
	}
	// edit_message кладёт reply_markup всегда, в том числе null (клавиатура
	// снята) — такой кадр конвертер трогать не должен.
	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload)
		 VALUES ($1, 2, 'edit_message', jsonb_build_object('chat_id', $2::bigint, 'reply_markup', NULL))`,
		user, chatID); err != nil {
		t.Fatalf("seed null-markup update: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO channel_updates (channel_id, pts, pts_count, type, payload)
		 VALUES ($1, 1, 1, 'new_message', jsonb_build_object('chat_id', $1::bigint, 'reply_markup', $2::jsonb))`,
		chatID, `{"keyboard":[["A"]],"resize":true}`); err != nil {
		t.Fatalf("seed channel update: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0101: %v", err)
	}

	repo := NewMessagesRepo(pool)
	read := func(id int64) domain.ReplyMarkup {
		t.Helper()
		msgs, err := repo.GetByIDs(ctx, []int64{id})
		if err != nil || len(msgs) != 1 {
			t.Fatalf("GetByIDs(%d): %v, %d строк", id, err, len(msgs))
		}
		return msgs[0].ReplyMarkup
	}

	wantInline := domain.NewReplyInlineMarkup([]domain.KeyboardButtonRow{
		domain.NewKeyboardButtonRow(
			// callback прежней формы — строка; в схеме data:bytes, поэтому в
			// jsonb он лежит base64-строкой и читается обратно теми же байтами.
			domain.NewKeyboardButtonCallback("алерт", []byte("alert")),
			domain.NewKeyboardButtonURL("сайт", "https://telegram.org")),
		domain.NewKeyboardButtonRow(domain.NewKeyboardButtonWebView("mini-app", "/webapp-demo.html")),
	})
	if got := read(inlineID); !reflect.DeepEqual(got, wantInline) {
		t.Errorf("inline после конвертации =\n%#v\nждали\n%#v", got, wantInline)
	}

	// one_time прежней формы — это pFlags.single_use схемы, а не своё имя.
	wantKeyboard := domain.NewReplyKeyboardMarkup([]domain.KeyboardButtonRow{
		domain.NewKeyboardButtonRow(domain.NewKeyboardButton("Кнопка A"), domain.NewKeyboardButton("Кнопка B")),
		domain.NewKeyboardButtonRow(domain.NewKeyboardButton("/hide")),
	}, domain.ReplyKeyboardFlags{Resize: true, SingleUse: true}, "")
	if got := read(keyboardID); !reflect.DeepEqual(got, wantKeyboard) {
		t.Errorf("keyboard после конвертации =\n%#v\nждали\n%#v", got, wantKeyboard)
	}

	if got := read(hideID); !reflect.DeepEqual(got, domain.NewReplyKeyboardHide(false)) {
		t.Errorf("«скрыть» после конвертации = %#v, ждали replyKeyboardHide", got)
	}

	if got := read(alreadyTLID); !reflect.DeepEqual(got, domain.NewReplyKeyboardHide(true)) {
		t.Errorf("уже переписанная строка испорчена конвертацией: %#v", got)
	}

	assertFrameMarkup(t, pool, `SELECT payload FROM updates WHERE user_id=$1 AND pts=1`, user,
		domain.NewReplyInlineMarkup([]domain.KeyboardButtonRow{
			domain.NewKeyboardButtonRow(domain.NewKeyboardButtonCallback("эхо", []byte("echo"))),
		}))
	// Кадра правки с pts=2 больше нет: миграция 0115 удалила замороженные патчи
	// правки — конструктор updateEditMessage несёт сообщение целиком, а достроить
	// его из патча нечем. Клавиатура «снята» (reply_markup: null) уезжает вместе
	// с ним, и это ровно то, что миграция объявляет ценой.
	var editFrames int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM updates WHERE user_id=$1 AND pts=2`, user).Scan(&editFrames); err != nil {
		t.Fatalf("подсчёт кадров правки: %v", err)
	}
	if editFrames != 0 {
		t.Error("патч правки пережил миграцию 0115")
	}
	assertFrameMarkup(t, pool, `SELECT payload FROM channel_updates WHERE channel_id=$1 AND pts=1`, chatID,
		domain.NewReplyKeyboardMarkup([]domain.KeyboardButtonRow{
			domain.NewKeyboardButtonRow(domain.NewKeyboardButton("A")),
		}, domain.ReplyKeyboardFlags{Resize: true}, ""))

	// Круг вниз-вверх: Down возвращает плоскую форму, повторный Up переводит её
	// снова — откат миграции не должен стоить истории клавиатур.
	if err := storepostgres.MigrateDownTo(url, replyMarkupMigrationPrevVersion); err != nil {
		t.Fatalf("повторный откат: %v", err)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	if got := read(inlineID); !reflect.DeepEqual(got, wantInline) {
		t.Errorf("после круга вниз-вверх inline =\n%#v\nждали\n%#v", got, wantInline)
	}
	if got := read(keyboardID); !reflect.DeepEqual(got, wantKeyboard) {
		t.Errorf("после круга вниз-вверх keyboard =\n%#v\nждали\n%#v", got, wantKeyboard)
	}
	if got := read(hideID); !reflect.DeepEqual(got, domain.NewReplyKeyboardHide(false)) {
		t.Errorf("после круга вниз-вверх «скрыть» = %#v", got)
	}
}
