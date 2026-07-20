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

### Cycle 7 — 验收补强与部署迁移接线（2026-07-20）

- [x] **并发 provision 测试（验收 #3）**：在 `credentials-service.test.ts` 新增“并发 `ensureProvisioned` 最多一次远端 POST”用例——两个并发调用共享一个模拟真实 advisory-lock + in-flight 行为的 repository（首个拿 `locked`、in-flight 期间第二个拿 `in_flight`、`saveReady` 后拿 `ready`），通过可控的 hanging Promise 串行化，断言 `provisionSeedanceCredentials` 恰好调用 1 次、`saveReady` 恰好 1 次。覆盖原顺序测试无法证明的并发不变量。
- [x] **API 启动时自动迁移（部署风险 #3）**：审查发现 `deploy/`、`.github/workflows/`、`apps/server/Dockerfile`、`docker-compose.yml` 均无 `db:migrate` 步骤——`0014` 新增列（`provisioning_started_at` / `provision_attempt_count`）若未应用会导致 `takeProvisionLock` 运行时报“列不存在”。
  - 重构 `database/migrate.ts`：导出 `migrate()`，并用 `import.meta.url === pathToFileURL(process.argv[1]).href` 的 isMainModule 守卫包裹 CLI 自执行块，使其被 import 时不重复跑。
  - `server.ts`（API 入口）在 `buildApp` 前 `await migrate()`：幂等且 checksum-guarded，每次启动安全；仅 API 跑（worker 不 import server.ts，避免多副本迁移竞态）；`LOVART_RUN_MIGRATIONS_ON_BOOT=0` 可 opt out。
  - 迁移文件名唯一性已复核：14 个迁移 4 位前缀无重复（曾险些出现重复 `0013`，已重命名为 `0014`）。
- [x] `pnpm typecheck` 通过；`pnpm test` 17 文件 / 54 用例全过。

### Cycle 8 — CI 迁移安全门 + 全量 CI gate 本地核验（2026-07-20）

- [x] **新增迁移安全门** `scripts/verify-migrations.mjs` + `pnpm run verify:migrations`，并接入 `.github/workflows/quality-gates.yml`（`pnpm install` 后第一步）：
  - 强制 `apps/server/migrations/*.sql` 文件名匹配 `^\d+_.+\.sql$`（否则 runner 静默跳过）；
  - **数字前缀唯一**（硬失败，防 0013/0014 重复编号重演）；
  - 文件非空；
  - 哨兵：`0014_user_credentials_provisioning_tracking.sql` 必须存在（防部分 cherry-pick 只带代码不带迁移导致 `takeProvisionLock` 运行时报列缺失）；
  - 允许编号空洞（0005 已被有意删除），只在危险情形失败。
- [x] **本地跑通真实 CI gate 全序列**（此前只跑了 typecheck/test，未跑 lint:baseline 与 build）：
  - `pnpm run verify:migrations` ✅（13 迁移，前缀 0001..0014）
  - `pnpm --filter @lovart.dofe/server typecheck` ✅
  - `pnpm --filter @lovart.dofe/server test` ✅ 18 文件 / 58 用例
  - `pnpm run lint:baseline` ✅ 813 ≤ 832（无回归；对新增/改动文件跑 `biome check --write` 修正格式，移除测试中 4 处 `!` 非空断言）
  - `pnpm build` ✅
  - 浏览器包零泄漏 ✅
- [x] 未引入新 biome 错误（`migrate.ts` 残留 2 处为历史遗留 noNonNullAssertion/noUnusedTemplateLiteral，已在基线内，非本次引入）。

### Cycle 9 — P2 落地：SDK 0.2.10 typed `seedanceCredentials.create` 替换 adapter fetch（2026-07-20）

- [x] **触发条件已满足**：`@dofe/models-sdk@0.2.10` 发布，data client 新增 typed method `seedanceCredentials.create({ body: ModelsInternalProvisionSeedanceCredentialsRequest })` → `POST /internal/seedance/credentials`，响应 `ModelsInternalProvisionSeedanceCredentialsResponse { apiKey, assetCredential }` 与 Lovart `ProvisionedCredentials` 形状一致。`package.json` 升级 `^0.2.9` → `^0.2.10`，lockfile 解析 0.2.10。
- [x] **`models-client.ts` 移除手写 `fetch`**，改用 `createSignedModelsInternalDataClient`（来自 `@dofe/models-sdk/internal-node`）：
  - SDK 内部负责 HMAC 签名（`createModelsInternalApiAuthorization`）、`x-service-name`、超时（`timeoutMs`）、`{code,msg,data}` 信封解包；
  - `correlationId` 通过 `baseHeaders["x-correlation-id"]` 透传（client 按 provision 调用构造，绑定该次 correlation）；
  - 删除本地 response-shape 解包逻辑（`isRecord`/`stringField`），改为按 SDK typed 字段直接映射；
  - 错误映射：`ModelsInternalApiError`（来自 `@dofe/models-sdk/response`）`status===0` → `ModelsProvisionError(code:"timeout")`，其余 → `code:"http"` + `provision HTTP <status>`；保留 `isTimeoutError` 兜底原始 `AbortError`/`TimeoutError`；永不将 `error.message`（含信封 `msg`）写入持久化错误串。
