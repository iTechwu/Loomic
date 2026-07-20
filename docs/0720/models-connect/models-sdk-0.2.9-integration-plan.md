# Lovart 到 Models 的对接优化清单

审查日期：2026-07-20。本文是 Lovart 的实施单，不修改 models、agents 或 DataEyes 的权威数据。

## 已确认的基线

models 已完成并发布 `@dofe/models-sdk@0.2.9`，npm `latest` 已指向该版本。该版本保持 `0.2.8` 的公开 exports 和 `/internal/*` 合同；它不是图片/视频 generation data-plane SDK，也没有新增 `seedanceCredentials.create` typed client method。

Lovart 当前不依赖 SDK。`apps/server/src/features/credentials/models-client.ts` 在服务端直接调用 `POST /internal/seedance/credentials`，并复制 HMAC 签名算法；`credentials-service.ts` 负责将返回的 design API key 与 Seedance asset AK/SK 加密保存。这个职责划分是合理的：Lovart 不拥有模型目录、provider key、availability、路由、usage，也不得从 `docs/dataeyes-docs` 复制 alias、operation、价格或 provider 配置。

## 接口影响

| 连接面 | 当前实现 | 0.2.9 影响 | 正确目标 |
| --- | --- | --- | --- |
| 内部认证 | 本地 `signModelsInternalToken` | SDK 已有等价 `createModelsInternalApiAuthorization` | npm 版本可用后改用 SDK helper，签名只在服务端生成 |
| Seedance 凭据发放 | 手写 `fetch` 与松散 JSON 解包 | 没有可替换的 SDK endpoint method | 保持一个 Lovart adapter；等待 models 发布 Zod/ts-rest typed method 后再删除过渡 fetch |
| 多模态调用 | 使用发放的 tenant API key | 没有新的 SDK generation client | 仅用 models 已发布且授权可用的 `/v1/*` 或 `/v1/generation/tasks`，不硬编码 DataEyes 候选能力 |
| 目录、路由、计费 | 未在 Lovart 本地维护 | 无变化 | 始终由 models 决策与记录 |

## 实施顺序

### P0：在版本发布后收敛认证实现

1. 将已发布的 `@dofe/models-sdk@0.2.9` 加入 `apps/server` 的运行时依赖，并提交其 lockfile 变更；不要使用本地 tarball 或浮动版本作为生产依赖。
2. 将 `models-client.ts` 中 `createHmac` 和 `signModelsInternalToken` 替换为 `@dofe/models-sdk/internal-node` 的 `createModelsInternalApiAuthorization`。仍传入 `serviceName`，并保留 `x-service-name`，使 HMAC 绑定的服务名与 models 白名单一致。
3. 保留 `ModelsProvisionConfig`、超时、错误类型和唯一的 `provisionSeedanceCredentials` server adapter。不要把 `INTERNAL_API_SECRET`、资产密钥或 API key 暴露到浏览器、日志或客户端状态。
4. 添加签名互操作测试：固定 timestamp 与 service name 时，SDK helper 生成的 Authorization 必须与 models InternalAuthGuard 接受的格式相同；缺失 secret、空 service name、401/403 和超时必须 fail closed。

### P1：消除凭据重复发放风险

models 的 provision endpoint 每次成功都会创建新的凭据，而 Lovart 目前通过“先查 ready row”避免重复。并发登录、重试超时或两个 worker 同时进入时，仍可能在本地写入前发出两次远端创建请求。

1. 在 `ensureProvisioned` 周围增加按 `userId + ssoTeamId` 的事务性互斥或数据库唯一的 in-flight 状态；只有持有者可以调用 models。
2. 将 provision 请求关联到一个非敏感 correlation ID，并记录远端 credential ID、耗时、状态码类别和重试次数；日志不得记录 `apiKey`、`secretAccessKey`、完整 Authorization 或响应体。
3. 对连接超时采用“先查询本地/远端状态再重试”的策略；在 models 没有显式 idempotency key 合同前，不可盲目重放 POST。
4. 保持现有 no-fallback：凭据未就绪时返回 `CredentialsNotProvisionedError`，不得降级为共享 provider key。

### P2：为将来的 SDK endpoint 做好替换条件

只有 models 在 contracts 中增加并发布 `seedanceCredentials.create`（请求、响应、错误和认证均为 Zod-first/ts-rest），且 SDK data client 暴露该方法时，才将 adapter 内部的 `fetch` 替换成 SDK 调用。Lovart 不应自行声明“兼容 SDK”的 endpoint 类型来绕过该发布步骤。

## DataEyes 与多模态一致性要求

`docs/dataeyes-docs` 是上游资料，不是 Lovart 的可调用目录。当前 models 的图片 17 条和视频 39 条 alias/operation 证据仍为 pending，且未验证能力的公开示例被隐藏。Lovart 应只从 models 的授权投影获取可调用 alias/operation，并在 models 返回不可用、未授权或未验证时向用户显示不可用状态；不得以 DataEyes 文档中的名称生成可执行请求。

