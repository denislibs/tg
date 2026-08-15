// seed-reactions заливает каталог доступных реакций (available_reactions) из
// assets/reactions/ в БД и MinIO (env те же, что у сервера: DATABASE_URL,
// MINIO_*). Источник — выгрузка tools/fetch_stickers.py --reactions: единый
// reactions.json в корне каталога плюс файлы ролей в <slug>/ на реакцию.
// Идемпотентно — см. seedReactions.
//
//	go run ./cmd/seed-reactions            # каталог ./assets/reactions
//	go run ./cmd/seed-reactions -dir path  # свой каталог
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	minioadapter "github.com/messenger-denis/backend/internal/adapter/storage/minio"
	"github.com/messenger-denis/backend/internal/config"
	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

// reactionEntry — одна запись reactions.json: сама реакция и файлы её ролей на
// диске (ключ files — имя роли: static/appear/select/activate/effect/around/
// center, значение — имя файла в каталоге <slug>/, см. tools/fetch_stickers.py
// REACTION_ROLES).
type reactionEntry struct {
	Reaction string            `json:"reaction"`
	Title    string            `json:"title"`
	Slug     string            `json:"slug"`
	Premium  bool              `json:"premium"`
	Inactive bool              `json:"inactive"`
	Files    map[string]string `json:"files"`
}

// reactionRoles — фиксированный порядок ролей файла реакции. У выгрузки они
// лежат в map (порядок JSON-объекта не гарантирован), а лог сида и порядок
// заливки должны быть стабильны между прогонами; какие роли реально
// присутствуют, решает сам entry.Files.
var reactionRoles = []string{"static", "appear", "select", "activate", "effect", "around", "center"}

// loadIndex читает reactions.json. В отличие от стикеров (у каждого набора
// свой meta.json) индекс реакций один на весь каталог: порядок его элементов —
// порядок реакций в пикере Telegram, отсюда же берётся Position.
func loadIndex(dir string) ([]reactionEntry, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "reactions.json"))
	if err != nil {
		return nil, err
	}
	var list []reactionEntry
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, err
	}
	return list, nil
}

func main() {
	dir := flag.String("dir", "assets/reactions", "каталог с реакциями (reactions.json + <slug>/файлы)")
	flag.Parse()

	if err := run(*dir); err != nil {
		log.Fatalf("seed-reactions: %v", err)
	}
}

// reactionMime детектит mime по расширению файла роли реакции. В отличие от
// stickerMime (cmd/seed-stickers) здесь только два формата — выгрузка реакций
// качает исключительно их (tools/fetch_stickers.py REACTION_ROLES + EXT_BY_MIME),
// поэтому неизвестное расширение — это не «третий вид контента», а испорченная
// выгрузка, и сид должен упасть, а не молча залить мусор с неверным Content-Type.
func reactionMime(file string) (string, error) {
	switch strings.ToLower(filepath.Ext(file)) {
	case ".tgs":
		// .tgs — gzip'нутый lottie-json, как у анимированных стикеров.
		return "application/x-tgsticker", nil
	case ".webp":
		return "image/webp", nil
	default:
		return "", fmt.Errorf("неизвестное расширение файла роли реакции: %s", file)
	}
}

func run(dir string) error {
	ctx := context.Background()
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	// Миграции здесь же: сид может бежать до первого старта сервера.
	if err := postgres.Migrate(cfg.DatabaseURL); err != nil {
		return err
	}
	pool, err := postgres.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	mc, err := minioadapter.Connect(cfg.MinioEndpoint, cfg.MinioAccessKey, cfg.MinioSecretKey, cfg.MinioBucket, cfg.MinioUseSSL)
	if err != nil {
		return err
	}
	if err := mc.EnsureBucket(ctx); err != nil {
		return err
	}

	// Тот же конвейер, что у стикеров: media-запись + объект в MinIO, без
	// постобработки — lottie-json и webp-иконке она не нужна.
	mediaUC := usecasemedia.New(pgadapter.NewMediaRepo(pool), mc, nil)
	repo := pgadapter.NewAvailableReactionsRepo(pool)

	list, err := loadIndex(dir)
	if err != nil {
		return err
	}
	upload := func(ctx context.Context, path string) (int64, error) { return uploadFile(ctx, mediaUC, path) }
	return seedReactions(ctx, repo, upload, dir, list)
}

// uploadFile читает файл роли реакции и заливает его как media — тот же путь,
// что у обычной загрузки и у стикеров (CreateUpload + PutContent).
func uploadFile(ctx context.Context, mediaUC *usecasemedia.Interactor, path string) (int64, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	name := filepath.Base(path)
	mime, err := reactionMime(name)
	if err != nil {
		return 0, err
	}
	m, _, err := mediaUC.CreateUpload(ctx, usecasemedia.UploadInput{
		OwnerID: domain.ServiceUserID, Mime: mime,
		Size: int64(len(data)), Width: 512, Height: 512, FileName: name,
	})
	if err != nil {
		return 0, err
	}
	if err := mediaUC.PutContent(ctx, m.ID, domain.ServiceUserID, bytes.NewReader(data), int64(len(data))); err != nil {
		return 0, err
	}
	return m.ID, nil
}

// reactionsRepo — часть AvailableReactionsRepo, нужная сиду: List — чтобы
// понять, какие реакции уже полностью залиты (идемпотентность), Upsert —
// чтобы записать результат. Узкий интерфейс, чтобы seedReactions тестировался
// без Postgres (см. main_test.go), как setSeeder в cmd/seed-stickers.
type reactionsRepo interface {
	List(ctx context.Context) ([]domain.AvailableReaction, error)
	Upsert(ctx context.Context, rc domain.AvailableReaction) error
}

