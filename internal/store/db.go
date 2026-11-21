// Package store owns nanoworkspace's MongoDB database: one collection,
// workspace_goals, holding the long-running goals and their round summaries.
//
// Nothing else opens this database. The conversation, the evidence and the
// files stay where they already live (the portal's session rows and the agent
// container's volume); this service writes only the goal state it must survive
// a restart with. The bus and the admin module own their own databases and are
// joined to this one by HTTP, never by a shared connection.
package store

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// Store is the handle the rest of the service uses.
type Store struct {
	client *mongo.Client
	db     *mongo.Database
}

// Open connects and verifies the connection before returning.
//
// The database name is taken from the URI path on purpose: a deployment that
// forgets it would otherwise land in "test" and look healthy.
func Open(ctx context.Context, uri string) (*Store, error) {
	name, err := databaseFromURI(uri)
	if err != nil {
		return nil, err
	}

	connectCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	client, err := mongo.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	if err := client.Ping(connectCtx, nil); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, fmt.Errorf("ping %s: %w", name, err)
	}
	return &Store{client: client, db: client.Database(name)}, nil
}

// Close releases the connection pool.
func (s *Store) Close(ctx context.Context) error { return s.client.Disconnect(ctx) }

// DB exposes the database for the migration runner and the goal repository.
func (s *Store) DB() *mongo.Database { return s.db }

// databaseFromURI reads the path component of a mongodb:// URI.
func databaseFromURI(uri string) (string, error) {
	u, err := url.Parse(uri)
	if err != nil {
		return "", fmt.Errorf("parse mongo uri: %w", err)
	}
	name := strings.Trim(strings.TrimPrefix(u.Path, "/"), " ")
	if name == "" {
		return "", fmt.Errorf("mongo uri must name a database (mongodb://host:port/<db>)")
	}
	return name, nil
}
