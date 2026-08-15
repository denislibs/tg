// seed-stickers заливает наборы стикеров из assets/stickers/<slug>/ в БД и
// MinIO (env те же, что у сервера: DATABASE_URL, MINIO_*). Идемпотентно, так что
// можно гонять при каждом деплое: существующему набору стикеры не перезаливаются,
// а недостающие метаданные (rank трендов, обложка) доставляются — см. seedSet.
//
//	go run ./cmd/seed-stickers            # каталоги из ./assets/stickers
//	go run ./cmd/seed-stickers -dir path  # свой каталог с наборами
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
	usecasestickers "github.com/messenger-denis/backend/internal/usecase/stickers"
)

// setMeta — meta.json набора: заголовок, вид, обложка и список файлов с эмодзи.
type setMeta struct {
	Title    string `json:"title"`
	Kind     string `json:"kind"`
	Cover    string `json:"cover"`
	Stickers []struct {
		File  string `json:"file"`
		Emoji string `json:"emoji"`
	} `json:"stickers"`
}

// setIndex — _index.json рядом с наборами: порядок трендов из выгрузки
// (tools/fetch_stickers.py). Без него наборы сидируются в алфавитном порядке
// каталогов, и панель показывает их не так, как Telegram.
type setIndex struct {
	Order []string `json:"order"`
}

// loadRanks читает _index.json и отдаёт slug → позиция (с единицы). Файла нет —
// пустая карта: все наборы получают rank 0 («вне трендов»).
func loadRanks(dir string) map[string]int {
	raw, err := os.ReadFile(filepath.Join(dir, "_index.json"))
	if err != nil {
		return map[string]int{}
	}
	var idx setIndex
	if err := json.Unmarshal(raw, &idx); err != nil {
		return map[string]int{}
	}
	ranks := make(map[string]int, len(idx.Order))
	for i, slug := range idx.Order {
		ranks[slug] = i + 1
	}
	return ranks
}

func main() {
	dir := flag.String("dir", "assets/stickers", "каталог с наборами (<slug>/meta.json + файлы)")
	flag.Parse()

	if err := run(*dir); err != nil {
		log.Fatalf("seed-stickers: %v", err)
	}
}

// stickerMime детектит mime по расширению файла стикера. Content-Type отдаётся из
// этого mime (media.GetContent → info.ContentType), а фронт различает ветки по
// нему: application/json → lottie, video/* → видео-стикер (webm/vp9), image/* →
// статичный. .json остаётся application/json, чтобы не сломать lottie-детект.
func stickerMime(file string) string {
	switch strings.ToLower(filepath.Ext(file)) {
	case ".tgs":
		// .tgs — gzip'нутый lottie-json Telegram. Не распаковываем: бэкенд читает
		// из него размеры сам (ffmpeg.lottieDims разжимает по magic-байтам), а
		// фронт — DecompressionStream в StickerMedia.
		return "application/x-tgsticker"
	case ".webm":
		return "video/webm"
	case ".webp":
		return "image/webp"
	case ".png":
		return "image/png"
	case ".json":
		return "application/json"
	default:
		return "application/json"
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

	// Тот же конвейер, что у обычной загрузки медиа (запись в media + объект в
	// MinIO), только без постобработки — lottie-json в ней не нуждается.
	mediaUC := usecasemedia.New(pgadapter.NewMediaRepo(pool), mc, nil)
	stickersUC := usecasestickers.New(pgadapter.NewStickersRepo(pool))

	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	ranks := loadRanks(dir)
	upload := func(ctx context.Context, path string) (int64, error) { return uploadFile(ctx, mediaUC, path) }
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if err := seedSet(ctx, stickersUC, upload, dir, e.Name(), ranks[e.Name()]); err != nil {
			return fmt.Errorf("набор %s: %w", e.Name(), err)
		}
	}
	return nil
}

