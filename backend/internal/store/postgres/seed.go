package postgres

import (
	"context"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
)

// demoUser is a single seed profile.
type demoUser struct {
	phone, first, last, username, bio string
}

// demoUsers is the set of profiles SeedDemo fills in. The first three match the
// phones that already exist in dev/CI flows; the rest give search & "new chat"
// something to find — and populate the demo channels/groups seeded on top of
// them (see internal/demoseed).
var demoUsers = []demoUser{
	{"+79990000001", "Алиса", "Иванова", "alice_ivanova", "Создатель чатов и любитель кофе ☕"},
	{"+79990000002", "Боб", "Петров", "bob_petrov", "Бэкенд-разработчик"},
	{"+77790", "Чарли", "Чаплин", "charlie_c", "Тестировщик — ловлю баги 🐞"},
	{"+79990000003", "Дарья", "Смирнова", "daria_smirnova", "UI/UX дизайнер"},
	{"+79990000004", "Егор", "Кузнецов", "egor_k", "Продакт-менеджер"},
	{"+79990000005", "Фёдор", "Морозов", "fedor_m", "Мобильный разработчик"},
	{"+79990000006", "Галина", "Соколова", "galina_s", "Маркетолог"},
	{"+79990000007", "Дмитрий", "Волков", "dmitry_v", "DevOps-инженер"},
	{"+79990000008", "Ирина", "Лебедева", "irina_lebedeva", "Копирайтер, пишу про технологии"},
	{"+79990000009", "Кирилл", "Орлов", "kirill_orlov", "Аналитик данных"},
	{"+79990000010", "Лариса", "Зайцева", "larisa_z", "HR-менеджер, ищу людей в команду"},
	{"+79990000011", "Михаил", "Новиков", "mikhail_n", "Фронтенд-разработчик"},
	{"+79990000012", "Наталья", "Егорова", "natalia_e", "Руководитель поддержки"},
	{"+79990000013", "Олег", "Виноградов", "oleg_v", "Системный администратор"},
	{"+79990000014", "Полина", "Крылова", "polina_k", "Иллюстратор и немного шрифтовик"},
	{"+79990000015", "Роман", "Беляев", "roman_belyaev", "Спортивный журналист"},
	{"+79990000016", "Светлана", "Тарасова", "svetlana_t", "Редактор новостной ленты"},
	{"+79990000017", "Тимур", "Гусев", "timur_g", "Data-инженер"},
	{"+79990000018", "Ульяна", "Панова", "ulyana_p", "Музыкальный критик"},
	{"+79990000019", "Виктор", "Сафонов", "viktor_s", "Тренер по плаванию"},
}

// SeedDemo idempotently fills in demo profiles. It never clobbers fields a user
// has already set: names/bio are only filled when blank, the username only when
// unset, and display_name only while it's still the placeholder phone. New demo
// phones are inserted outright. Safe to run on every boot.
//
// Возвращает карту «юзернейм → id» — по ней демо-контент (каналы, группы,
// посты) находит своих авторов. Профили, которых завести не удалось (например,
// юзернейм занял живой пользователь), в карту просто не попадают, и контент,
// завязанный на них, пропускается.
func SeedDemo(ctx context.Context, pool *pgxpool.Pool) (map[string]int64, error) {
	const q = `
		INSERT INTO users (phone, first_name, last_name, username, bio, display_name)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (phone) DO UPDATE SET
		  first_name   = CASE WHEN users.first_name = '' THEN EXCLUDED.first_name ELSE users.first_name END,
		  last_name    = CASE WHEN users.last_name  = '' THEN EXCLUDED.last_name  ELSE users.last_name  END,
		  username     = COALESCE(users.username, EXCLUDED.username),
		  bio          = CASE WHEN users.bio = '' THEN EXCLUDED.bio ELSE users.bio END,
		  display_name = CASE WHEN users.display_name = users.phone OR users.display_name = ''
		                      THEN EXCLUDED.display_name ELSE users.display_name END`
	n := 0
	ids := make(map[string]int64, len(demoUsers))
	for _, u := range demoUsers {
		display := u.first + " " + u.last
		if _, err := pool.Exec(ctx, q, u.phone, u.first, u.last, u.username, u.bio, display); err != nil {
			// A username collision with a real user shouldn't abort boot; log & skip.
			log.Printf("seed: %s skipped: %v", u.phone, err)
			continue
		}
		n++
		// Телефон — стабильный ключ строки (username мог достаться живому
		// пользователю), поэтому id читаем по нему.
		var id int64
		if err := pool.QueryRow(ctx, `SELECT id FROM users WHERE phone = $1`, u.phone).Scan(&id); err == nil {
			ids[u.username] = id
		}
	}
	log.Printf("seed: %d demo profiles ensured", n)
	return ids, nil
}
