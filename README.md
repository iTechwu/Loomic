<p align="center">
  <img src="apps/web/public/logo.svg" alt="lovart.dofe Logo" width="80" />
</p>

<h1 align="center">
  lovart.dofe
</h1>

<p align="center">
  Open-source alternative to <b>Lovart</b> / <b>CapCut Video Studio</b> / <b>Canva AI</b><br/>
  Canvas-based AI creative workspace — no timeline, no templates, just talk.
</p>

<p align="center">
  <img width="900" src="docs/images/base-image.png" alt="lovart.dofe" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-15-black?logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Fastify-5-000000?logo=fastify" alt="Fastify" />
  <img src="https://img.shields.io/badge/LangGraph-1.2-1C3C3C?logo=langchain&logoColor=white" alt="LangGraph" />
  <img src="https://img.shields.io/badge/PostgreSQL-Native-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Excalidraw-Canvas-6965DB?logo=excalidraw&logoColor=white" alt="Excalidraw" />
  <img src="https://img.shields.io/badge/Turborepo-Monorepo-EF4444?logo=turborepo&logoColor=white" alt="Turborepo" />
  <img src="https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white" alt="pnpm" />
</p>

<p align="center">
  <img width="900" src="docs/images/home-image.png" alt="lovart.dofe Workspace" />
</p>

---

## 💡 lovart.dofe 是什么

CapCut 刚推出了 Video Studio——基于画布的 AI 视频制作空间，Lovart 做的是 AI 设计 Agent，Canva 也在往 AI 方向猛推。这类产品的共同点：闭源、数据不在你手里、定价你说了不算。

lovart.dofe 做的是同一件事，但完全开源。你在无限画布上跟 AI 对话，它直接生成图片、视频，摆好位置，调好样式。不需要时间轴，不需要模板，不需要学 prompt 工程。说"把左边那张换成暖色调"，AI 就懂了。

从构思、角色设定、故事板、场景生成、细节打磨到导出——整个创作流程在一个画布上完成。底层是 LangGraph 驱动的 Agent，接了 Google Gemini / Vertex AI / OpenAI / Replicate 十几个模型（包括 Veo 3.1、Kling、Seedance、Sora 等），图片视频都能生。

开源，可以自己部署，数据全在你手里。

<p align="center">
  <img width="900" src="docs/images/canvas-image.png" alt="lovart.dofe Canvas" />
</p>

---

## ✨ Features

🗣️ **对话式画布设计**
- 在无限画布上和 AI 对话，直接生成、编辑、排版
- 多轮对话迭代，说"把左边那张图换成暖色调"就行
- Agent 看得懂画布上下文，知道你在说哪个元素

🖼️ **图片生成（15+ 模型）**
- Google Imagen 4 / Gemini Image / Vertex AI
- OpenAI DALL-E 3 / GPT Image
- Replicate: Flux Kontext, SDXL, Recraft, Seedream...
- 填自己的 API Key，按需组合

🎬 **视频生成**
- Google Veo 3.1 / 3.0 / 2.0（文生视频、图生视频）
- Replicate: Kling, Seedance, Wan, Sora, Hailuo...
- 支持原生音频生成

🎨 **无限画布**
- 基于 Excalidraw，自由拖拽、缩放、分层
- AI 生成的素材直接落在画布上，不用手动导入
- 导出、截图、分享

🏷️ **Brand Kit**
- 设定品牌色、字体、Logo
- AI 生成时自动遵循品牌规范
- 集成 Google Fonts

💰 **积分 & 付费**
- 内置积分系统，按量计费
- LemonSqueezy 订阅集成
- 免费用户每天有基础额度

🧩 **可扩展技能系统**
- Markdown 定义 workspace 技能
- 按项目扩展 Agent 能力

---

## 🏗️ Architecture

```
┌─────────────┐     WebSocket / REST      ┌─────────────────┐
│   Next.js   │ ◄──────────────────────►  │  Fastify API    │
│   Frontend  │                           │  + LangGraph    │
│  (Vercel)   │                           │  Agent (Railway) │
└─────────────┘                           └────────┬────────┘
                                                   │ RabbitMQ
                                          ┌────────▼────────┐
                                          │    Worker(s)     │
                                          │  Image / Video   │
                                          │  Generation      │
                                          │  (Railway)       │
                                          └────────┬────────┘
                                                   │
                                          ┌────────▼────────┐
                                          │   PostgreSQL     │
                                          │   SSO / TOS      │
                                          └─────────────────┘
```

