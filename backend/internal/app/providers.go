// Package app assembles the application with the uber/fx DI container.
package app

import (
	"context"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/messenger-denis/backend/internal/auth"
	"github.com/messenger-denis/backend/internal/config"
	"github.com/messenger-denis/backend/internal/messaging"
	"github.com/messenger-denis/backend/internal/store/miniostore"
	"github.com/messenger-denis/backend/internal/store/postgres"
	"github.com/messenger-denis/backend/internal/store/redisstore"
	"github.com/redis/go-redis/v9"
	"go.uber.org/fx"
)

// RedisResult carries an optional Redis client (OK=false when Redis is unavailable,
// preserving the app's graceful-degradation behavior).
type RedisResult struct {
	Client *redis.Client
	OK     bool
}

// MinioResult carries an optional MinIO client.
type MinioResult struct {
	Client *miniostore.Client
	OK     bool
}

func provideConfig() (*config.Config, error) {
	return config.Load()
}

// provideAppContext returns a process-lifetime context cancelled on shutdown
// (used by background workers / the WS hub).
func provideAppContext(lc fx.Lifecycle) context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	lc.Append(fx.Hook{OnStop: func(context.Context) error { cancel(); return nil }})
	return ctx
}

func providePool(lc fx.Lifecycle, cfg *config.Config, ctx context.Context) (*pgxpool.Pool, error) {
	if err := postgres.Migrate(cfg.DatabaseURL); err != nil {
		return nil, err
	}
	pool, err := postgres.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	lc.Append(fx.Hook{OnStop: func(context.Context) error { pool.Close(); return nil }})
	return pool, nil
}

func provideRedis(lc fx.Lifecycle, cfg *config.Config, ctx context.Context) RedisResult {
	c, err := redisstore.Connect(ctx, cfg.RedisURL)
	if err != nil {
		log.Printf("redis unavailable, running without cache/realtime: %v", err)
		return RedisResult{}
	}
	lc.Append(fx.Hook{OnStop: func(context.Context) error { return c.Close() }})
	return RedisResult{Client: c, OK: true}
}

func provideMinio(cfg *config.Config, ctx context.Context) MinioResult {
	mc, err := miniostore.Connect(cfg.MinioEndpoint, cfg.MinioAccessKey, cfg.MinioSecretKey, cfg.MinioBucket, cfg.MinioUseSSL)
	if err != nil {
		log.Printf("minio unavailable, media disabled: %v", err)
		return MinioResult{}
	}
	if err := mc.EnsureBucket(ctx); err != nil {
		log.Printf("minio bucket setup failed, media disabled: %v", err)
		return MinioResult{}
	}
	return MinioResult{Client: mc, OK: true}
}

func provideAuthService(cfg *config.Config, pool *pgxpool.Pool) *auth.Service {
	return auth.NewService(auth.NewRepo(pool), cfg.DevOTPCode, log.Printf)
}

func provideChatService(pool *pgxpool.Pool) *messaging.Service {
	return messaging.NewService(pool)
}
