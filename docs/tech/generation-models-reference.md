# lovart.dofe 图片/视频生成模型参考手册

> **2026-07-20 更新：** 本仓库模型接入已统一迁移至 DoFe / ixicai.cn 多模态网关。Replicate 风格的模型 ID 与参数映射表仅作为历史参考保留；当前运行时代码仅注册 `DofeImageProvider` 与 `DofeVideoProvider`，并通过每用户独立的 design apikey 调用 `/generation/tasks`。所有模型 ID 必须使用 ixicai 侧 ID，严格无降级。

---

## 一、架构概览

```text
LLM Agent
  │
  ├─ generate_image tool (归一化 schema)
  │     │
  │     └─ DofeImageProvider.generate()  ← 参数映射到 ixicai 网关
  │           │
  │           └─ POST {ixicai}/generation/tasks
  │
  └─ generate_video tool (归一化 schema)
        │
        └─ DofeVideoProvider.generate()
              │
              └─ POST {ixicai}/generation/tasks
```

### 三层归一化设计

| 层 | 职责 | 文件 |
| --- | --- | --- |
| **Tool 层** | LLM 调用的统一 schema，语义化参数 | `agent/tools/image-generate.ts`, `video-generate.ts` |
| **Provider 层** | 将归一化参数映射到 ixicai `/generation/tasks` 协议 | `providers/dofe-generation.ts` |
| **API 层** | Fastify HTTP 路由与后台任务执行器 | `http/generate.ts`, `features/jobs/executors/*` |

---

## 二、图片模型

### 2.1 Tool 层归一化 Schema (`generate_image`)

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `title` | string | (必填) | 图片元数据标题 |
| `prompt` | string | (必填) | 详细的图片描述 |
| `model` | enum | `flux-kontext-pro` | 从 ixicai 目录动态构建 |
| `aspectRatio` | `1:1, 16:9, 9:16, 4:3, 3:4` | `1:1` | 宽高比 |
| `quality` | `standard, hd, ultra` | `hd` | 语义化质量级别 |
| `outputFormat` | `png, jpg, webp` | (可选) | 输出格式 |
| `inputImages` | string[] | (可选) | 参考图 URL |
| `placementX/Y` | number | (可选) | Canvas 放置坐标 |
| `placementWidth/Height` | number | 512 | Canvas 显示尺寸 |

### 2.2 当前 ixicai 模型清单

| 模型 ID | 显示名 | 说明 |
| --- | --- | --- |
| `flux-kontext-pro` | Flux Kontext Pro | 高保真上下文感知图片编辑与生成 |
| `flux-kontext-max` | Flux Kontext Max | 顶级 Flux 画质 |
| `bytedance-seedream-4.5` | Seedream 4.5 | 字节 Seedream 4.5 |
| `bytedance-seedream-5.0` | Seedream 5.0 | 字节 Seedream 5.0 |
| `seedream-5.0` | Seedream 5.0 | Seedream 5.0 图片生成 |
| `seedream-5.0-pro` | Seedream 5.0 Pro | 最高画质 Seedream |
| `gpt-image-1.5` | GPT Image 1.5 | OpenAI 强文本渲染 |
| `gpt-image-2` | GPT Image 2 | OpenAI GPT Image 2 |
| `gpt-image-2-all` | GPT Image 2 All | GPT Image 2 全能力 |
| `imagen-4.0-generate-001` | Imagen 4 | Google Imagen 4，纯文生图 |
| `gemini-2.5-flash-image` | Gemini 2.5 Flash Image | 快速 Gemini 图片生成/编辑 |
| `gemini-3.1-flash-image` | Gemini 3.1 Flash Image | Gemini 3.1 Flash 图片模型 |
| `gemini-3.1-flash-lite-image` | Gemini 3.1 Flash Lite Image | 轻量 Gemini 3.1 图片模型 |
| `gemini-3-pro-image` | Gemini 3 Pro Image | Gemini 3 Pro 图片模型 |

### 2.3 Provider 层参数映射（DoFe）

DoFe 网关统一接收 `content`（text + image_url 参考图）与 `params`：

| 归一化参数 | DoFe `params` | 备注 |
| --- | --- | --- |
| `aspectRatio` | `resolution: "{W}x{H}"` | 由 `aspectRatioToDimensions` 转换为像素 |
| `quality` | 当前未透传 | 由 ixicai 侧模型/默认值决定 |
| `outputFormat` | 当前未透传 | 由 ixicai 侧输出决定 |
| `inputImages` | `content` 中的 `image_url` parts | 作为 reference 角色传入 |

---

## 三、视频模型

