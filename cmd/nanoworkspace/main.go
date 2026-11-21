// Command nanoworkspace serves the agent workspace surface: the file browser,
// previews, the git panel and the long-running goals.
//
// The bytes live in the agent container's volume, the agent rows belong to the
// portal, and the conversation socket to that container is terminated by the
// provisioner; this service verifies the caller, asks who owns the agent, and
// puts the request on the tunnel. The one thing it owns itself is
// workspace_goals: goal state must survive a restart of both this service and
// the agent container.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"gitee.com/kobeyoung81/nanoworkspace/internal/agents"
	"gitee.com/kobeyoung81/nanoworkspace/internal/auth"
	"gitee.com/kobeyoung81/nanoworkspace/internal/config"
	"gitee.com/kobeyoung81/nanoworkspace/internal/server"
	"gitee.com/kobeyoung81/nanoworkspace/internal/store"
	"gitee.com/kobeyoung81/nanoworkspace/internal/tunnel"
	"gitee.com/kobeyoung81/nanoworkspace/migrations"
)

// version is stamped at build time (see Dockerfile).
var version = "dev"

func main() {
	server.Version = version
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "version":
			fmt.Println(version)
			return
		case "migrate":
			if len(os.Args) < 3 || os.Args[2] != "up" {
				usage()
			}
			if err := migrate(); err != nil {
				slog.Error("migrate failed", "error", err)
				os.Exit(1)
			}
			return
		case "serve":
		default:
			usage()
		}
	}

	if err := serve(); err != nil {
		slog.Error("nanoworkspace stopped", "error", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, "usage: nanoworkspace [serve|migrate up|version]\n")
	os.Exit(2)
}

// openStore connects and applies pending manifests. Both entry points call it:
// there is no init container for this database, and a missing index must not be
// a runtime surprise on the first scheduler tick.
func openStore(ctx context.Context, cfg config.Config) (*store.Store, error) {
	if cfg.MongoURI == "" {
		return nil, fmt.Errorf("NANOSEC_WORKSPACE_MONGO_URI is required")
	}
	st, err := store.Open(ctx, cfg.MongoURI)
	if err != nil {
		return nil, err
	}
	manifests, err := migrations.Manifests()
	if err != nil {
		_ = st.Close(context.Background())
		return nil, fmt.Errorf("read manifests: %w", err)
	}
	ran, err := st.Migrate(manifests)
	if err != nil {
		_ = st.Close(context.Background())
		return nil, fmt.Errorf("migrate: %w", err)
	}
	if len(ran) > 0 {
		slog.Info("migrations applied", "count", len(ran), "names", ran)
	}
	return st, nil
}

func migrate() error {
	cfg := config.Load()
	ctx := context.Background()
	st, err := openStore(ctx, cfg)
	if err != nil {
		return err
	}
	return st.Close(ctx)
}

func serve() error {
	cfg := config.Load()
	ctx := context.Background()

	st, err := openStore(ctx, cfg)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close(context.Background()) }()

	slog.Info("starting nanoworkspace", "addr", cfg.Addr, "portal", cfg.PortalURL, "provisioner", cfg.ProvisionerURL)

	srv := server.New(
		cfg.Addr,
		auth.NewValidator(cfg.JWKSURL),
		agents.New(cfg.PortalURL, cfg.InternalToken),
		tunnel.New(cfg.ProvisionerURL, cfg.BusURL, cfg.InternalToken),
		cfg.UIDir,
	)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		sig := <-sigCh
		slog.Info("shutting down", "signal", sig)
		_ = srv.Shutdown()
	}()

	slog.Info("nanoworkspace listening", "addr", cfg.Addr, "version", version)
	return srv.ListenAndServe()
}