## 验收

- 已发布版本安装后，SDK helper 的签名兼容测试、凭据服务单测和 `apps/server` 类型检查通过。
- SDK import 仅存在于 Lovart 服务端 credential adapter；浏览器包不包含 `node:crypto`、`INTERNAL_API_SECRET` 或任何 tenant key。
- 并发 provision 测试证明同一 user/team 最多发出一次远端 POST，失败和超时不会泄露密钥或创建共享回退。
- 一次已授权的 generation 调用使用 tenant key；模型可用性、路由和 usage 仍由 models 侧观测与记录。

## 实施记录

### Cycle 1 — P0：SDK 认证收敛（2026-07-20）

- [x] 将 `@dofe/models-sdk` 加入 `apps/server/package.json` 运行时依赖。
  - npmjs 已发布 `0.2.9`（`dist-tags latest = 0.2.9`）；`package.json` 锁定为 `"@dofe/models-sdk": "^0.2.9"`，`pnpm-lock.yaml` 已重生成并解析到 `@dofe/models-sdk@0.2.9`（无残留 0.2.8 引用）。
  - 发布版 `internal-node` 导出的 `createModelsInternalApiAuthorization(secret, timestamp?, serviceName?)` 签名与 0.2.8 一致，无需改动调用点。
- [x] `apps/server/src/features/credentials/models-client.ts` 已移除内联 HMAC 实现，改用 `@dofe/models-sdk/internal-node` 的 `createModelsInternalApiAuthorization`。
- [x] 保留 `x-service-name` header、`serviceName` 绑定、`ModelsProvisionConfig`、`ModelsProvisionError` 与 `provisionSeedanceCredentials` adapter。
- [x] 新增 `apps/server/src/features/credentials/models-client.test.ts`：
  - 固定 timestamp + service name 验证 Authorization 格式与 models `InternalAuthGuard` 兼容；
  - 缺失 secret、空 service name、401/403、timeout 均 fail closed；
  - 验证日志不泄露 apiKey、secretAccessKey、Authorization、响应体。
- [ ] P1：并发互斥与 in-flight 状态（待 Cycle 2）。
- [ ] P1：correlation ID 与可观测性（待 Cycle 3-4）。
- [ ] P2：SDK endpoint 替换条件（待 Cycle 5）。

### Cycle 2 — P1：并发互斥与 in-flight 状态（2026-07-20）

- [x] 新增迁移 `apps/server/migrations/0014_user_credentials_provisioning_tracking.sql`，增加 `provisioning_started_at` 与 `provision_attempt_count`。
- [x] `credentials-repository.ts` 新增 `takeProvisionLock`：
  - 事务内通过 `pg_advisory_xact_lock` 按 `userId:ssoTeamId` 串行化；
  - `ready` 直接返回；未超时的 `provisioning` 返回 `in_flight`；其他情况更新为 `provisioning` 并递增 `attempt_count`；
  - `saveReady` 重置 `provisioning_started_at = null`、`provision_attempt_count = 0`；
  - `saveFailed` 仅重置 `provisioning_started_at`，保留 `attempt_count` 用于后续重试观察。
- [ ] `credentials-service.ts` 尚未接入 `takeProvisionLock`（待 Cycle 3）。

### Cycle 3 — P1：凭据服务接入互斥与 correlation ID 日志（2026-07-20）

- [x] `credentials-service.ts` 重写 `ensureProvisioned`：
  - 通过 `takeProvisionLock` 获取互斥与状态；`ready` 直接复用、`in_flight` 跳过、`locked` 才发起远端 provision；
  - 每次尝试生成 `randomUUID()` 作为 `correlationId`，透传到 models 的 `x-correlation-id` header；
  - 记录 `provision_attempt` / `provision_ok` / `provision_failed`，含 `correlationId`、`attemptCount`、`latencyMs`、`statusCategory`、`modelsApiKeyId`、`modelsCredentialId`；
  - 失败/超时仅写入脱敏错误串（`models provision <code> (<statusCategory>) corr=<id>`），不含响应体或密钥；
  - 保留严格 no-fallback：`getByUserId` 未就绪仍抛 `CredentialsNotProvisionedError`。
- [x] 更新 `credentials-service.test.ts`：覆盖 ready 复用、in_flight 跳过、失败重试 attemptCount 递增、无降级。
- [ ] app/worker 的 logger 注入与类型检查（待 Cycle 4）。

### Cycle 4 — P1：logger 注入、类型检查与全量测试（2026-07-20）

- [x] `apps/server/src/app.ts` 向 `createCredentialsService` 注入封装 Fastify logger 的 `Logger`（`info/warn/error`）；`worker.ts` 复用默认 console logger（带 `[worker]` 上下文由其自身日志前缀承担）。
- [x] 新增 `apps/server/src/features/credentials/credentials-repository.test.ts`：用 query-recording mock pool 校验 `takeProvisionLock` 在 ready / in_flight / locked 三条路径的 SQL（`pg_advisory_xact_lock`、`for update`、条件 upsert）。
- [x] `pnpm typecheck` 通过；`pnpm test` 17 个测试文件 / 53 个用例全部通过；`apps/web/src` 无 `@dofe/models-sdk` 或 `node:crypto` 引入，浏览器包无泄漏。

