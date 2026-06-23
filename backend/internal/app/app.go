package app

import (
	"go.uber.org/fx"
	"go.uber.org/fx/fxevent"
)

// Module is the full application dependency graph.
var Module = fx.Options(
	fx.Provide(
		provideConfig,
		provideAppContext,
		providePool,
		provideRedis,
		provideMinio,
		provideAuthService,
		provideChatService,
	),
	fx.Invoke(registerServer),
	// Keep our own log.Printf lines as the signal; silence fx's event log.
	fx.WithLogger(func() fxevent.Logger { return fxevent.NopLogger }),
)
