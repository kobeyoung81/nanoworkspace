package store

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// The migration runner is deliberately smaller than the bus's: this service
// only ever needs indexes, so validators, partial filters and TTLs are refused
// by DisallowUnknownFields instead of half-implemented.

const migrationsCollection = "sys_migrations"

// migrationService scopes this service's records inside the shared
// sys_migrations collection (the bus writes its own there too).
const migrationService = "workspace"

// Migrate applies every manifest not yet recorded, in filename order.
//
// Creating an index that already exists is a no-op in MongoDB, so a manifest
// that is only half applied is repaired by the next run rather than failing.
func (s *Store) Migrate(manifests map[string]string) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	applied, err := s.appliedMigrations(ctx)
	if err != nil {
		return nil, err
	}

	var ran []string
	for _, name := range sortedNames(manifests) {
		if _, ok := applied[name]; ok {
			continue
		}
		spec, err := parseManifest(manifests[name])
		if err != nil {
			return ran, fmt.Errorf("migration %s: %w", name, err)
		}
		if err := s.applySpec(ctx, spec); err != nil {
			return ran, fmt.Errorf("migration %s: %w", name, err)
		}
		if _, err := s.db.Collection(migrationsCollection).InsertOne(ctx, bson.D{
			{Key: "_id", Value: migrationService + ":" + name},
			{Key: "service", Value: migrationService},
			{Key: "applied_at", Value: time.Now().UTC()},
		}); err != nil {
			return ran, fmt.Errorf("migration %s: record: %w", name, err)
		}
		ran = append(ran, name)
	}
	return ran, nil
}

func (s *Store) appliedMigrations(ctx context.Context) (map[string]time.Time, error) {
	cur, err := s.db.Collection(migrationsCollection).Find(ctx, bson.D{{Key: "service", Value: migrationService}})
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", migrationsCollection, err)
	}
	defer func() { _ = cur.Close(ctx) }()

	out := make(map[string]time.Time)
	for cur.Next(ctx) {
		var doc struct {
			ID        string    `bson:"_id"`
			AppliedAt time.Time `bson:"applied_at"`
		}
		if err := cur.Decode(&doc); err != nil {
			return nil, fmt.Errorf("decode migration record: %w", err)
		}
		out[strings.TrimPrefix(doc.ID, migrationService+":")] = doc.AppliedAt
	}
	return out, cur.Err()
}

func (s *Store) applySpec(ctx context.Context, spec manifest) error {
	names := make([]string, 0, len(spec.Collections))
	for name := range spec.Collections {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		indexes := spec.Collections[name].Indexes
		if len(indexes) == 0 {
			continue
		}
		models := make([]mongo.IndexModel, 0, len(indexes))
		for _, ix := range indexes {
			opts := options.Index()
			if ix.Name != "" {
				opts.SetName(ix.Name)
			}
			if ix.Unique {
				opts.SetUnique(true)
			}
			if ix.Sparse {
				opts.SetSparse(true)
			}
			models = append(models, mongo.IndexModel{Keys: ix.keys(), Options: opts})
		}
		if _, err := s.db.Collection(name).Indexes().CreateMany(ctx, models); err != nil {
			return fmt.Errorf("create indexes on %s: %w", name, err)
		}
	}
	return nil
}

type manifest struct {
	Collections map[string]collectionSpec `json:"collections"`
}

type collectionSpec struct {
	Indexes []indexSpec `json:"indexes"`
}

type indexSpec struct {
	Name   string   `json:"name,omitempty"`
	Keys   [][2]any `json:"keys"`
	Unique bool     `json:"unique,omitempty"`
	Sparse bool     `json:"sparse,omitempty"`
}

// keys converts the decoded pairs into the ordered bson.D the driver wants.
//
// JSON numbers arrive as float64 and the driver rejects them as index
// directions, so integers are narrowed to int32 here.
func (i indexSpec) keys() bson.D {
	out := make(bson.D, 0, len(i.Keys))
	for _, pair := range i.Keys {
		field, _ := pair[0].(string)
		switch v := pair[1].(type) {
		case float64:
			out = append(out, bson.E{Key: field, Value: int32(v)})
		case string:
			out = append(out, bson.E{Key: field, Value: v})
		}
	}
	return out
}

func parseManifest(raw string) (manifest, error) {
	var spec manifest
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&spec); err != nil {
		return spec, fmt.Errorf("manifest: %w", err)
	}
	if len(spec.Collections) == 0 {
		return spec, fmt.Errorf("manifest declares no collections")
	}
	for name, cs := range spec.Collections {
		for _, ix := range cs.Indexes {
			if len(ix.Keys) == 0 {
				return spec, fmt.Errorf("collection %s: index %q has no keys", name, ix.Name)
			}
		}
	}
	return spec, nil
}

func sortedNames(manifests map[string]string) []string {
	names := make([]string, 0, len(manifests))
	for name := range manifests {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
