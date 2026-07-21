# 调用链证据与问题清单

> **更正（2026-07-21 线上联调）：** 下文“调用矩阵”中“图片任务/视频任务…
> 基础 image_async 请求体和结果 envelope 对齐 / 基础 T2V/I2V 可提交”等结论
> **只覆盖了请求体与 envelope，未覆盖路径前缀**，已被推翻。Lovart 生成
> adapter 的 `TASK_PATH` 历史值为 `/generation/tasks`（缺 `/v1`），而 Models
> ts-rest 合同 `pathPrefix` 为 `/v1/generation`，线上 `POST /api/generation/tasks`
> 实际返回 404——每笔生成都到不了 Models。该断链被一个 Lovart 侧 registry
> 竞态错误（目录未填充即抛 `model_not_found`，见新增 P0 行）掩盖。两者均已
> 修复并经线上 probe + 单测验证，详见 [README.md 的“更正”段](./README.md#更正2026-07-21-线上联调)。
> 审查期间为避免产生费用未做真实 POST，是漏检主因；生成类入口应补一次直达
> `alias_not_found` 的探测。

## 审查方法与边界

审查以两个仓库当前工作区为准。`../models.dofe.ai` 在审查期间已有与本任务
无关的未提交 AI Playground 改动，未修改、未纳入结论。没有使用真实租户 key
发起会产生费用的调用，也没有读取或输出任何 credential 的值。

运行时探测使用根 `.env.local` 的 `DOFE_MODEL_API_KEY`，只读取目录和能力投影，
没有提交推理或生成任务：

| 请求 | `api.model.local.dofe.ai` | `ixicai.cn/api` | 结论 |
| --- | --- | --- | --- |
| `GET /v1/models`，Bearer env API key | 99 个模型、8,680 bytes | 相同，SHA-256 与响应体均相同 | 两个入口指向同一授权目录 |
| 对目录内全部 alias 请求 `GET /v1/models/:alias/capabilities` | 99/99 HTTP 200 | 未重复请求 | 该 env API key 对目录和能力投影的授权一致 |

目录构成为 58 个 `llm`、24 个 `image`、17 个 `video`。这些请求证明 env API key
的授权、入口映射和能力发现；它们不证明文本推理、provider 路由、计费或异步任务
成功，也不产生模型消费。

视频能力投影还显示：12 个模型具备 `image_to_video`，1 个具备
`video_to_video`；该 V2V alias 为 `happyhorse-1.0-video-edit`，并声明
`video_edit` operation。因此后文 P0-1 是当前授权模型的实际断链，不是未来
catalog 扩展的推测。

## 调用矩阵

| 能力 | Lovart 发起点 | Models 入口/守卫 | 结论 |
| --- | --- | --- | --- |
| 模型目录 | `apps/server/src/models/dofe-model-router.ts:57` | `apps/api/src/modules/proxy-api/proxy-api.controller.ts:75` | URL、Bearer 鉴权和 `/v1/models` 一致；Models 负责可见性裁剪 |
| OpenAI 文本 | `apps/server/src/agent/deep-agent.ts:224` | `apps/api/src/modules/proxy-api/proxy-api.controller.ts:195` | 路径正确，仍受 P1-1 协议选择风险影响 |
| Gemini/Anthropic 文本 | `apps/server/src/agent/deep-agent.ts:201` | `apps/api/src/modules/proxy-api/gemini-proxy.controller.ts:68`、`anthropic-proxy.controller.ts:67` | 原生入口存在并校验 protocol；Lovart 选择依据不充分 |
| 内部凭据 | `apps/server/src/features/credentials/models-client.ts:89` | `apps/api/src/modules/internal-api/internal-api.controller.ts:397` | SDK typed client 与 HMAC guard 合约对齐 |
| 图片任务 | `apps/server/src/generation/providers/dofe-generation.ts:426` | `apps/api/src/modules/generation-api/generation-api.controller.ts:32` | 基础 `image_async` 请求体和结果 envelope 对齐 |
| 视频任务 | `apps/server/src/generation/providers/dofe-generation.ts:471` | 同上 | 基础 T2V/I2V 可提交；P0-1 使任何源视频语义错误 |

Models 的生成合约定义在
`../models.dofe.ai/packages/contracts/src/schemas/generation.schema.ts:21`、`:56`、
`:141`、`:591`；其可接受 `video_url`，且用 `videoOperation` 和 role 校验高级
视频任务。Lovart 的 adapter 未完整映射这部分合同。

## 发现

### P0-1 `inputVideo` 到 Models 的断链

证据链：

1. Lovart 对外 video schema 接受 `inputVideo`：
   `apps/server/src/http/generate.ts:30-39`。
2. HTTP 路由将其写为 `input_video`：`apps/server/src/http/generate.ts:215-228`。
3. Worker 读出并传给 provider：
   `apps/server/src/features/jobs/executors/video-generation.ts:18-26`、`:52-62`。
4. Provider 的类型也声明该字段：`apps/server/src/generation/types.ts:64-75`。
5. 最终 adapter 仅调用 `buildContent(params.prompt, params.inputImages)`：
   `apps/server/src/generation/providers/dofe-generation.ts:478-490`；
   `buildContent` 只产生 text 和 `image_url`：`:198-213`。
6. Models 生成请求支持 `video_url`，并要求 `video_edit/video_extend` 使用
   `source_video`：`../models.dofe.ai/packages/contracts/src/schemas/generation.schema.ts:34-37`、`:77-90`、`:560-565`。

影响：非文本视频模型的输入被丢弃。优先级为 P0，因为请求可以返回成功却不是
用户请求的操作。

### P0-2 `INTERNAL_API_SECRET` 的示例值复用

证据链：

1. Lovart 的 `INTERNAL_API_SECRET`、Models 本地 `.env` 的该变量、Models
   `.env.example` 的该变量均非空、长度相同，且两两值相同（审计只记录比较
   结果，未记录值）。
2. Models `InternalAuthGuard` 用此值计算 HMAC：
   `../models.dofe.ai/apps/api/src/modules/internal-api/internal-auth.guard.ts:91-109`、
   `:231-242`。
3. Lovart 使用它调用 credential provision：
   `apps/server/src/app.ts:171-186`、
   `apps/server/src/features/credentials/models-client.ts:89-108`。

这不是代码路径不通，而是连接信任根已知。未验证线上是否同样复用，但当前本机
值已不应被提升或复制；按 P0-2 处置要求轮换后才可证明安全。

### P1-1 协议选择不是 Models 权威数据驱动

Lovart 按 alias 字符串前缀把 `gemini-*` 送往 `/gemini`、`claude-*` 送往
`/anthropic`，其他送 `/v1`：
`apps/server/src/models/dofe-model-router.ts:169-187`。目录客户端只读取 alias、
`owned_by`、模型类型和能力名：`:8-21`、`:76-115`，没有读取或缓存
`supportedProtocols/preferredProtocol`。

但 Models 原生 Gemini 与 Anthropic controllers 会先做 protocol support 校验：
`../models.dofe.ai/apps/api/src/modules/proxy-api/gemini-proxy.controller.ts:96-116`，
`anthropic-proxy.controller.ts:93-113`。所以某个 alias 的名称不是能调用何种
协议的可靠事实来源。别名、提供商路由或 endpoint protocol 一旦变化，Lovart
会在到达路由器前被拒绝，或把错误协议送给上游。

建议：让 Models 在 API-key-scoped discovery 中投影 `preferredProtocol` 与
`supportedProtocols`，或为 Lovart 提供一个只返回可执行协议的 capability
端点；Lovart 缓存该投影并按其选 SDK。不能继续扩展前缀白名单。新增/修改 alias
须有“目录投影 -> SDK 入口 -> Models protocol validation”契约测试。

### P1-2 测试未覆盖视频和真实跨边界契约

Lovart 的 `dofe-generation.test.ts` 只有 3 个 image provider 测试，且其成功
fixture 是未包 envelope 的任务对象；没有 video provider、`inputVideo`、角色、
`videoOperation`、取消/轮询、或 Models API-key scoped task 的断言。当前测试
通过只能说明基本图片 request path 未回归。

最低补充集合：

- adapter 单测：T2V、I2V、V2V、首尾帧、失败状态和 `{ code, msg, data }` envelope；
- Models contract fixture：每个内容角色和 operation 的正/负例；
- 使用专用低额度 key 的 E2E：目录、文本、图片、视频、任务查询、取消、usage；
- 每项关联 Models `traceId/requestId/localTaskId`，日志只记 ID/状态/耗时。

## 已通过的自动化验证

```text
Lovart server focused suite: 5 files, 24 tests passed
  env, catalog router, deep-agent protocol config, image DoFe adapter,
  models credential SDK client

Models contracts: 2 suites, 5 tests passed
Models API: 2 suites, 57 tests passed
  generation service and public proxy visibility/controller suite
```

这些测试没有产生真实模型消费。Models API 测试运行时打印了 Node
`--localstorage-file` 参数警告，但测试进程以成功状态退出；该警告与本审查发现
无直接因果关系。
