// Package config reads nanoworkspace's settings from the environment.
//
// The service is stateless: it holds no database and no files. Everything it
// answers is either a fact it asks another module (who owns this agent) or a
// request it puts on a container's tunnel.
package config

import (
	"os"
	"strings"
)

// Config is the resolved environment.
type Config struct {
	// Addr is the listen address (NANOSEC_WORKSPACE_ADDR, default ":8080").
	Addr string
	// JWKSURL is nanoauth's key set (NANOAUTH_JWKS_URL). Browser tokens are
	// verified here, so the service does not depend on the portal to tell it who
	// the caller is.
	JWKSURL string
	// PortalURL answers "who owns this agent" (the portal owns the rows).
	PortalURL string
	// ProvisionerURL terminates the hypervisor tunnels. The bus holds a
	// connection only for containers whose image predates the move, so it is the
	// second attempt.
	ProvisionerURL string
	BusURL         string
	// UIDir is the built front end this module contributes to the portal (served
	// at /plugins/workspace/). Empty disables it: the module still works, the portal
	// then shows its own page.
	UIDir string
	// InternalToken authenticates this service to the portal, the provisioner
	// and the bus. Empty means every call fails rather than travelling unauthenticated.
	InternalToken string
}

// Load reads the configuration from the environment.
func Load() Config {
	return Config{
		Addr:           env("NANOSEC_WORKSPACE_ADDR", ":8080"),
		JWKSURL:        env("NANOAUTH_JWKS_URL", "http://nanoauth:8081/auth/v1/.well-known/jwks"),
		PortalURL:      env("NANOSEC_PORTAL_URL", "http://nanoportal:80"),
		ProvisionerURL: env("NANOSEC_PROVISIONER_URL", "http://nanorunner:8080"),
		BusURL:         env("NANOSEC_BUS_URL", "http://nanobus:9000"),
		UIDir:          env("NANOSEC_WORKSPACE_UI_DIR", "/app/ui"),
		InternalToken:  os.Getenv("NANOSEC_BUS_INTERNAL_TOKEN"),
	}
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return strings.TrimRight(v, "/")
	}
	return fallback
}
