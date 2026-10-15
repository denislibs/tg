package postgres

import (
	"context"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Команды бота по скоупам с адресом (Ф-6, f6-bots, миграция 0176): список для
// чата X не виден в чате Y, админ видит свой список, рядовой — нет, запись
// chat_member видит один пользователь, язык откатывается на пустой.

type botFixture struct {
	pool  *pgxpool.Pool
	api   *BotAPIRepo
	bots  *BotRepo
	bot   int64
	admin int64 // создатель обеих групп
	alice int64 // рядовой участник обеих групп
	bob   int64 // рядовой участник группы X
	chatX int64
	chatY int64
}

func cmds(names ...string) []domain.BotCommand {
	out := make([]domain.BotCommand, 0, len(names))
	for _, n := range names {
		out = append(out, domain.BotCommand{Command: n, Description: n + " d"})
	}
	return out
}

func names(cs []domain.BotCommand) []string {
	out := make([]string, 0, len(cs))
	for _, c := range cs {
		out = append(out, c.Command)
	}
	return out
}

func newBotFixture(t *testing.T) botFixture {
	t.Helper()
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	f := botFixture{pool: pool, api: NewBotAPIRepo(pool), bots: NewBotRepo(pool)}
	f.admin = seedUser(t, pool, "+79990000601")
	f.alice = seedUser(t, pool, "+79990000602")
	f.bob = seedUser(t, pool, "+79990000603")
	acc, err := f.api.CreateBot(ctx, f.admin, "Бот", "cmd_bot")
	if err != nil {
		t.Fatal(err)
	}
	f.bot = acc.BotID
	group := func(title string, members map[int64]string) int64 {
		var id int64
		if err := pool.QueryRow(ctx, `INSERT INTO chats (type, title) VALUES ('group', $1) RETURNING id`, title).Scan(&id); err != nil {
			t.Fatal(err)
		}
		for uid, role := range members {
			if _, err := pool.Exec(ctx, `INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,$3)`, id, uid, role); err != nil {
				t.Fatal(err)
			}
		}
		return id
	}
	f.chatX = group("X", map[int64]string{f.admin: "creator", f.alice: "member", f.bob: "member", f.bot: "member"})
	f.chatY = group("Y", map[int64]string{f.admin: "creator", f.alice: "member", f.bot: "member"})
	return f
}

func (f botFixture) set(t *testing.T, scope domain.BotCommandScope, lang string, c []domain.BotCommand) {
	t.Helper()
	if err := f.api.SetCommands(context.Background(), f.bot, scope, lang, c); err != nil {
		t.Fatalf("SetCommands(%+v): %v", scope, err)
	}
}

func (f botFixture) view(t *testing.T, chatID, viewer int64, admin bool, lang string) []string {
	t.Helper()
	got, err := f.bots.CommandsFor(context.Background(), f.bot, chatID, viewer, admin, lang)
	if err != nil {
		t.Fatalf("CommandsFor: %v", err)
	}
	return names(got)
}

func TestBotCommands_ChatScopeIsPerChat(t *testing.T) {
	f := newBotFixture(t)
	f.set(t, domain.BotCommandScope{Type: "default"}, "", cmds("start"))
	f.set(t, domain.BotCommandScope{Type: "chat", ChatID: f.chatX}, "", cmds("only_x"))

	if got := f.view(t, f.chatX, f.alice, false, ""); !reflect.DeepEqual(got, []string{"only_x"}) {
		t.Fatalf("чат X: %v; want [only_x]", got)
	}
	if got := f.view(t, f.chatY, f.alice, false, ""); !reflect.DeepEqual(got, []string{"start"}) {
		t.Fatalf("чат Y видит список чата X: %v; want [start]", got)
	}
}

func TestBotCommands_AdminsSeeAdminScope(t *testing.T) {
	f := newBotFixture(t)
	f.set(t, domain.BotCommandScope{Type: "all_group_chats"}, "", cmds("group"))
	f.set(t, domain.BotCommandScope{Type: "all_chat_administrators"}, "", cmds("all_admin"))
	f.set(t, domain.BotCommandScope{Type: "chat_administrators", ChatID: f.chatX}, "", cmds("x_admin"))
	f.set(t, domain.BotCommandScope{Type: "chat", ChatID: f.chatX}, "", cmds("x_chat"))

	// Приоритет админа: chat_administrators(X) > chat(X) > all_chat_administrators > all_group_chats.
	if got := f.view(t, f.chatX, f.admin, true, ""); !reflect.DeepEqual(got, []string{"x_admin"}) {
		t.Fatalf("админ X: %v; want [x_admin]", got)
	}
	if got := f.view(t, f.chatX, f.alice, false, ""); !reflect.DeepEqual(got, []string{"x_chat"}) {
		t.Fatalf("рядовой X видит админский список: %v; want [x_chat]", got)
	}
	// В чате Y нет ни chat, ни chat_administrators: админ получает all_chat_administrators.
	if got := f.view(t, f.chatY, f.admin, true, ""); !reflect.DeepEqual(got, []string{"all_admin"}) {
		t.Fatalf("админ Y: %v; want [all_admin]", got)
	}
	if got := f.view(t, f.chatY, f.alice, false, ""); !reflect.DeepEqual(got, []string{"group"}) {
		t.Fatalf("рядовой Y: %v; want [group]", got)
	}
}

func TestBotCommands_ChatMemberScopeIsOneUsers(t *testing.T) {
	f := newBotFixture(t)
	f.set(t, domain.BotCommandScope{Type: "chat", ChatID: f.chatX}, "", cmds("x_chat"))
	f.set(t, domain.BotCommandScope{Type: "chat_member", ChatID: f.chatX, UserID: f.bob}, "", cmds("for_bob"))

	if got := f.view(t, f.chatX, f.bob, false, ""); !reflect.DeepEqual(got, []string{"for_bob"}) {
		t.Fatalf("Боб: %v; want [for_bob]", got)
	}
	if got := f.view(t, f.chatX, f.alice, false, ""); !reflect.DeepEqual(got, []string{"x_chat"}) {
		t.Fatalf("Алиса видит список Боба: %v; want [x_chat]", got)
	}
	// Зритель 0 (расчёт тела «рядового» для рассылки) записей chat_member не видит.
	if got := f.view(t, f.chatX, 0, false, ""); !reflect.DeepEqual(got, []string{"x_chat"}) {
		t.Fatalf("зритель 0: %v; want [x_chat]", got)
	}
	// Админ-ветка не перекрывает chat_member: он выше всех.
	if got := f.view(t, f.chatX, f.bob, true, ""); !reflect.DeepEqual(got, []string{"for_bob"}) {
		t.Fatalf("Боб-админ: %v; want [for_bob]", got)
	}
}

func TestBotCommands_PrivateScopes(t *testing.T) {
	f := newBotFixture(t)
	f.set(t, domain.BotCommandScope{Type: "default"}, "", cmds("start"))
	f.set(t, domain.BotCommandScope{Type: "all_group_chats"}, "", cmds("group"))
	if got := f.view(t, 0, f.alice, false, ""); !reflect.DeepEqual(got, []string{"start"}) {
		t.Fatalf("личка без all_private_chats: %v; want [start]", got)
	}
	f.set(t, domain.BotCommandScope{Type: "all_private_chats"}, "", cmds("pm"))
	if got := f.view(t, 0, f.alice, false, ""); !reflect.DeepEqual(got, []string{"pm"}) {
		t.Fatalf("личка: %v; want [pm]", got)
	}
}

func TestBotCommands_LanguageFallsBackToEmpty(t *testing.T) {
	f := newBotFixture(t)
	f.set(t, domain.BotCommandScope{Type: "default"}, "", cmds("start", "help"))
	f.set(t, domain.BotCommandScope{Type: "default"}, "ru", cmds("start_ru"))
	f.set(t, domain.BotCommandScope{Type: "all_group_chats"}, "", cmds("group"))

	if got := f.view(t, 0, f.alice, false, "ru"); !reflect.DeepEqual(got, []string{"start_ru"}) {
		t.Fatalf("ru: %v; want [start_ru]", got)
	}
	if got := f.view(t, 0, f.alice, false, "de"); !reflect.DeepEqual(got, []string{"start", "help"}) {
		t.Fatalf("de без своего списка: %v; want [start help]", got)
	}
	// Скоуп важнее языка: точный язык у менее специфичного скоупа не перебивает.
	if got := f.view(t, f.chatY, f.alice, false, "ru"); !reflect.DeepEqual(got, []string{"group"}) {
		t.Fatalf("группа ru: %v; want [group] (all_group_chats без языка важнее default ru)", got)
	}
	// Зритель без языка видит только пустой.
	if got := f.view(t, 0, f.alice, false, ""); !reflect.DeepEqual(got, []string{"start", "help"}) {
		t.Fatalf("язык \"\": %v; want [start help]", got)
	}
}

func TestBotCommands_DeleteTouchesOnlyItsScope(t *testing.T) {
	f := newBotFixture(t)
	ctx := context.Background()
	f.set(t, domain.BotCommandScope{Type: "default"}, "", cmds("start"))
	f.set(t, domain.BotCommandScope{Type: "chat", ChatID: f.chatX}, "", cmds("x"))
	f.set(t, domain.BotCommandScope{Type: "chat", ChatID: f.chatY}, "", cmds("y"))

	if err := f.api.DeleteCommands(ctx, f.bot, domain.BotCommandScope{Type: "chat", ChatID: f.chatX}, ""); err != nil {
		t.Fatal(err)
	}
	if got := f.view(t, f.chatX, f.alice, false, ""); !reflect.DeepEqual(got, []string{"start"}) {
		t.Fatalf("X после удаления: %v; want [start]", got)
	}
	if got := f.view(t, f.chatY, f.alice, false, ""); !reflect.DeepEqual(got, []string{"y"}) {
		t.Fatalf("Y тронут удалением X: %v; want [y]", got)
	}
	// Пустой список — то же, что удаление.
	f.set(t, domain.BotCommandScope{Type: "chat", ChatID: f.chatY}, "", nil)
	if got := f.view(t, f.chatY, f.alice, false, ""); !reflect.DeepEqual(got, []string{"start"}) {
		t.Fatalf("Y после пустого списка: %v; want [start]", got)
	}
}

func TestBotCommands_SetReplacesAndKeepsOrder(t *testing.T) {
	f := newBotFixture(t)
	f.set(t, domain.BotCommandScope{Type: "default"}, "", cmds("b", "a", "c"))
	f.set(t, domain.BotCommandScope{Type: "default"}, "", cmds("z", "y"))
	if got := f.view(t, 0, f.alice, false, ""); !reflect.DeepEqual(got, []string{"z", "y"}) {
		t.Fatalf("замена списка: %v; want [z y]", got)
	}
	got, err := f.api.CommandsScoped(context.Background(), f.bot, domain.BotCommandScope{Type: "default"}, "")
	if err != nil || !reflect.DeepEqual(names(got), []string{"z", "y"}) {
		t.Fatalf("getMyCommands: %v %v", names(got), err)
	}
}

func TestBotCommands_CommandsForBotsBatch(t *testing.T) {
	f := newBotFixture(t)
	ctx := context.Background()
	other, err := f.api.CreateBot(ctx, f.admin, "Второй", "cmd_bot2")
	if err != nil {
		t.Fatal(err)
	}
	f.set(t, domain.BotCommandScope{Type: "all_group_chats"}, "", cmds("one"))
	if err := f.api.SetCommands(ctx, other.BotID, domain.BotCommandScope{Type: "chat", ChatID: f.chatX}, "", cmds("two")); err != nil {
		t.Fatal(err)
	}
	got, err := f.bots.CommandsForBots(ctx, []int64{f.bot, other.BotID}, f.chatX, f.alice, false, "")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(names(got[f.bot]), []string{"one"}) || !reflect.DeepEqual(names(got[other.BotID]), []string{"two"}) {
		t.Fatalf("пакет: %v / %v", names(got[f.bot]), names(got[other.BotID]))
	}
	empty, _ := f.bots.CommandsForBots(ctx, nil, f.chatX, f.alice, false, "")
	if len(empty) != 0 {
		t.Fatalf("пустой набор ботов: %v", empty)
	}
}

func TestBotChats_LimitAndMembers(t *testing.T) {
	f := newBotFixture(t)
	ctx := context.Background()
	var pm int64
	if err := f.pool.QueryRow(ctx, `INSERT INTO chats (type) VALUES ('private') RETURNING id`).Scan(&pm); err != nil {
		t.Fatal(err)
	}
	for _, uid := range []int64{f.bot, f.bob} {
		if _, err := f.pool.Exec(ctx, `INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2)`, pm, uid); err != nil {
			t.Fatal(err)
		}
	}

	// Канал-вещание с ботом-админом: в рассылку не входит.
	var channel int64
	if err := f.pool.QueryRow(ctx, `INSERT INTO chats (type, title) VALUES ('channel', 'Канал') RETURNING id`).Scan(&channel); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,'admin')`, channel, f.bot); err != nil {
		t.Fatal(err)
	}

	all, err := f.bots.BotChats(ctx, f.bot, 10)
	if err != nil || len(all) != 3 {
		t.Fatalf("BotChats: %v %v; want 3 чата", all, err)
	}
	types := map[int64]string{}
	for _, c := range all {
		types[c.ChatID] = c.Type
	}
	if types[pm] != "private" || types[f.chatX] != "group" {
		t.Fatalf("типы чатов: %v", types)
	}
	capped, _ := f.bots.BotChats(ctx, f.bot, 2)
	if len(capped) != 2 {
		t.Fatalf("BotChats с пределом 2 вернул %d", len(capped))
	}

	ids := []int64{f.chatX, f.chatY, pm}
	if n, err := f.bots.CountChatMembers(ctx, ids, 100); err != nil || n != 4+3+2 {
		t.Fatalf("CountChatMembers = %d %v; want 9", n, err)
	}
	if n, _ := f.bots.CountChatMembers(ctx, ids, 5); n != 5 {
		t.Fatalf("счёт с пределом 5 = %d; want 5", n)
	}

	rec, err := f.bots.ChatRecipients(ctx, f.bot, ids)
	if err != nil {
		t.Fatal(err)
	}
	staff := map[[2]int64]bool{}
	for _, r := range rec {
		if r.UserID == f.bot {
			t.Fatalf("бот среди получателей: %+v", r)
		}
		staff[[2]int64{r.ChatID, r.UserID}] = r.Staff
	}
	if len(rec) != 3+2+1 || !staff[[2]int64{f.chatX, f.admin}] || staff[[2]int64{f.chatX, f.alice}] {
		t.Fatalf("получатели: %+v", rec)
	}

	// Записи chat_member бота по чату — одной выборкой, сгруппированы по пользователю.
	f.set(t, domain.BotCommandScope{Type: "chat_member", ChatID: f.chatX, UserID: f.bob}, "", cmds("b1", "b2"))
	f.set(t, domain.BotCommandScope{Type: "chat_member", ChatID: f.chatX, UserID: f.alice}, "", cmds("a1"))
	f.set(t, domain.BotCommandScope{Type: "chat_member", ChatID: f.chatY, UserID: f.alice}, "", cmds("other"))
	f.set(t, domain.BotCommandScope{Type: "chat_member", ChatID: f.chatX, UserID: f.admin}, "ru", cmds("ru_only"))
	byUser, err := f.bots.ChatMemberCommands(ctx, f.bot, f.chatX)
	if err != nil {
		t.Fatal(err)
	}
	if len(byUser) != 2 || !reflect.DeepEqual(names(byUser[f.bob]), []string{"b1", "b2"}) || !reflect.DeepEqual(names(byUser[f.alice]), []string{"a1"}) {
		t.Fatalf("chat_member записи: %v", byUser)
	}

	bots, err := f.bots.ChatBotIDs(ctx, f.chatX, 50)
	if err != nil || !reflect.DeepEqual(bots, []int64{f.bot}) {
		t.Fatalf("боты чата: %v %v", bots, err)
	}
}

// Миграция 0176: у прежних строк адрес скоупа нулевой, команды видны как раньше;
// откат убирает строки с адресом и возвращает прежний первичный ключ.
func TestMigration0176_ScopeAddress(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()
	if err := storepostgres.MigrateDownTo(url, 175); err != nil {
		t.Fatalf("откат до 175: %v", err)
	}
	owner := seedUser(t, pool, "+79990000611")
	var bot int64
	if err := pool.QueryRow(ctx, `INSERT INTO users (phone, first_name, display_name, is_bot) VALUES ('bot_mig','b','b',true) RETURNING id`).Scan(&bot); err != nil {
		t.Fatal(err)
	}
	_ = owner
	if _, err := pool.Exec(ctx,
		`INSERT INTO bot_commands (bot_id, command, description, sort, scope, language_code) VALUES ($1,'start','d',0,'default','')`, bot); err != nil {
		t.Fatalf("seed старой формы: %v", err)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0176: %v", err)
	}
	got, err := NewBotRepo(pool).CommandsFor(ctx, bot, 0, owner, false, "")
	if err != nil || !reflect.DeepEqual(names(got), []string{"start"}) {
		t.Fatalf("прежняя строка после наката: %v %v", names(got), err)
	}
	// Одна команда живёт в двух чатах одного скоупа — PK различает адрес.
	for _, chat := range []int64{1, 2} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO bot_commands (bot_id, command, description, sort, scope, scope_chat_id) VALUES ($1,'x','d',0,'chat',$2)`, bot, chat); err != nil {
			t.Fatalf("адресные строки: %v", err)
		}
	}
	if err := storepostgres.MigrateDownTo(url, 175); err != nil {
		t.Fatalf("откат 0176: %v", err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM bot_commands WHERE bot_id=$1`, bot).Scan(&n); err != nil || n != 1 {
		t.Fatalf("после отката осталось %d строк (%v); want 1 — только безадресная", n, err)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
}