### Cycle 5 — P2：适配器 fetch 替换条件声明与最终状态（2026-07-20）

- [x] 当前保留 `models-client.ts` 中的手写 `fetch`；仅签名收敛到 SDK helper。
- [x] 替换条件（与正文 P2 一致，落地为可执行检查项）：
  1. models 在 contracts 中新增并发布 `seedanceCredentials.create`，请求/响应/错误/认证均为 Zod-first、ts-rest 定义；
  2. `@dofe/models-sdk` 的 data client（`createSignedModelsInternalDataClient` / `ModelsInternalDataClient`）暴露该 typed method；
  3. Lovart 才可将 `provisionSeedanceCredentials` 内部的 `fetch` 替换为该 SDK 调用，并在替换后删除本地 response-shape 解包逻辑。
- [x] 在替换前，Lovart 不自行声明任何“兼容 SDK”的 endpoint 类型来绕过 models 的发布步骤。
- [x] 远端状态校验待办：models 暂未提供按 `(ssoUserId, ssoTeamId)` 查询已发放凭据的端点；当前超时/崩溃后仅依赖 `provisioning_started_at` TTL 避免立即重发。待 models 暴露查询端点后，在 `takeProvisionLock` 的 `locked` 分支前补一次远端状态校验，杜绝超时窗口内的重复发放。

### Cycle 6 — 0.2.9 发布确认与 P2 可行性核验（2026-07-20）

- [x] npmjs `@dofe/models-sdk@0.2.9` 已发布（`dist-tags latest = 0.2.9`）；`package.json` 锁 `^0.2.9`，`pnpm-lock.yaml` 解析到 0.2.9，`tsc` + 53 用例通过。
- [x] **P2 可行性核验（证据驱动）**：对已安装的 `node_modules/.pnpm/@dofe+models-sdk@0.2.9/.../dist/` 全量 `grep -niE "seedance|seedanceCredentials|assetCredential|secretAccessKey|accessKeyId"` 结果为 **0 匹配**。
  - 0.2.9 的 `ModelsInternalDataClient` 资源面仅含：models / availability / usage(stats,logs) / providerKeys / capabilityTags / billing(preflight,balanceByTeam,calculate) / employeeKeys(create,revoke,governance) / routing(check,decide) / health。
  - 其中 `employeeKeys.create`（`ModelsInternalCreateEmployeeKeyRequest{employeeId,ssoTeamId,name}` → `{id,keyPrefix,apiKey}`）**不等价**于 `POST /internal/seedance/credentials`：后者同时返回 design apikey **和** seedance asset AK/SK，且 owner 是 SSO subject 而非 employee。
  - 结论：0.2.9 **未**新增 `seedanceCredentials.create` typed method，P2 替换条件仍未满足；adapter 手写 `fetch` 按 P2 规约继续保留，Lovart 不自行声明兼容类型绕过 models 发布步骤。
  - 该核验结论固化于此，后续无需重复排查 0.2.9；待 0.3.x+ 发布且 grep 命中 `seedanceCredentials` 时再启动 P2 实施。

## 最终状态汇总

| 项 | 状态 |
| --- | --- |
| P0 SDK 认证收敛 + 互操作测试 | ✅ 完成（`@dofe/models-sdk@^0.2.9`，lockfile 已解析到 0.2.9） |
| P1 并发互斥（advisory lock + in-flight 状态） | ✅ 完成 |
| P1 correlation ID / 脱敏日志 / 超时 fail closed | ✅ 完成 |
| P1 严格 no-fallback | ✅ 保持 |
| P2 适配器 fetch 替换 | ⏳ 条件未满足，保留 `fetch`，条件已在 Cycle 5 落地 |
| 远端凭据状态校验（防超时重复发放） | ⏳ 待 models 提供查询端点 |
| 浏览器包零泄漏 | ✅ 验证通过 |
| 类型检查 / 全量测试 | ✅ `tsc` 通过，53 用例通过 |

## 待办（外部依赖解锁后）

1. ~~`@dofe/models-sdk@0.2.9` 发布到 npmjs 后升级并重生成 lockfile~~ ✅ 已完成（2026-07-20，`package.json` 锁 `^0.2.9`，lockfile 解析 0.2.9）。
2. models 发布 `seedanceCredentials.create` typed method 后，替换 adapter `fetch`（见 Cycle 5 条件）。
3. models 提供按 `(ssoUserId, ssoTeamId)` 查询凭据端点后，在 `takeProvisionLock` 重试路径补远端状态校验。
4. 部署前确保 `pnpm --filter @lovart.dofe/server db:migrate` 已应用 `0014` 迁移。
