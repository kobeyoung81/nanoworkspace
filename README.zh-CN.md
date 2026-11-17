# nanoworkspace

屏幕上的智能体工作区：文件浏览器、预览、git 面板，以及聊天工作台。

它是八个一级服务之一，而且**不存任何东西**。它验调用者、问门户这个智能体归谁，
然后通过容器的隧道把请求转过去。

## 它是什么

- **文件浏览器。** 列目录、读、写、改名、复制、删除、建目录 —— 都在智能体自己的卷里，不在数据库里。
- **预览。** Markdown、沙箱里的 HTML、图片、文本，以及智能体一轮对话产出的记录。
- **git 面板。** 状态、差异、分支与文件历史，走同一条隧道。
- **聊天工作台。** 对话界面本身，作为面板贡献给控制台，旁边是智能体列表。
- **没有状态。** 没有要迁的数据、没有要备份的东西：重启后按门户与容器重建。

## 它在哪

| | |
|---|---|
| 集合 | 无 |
| 端口 | 网络内 `8080`，浏览器经控制台的 nginx 从 `/api/user/v1/*` 与 `/api/v1/workspace/*` 进来 |
| 上游 | 浏览器，经控制台 |
| 下游 | `nanoprovisioner` —— 隧道在那里终止；镜像没更新的容器仍拨 `nanobus`，那是回退 |
| 读取 | `nanoportal`（这个智能体归谁）、`nanoauth`（调用者的令牌） |

## 快速开始

```bash
go build ./cmd/nanoworkspace
NANOSEC_PORTAL_URL="http://localhost:14403" \
NANOSEC_PROVISIONER_URL="http://localhost:14404" \
NANOAUTH_JWKS_URL="http://localhost:14401/auth/v1/.well-known/jwks" \
NANOSEC_BUS_INTERNAL_TOKEN="…" \
  ./nanoworkspace
```

别的都不需要：没有数据库要指，前端已经打进镜像。

## 配置

| 变量 | 含义 |
|---|---|
| `NANOSEC_WORKSPACE_ADDR` | 监听地址，默认 `:8080` |
| `NANOAUTH_JWKS_URL` | 校验调用者令牌用的公钥集 |
| `NANOSEC_PORTAL_URL` | 解析智能体归属的地方 |
| `NANOSEC_PROVISIONER_URL` | 隧道在哪儿终止（首选） |
| `NANOSEC_BUS_URL` | 镜像还没更新的容器用的隧道回退 |
| `NANOSEC_BUS_INTERNAL_TOKEN` | 所有内部面共用的密钥 |
| `NANOSEC_WORKSPACE_UI_DIR` | 挂在控制台插件路径下的前端产物 |

## API

| 面 | 做什么 |
|---|---|
| `GET …/files/{agentID}` | 目录列表 |
| `GET` / `PUT` / `DELETE …/files/{agentID}/content` | 读、写、删一个文件 |
| `POST …/files/{agentID}/mkdir`、`/rename`、`/copy` | 文件操作 |
| `GET /healthz` | 存活 |

同一套 handler 挂在两个前缀上：`/api/user/v1/*`（控制台的历史前缀）与
`/api/v1/workspace/*`（模块前缀）。在容器内，hypervisor 以 `/api/v1` 应答。

## 设计决策

- **刻意不存数据。** 它显示的一切都在容器卷或门户里；这个服务只做校验与转发，所以加副本就能扩。
- **隧道在 provisioner 终止。** 总线那个端点只留给镜像还没更新的容器；隧道回 404 时才落到它。
- **一套 handler，两个前缀。** 历史前缀 `/api/user/v1` 保留着，旧版控制台在模块前缀铺开前还能用。
- **先验令牌，再转发。** 智能体归谁只从门户问，绝不从请求体里取。

## 文档

- [`docs/ARCHITECTURE.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/docs/ARCHITECTURE.md) —— 它所在的整个平台
- [`docs/DEPLOYMENT.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/docs/DEPLOYMENT.md) —— 端口、隧道与运维
- [`docs/README.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/docs/README.md) —— 全部文档索引

## 状态

随 `v0.1.0` 发布；本模块的版本钉在超仓的 `versions.lock` 里。

## 贡献与安全

开发与提交规则见
[`CONTRIBUTING.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/CONTRIBUTING.md)；
漏洞请按
[`SECURITY.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/SECURITY.md) 私下报告，
不要开公开 issue。

## 许可证

[AGPL-3.0](./LICENSE)。名称与标志另有说明 —— 见 [`NOTICE`](./NOTICE)。
