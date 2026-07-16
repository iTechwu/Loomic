# Canvas Design Skill — Integration & Verification Guide

## Local Development Setup

### Prerequisites

- Node.js 22 and the workspace dependencies installed with `pnpm install`
- `DATABASE_URL` and the complete `TOS_*` configuration, because every agent run
  persists workspace state and generated files through the native data plane
- Python 3 with Pillow and ReportLab only when exercising the canvas-design skill

The production image installs Python, Pillow, and ReportLab. Local development must
provide those executables when a skill invokes them.

### Environment Variables

```bash
# .env.local
# The server process runs from apps/server, so this resolves to the repository skill root.
LOVART_DOFE_SKILLS_ROOT=../../skills
LOVART_DOFE_AGENT_BACKEND_MODE=state
```

### Verification Steps

1. Start dev server: `pnpm dev`
2. Open a project in the web UI
3. Send message: "帮我生成一张极简主义风格的海报"
4. Verify:
   - Agent loads the enabled workspace skill (check the agent-run logs)
   - Agent calls `execute` tool with Python code
   - Generated PNG appears in the agent sandbox
   - Agent calls `persist_sandbox_file`, which writes the object to TOS and metadata to PostgreSQL
   - User receives a short-lived TOS read URL
   - The sandbox directory is removed after the run

### Production Deployment

The Dockerfile installs Python, Pillow, and ReportLab and copies `skills/` to
`/opt/lovart-dofe/skills/`. Set `LOVART_DOFE_SKILLS_ROOT=/opt/lovart-dofe/skills`
in the deployment environment; credentials and endpoints remain deployment-managed.

### Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `execute` tool not available | Agent backend is not configured for the state runtime | Check `LOVART_DOFE_AGENT_BACKEND_MODE=state` and agent startup logs |
| Fonts not found | Skills root does not match the process environment | Check `LOVART_DOFE_SKILLS_ROOT` |
| Sandbox directory remains | Run cleanup was interrupted | Inspect the agent-run error logs and the runtime cleanup path |
| Python not found | Not in Docker image | Rebuild Docker image |
| Skill not discovered | The skill is not installed or enabled for the workspace | Check the skills API and workspace skill state |

### Adding New Skills

Place source-controlled skills in `skills/<skill-name>/SKILL.md`. Marketplace
skills are stored in PostgreSQL (`skills`, `skill_files`, and `workspace_skills`)
and become available only after installation and enablement for a workspace.
