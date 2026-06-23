package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/messenger-denis/backend/internal/auth"
	"github.com/messenger-denis/backend/internal/config"
	"github.com/messenger-denis/backend/internal/media"
	"github.com/messenger-denis/backend/internal/messaging"
	"github.com/messenger-denis/backend/internal/presence"
	"github.com/messenger-denis/backend/internal/realtime"
	"github.com/messenger-denis/backend/internal/store/miniostore"
	"github.com/messenger-denis/backend/internal/store/postgres"
	"github.com/messenger-denis/backend/internal/store/redisstore"
	httptransport "github.com/messenger-denis/backend/internal/transport/http"
	"github.com/messenger-denis/backend/internal/transport/ws"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if err := postgres.Migrate(cfg.DatabaseURL); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	ctx := context.Background()
	pool, err := postgres.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	authSvc := auth.NewService(auth.NewRepo(pool), cfg.DevOTPCode, log.Printf)
	chatSvc := messaging.NewService(pool)

	var wsHandler http.Handler
	if rdb, err := redisstore.Connect(ctx, cfg.RedisURL); err != nil {
		log.Printf("redis unavailable, running without cache/realtime: %v", err)
	} else {
		defer rdb.Close()
		authSvc.SetCache(redisstore.NewSessionCache(rdb))
		publisher := realtime.NewRedisPublisher(rdb)
		chatSvc.SetPublisher(publisher)
		authSvc.SetRevocationNotifier(publisher)
		presenceMgr := presence.NewManager(rdb, publisher, chatSvc.ChatPartners, 35*time.Second)
		hub := ws.NewHub(ctx, rdb)
		defer hub.Close()
		wsHandler = ws.NewHandler(hub, authSvc, chatSvc, presenceMgr)
		log.Printf("session cache + realtime + presence enabled (redis)")
	}

	var mediaHandler *httptransport.MediaHandler
	if mc, err := miniostore.Connect(cfg.MinioEndpoint, cfg.MinioAccessKey, cfg.MinioSecretKey, cfg.MinioBucket, cfg.MinioUseSSL); err != nil {
		log.Printf("minio unavailable, media disabled: %v", err)
	} else if err := mc.EnsureBucket(ctx); err != nil {
		log.Printf("minio bucket setup failed, media disabled: %v", err)
	} else {
		mediaHandler = httptransport.NewMediaHandler(media.NewService(media.NewRepo(pool), mc))
		log.Printf("media enabled (minio bucket %q)", cfg.MinioBucket)
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           httptransport.NewRouter(authSvc, chatSvc, wsHandler, mediaHandler),
		ReadHeaderTimeout: 5 * time.Second,
		// ReadTimeout and WriteTimeout are intentionally omitted (0): both would
		// terminate long-lived WS connections. Slow-header attacks are bounded by
		// ReadHeaderTimeout; WS read/write liveness is governed by the conn pumps
		// (ping/pong + per-write deadlines).
		IdleTimeout: 120 * time.Second,
	}

	go func() {
		log.Printf("listening on %s", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("serve: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	log.Println("shut down")
}