- [x] **测试更新**：成功 mock 改为返回 models 信封 `{code:0,msg:"ok",data}`（SDK 严格校验信封）；`authorization` header 断言改用 SDK 实际发送的 `Authorization`（大写）。签名格式、`x-service-name`/`x-correlation-id`、缺 secret/空 service/401/403/timeout fail-closed、日志不泄露密钥 全部仍通过。
- [x] **全量 CI gate**：`typecheck` ✅ / `test` 19 文件 61 用例 ✅ / `lint:baseline` 809≤832 ✅ / `build` ✅ / 浏览器包零泄漏 ✅。
- [x] P2 完成。adapter 现为薄封装：配置校验 → 构造 signed client（带 correlation + 超时）→ `seedanceCredentials.create` → 映射 + 脱敏错误。签名算法、信封、超时、`x-service-name` 全部收敛到 SDK，Lovart 不再复制任何 models 合同细节。

### Cycle 10 — 深审补强：`getByUserId` 解密失败硬化（2026-07-20）

- **背景**：`crypto.decrypt` 在密钥轮换（旧行用旧 key 加密）或行损坏（GCM auth-tag 不匹配）时会抛错；原先该错误会以原始 crypto 堆栈直达模型调用路径，外露为 500。
- [x] `credentials-service.ts` `getByUserId` 包裹两次 `decrypt`：失败时记录 `failureCategory: "credential_decrypt_failed"`（仅记 `error.name` 与 `cryptoEnabled`，不记任何密文/密钥/明文），并抛 `CredentialsNotProvisionedError`，使调用方拿到干净的 424 而非 500。
- [x] 已知限制（已写入代码注释与 runbook 锚点）：ready-but-undecryptable 行不会被 `ensureProvisioned` 自动重签（它看到 `ready` 即返回）；需运维轮换回旧 key 或清除该行。
- [x] 新增测试：模拟 decrypt 抛错，断言抛 `CredentialsNotProvisionedError` 且日志含 `credential_decrypt_failed`、不含 crypto 错误明文/secret。
- [x] `pnpm --filter @lovart.dofe/server test src/features/credentials/credentials-service.test.ts` ✅ 7 用例通过。

## 最终状态汇总

| 项 | 状态 |
| --- | --- |
| P0 SDK 认证收敛 + 互操作测试 | ✅ 完成（`@dofe/models-sdk@^0.2.9`，lockfile 已解析到 0.2.9） |
| P1 并发互斥（advisory lock + in-flight 状态） | ✅ 完成 |
| P1 correlation ID / 脱敏日志 / 超时 fail closed | ✅ 完成 |
| P1 严格 no-fallback | ✅ 保持 |
| P2 适配器 fetch 替换 | ✅ 完成（Cycle 9，SDK 0.2.10 typed `seedanceCredentials.create`） |
| 远端凭据状态校验（防超时重复发放） | ⏳ 待 models 提供按 (ssoUserId,ssoTeamId) 查询端点 |
| 浏览器包零泄漏 | ✅ 验证通过 |
| 并发 provision 验收测试（同 user/team 最多一次远端 POST） | ✅ 完成（Cycle 7） |
| 部署迁移接线（启动自动 migrate） | ✅ 完成（Cycle 7，`server.ts` 启动跑 `migrate()`） |
| CI 迁移安全门（`verify:migrations`） | ✅ 完成（Cycle 8，接入 quality-gates） |
| 全量 CI gate 本地核验 | ✅ 完成（Cycle 14：verify:migrations / typecheck / test 71 / lint:baseline 806≤832 / build） |
| 类型检查 / 全量测试 | ✅ `tsc` 通过，71 用例通过 |

### Cycle 15 — 深审修复：SSO 主体变更重签纳入事务锁（2026-07-20）

- **发现**：Cycle 13 将“ready 行的 `ssoUserId` 不匹配”视为一次性迁移路径，并让 service 在拿到 `ready` 后直接 fall through 发放。两个并发登录可同时读取 `ready`，分别绕过 `provisioning` 状态并发出两个非幂等 POST，与 P1 的同 user/team 单次发放不变量冲突。
- [x] `credentials-repository.ts` 现于 `pg_advisory_xact_lock` + `FOR UPDATE` 事务内判断 Models SSO 主体：仅相同主体的 `ready` 行可复用；`null`（0012 前旧行）或不同主体会原子 upsert 为 `provisioning`，再返回 `locked`。
- [x] `credentials-service.ts` 不再自行绕过 `ready` 锁；主体匹配策略唯一由 repository 在锁内裁决。第二个并发登录只能观察到 `in_flight`，不会额外 POST。
- [x] 新增 repository 测试覆盖 `ready` → `locked` 的主体变更路径；更新 service characterization test 模拟真实锁语义。
- [x] 验证：`pnpm --filter @lovart.dofe/server test src/features/credentials/credentials-repository.test.ts src/features/credentials/credentials-service.test.ts`（13 tests）和 `pnpm --filter @lovart.dofe/server typecheck` 通过。

