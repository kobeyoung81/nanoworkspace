// Command nanoworkspace serves the agent workspace surface: the file browser,
// previews and the git panel.
//
// It stores nothing. The bytes live in the agent container's volume, the agent
// rows belong to the portal, and the conversation socket to that container is
// terminated by the provisioner; this service verifies the caller, asks who owns
// the agent, and puts the request on the tunnel.
package main

import (
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"gitee.com/kobeyoung81/nanoworkspace/internal/agents"
	"gitee.com/kobeyoung81/nanoworkspace/internal/auth"
	"gitee.com/kobeyoung81/nanoworkspace/internal/config"
	"gitee.com/kobeyoung81/nanoworkspace/internal/server"
	"gitee.com/kobeyoung81/nanoworkspace/internal/tunnel"
)

// version is stamped at build time (see Dockerfile).
var version = "dev"

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "version":
			fmt.Println(version)
			return
		case "serve":
		default:
			fmt.Fprintf(os.Stderr, "usage: nanoworkspace [serve|version]\n")
			os.Exit(2)
		}
	}

	cfg := config.Load()
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
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("nanoworkspace stopped", "error", err)
		os.Exit(1)
	}
}
