# Lovart -> Models 调用链深度审查

审查日期：2026-07-21

审查范围：`lovart.dofe.ai` 的文本、图片、视频模型调用，以及相邻
`../models.dofe.ai` 的公开数据面、内部凭据面和生成任务面。本文只记录审查
结论，不修改业务代码或 Models 的权威数据。

## 结论

使用根 `.env.local` 的 `DOFE_MODEL_API_KEY` 后，`https://ixicai.cn/api` 与本机
`https://api.model.local.dofe.ai` 返回字节级一致的授权目录：99 个模型；对所有
99 个 alias 的 `/v1/models/:alias/capabilities` 请求均返回 HTTP 200（58 LLM、24
图片、17 视频）。其中当前可见视频能力包含 12 个 `image_to_video` 和 1 个
`video_to_video` / `video_edit` 模型；后者直接受 P0-1 影响。Lovart 的 URL
归一化、OpenAI 目录请求、内部 HMAC 凭据发放、基础图片任务创建，以及 Models 的
`/v1/*` 和 `/v1/generation/*` 路由在代码层相互匹配。

不能据此给出“所有模型调用已正确”的结论，原因是存在一个已证实的 P0 语义
丢失，以及一项会使模型选择失去确定性的 P1 风险。发布到任何可被外部访问的
环境前，必须关闭 P0 和 P1-1。

| 优先级 | 发现 | 影响 | 状态 |
| --- | --- | --- | --- |
| P0 | 视频 `inputVideo` 在 DoFe adapter 中被丢弃 | V2V、视频编辑、延长、动作控制模型接到错误请求 | Lovart 侧已修复（adapter 映射 `video_url` + role + `videoOperation`，见 [01-call-chain-evidence.md](./01-call-chain-evidence.md)）；待 Models 侧契约校验联调 |
| P0 | 当前 Models 内部 HMAC secret 与被提交的示例值相同 | 若相同配置进入可访问环境，内部凭据发放与代理边界可被伪造 | Lovart 侧已加固：`validateInternalApiSecret` 拒绝占位符/示例 hex/弱值，启动 smoke check（默认 warn，`LOVART_STRICT_INTERNAL_SECRET_SMOKE=true` 时 401 阻断启动）。根因仍需 Models 仓库独立轮换 |
| P1 | 文本协议由 alias 前缀推断，不由 Models 可用性/协议投影决定 | 新 alias、别名变更或仅支持另一协议的模型可能访问错误入口 | Lovart 侧已支持消费 Models 投影（`preferred_protocol` 缓存优先，前缀作 fallback）；待 Models 在 `/v1/models/:alias/capabilities` 暴露投影字段后自动生效 |
| P1 | 缺少视频 adapter、真实 API-key 和跨入口契约测试 | 已有代码回归无法自动阻止 | 已补 video adapter（T2V/I2V/V2V/motion_control/envelope/error）、secret 校验与 smoke、协议缓存单测；跨入口真实 E2E 仍待补 |

详细证据、调用矩阵和验收步骤见 [01-call-chain-evidence.md](./01-call-chain-evidence.md)。

## 已验证调用链

```text
浏览器 / WebSocket / HTTP
  -> Lovart Fastify (server-only credentials)
  -> Models API key: /v1/models, /v1/chat/completions, /gemini/*, /anthropic/*
  -> Models routing / provider key / usage
  -> 上游模型厂商

图片 / 视频任务
  -> Lovart job worker
  -> Bearer <per-user design API key>
  -> Models /v1/generation/tasks
  -> Models generation routing / provider adapter / asset persistence
  -> 上游异步任务

凭据发放
  -> Lovart server SDK HMAC client
  -> Models /internal/seedance/credentials
  -> 加密保存到 Lovart user_credentials
```

以下连接点已在代码中一致：

- `DOFE_MODEL_BASE_URL=https://ixicai.cn` 被归一为 `/api`；文本 OpenAI
  基址为 `/api/v1`，原生 Gemini/Anthropic 分别为 `/api/gemini` 与
  `/api/anthropic`。
