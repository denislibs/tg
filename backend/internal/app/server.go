package app

import (
	"context"
	"log"
	"net"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	rtredis "github.com/messenger-denis/backend/internal/adapter/realtime/redis"
	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/config"
	"github.com/messenger-denis/backend/internal/push"
	httptransport "github.com/messenger-denis/backend/internal/transport/http"
	"github.com/messenger-denis/backend/internal/transport/ws"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
	usecasepresence "github.com/messenger-denis/backend/internal/usecase/presence"
	"go.uber.org/fx"
)

// serverParams are the dependencies the assembler pulls from the fx graph.
type serverParams struct {
	fx.In

	LC      fx.Lifecycle
	Cfg     *config.Config
	Ctx     context.Context
	Pool    *pgxpool.Pool
	Redis   RedisResult
	Minio   MinioResult
	AuthUC *usecaseauth.Interactor
	ChatUC *usecasechat.Interactor
}

// registerServer wires the (optional) realtime/push/media features onto the
// services, builds the router + HTTP server, and registers lifecycle hooks.
// This mirrors the previous main.go assembly; later slices decompose it.
func registerServer(p serverParams) {
	var wsHandler http.Handler
	if p.Redis.OK {
		p.AuthUC.SetCache(redisSessionCache(p.Redis))
		publisher := rtredis.NewRedisPublisher(p.Redis.Client)
		p.ChatUC.SetPublisher(publisher)
		p.AuthUC.SetRevocationNotifier(publisher)
		presenceMgr := usecasepresence.NewManager(rtredis.NewPresenceStore(p.Redis.Client), publisher, p.ChatUC.ChatPartners, 35*time.Second)
		hub := ws.NewHub(p.Ctx, p.Redis.Client)
		p.LC.Append(fx.Hook{OnStop: func(context.Context) error { return hub.Close() }})
		wsHandler = ws.NewHandler(hub, p.AuthUC, p.ChatUC, presenceMgr)
		log.Printf("session cache + realtime + presence enabled (redis)")
	}

	var pushHandler *httptransport.PushHandler
	if p.Redis.OK && p.Cfg.VAPIDPublicKey != "" && p.Cfg.VAPIDPrivateKey != "" {
		pushSvc := push.NewService(p.Redis.Client, p.Pool)
		p.ChatUC.SetNotifier(pushSvc)
		sender := push.NewWebPushSender(p.Cfg.VAPIDPublicKey, p.Cfg.VAPIDPrivateKey, p.Cfg.VAPIDSubject)
		worker := push.NewWorker(p.Redis.Client, p.Pool, sender)
		p.LC.Append(fx.Hook{OnStart: func(context.Context) error { go worker.Run(p.Ctx); return nil }})
		pushHandler = httptransport.NewPushHandler(push.NewRepo(p.Pool), p.Cfg.VAPIDPublicKey)
		log.Printf("web push enabled")
	} else {
		log.Printf("web push disabled (needs redis + VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)")
	}

	var mediaHandler *httptransport.MediaHandler
	if p.Minio.OK {
		mediaUC := usecasemedia.New(pgadapter.NewMediaRepo(p.Pool), p.Minio.Client)
		mediaHandler = httptransport.NewMediaHandler(mediaUC, p.ChatUC)
		log.Printf("media enabled (minio bucket %q)", p.Cfg.MinioBucket)
	}

	srv := &http.Server{
		Addr:              p.Cfg.HTTPAddr,
		Handler:           httptransport.NewRouter(p.AuthUC, p.ChatUC, wsHandler, mediaHandler, pushHandler),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	p.LC.Append(fx.Hook{
		OnStart: func(context.Context) error {
			ln, err := net.Listen("tcp", srv.Addr)
			if err != nil {
				return err
			}
			go func() {
				if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
					log.Fatalf("serve: %v", err)
				}
			}()
			log.Printf("listening on %s", p.Cfg.HTTPAddr)
			return nil
		},
		OnStop: func(ctx context.Context) error { return srv.Shutdown(ctx) },
	})
}

// redisSessionCache is a tiny helper so server.go doesn't import redisstore twice.
func redisSessionCache(r RedisResult) usecaseauth.SessionCache {
	return newSessionCache(r.Client)
}
