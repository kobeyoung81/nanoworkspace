// Package config reads nanoworkspace's settings from the environment.
//
// The service owns one database: workspace_goals, the long-running goal rows.
// Everything else it answers is either a fact it asks another module (who owns
// this agent) or a request it puts on a container's tunnel — the conversation,
// the evidence and the files stay where they already live.
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
	// at /plugins/workspace/). Empty disables it: the API still works, and the
	// portal reports the page as unavailable — it keeps no copy of it.
	UIDir string
	// InternalToken authenticates this service to the portal, the provisioner
	// and the bus. Empty means every call fails rather than travelling unauthenticated.
	InternalToken string
	// AdminURL is the admin module's base URL (NANOSEC_ADMIN_URL). The goal
	// switch is read from its agent component; configuration belongs there.
	AdminURL string
	// MongoURI names the database this module owns (NANOSEC_WORKSPACE_MONGO_URI).
	// The database name is part of the URI; a deployment that omits it fails at
	// start-up instead of quietly writing into "test".
	MongoURI string
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
		MongoURI:       strings.TrimSpace(os.Getenv("NANOSEC_WORKSPACE_MONGO_URI")),
		AdminURL:       env("NANOSEC_ADMIN_URL", "http://nanoadmin:8080"),
	}
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return strings.TrimRight(v, "/")
	}
	return fallback
}
