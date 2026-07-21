// seed-stickers заливает наборы стикеров из assets/stickers/<slug>/ в БД и
// MinIO (env те же, что у сервера: DATABASE_URL, MINIO_*). Идемпотентно:
// существующий slug пропускается целиком, так что можно гонять при каждом деплое.
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

	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	minioadapter "github.com/messenger-denis/backend/internal/adapter/storage/minio"
	"github.com/messenger-denis/backend/internal/config"
	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
	usecasestickers "github.com/messenger-denis/backend/internal/usecase/stickers"
)

// setMeta — meta.json набора: заголовок, вид и список файлов с эмодзи.
type setMeta struct {
	Title    string `json:"title"`
	Kind     string `json:"kind"`
	Stickers []struct {
		File  string `json:"file"`
		Emoji string `json:"emoji"`
	} `json:"stickers"`
}

func main() {
	dir := flag.String("dir", "assets/stickers", "каталог с наборами (<slug>/meta.json + файлы)")
	flag.Parse()

	if err := run(*dir); err != nil {
		log.Fatalf("seed-stickers: %v", err)
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
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if err := seedSet(ctx, stickersUC, mediaUC, dir, e.Name()); err != nil {
			return fmt.Errorf("набор %s: %w", e.Name(), err)
		}
	}
	return nil
}

func seedSet(ctx context.Context, stickersUC *usecasestickers.Interactor, mediaUC *usecasemedia.Interactor, dir, slug string) error {
	if _, _, err := stickersUC.SetBySlug(ctx, slug); err == nil {
		log.Printf("набор %s уже есть — пропускаю", slug)
		return nil
	} else if !errors.Is(err, domain.ErrNotFound) {
		return err
	}

	raw, err := os.ReadFile(filepath.Join(dir, slug, "meta.json"))
	if err != nil {
		return err
	}
	var meta setMeta
	if err := json.Unmarshal(raw, &meta); err != nil {
		return err
	}

	// Владелец сид-наборов — сервисный аккаунт: он есть в любой БД (миграция
	// 0014) и наборы не окажутся «ничьими».
	set, err := stickersUC.CreateSet(ctx, domain.ServiceUserID, slug, meta.Title, meta.Kind)
	if err != nil {
		return err
	}
	for _, s := range meta.Stickers {
		data, err := os.ReadFile(filepath.Join(dir, slug, s.File))
		if err != nil {
			return err
		}
		m, _, err := mediaUC.CreateUpload(ctx, usecasemedia.UploadInput{
			OwnerID: domain.ServiceUserID, Mime: "application/json",
			Size: int64(len(data)), Width: 512, Height: 512, FileName: s.File,
		})
		if err != nil {
			return err
		}
		if err := mediaUC.PutContent(ctx, m.ID, domain.ServiceUserID, bytes.NewReader(data), int64(len(data))); err != nil {
			return err
		}
		if _, err := stickersUC.AddSticker(ctx, domain.ServiceUserID, set.ID, m.ID, s.Emoji); err != nil {
			return err
		}
	}
	log.Printf("набор %s (%s, %d стикеров) залит", slug, meta.Kind, len(meta.Stickers))
	return nil
}
