# 授权交接可观测性运行手册

> 状态：Lovart 已产生所需的最小化结构化日志；仪表盘与告警策略待 observability owner 在批准的日志后端创建。

## 数据边界

Lovart 的 `/api/telemetry/auth-transfer` 只接受并记录 `entryPoint`、`state`、`durationMsBucket` 和 tab scoped 的随机 `flowId`。它不接收用户标识、邮箱、URL query、OIDC code、cookie 或 IP。`requestId` 仅用于将单次 API 请求与服务端日志关联，不得作为 dashboard group-by label。

还会记录：

| 事件 | 字段 | 用途 |
| --- | --- | --- |
| `auth_transfer_viewed` | `entryPoint`、`state`、`durationMsBucket`、`flowId`、`requestId` | 本 tab 授权漏斗及耗时 bucket。 |
| `auth_transfer_telemetry_rejected` | `failureCategory` = `invalid_auth_transfer_event` 或 `auth_transfer_rate_limited` | 输入滥用与限流观测。不得附加 limiter key 或 IP。 |
| `auth_transfer_telemetry_redis_ready` | 无 | 共享 Redis limiter 在本实例启动时已就绪。 |
| `server_startup_failed` | 安全错误摘要 | Redis 或其他启动依赖使实例未进入健康流量。 |
| `websocket_connection_rejected` | `failureCategory=invalid_websocket_auth` | 发现不带有效 subprotocol、携带 query 或无效连接 ID 的实时连接请求；不得记录 token、query 或 protocol 值。 |

禁止以 `flowId`、`requestId`、IP、cookie、SSO subject 或完整回跳 URL 作为持久化标签。`flowId` 只可用于同一 tab 的短时漏斗 join；不得跨 session 或跨 24 小时关联用户。

## 仪表盘

在日志管道为上述事件建立 logs-based metrics 后，创建名为 `Lovart / Auth Transfer` 的 dashboard。所有比例面板都必须显示分母，样本不足时显示 `insufficient sample`，不要用 0% 表示没有流量。

| 面板 | 查询定义 | 分组 | 目的 |
| --- | --- | --- | --- |
| 交接请求量 | `count(auth_transfer_viewed where state=intent_started)` | `entryPoint` | 识别入口流量突变。 |
| 终态分布 | `count(auth_transfer_viewed where state in terminal states)` | `state`、`entryPoint` | 区分授权取消、本地 callback、交换与服务失败。 |
| 授权完成率 | `authorized terminal flows / intent_started flows`，同一 `flowId` 仅在短时窗口内 join | `entryPoint` | 只反映单 tab 交接，不推断用户留存。 |
| 时延 bucket | `count(auth_transfer_viewed where state in terminal states)` | `durationMsBucket`、`entryPoint` | 以 `over_10s` 比例判断外部 SSO 或网络退化；bucket 数据不能伪装成精确 p95。 |
| 遥测拒绝 | `count(auth_transfer_telemetry_rejected)` | `failureCategory` | 发现 schema 探测和匿名日志洪泛。 |
| Redis 启动健康 | `count(auth_transfer_telemetry_redis_ready)` 与 `count(server_startup_failed)` | `failureCategory`（仅后者） | 验证有 `REDIS_URL` 的实例没有带病进入流量。 |
| WebSocket 鉴权拒绝 | `count(websocket_connection_rejected)` | `failureCategory` | 发现旧 URL token 客户端、proxy 丢失 subprotocol 或异常连接尝试。 |

终态包括 `authorized`、`callback_invalid`、`cancelled`、`exchange_failed`、`service_unavailable`、`timeout` 和 `viewer_bootstrap_failed`；`checking` 与 `intent_started` 不是终态。仪表盘读取的是平台日志管道，不得直接调用浏览器 beacon 或 Redis。

## 告警策略

先采集连续 7 天基线，再由 owner 将下列初始候选阈值写入告警平台并记录变更原因。阈值使用事件数和比例双门槛，以避免低流量误报。

| 告警 | 初始触发条件 | 窗口 | 路由 | 首次处置 |
| --- | --- | --- | --- | --- |
| 授权完成率下降 | 至少 20 个 intent，且完成率低于 97% | 15 分钟 | SSO + Lovart on-call | 对照 provider 状态、callback 失败类别和最近发布。 |
| SSO/服务不可用 | `service_unavailable` 至少 3 次，或终态占比超过 3% 且终态至少 20 个 | 5/15 分钟 | Lovart on-call | 检查 `server_startup_failed`、OIDC provider、ingress 与 secret 版本。 |
| 交接明显变慢 | `over_10s` 终态至少 5 次且占比超过 10% | 30 分钟 | Lovart on-call（低优先级） | 比较 SSO authorize/token 时延与网络/CDN 指标。 |
| 遥测端点被滥用 | `auth_transfer_rate_limited` 至少 20 次 | 5 分钟 | Security/on-call | 检查 WAF、入口流量与日志量；不要导出 IP 到产品分析。 |
| Redis 阻止启动 | 任一 `server_startup_failed` 与 Redis readiness/connection 分类匹配 | 5 分钟 | Platform on-call | 检查受管 Redis DNS、TLS CA、ACL、网络策略和 `REDIS_URL` secret。 |
| WebSocket 鉴权异常 | `websocket_connection_rejected` 至少 20 次 | 5 分钟 | Lovart on-call | 检查 Web 发布版本、Nginx/ingress `Sec-WebSocket-Protocol` 转发和异常连接来源。 |

上线后第 7 天复核一次阈值；第 30 天再根据真实流量收紧。没有正常流量时不要为“没有 `auth_transfer_viewed`”创建告警，因为公开站点本身可能没有认证访问。

## 上线交接清单

1. Platform 将受管 Redis 的 TLS URL 作为 `REDIS_URL` 注入 API 实例，并保持 `LOVART_DOFE_REQUIRE_REDIS=true`；验证实例启动时有 `auth_transfer_telemetry_redis_ready`，失败实例不应通过健康检查。
2. Observability owner 将上述四种事件接入批准的日志管道，原始事件保留期和 tab scoped `flowId` 的短时 join 期限须经隐私 owner 书面确认。
3. 依照本文件建 dashboard、告警路由和 runbook 链接，先记录 7 天基线，再启用告警。
4. CI runner 必须能拉取 `node:22-alpine`、`node:25-alpine` 与 `nginx:1.27-alpine`，并能访问 `https://registry.npmjs.org`；首次运行 `quality-gates` 的 Compose smoke 后保留 workflow URL 和失败日志作为网络验收记录。
5. `sso-e2e` GitHub Environment 已创建；在首次 dispatch 前配置两个 variables 和五个 non-production secrets，并由 environment protection 限制可使用它的分支/审核者。

所需 variables：`E2E_BASE_URL`、`E2E_SSO_ORIGIN`。

所需 secrets：`E2E_SSO_USERNAME`、`E2E_SSO_PASSWORD`、`E2E_SSO_USERNAME_SELECTOR`、`E2E_SSO_PASSWORD_SELECTOR`、`E2E_SSO_SUBMIT_SELECTOR`。