| Component | Tech | Role |
|-----------|------|------|
| **Frontend** | Next.js 15 + React 19 + Tailwind CSS 4 | Canvas UI, chat panel, workspace |
| **API Server** | Fastify 5 + LangGraph | Agent runtime, WebSocket, REST API |
| **Worker** | Node.js RabbitMQ consumer | Async image/video generation jobs |
| **Data plane** | PostgreSQL + Volcengine TOS | Product metadata, LangGraph state, and private assets |
| **Canvas** | Excalidraw 0.18 | Infinite canvas rendering |
| **AI** | LangChain + LangGraph | Agent orchestration, tool calling |
| **Queue** | RabbitMQ | Image and video generation job delivery |

For the request lifecycle, persistence boundaries, and operational invariants,
see [Runtime and Data Plane](docs/architecture/runtime-and-data-plane.md).

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | Turborepo + pnpm |
| Frontend | Next.js 15 (App Router), React 19, Tailwind CSS 4 |
| Canvas | Excalidraw |
| Backend | Node.js, Fastify 5, TypeScript |
| AI Framework | LangChain 1.2, LangGraph 1.2 |
| LLM Providers | OpenAI, Google Gemini, Google Vertex AI |
| Image Generation | Imagen, DALL-E, Replicate (13+ models) |
| Video Generation | Google Veo 3.x, Replicate (Kling, Sora, Seedance, etc.) |
| Database | Native PostgreSQL |
| Auth | DoFe SSO / OpenID Connect |
| Storage | Volcengine TOS |
| Queue | RabbitMQ |
| Payments | LemonSqueezy |
| Linting | Biome |
| Testing | Vitest |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 10 (`npm install -g pnpm`)
- PostgreSQL 15+ and a Volcengine TOS bucket
- DoFe SSO / OpenID Connect client credentials
- At least one AI API key (Google or OpenAI)

### 1. Clone & Install

```bash
git clone <your-repository-url>
cd lovart.dofe
pnpm install
```

### 2. Set Up PostgreSQL

Create the product database and apply the server-owned migrations:

```bash
DATABASE_URL=postgresql://... pnpm --filter @lovart.dofe/server db:migrate
```

This creates product metadata, SSO subject mappings, skills, brand kits, chat state, and LangGraph persistence tables. Configure TOS separately for binary assets.

### 3. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your credentials:

```bash
# ── Required: native data plane ──────────────────────────────
DATABASE_URL=postgresql://dofe:pw@postgres:5432/lovart_dofe
TOS_ACCESS_KEY=your-tos-access-key
TOS_SECRET_KEY=your-tos-secret-key
TOS_REGION=your-tos-region
TOS_ENDPOINT=https://tos.example.com
TOS_INTERNAL_ENDPOINT=https://tos-internal.example.com
TOS_BUCKET=lovart-dofe
TOS_BUCKET_DOMAIN=https://assets.example.com
TOS_INTERNAL_BUCKET_DOMAIN=https://assets-internal.example.com

# Required by the background worker; the API can start without it, but will not
# expose asynchronous image/video job routes.
RABBITMQ_URL=amqp://dofe:pw@rabbitmq:5672/lovart_dofe

# ── Required: DoFe SSO / OIDC ───────────────────────────────
# The browser redirects to SSO; keep the client and internal secrets server-only.
SSO_API_URL=https://sso.ixicai.cn/api
SSO_INTERNAL_API_URL=https://sso.ixicai.cn/api
SSO_ISSUER=https://sso.ixicai.cn/api
SSO_CLIENT_ID=lovart-dofe-ai-local
SSO_CLIENT_SECRET=your-client-secret
INTERNAL_API_SECRET=your-internal-secret
SSO_REDIRECT_URI=https://lovart.local.dofe.ai/auth/callback
JWKS_URI=https://sso.ixicai.cn/api/.well-known/jwks.json

# ── Required: At least one AI provider ──────────────────────
LOVART_DOFE_AGENT_MODEL=google:gemini-2.5-flash     # or openai:gpt-4o
GOOGLE_API_KEY=your-google-api-key             # for Gemini + Imagen + Veo
# OPENAI_API_KEY=your-openai-key               # alternative: OpenAI provider

# ── Optional: More generation providers ─────────────────────
# REPLICATE_API_TOKEN=                          # 13+ image/video models
# GOOGLE_VERTEX_PROJECT=                        # Vertex AI (service account)
# GOOGLE_VERTEX_LOCATION=global                 # global for image/LLM
# GOOGLE_VERTEX_VIDEO_LOCATION=us-central1      # us-central1 for video
# GOOGLE_APPLICATION_CREDENTIALS=               # path to SA JSON
```

The configured `lovart-dofe-ai-local` client allows `openid profile email offline_access`.
Refresh tokens remain in an HttpOnly cookie, so browser session renewal does not expose
long-lived SSO credentials to JavaScript.

