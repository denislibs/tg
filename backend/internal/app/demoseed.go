package app

import (
	"context"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/messenger-denis/backend/internal/adapter/media/ffmpeg"
	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/config"
	"github.com/messenger-denis/backend/internal/demoseed"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
	"go.uber.org/fx"
)

// demoSeedParams — зависимости дев-сида. Он берёт СОБРАННЫЙ интерактор чата, а
// не пул с SQL: демо-контент обязан появляться тем же путём, что и настоящий
// (служебные сообщения, журнал updates с pts, веер по участникам).
type demoSeedParams struct {
	fx.In

	Cfg    *config.Config
	Ctx    context.Context
	Pool   *pgxpool.Pool
	Minio  MinioResult
	ChatUC *usecasechat.Interactor
}

// registerDemoSeed засевает стенд под флагом SEED_DEMO: сначала демо-профили
// (единственная часть, которой нужен прямой доступ к users — аккаунтов ещё
// нет), затем каналы/группы/сообщения через chat-usecase.
//
// Регистрируется ПОСЛЕ registerServer и именно поэтому: тот довешивает на
// интерактор опросы, публикацию в realtime и остальные опциональные порты —
// сид должен получить его уже полностью собранным. Сам вызов идёт в фазе
// invoke (до OnStart), так что к моменту «listening on» контент уже в базе.
func registerDemoSeed(p demoSeedParams) {
	if !p.Cfg.SeedDemo {
		return
	}
	users, err := postgres.SeedDemo(p.Ctx, p.Pool)
	if err != nil {
		log.Printf("seed demo failed: %v", err)
		return
	}
	// Медиа-usecase собирается так же, как в registerServer; без MinIO сид
	// просто обходится без картинок.
	var mediaUC *usecasemedia.Interactor
	if p.Minio.OK {
		mediaUC = usecasemedia.New(pgadapter.NewMediaRepo(p.Pool), p.Minio.Client, ffmpeg.New())
	}
	demoseed.Seed(p.Ctx, p.ChatUC, mediaUC, users)
}
