package server

// Version is the release tag this binary was built from, stamped at build time
// with -X. /healthz reports it so an operator can tell which build a container
// runs without inspecting image labels.
var Version = "dev"