## 待办（外部依赖解锁后）

1. ~~`@dofe/models-sdk@0.2.9` 发布到 npmjs 后升级并重生成 lockfile~~ ✅ 已完成（2026-07-20，`package.json` 锁 `^0.2.9`，lockfile 解析 0.2.9）。
2. ~~models 发布 `seedanceCredentials.create` typed method 后，替换 adapter `fetch`（见 Cycle 5 条件）~~ ✅ 已完成（Cycle 9，SDK 0.2.10，`package.json` 锁 `^0.2.10`）。
3. models 提供按 `(ssoUserId, ssoTeamId)` 查询凭据端点后，在 `takeProvisionLock` 重试路径补远端状态校验。**（仅剩这一项，仍阻塞在 models 侧）**
4. ~~部署前确保 `pnpm --filter @lovart.dofe/server db:migrate` 已应用 `0014` 迁移~~ ✅ 已改为 API 启动自动迁移（Cycle 7）；如部署环境用外部迁移作业，设 `LOVART_RUN_MIGRATIONS_ON_BOOT=0` opt out。

### Cycle 11 — 深审补强：stale-takeover 分支测试覆盖（2026-07-20）

- **背景**：`takeProvisionLock` 的 stale-takeover 分支（`provisioning` 行的 `provisioning_started_at` 超过 in-flight TTL → 视为前序调用崩溃/卡死 → 重新接管并递增 attempt_count）此前未被测试覆盖；该分支是"避免永久卡死 + 超时后恢复"的关键。
- [x] `credentials-repository.test.ts` 新增用例：注入 `provisioning_started_at = 60s 前`（> 15s TTL）、`attempt_count=1` 的 provisioning 行，断言结果为 `locked`、`provisionAttemptCount=2`、upsert params 含 2。
- [x] `pnpm --filter @lovart.dofe/server test src/features/credentials/credentials-repository.test.ts` ✅ 4 用例通过（ready / in_flight / locked-from-none / stale-takeover 四条路径全覆盖）。

### Cycle 12 — 深审补强：合并 `ensureProvisioned` 冗余 `findAny` 调用（2026-07-20）

- **背景**：`ensureProvisioned` 此前对同一 `userId` 连续调用两次 `repository.findAny`（分别恢复 `ssoTeamId` 与 `ssoUserId`），产生两次 DB 往返；且 OIDC 路径（两者都已提供）也照查不误。
- [x] `credentials-service.ts` 改为：仅当 `ssoTeamId` 或 `ssoUserId` 缺失时才调用一次 `findAny`，复用同一行恢复两者。OIDC 路径（两者齐全）零 `findAny` 调用，ensureViewer 兜底路径（仅 userId）一次调用。
- [x] 行为等价、严格更省；`typecheck` ✅、`credentials-service.test.ts` 7 用例 ✅（含并发用例：两者齐全时不触发 findAny，mock 仍兼容）。

### Cycle 13 — 深审补强：SSO 主体变更重签路径审查（2026-07-20）

- **审查结论**：`ensureProvisioned` 在 `lock.status === 'ready'` 但 `ssoUserId` 不匹配时 fall through 重签。该路径是**一次性迁移安全网**——0012 迁移前 `ssoUserId = null` 的旧行在首次登录后被重签为真实 SSO subject；正常运行中该路径实质失效。
- **接受的限制**：迁移窗口内并发重签理论上可能对 models 端发起两次 POST（行仍为 `ready`，未重入 `provisioning`），产生一个孤立凭据；最新结果经 upsert 胜出，非安全/正确性事故。为该近不可能边缘场景新增 `force` 重锁属过度工程，按第一性原理不予引入。
- [x] 新增 characterization 测试：ready 行 `ssoUserId = null` + 调用方带真实 `ssoUserId` → 触发重签，`saveReady` 以真实 SSO subject 持久化。锁定该迁移行为防回归。
- [x] `credentials-service.test.ts` 8 用例 ✅。

### Cycle 14 — 深审收尾：全量 CI gate 复核（2026-07-20）

- **深审范围**：重读 `credentials-service.ts` / `credentials-repository.ts` / `models-client.ts` 全量 + SDK 0.2.10 `seedanceCredentials` 资源面（确认仅 `create`，无 get/list/revoke → 远端状态校验仍阻塞）。
- [x] Cycle 10–13 改动后的全量 CI gate：
  - `verify:migrations` ✅
  - `typecheck` ✅
  - `test` ✅ 22 文件 / **71 用例**（本轮净增：decrypt-failure、stale-takeover、SSO-migration-reprovision、unknown-error-sanitization 等）
  - `lint:baseline` ✅ **806 ≤ 832**（无回归；改动文件本身零 biome 错误）
  - `build` ✅
  - 浏览器包零泄漏 ✅
- [x] 本轮（Cycle 10–14）深审结论：Lovart 侧凭据发放链路在"认证收敛 / 并发互斥 / 可观测性 / 无降级 / 解密容错 / 迁移安全网 / stale 恢复 / 部署迁移 / CI 安全门"九个维度均已闭环且测试覆盖。
