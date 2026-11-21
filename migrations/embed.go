// Package migrations embeds the MongoDB manifests this service applies.
//
// The manifests live next to this file so a compiled binary carries them: a
// container image needs no extra mount and `nanoworkspace migrate up` works in
// any environment the binary runs in.
package migrations

import "embed"

// FS holds every manifest, ordered by filename.
//
//go:embed *.json
var FS embed.FS

// Manifests returns every embedded manifest keyed by file name.
func Manifests() (map[string]string, error) {
	entries, err := FS.ReadDir(".")
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		raw, err := FS.ReadFile(e.Name())
		if err != nil {
			return nil, err
		}
		out[e.Name()] = string(raw)
	}
	return out, nil
}