### 3.1 Tool 层归一化 Schema (`generate_video`)

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `prompt` | string | (必填) | 详细视频描述 |
| `model` | enum | `seedance-2.0` | 从 ixicai 目录动态构建 |
| `duration` | int (3-16) | 5 | 视频时长（秒），按模型约束 |
| `resolution` | `480p, 720p, 1080p, 4k` | `720p` | 输出分辨率 |
| `aspectRatio` | `1:1, 16:9, 9:16, 4:3, 3:4` | `16:9` | 宽高比 |
| `inputImages` | string[] (max 7) | (可选) | I2V 参考图 |
| `inputVideo` | string | (可选) | V2V 源视频（当前未启用） |
| `enableAudio` | boolean | true | 是否生成同步音频 |

### 3.2 当前 ixicai 视频模型清单

| 模型 ID | 显示名 | 说明 |
| --- | --- | --- |
| `seedance-2.0` | Seedance 2.0 | 字节旗舰文生/图生视频 |
| `seedance-2.0-fast` | Seedance 2.0 Fast | 低延迟 Seedance 2.0 |
| `seedance-2.0-mini` | Seedance 2.0 Mini | 轻量 Seedance 2.0 |
| `kling-v3` | Kling 3 | 快手 Kling 3 |
| `kling-v2-6` | Kling 2.6 | 快手 Kling 2.6 |
| `veo-3.1-generate` | Veo 3.1 | Google Veo 3.1 |
| `veo-3.0-generate-001` | Veo 3.0 | Google Veo 3.0 |
| `veo-3.0-fast-generate-001` | Veo 3.0 Fast | Google Veo 3.0 Fast |
| `viduq3-pro` | Vidu Q3 Pro | 生数长时长视频生成 |
| `viduq3-turbo` | Vidu Q3 Turbo | 生数快速视频生成 |

### 3.3 Provider 层参数映射（DoFe）

| 归一化参数 | DoFe `params` | 类型 | 备注 |
| --- | --- | --- | --- |
| `prompt` | `content` text part | string | 作为 prompt 角色传入 |
| `aspectRatio` | `ratio` | string | 原始比例字符串 |
| `resolution` | `resolution` | string | 例如 `720p`、`1080p` |
| `duration` | `duration` | number | 秒 |
| `inputImages` | `content` image_url parts | array | 作为 reference 角色传入 |
| `enableAudio` | `generateAudio` | boolean | 部分模型忽略 |

---

## 四、Job Queue 配置

| 参数 | 图片生成 | 视频生成 |
| --- | --- | --- |
| Queue 名称 | `image_generation_jobs` | `video_generation_jobs` |
| Job Type | `image_generation` | `video_generation` |
| Visibility Timeout | 120s (2 分钟) | 300s (5 分钟) |
| Poll Interval | 2s | 3s |
| Max Wait (Agent) | 120s | 300s |
| Max Retries | 3 | 3 |
| 存储路径 | `{ws}/generated/{ts}-{id}.png` | `{ws}/generated/{ts}-{id}.mp4` |
| 存储 Bucket | `project-assets` (public) | `project-assets` (public) |

---

