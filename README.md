# nanoworkspace

The agent's workspace on screen: the file browser, the previews, the git panel and
the chat workbench.

It is one of the eight first-class services and it **stores nothing**. It verifies
the caller, asks the portal who owns the agent, and forwards the request through the
container's tunnel.

## What it is

- **A file browser.** List, read, write, rename, copy, delete and make directories —
  in the agent's own volume, not in a database.
- **Previews.** Markdown, HTML in a sandboxed frame, images, text, and the records
  that come out of an agent's turn.
- **A git panel.** Status, diff, branches and file history, read through the same
  tunnel.
- **The chat workbench.** The conversation surface itself, contributed to the console
  as a panel, with the agent list beside it.
- **No state.** Nothing to migrate, nothing to back up: restart it and reconnects
  rebuild from the portal and the container.

## Where it sits

| | |
|---|---|
| Collections | none |
| Port | `8080` in the network, reached through the console's nginx at `/api/user/v1/*` and `/api/v1/workspace/*` |
| Upstream | the browser, through the console |
| Downstream | `nanoprovisioner` — tunnels terminate there; `nanobus` is the fallback while a container still dials it |
| Reads from | `nanoportal` (who owns this agent), `nanoauth` (the caller's token) |

## Quick start

```bash
go build ./cmd/nanoworkspace
NANOSEC_PORTAL_URL="http://localhost:14403" \
NANOSEC_PROVISIONER_URL="http://localhost:14404" \
NANOAUTH_JWKS_URL="http://localhost:14401/auth/v1/.well-known/jwks" \
NANOSEC_BUS_INTERNAL_TOKEN="…" \
  ./nanoworkspace
```

Nothing else is needed: there is no database to point at, and the front end is built
into the image.

## Configuration

| Variable | Meaning |
|---|---|
| `NANOSEC_WORKSPACE_ADDR` | Listen address, default `:8080` |
| `NANOAUTH_JWKS_URL` | Key set for validating the caller's token |
| `NANOSEC_PORTAL_URL` | Where an agent's owner is resolved |
| `NANOSEC_PROVISIONER_URL` | Where tunnels terminate (first choice) |
| `NANOSEC_BUS_URL` | Tunnel fallback for containers not yet on the new image |
| `NANOSEC_BUS_INTERNAL_TOKEN` | Shared secret for every internal surface |
| `NANOSEC_WORKSPACE_UI_DIR` | Built front end to serve under the console's plugin path |

## API

| Surface | What it does |
|---|---|
| `GET …/files/{agentID}` | Directory listing |
| `GET` / `PUT` / `DELETE …/files/{agentID}/content` | Read, write, remove a file |
| `POST …/files/{agentID}/mkdir`, `/rename`, `/copy` | File operations |
| `GET /healthz` | Liveness |

Two mounts serve the same handlers: `/api/user/v1/*` (the historical console prefix)
and `/api/v1/workspace/*` (the module prefix). Inside the container the hypervisor
answers them under `/api/v1`.

## Design decisions

- **It holds no data, on purpose.** Everything it shows lives in the container's
  volume or in the portal; this service is a verifier and a forwarder, so it scales
  by adding replicas.
- **Tunnels terminate at the provisioner.** The bus endpoint stays only for
  containers whose image predates the move; when the tunnel answers 404, the request
  falls through to it.
- **One handler set, two prefixes.** The historical `/api/user/v1` mount stays so an
  older console keeps working while the module prefix rolls out.
- **The token is verified, then forwarded.** The agent's owner comes from the portal,
  never from the request body.

## Docs

- [`docs/ARCHITECTURE.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/docs/ARCHITECTURE.md) — the platform around this module
- [`docs/DEPLOYMENT.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/docs/DEPLOYMENT.md) — ports, tunnels and operations
- [`docs/README.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/docs/README.md) — every document

## Status

Released as part of `v0.1.0`; the version of this module is pinned in the
super-repo's `versions.lock`.

## Contributing and security

[`CONTRIBUTING.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/CONTRIBUTING.md)
for setup and commit rules; report vulnerabilities privately through
[`SECURITY.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/SECURITY.md), never
in a public issue.

## License

[AGPL-3.0](./LICENSE). The name and logo are covered separately — see
[`NOTICE`](./NOTICE).