- Models 公开模型目录由 API key 做租户可见性裁剪；Lovart 不维护另一份
  可执行模型目录。
- Lovart 凭据客户端使用 `@dofe/models-sdk/internal-node` 的签名数据客户端，
  调用 typed `seedanceCredentials.create/get`，密钥只保留在服务端。
- 图片、视频使用 Models 的 `POST /v1/generation/tasks` 合约；请求包含
  `model`、`endpointKind`、有序 `content` 和受控 `params`，而非直连厂商。

## 必须修复

### P0-1 视频源素材被静默丢弃

Lovart 对外请求、任务 payload 和 worker 都接受并传递 `inputVideo`，但
`DofeVideoProvider.generate()` 调用 `buildContent(prompt, inputImages)`，没有把
`inputVideo` 变成 Models 合约所需的 `{ type: "video_url" }` 内容块；也没有按
`videoOperation` 写入 `source_video`、`motion_reference` 等角色。Models 合约明确
支持 `video_url`，并在 `video_edit`、`video_extend` 等 operation 上校验角色。

这不是“模型不支持”的正常失败，而是用户选择支持视频输入的模型时 Lovart
悄悄改写成无源视频请求。结果可能是文本生成、参数校验失败，或生成与用户
素材无关的视频。

修复要求：

1. 将 Lovart 视频请求扩展为受控的 `videoOperation` 和 content role，而不是
   只传一个 `inputVideo` 字符串。
2. `inputVideo` 存在时映射为 `video_url`，并按 operation 映射为
   `source_video` 或 `motion_reference`；首帧、尾帧、主体参考也必须保留
   区分，不能全部写成 `reference`。
3. 在提交前读取 Models 的 API-key-scoped capability projection，拒绝不支持
   的 operation、角色、时长、分辨率和素材数量。
4. 添加单元测试，断言发给 `/v1/generation/tasks` 的 JSON 包含视频块和正确
   role；再补一条授权、可取消的真实 smoke。

### P0-2 内部服务 secret 使用已公开的示例值

本机审计只比较了存在性、长度和相等性，未把 secret 写入本文件。结果表明：

- Lovart 本地运行配置与 Models 本地运行配置的 `INTERNAL_API_SECRET` 相同；
- Models 本地运行配置又与仓库中 `apps/api/.env.example` 的示例值相同；
- Models 的 `InternalAuthGuard` 正是用该值验证 HMAC，并接受
  `x-service-name` 绑定的内部调用。

示例 secret 不能是可运行环境中的 secret。只要这种配置被复用到可访问的
`api.model.local.dofe.ai` 或线上入口，攻击者即可构造内部服务签名，风险覆盖
credential provision 和 `/internal/*` 数据面。

处置要求：立即生成并注入新的环境 secret，撤销旧值；从 `.env.example` 删除
具体 secret，改为无值占位符；确认密钥仅在秘密管理系统/未跟踪环境文件中
存在；最后用新的 `lovart.dofe.ai` service-name HMAC 做 401/200/拒绝旧 secret
的三项验证。由于无法从本机确定线上环境变量，本项在完成轮换证明前视为发布
阻断。

## 发布门槛

完成上述 P0 后，至少执行以下验收：

1. 使用环境中的权限最小测试 API key，验证目录、一个 OpenAI 文本模型、一个
   Gemini/Anthropic 原生文本模型、一个图片任务和一个视频任务。每项记录
   request ID、alias、协议、HTTP 状态和 Models usage/task ID，绝不记录 key 或
   prompt 原文。
2. 对视频依次验证 `text_to_video`、`image_to_video`、`video_edit` 或
   `video_extend`；后两项必须证明 `video_url/source_video` 到达 Models。
3. 在 Models 中确认请求使用该 API key 的可见性、路由和 usage，并记录请求
   所属的预期用户/团队。
4. 将这些验证自动化为不消耗生产额度的 smoke fixture，失败时阻止发布。