> **Note**: See [Environment Variables Reference](#environment-variables-reference) for the full list.

### 4. Start Development

```bash
pnpm dev
```

This starts all services simultaneously:

| Service | URL | Description |
|---------|-----|-------------|
| Web | http://localhost:3005 | Next.js frontend |
| API Server | http://localhost:3105 | Fastify API + WebSocket |
| Worker | — | Background job processor |

Open http://localhost:3005 and start creating!

---

## ☁️ Deployment

### Frontend → Vercel

```bash
# Connect your repo to Vercel, then set:
# Build Command:   pnpm --filter @lovart.dofe/shared build && pnpm --filter @lovart.dofe/web build
# Output Directory: apps/web/out
# Environment Variables: NEXT_PUBLIC_SERVER_BASE_URL
```

### Backend → Railway

The backend runs as two services from a single Docker image, differentiated by `SERVICE_MODE`:

**API Service:**
```bash
SERVICE_MODE=api
LOVART_DOFE_SERVER_PORT=3105
```

**Worker Service:**
```bash
SERVICE_MODE=worker
WORKER_ID=railway-w1
```

Both services share the native data-plane and AI environment variables.

The `Dockerfile` at `apps/server/Dockerfile` handles the multi-stage build.

### Database → PostgreSQL

```bash
# Apply all server-owned migrations
pnpm --filter @lovart.dofe/server db:migrate
```

---

## ⚡ Worker Scaling

Each worker consumes image and video jobs from RabbitMQ. Job state, attempts, retries,
and dead-letter status are recorded in PostgreSQL; delivery is therefore at-least-once
and executors must remain idempotent for a job ID.

```bash
# Local: start multiple workers
pnpm --filter @lovart.dofe/server dev:workers:2   # 2 workers (6 concurrent jobs)
pnpm --filter @lovart.dofe/server dev:workers:3   # 3 workers (9 concurrent jobs)
```

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKER_IMAGE_CONCURRENCY` | `3` | Image generation slots |
| `WORKER_VIDEO_CONCURRENCY` | `2` | Video generation slots |
| `WORKER_ID` | random | Worker instance identifier |

On Railway, scale by adding more worker service replicas.

---

## 📂 Project Structure

```
lovart.dofe/
├── apps/
│   ├── web/                    # Next.js 15 frontend
│   │   ├── src/
│   │   │   ├── app/            #   App Router pages (workspace, canvas, auth, pricing)
│   │   │   ├── components/     #   React components (canvas, chat, credits, auth)
│   │   │   ├── hooks/          #   Custom React hooks
│   │   │   └── lib/            #   Client utilities & API helpers
│   │   └── public/             #   Static assets
│   │
│   └── server/                 # Fastify API + Worker
│       ├── src/
│       │   ├── agent/          #   LangGraph agent, tools, prompts
│       │   ├── generation/     #   Image & video generation providers
│       │   │   └── providers/  #     Google, OpenAI, Replicate, Vertex AI, Volces
│       │   ├── features/       #   Domain services
│       │   │   ├── credits/    #     Credit system & tier guard
│       │   │   ├── payments/   #     LemonSqueezy integration
│       │   │   ├── jobs/       #     RabbitMQ job orchestration & executors
│       │   │   ├── canvas/     #     Canvas CRUD
│       │   │   ├── chat/       #     Chat threads & messages
│       │   │   └── brand-kit/  #     Brand kit management
│       │   ├── http/           #   REST route handlers
│       │   ├── ws/             #   WebSocket handlers
│       │   ├── config/         #   Environment config loader
│       │   └── queue/          #   RabbitMQ client
│       └── Dockerfile          #   Multi-stage Docker build
│
├── packages/
│   ├── shared/                 # Shared types, contracts, credit config
│   ├── config/                 # Shared configuration
│   └── ui/                     # Shared UI components
│
├── skills/                     # Extensible workspace skills
│   ├── canvas-design/          #   Canvas design guidance
│   └── json-image-prompt/      #   Image prompt templates
│
├── apps/server/migrations/     # Server-owned PostgreSQL migrations
│
├── .env.example                # Environment template
├── turbo.json                  # Turborepo config
├── pnpm-workspace.yaml         # pnpm workspace definition
└── package.json                # Root scripts
```

---

## 🔐 Environment Variables Reference

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Native PostgreSQL connection string |
| `TOS_*` | Server-only Volcengine TOS credentials and bucket endpoints |
| `SSO_ISSUER`, `SSO_CLIENT_ID`, `JWKS_URI` | SSO token verification configuration |
| `SSO_CLIENT_SECRET`, `SSO_INTERNAL_API_URL` | Server-only OIDC exchange configuration |
| `RABBITMQ_URL` | Required by the worker and enables asynchronous generation routes on the API |

### AI Model Router (recommended)

`models.dofe.ai` is the catalog and routing authority for Agent/LLM calls.
Configure this pair to use the ixicai data plane. A root URL such as
`https://ixicai.cn` is normalized to `https://ixicai.cn/api`; the root itself
serves the interactive application rather than the model API.

| Variable | Description |
|----------|-------------|
| `DOFE_MODEL_BASE_URL` | DoFe Models gateway, e.g. `https://ixicai.cn` or `https://ixicai.cn/api` |
| `DOFE_MODEL_API_KEY` | Server-only DoFe Models API key; required together with the base URL |

The server reads the API-key-scoped `/v1/models` catalog, caches it briefly,
and excludes known asynchronous image/video aliases from the Agent picker. It
selects a native gateway protocol by model family: `gemini-*` uses `/gemini`,
`claude-*` uses `/anthropic`, and all other text aliases use OpenAI-compatible
`/v1`. The gateway remains responsible for alias resolution, provider choice,
protocol transforms, fallback, billing, and usage records. Existing workspace
settings with `openai:` or `google:` prefixes are migrated in-memory to the
gateway alias when the router is enabled.

### Direct AI Providers (fallback without the router)

| Variable | Description |
|----------|-------------|
| `LOVART_DOFE_AGENT_MODEL` | Agent LLM model (e.g., `dofe:gpt-5.4`; legacy `google:gemini-2.5-flash` remains supported) |
| `GOOGLE_API_KEY` | Google AI API key (Gemini + Imagen + Veo) |
| `OPENAI_API_KEY` | OpenAI API key (GPT + DALL-E) |
| `OPENAI_API_BASE` | Custom OpenAI-compatible endpoint |
| `REPLICATE_API_TOKEN` | Replicate API token (13+ models) |

### Google Vertex AI (optional)

| Variable | Description |
|----------|-------------|
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON |
| `GOOGLE_VERTEX_PROJECT` | GCP project ID |
| `GOOGLE_VERTEX_LOCATION` | Region for image/LLM (`global`) |
| `GOOGLE_VERTEX_VIDEO_LOCATION` | Region for video (`us-central1`) |

### Server & Worker

| Variable | Default | Description |
|----------|---------|-------------|
| `LOVART_DOFE_SERVER_PORT` | `3105` | API server port |
| `LOVART_DOFE_WEB_ORIGIN` | `http://localhost:3005` | Frontend origin (CORS) |
| `LOVART_DOFE_AGENT_BACKEND_MODE` | `state` | Agent persistence (`state` or `filesystem`) |
| `LOVART_DOFE_SKILLS_ROOT` | `../../skills` | Path to skills directory |
| `WORKER_CONCURRENCY` | `3` | Jobs per worker |
| `WORKER_IMAGE_CONCURRENCY` | `3` | Image generation slots |
| `WORKER_VIDEO_CONCURRENCY` | `2` | Video generation slots |
| `GOOGLE_FONTS_API_KEY` | — | Google Fonts API (brand kit) |

---

## 🤖 Supported Models

### Image Generation

| Provider | Models |
|----------|--------|
| Google (API Key) | Imagen 4, Gemini 2.5 Flash Image, Gemini 3 Pro Image |
| Google (Vertex AI) | Gemini 3 Pro Image, Gemini 3.1 Flash Image, Gemini 2.5 Flash Image |
| OpenAI | DALL-E 3, GPT Image 1.5 |
| Replicate | Flux Kontext Pro/Max, SDXL, Recraft V3, Seedream, and more |

### Video Generation

| Provider | Models |
|----------|--------|
| Google (API Key) | Veo 3.1, Veo 3.1 Fast, Veo 3.1 Lite, Veo 3.0, Veo 2.0 |
| Google (Vertex AI) | Veo 3.1, Veo 3.1 Fast, Veo 3.1 Lite, Veo 3.0, Veo 2.0 |
| Replicate | Kling V3, Seedance 1.5, Wan 2.6, Sora 2, Hailuo 2.3, and more |

### LLM (Agent)

| Provider | Models |
|----------|--------|
| Google | Gemini 2.5 Flash, Gemini 2.5 Pro, Gemini 3 Flash |
| OpenAI | GPT-4o, GPT-4o-mini, or any OpenAI-compatible endpoint |

---

## 🤝 Contributing

Contributions welcome!

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

[MIT](LICENSE)

---

<p align="center">
  Built with ☕ and curiosity.
</p>