// uploadFunc — заливка одного файла роли реакции; в бою это uploadFile поверх
// usecase медиа, в тесте — счётчик.
type uploadFunc func(ctx context.Context, path string) (int64, error)

// setRole кладёт id залитого медиа в поле AvailableReaction, соответствующее
// роли. Неизвестная роль — испорченный reactions.json (сама выгрузка пишет
// только имена из REACTION_ROLES), поэтому это ошибка, а не тихий пропуск.
func setRole(rc *domain.AvailableReaction, role string, mediaID int64) error {
	switch role {
	case "static":
		rc.StaticMediaID = mediaID
	case "appear":
		rc.AppearMediaID = mediaID
	case "select":
		rc.SelectMediaID = mediaID
	case "activate":
		rc.ActivateMediaID = mediaID
	case "effect":
		rc.EffectMediaID = mediaID
	case "around":
		rc.AroundMediaID = mediaID
	case "center":
		rc.CenterMediaID = mediaID
	default:
		return fmt.Errorf("неизвестная роль файла реакции: %s", role)
	}
	return nil
}

// roleMediaID читает текущий id роли из AvailableReaction — обратная операция
// к setRole. Нужна, чтобы понять, какие роли уже залиты прошлым прогоном, не
// дублируя список полей ещё раз через reflection.
func roleMediaID(rc domain.AvailableReaction, role string) int64 {
	switch role {
	case "static":
		return rc.StaticMediaID
	case "appear":
		return rc.AppearMediaID
	case "select":
		return rc.SelectMediaID
	case "activate":
		return rc.ActivateMediaID
	case "effect":
		return rc.EffectMediaID
	case "around":
		return rc.AroundMediaID
	case "center":
		return rc.CenterMediaID
	default:
		return 0
	}
}

// seedReactions заливает реакции индекса в порядке позиции (индекс элемента в
// reactions.json — это и есть порядок пикера в Telegram).
//
// Идемпотентность здесь построчная по РОЛИ, а не по реакции целиком (первая
// версия сида ошибочно считала признаком «готово» непустой static_media_id и
// пропускала всю реакцию разом — ревью R2 нашло на этом два бага: сирота в
// MinIO при сбое посреди ролей и реакция, которая после частичной выгрузки
// API не досеивалась никогда). Для каждой роли отдельно: если её файл есть в
// entry.Files, но в уже сохранённой реакции id этой роли пуст — заливаем и
// сохраняем ИМЕННО ЭТУ роль (repo.Upsert сразу после каждой успешной
// заливки, не одним вызовом в конце). Из этого следует:
//   - прерывание посреди ролей одной реакции не оставляет сирот: последняя
//     успешно залитая роль уже привязана к строке в БД до того, как упадёт
//     следующая (TestSeedReactionsFailureMidRolesIsRecoverable);
//   - на следующем прогоне уже привязанные роли не трогаются (roleMediaID
//     не равен 0 → пропуск), а недостающие — те, что появились в новой
//     выгрузке API, или которые не успели залиться раньше — доливаются;
//   - реакция, у которой все нужные по индексу роли уже на месте, вообще не
//     вызывает upload/Upsert — строгий no-op на повторном прогоне (в том
//     числе Title/Position/Premium/Inactive не переписываются лишний раз;
//     если Telegram когда-нибудь переставит готовую реакцию в пикере, это
//     не подхватится без доливки хотя бы одной роли — вне области этого
//     фикса, ревью просило только границу по ролям).
func seedReactions(ctx context.Context, repo reactionsRepo, upload uploadFunc, dir string, list []reactionEntry) error {
	existing, err := repo.List(ctx)
	if err != nil {
		return err
	}
	byEmoji := make(map[string]domain.AvailableReaction, len(existing))
	for _, rc := range existing {
		byEmoji[rc.Emoji] = rc
	}

	for pos, entry := range list {
		rc, hadRow := byEmoji[entry.Reaction]
		rc.Emoji = entry.Reaction
		rc.Title = entry.Title
		rc.Position = pos
		rc.Premium = entry.Premium
		rc.Inactive = entry.Inactive

		uploaded := 0
		for _, role := range reactionRoles {
			file, ok := entry.Files[role]
			if !ok {
				continue // выгрузка не принесла эту роль для данной реакции
			}
			if roleMediaID(rc, role) != 0 {
				continue // роль уже залита прошлым прогоном — не трогаем и не плодим дубль
			}
			mediaID, err := upload(ctx, filepath.Join(dir, entry.Slug, file))
			if err != nil {
				return fmt.Errorf("%s (%s): %w", entry.Reaction, role, err)
			}
			if err := setRole(&rc, role, mediaID); err != nil {
				return fmt.Errorf("%s: %w", entry.Reaction, err)
			}
			// Сохраняем сразу после каждой роли: если следующая роль этой же
			// реакции упадёт, уже залитая не осиротеет в MinIO — ссылка на неё
			// уже в БД, и следующий прогон увидит её как «залитую», а не
			// «недостающую».
			if err := repo.Upsert(ctx, rc); err != nil {
				return err
			}
			uploaded++
		}

		switch {
		case uploaded > 0:
			log.Printf("+ %s %s: залито %d ролей", entry.Reaction, entry.Title, uploaded)
		case !hadRow:
			// Реакция без единой роли в files (в реальной выгрузке не
			// встречалось, но JSON это не запрещает) — заводим строку хотя бы
			// с метаданными, иначе она вообще не попадёт в каталог.
			if err := repo.Upsert(ctx, rc); err != nil {
				return err
			}
			log.Printf("+ %s %s: 0 файлов (роли отсутствуют в выгрузке)", entry.Reaction, entry.Title)
		default:
			log.Printf("= %s уже полностью залита", entry.Reaction)
		}
	}
	return nil
}
