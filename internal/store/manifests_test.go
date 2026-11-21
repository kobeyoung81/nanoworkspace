package store

import "gitee.com/kobeyoung81/nanoworkspace/migrations"

// manifestsForTest loads the embedded manifests the production binary applies,
// so the integration tests exercise the same index set the deployment creates.
func manifestsForTest() (map[string]string, error) {
	return migrations.Manifests()
}
