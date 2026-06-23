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
	"github.com/messenger-denis/backend/internal/messaging"
	"github.com/messenger-denis/backend/internal/realtime"
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
		chatSvc.SetPublisher(realtime.NewRedisPublisher(rdb))
		hub := ws.NewHub(ctx, rdb)
		defer hub.Close()
		wsHandler = ws.NewHandler(hub, authSvc, chatSvc)
		log.Printf("session cache + realtime enabled (redis)")
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           httptransport.NewRouter(authSvc, chatSvc, wsHandler),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		// WriteTimeout intentionally omitted (0): it would terminate long-lived
		// WS connections. Per-write deadlines in the write pump bound writes.
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