// uploadFile читает файл набора и заливает его как media (тот же путь, что у
// обычной загрузки: CreateUpload + PutContent). Общий код для стикеров набора
// и его обложки — им обеим нужна ровно эта пара вызовов.
func uploadFile(ctx context.Context, mediaUC *usecasemedia.Interactor, path string) (int64, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	name := filepath.Base(path)
	m, _, err := mediaUC.CreateUpload(ctx, usecasemedia.UploadInput{
		OwnerID: domain.ServiceUserID, Mime: stickerMime(name),
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

// setSeeder — та часть usecase стикеров, которой пользуется seedSet. Узкий
// интерфейс вместо *usecasestickers.Interactor нужен затем, что вся логика
// идемпотентности сида живёт в seedSet, и её надо проверять тестом без
// Postgres и MinIO (cmd/seed-stickers/main_test.go).
type setSeeder interface {
	SetBySlug(ctx context.Context, slug string) (domain.StickerSet, []domain.Sticker, error)
	CreateSet(ctx context.Context, ownerID int64, slug, title, kind string) (domain.StickerSet, error)
	AddSticker(ctx context.Context, ownerID, setID, mediaID int64, emoji string) (domain.Sticker, error)
	SetRank(ctx context.Context, setID int64, rank int) error
	SetCover(ctx context.Context, setID, mediaID int64) error
}

// uploadFunc — заливка одного файла набора в media; в бою это uploadFile поверх
// usecase медиа, в тесте — счётчик.
type uploadFunc func(ctx context.Context, path string) (int64, error)

// seedSet заливает набор и приводит его метаданные (rank/обложка) к тому, что
// написано в выгрузке.
//
// Идемпотентность здесь построчная, а не «набор целиком»: существующему набору
// стикеры не перезаливаются, но rank и обложка проставляются НА КАЖДОМ прогоне.
// Иначе прерванный прогон (а он прерывается — это гигабайты файлов) оставлял бы
// уже созданные наборы с rank = 0 и без обложки навсегда: повторный запуск
// упирался бы в ранний возврат «набор уже есть», и порядок панели тихо
// разъезжался бы с Telegram.
func seedSet(ctx context.Context, sets setSeeder, upload uploadFunc, dir, slug string, rank int) error {
	raw, err := os.ReadFile(filepath.Join(dir, slug, "meta.json"))
	if err != nil {
		return err
	}
	var meta setMeta
	if err := json.Unmarshal(raw, &meta); err != nil {
		return err
	}

	set, _, err := sets.SetBySlug(ctx, slug)
	switch {
	case err == nil:
		log.Printf("набор %s уже есть — стикеры не перезаливаю", slug)
	case errors.Is(err, domain.ErrNotFound):
		// Владелец сид-наборов — сервисный аккаунт: он есть в любой БД (миграция
		// 0014) и наборы не окажутся «ничьими».
		set, err = sets.CreateSet(ctx, domain.ServiceUserID, slug, meta.Title, meta.Kind)
		if err != nil {
			return err
		}
		for _, s := range meta.Stickers {
			mediaID, err := upload(ctx, filepath.Join(dir, slug, s.File))
			if err != nil {
				return err
			}
			if _, err := sets.AddSticker(ctx, domain.ServiceUserID, set.ID, mediaID, s.Emoji); err != nil {
				return err
			}
		}
		log.Printf("набор %s (%s, %d стикеров) залит", slug, meta.Kind, len(meta.Stickers))
	default:
		return err
	}

	if rank > 0 && set.Rank != rank {
		if err := sets.SetRank(ctx, set.ID, rank); err != nil {
			return err
		}
	}
	// Обложка — такое же медиа, как стикер, но в наборе не числится: это
	// иконка вкладки панели (tweb stickerSetThumb), а не отправляемый стикер.
	// Заливаем её, только пока её нет: файл уже в media, и повторная заливка
	// плодила бы его копию на каждом прогоне сида.
	if meta.Cover != "" && set.CoverMediaID == 0 {
		coverID, err := upload(ctx, filepath.Join(dir, slug, meta.Cover))
		if err != nil {
			return err
		}
		if err := sets.SetCover(ctx, set.ID, coverID); err != nil {
			return err
		}
	}
	return nil
}
