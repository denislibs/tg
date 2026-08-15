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

// seedReactions заливает реакции индекса в порядке позиции (индекс элемента в
// reactions.json — это и есть порядок пикера в Telegram).
//
// Идемпотентность здесь не построчная, как у стикеров (там неполный набор
// досидируется по недостающим позициям), а целиком по реакции: признак «уже
// залито» — непустой static_media_id в БД. static — единственная роль,
// которая по описанию выгрузки есть всегда (static.webp — база, остальные
// шесть .tgs опциональны сверху), поэтому её отсутствие однозначно значит
// «эта реакция ещё не обработана ни разу или обработка прервалась». Так
// повторный (в том числе прерванный на середине) прогон не плодит копии
// медиа в MinIO ни для одной уже засеянной реакции, а недосеянные (упавшие
// до Upsert — см. ниже) досеиваются заново.
//
// Заливка и Upsert реакции — одна неделимая операция: если загрузка любой её
// роли падает, функция возвращает ошибку до вызова Upsert, и в БД для этой
// реакции не остаётся частично заполненной строки — на следующем прогоне она
// просто будет обработана заново (см. TestSeedReactionsRetriesIncompleteEntry).
func seedReactions(ctx context.Context, repo reactionsRepo, upload uploadFunc, dir string, list []reactionEntry) error {
	existing, err := repo.List(ctx)
	if err != nil {
		return err
	}
	seeded := make(map[string]bool, len(existing))
	for _, rc := range existing {
		if rc.StaticMediaID != 0 {
			seeded[rc.Emoji] = true
		}
	}

	for pos, entry := range list {
		if seeded[entry.Reaction] {
			continue
		}
		rc := domain.AvailableReaction{
			Emoji: entry.Reaction, Title: entry.Title, Position: pos,
			Premium: entry.Premium, Inactive: entry.Inactive,
		}
		filesUploaded := 0
		for _, role := range reactionRoles {
			file, ok := entry.Files[role]
			if !ok {
				continue
			}
			mediaID, err := upload(ctx, filepath.Join(dir, entry.Slug, file))
			if err != nil {
				return fmt.Errorf("%s (%s): %w", entry.Reaction, role, err)
			}
			if err := setRole(&rc, role, mediaID); err != nil {
				return fmt.Errorf("%s: %w", entry.Reaction, err)
			}
			filesUploaded++
		}
		if err := repo.Upsert(ctx, rc); err != nil {
			return err
		}
		log.Printf("+ %s %s: %d файлов", entry.Reaction, entry.Title, filesUploaded)
	}
	return nil
}