## 五、API 端点

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/image-models` | GET | 返回所有注册图片模型 |
| `/api/video-models` | GET | 返回所有注册视频模型（含 capabilities/limits） |
| `/api/agent/generate-image` | POST | 直接图片生成（同步） |
| `/api/agent/generate-video` | POST | 直接视频生成（同步，轮询任务） |
| `/api/jobs/image-generation` | POST | 创建图片生成任务 |
| `/api/jobs/video-generation` | POST | 创建视频生成任务 |
| `/api/jobs/:jobId` | GET | 查询任务状态 |
| `/api/jobs/:jobId/cancel` | POST | 取消任务 |

---

## 六、代码文件索引

| 文件 | 职责 |
| --- | --- |
| `apps/server/src/generation/types.ts` | 所有类型定义（Image/Video Params, Provider 接口, VideoModelInfo） |
| `apps/server/src/generation/providers/dofe-generation.ts` | DoFe / ixicai Provider（当前唯一注册的图片/视频 Provider） |
| `apps/server/src/generation/providers/register-all.ts` | Provider 注册；仅注册 Dofe Provider |
| `apps/server/src/generation/providers/registry.ts` | Provider 注册表（注册、查找、模型枚举） |
| `apps/server/src/generation/providers/replicate-image.ts` | 历史 Replicate 图片 Provider（已不再注册，保留作参考） |
| `apps/server/src/generation/providers/replicate-video.ts` | 历史 Replicate 视频 Provider（已不再注册，保留作参考） |
| `apps/server/src/agent/tools/image-generate.ts` | 图片工具（动态 schema + job/direct 双模式） |
| `apps/server/src/agent/tools/video-generate.ts` | 视频工具（动态 schema + job/direct 双模式） |
| `apps/server/src/features/jobs/executors/image-generation.ts` | 图片任务执行器 |
| `apps/server/src/features/jobs/executors/video-generation.ts` | 视频任务执行器 |
| `apps/server/src/http/generate.ts` | `/api/agent/generate-image` 与 `/api/agent/generate-video` 路由 |
| `apps/server/src/http/jobs.ts` | `/api/jobs/*` 路由 |
| `apps/server/src/worker.ts` | Worker 进程（轮询两个队列） |
| `apps/server/src/features/jobs/job-service.ts` | Job 服务（创建/状态/取消） |
| `packages/shared/src/job-contracts.ts` | 共享类型和 API schema |

---

## 七、历史 Replicate 参数映射（参考/不再使用）

以下表格描述的是项目早期直接调用 Replicate API 时的参数差异。2026-07-20 之后，实际运行时代码通过 ixicai 网关统一调用，不再使用这些 Replicate 专用字段名。保留它们仅为了便于理解旧模型能力与历史命名。

### 7.1 图片模型历史清单

| 模型 ID | 名称 | 厂商 | 图片输入 | 纯文本 | 最高分辨率 |
| --- | --- | --- | --- | --- | --- |
| `google/nano-banana-pro` | Nano Banana Pro | Google | 最多 14 张 | N | 4K |
| `google/nano-banana-2` | Nano Banana 2 | Google | 最多 14 张 | N | 4K |
| `google/nano-banana` | Nano Banana | Google | 最多 14 张 | N | 2K |
| `google/imagen-4` | Imagen 4 | Google | **不支持** | Y | 2K |
| `openai/gpt-image-1.5` | GPT Image 1.5 | OpenAI | 多张 | N | 2K |
| `black-forest-labs/flux-kontext-max` | Flux Kontext Max | BFL | **仅 1 张** | N | 1K |
| `black-forest-labs/flux-kontext-pro` | Flux Kontext Pro | BFL | **仅 1 张** | N | 1K |
| `bytedance/seedream-5-lite` | Seedream 5.0 Lite | ByteDance | 多张 | N | 3K |
| `bytedance/seedream-4.5` | Seedream 4.5 | ByteDance | 多张 | N | 4K |
| `bytedance/seedream-4` | Seedream 4 | ByteDance | 多张 | N | 4K |
| `recraft-ai/recraft-v3` | Recraft V3 | Recraft | **不支持** | Y | 1K |

### 7.2 视频模型历史清单

| 模型 ID | 名称 | 厂商 | T2V | I2V | V2V | 音频 | 最大时长 | 分辨率 | 最大参考图 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `kwaivgi/kling-v3-video` | Kling 3.0 | 快手 | Y | Y | — | Y | 15s | 1080p | 1 |
| `kwaivgi/kling-v3-omni-video` | Kling 3.0 Omni | 快手 | Y | Y | Y | Y | 15s | 1080p | 7 |
| `kwaivgi/kling-v2.6` | Kling 2.6 | 快手 | Y | Y | — | Y | 10s | 1080p | 1 |
| `kwaivgi/kling-o1` | Kling O1 | 快手 | — | — | **Y** | Y | 10s | **4K** | 0 |
| `bytedance/seedance-1.5-pro` | Seedance 1.5 Pro | ByteDance | Y | Y | — | Y | 10s | 1080p | 1 |
| `wan-video/wan-2.6` | Wan 2.6 | Alibaba | Y | Y | — | Y | 10s | 1080p | 1 |
| `openai/sora-2` | Sora 2 | OpenAI | Y | Y | — | Y | 12s | 1080p | 1 |
| `openai/sora-2-pro` | Sora 2 Pro | OpenAI | Y | Y | — | Y | 12s | 1080p | 1 |
| `google/veo-3` | Veo 3 | Google | Y | — | — | Y | 8s | 1080p | 0 |
| `google/veo-3.1` | Veo 3.1 | Google | Y | Y | — | Y | 8s | 1080p | 3 |
| `google/veo-3.1-fast` | Veo 3.1 Fast | Google | Y | Y | — | Y | 8s | 1080p | 3 |
| `minimax/hailuo-2.3` | Hailuo 2.3 | MiniMax | Y | Y | — | **—** | 10s | 1080p | 1 |
| `vidu/q3-pro` | Vidu Q3 Pro | 生数科技 | Y | Y | — | Y | **16s** | 1080p | 1 |
