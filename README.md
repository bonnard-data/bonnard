<p align="center">
  <a href="https://www.bonnard.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./assets/banner-dark.png" />
      <source media="(prefers-color-scheme: light)" srcset="./assets/banner-light.png" />
      <img alt="Bonnard: agent-native analytics. One schema, many surfaces." src="./assets/banner-light.png" width="100%" />
    </picture>
  </a>
</p>

<p align="center">
  <strong>Self-hosted semantic layer for AI agents.</strong>
</p>

<p align="center">
  <a href="https://github.com/bonnard-data/bonnard/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue?style=flat-square" alt="Apache 2.0 License" /></a>
  <a href="https://ghcr.io/bonnard-data/bonnard"><img src="https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" /></a>
  <a href="https://discord.com/invite/RQuvjGRz"><img src="https://img.shields.io/badge/Discord-Join%20us-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord" /></a>
</p>

<p align="center">
  <a href="https://docs.bonnard.dev/docs/">Docs</a> &middot;
  <a href="https://www.npmjs.com/package/@bonnard/cli">CLI</a> &middot;
  <a href="https://discord.com/invite/RQuvjGRz">Discord</a> &middot;
  <a href="https://www.bonnard.dev">Website</a>
</p>

---

Bonnard is an agent-native semantic layer — one set of metric definitions, every consumer (AI agents, apps, dashboards) gets the same governed answer. This repo is the self-hosted Docker deployment: run Bonnard on your own infrastructure with no cloud account needed.

## Quick Start

```bash
# 1. Scaffold project
npx @bonnard/cli init --self-hosted

# 2. Configure your data source
#    Edit .env with your database credentials

# 3. Start the server
docker compose up -d

# 4. Define your semantic layer
#    Add cube/view YAML files to bonnard/cubes/ and bonnard/views/

# 5. Deploy models to the server
bon deploy

# 6. Verify your semantic layer
bon schema

# 7. Connect AI agents
bon mcp
```

Requires [Node.js 20+](https://nodejs.org) and [Docker](https://docs.docker.com/engine/install/).

## What's Included

- **MCP server** — AI agents query your semantic layer over the [Model Context Protocol](https://docs.bonnard.dev/docs/mcp)
- **Cube semantic layer** — SQL-based metric definitions with caching, access control, and multi-database support
- **Cube Store** — pre-aggregation cache for fast analytical queries
- **Admin UI** — browse deployed models, views, and measures at `http://localhost:3000`
- **Deploy API** — push model updates via `bon deploy` without restarting containers
- **Health endpoint** — `GET /health` for uptime monitoring

## Connecting AI Agents

Run `bon mcp` to see connection config for your setup. Examples below.

### Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "bonnard": {
      "url": "https://bonnard.example.com/mcp",
      "headers": {
        "Authorization": "Bearer your-secret-token-here"
      }
    }
  }
}
```

### Claude Code

```json
{
  "mcpServers": {
    "bonnard": {
      "type": "url",
      "url": "https://bonnard.example.com/mcp",
      "headers": {
        "Authorization": "Bearer your-secret-token-here"
      }
    }
  }
}
```

### CrewAI (Python)

```python
from crewai import MCPServerAdapter

mcp = MCPServerAdapter(
    url="https://bonnard.example.com/mcp",
    transport="streamable-http",
    headers={"Authorization": "Bearer your-secret-token-here"}
)
```

## Production Deployment

### Authentication

Protect your endpoints by setting `ADMIN_TOKEN` in `.env`:

```env
ADMIN_TOKEN=your-secret-token-here
```

All API and MCP endpoints will require `Authorization: Bearer <token>`. The `/health` endpoint remains open for monitoring.

Restart after changing `.env`:

```bash
docker compose up -d
```

### TLS with Caddy

[Caddy](https://caddyserver.com) provides automatic HTTPS via Let's Encrypt.

Create a `Caddyfile` next to your `docker-compose.yml`:

```
bonnard.example.com {
    reverse_proxy localhost:3000
}
```

Add Caddy to your `docker-compose.yml`:

```yaml
  caddy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    restart: unless-stopped
```

Add the volume at the top level:

```yaml
volumes:
  models: {}
  caddy_data: {}
```

Then remove the Bonnard port mapping (`ports: - "3000:3000"`) since Caddy handles external traffic.

### Deploy to a VM

```bash
# Copy project files to your server
scp -r . user@your-server:~/bonnard/

# SSH in and start
ssh user@your-server
cd ~/bonnard
docker compose up -d
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `CUBEJS_DB_TYPE` | Database driver (`postgres`, `duckdb`, `snowflake`, `bigquery`, `databricks`, `redshift`, `clickhouse`) | `duckdb` |
| `CUBEJS_DB_*` | Database connection settings (host, port, name, user, pass) | — |
| `CUBEJS_DATASOURCES` | Comma-separated list for multi-datasource setups | `default` |
| `CUBEJS_API_SECRET` | HS256 secret for Cube JWT auth (auto-generated by `bon init`) | — |
| `ADMIN_TOKEN` | Bearer token for API/MCP authentication | — (open) |
| `CUBE_PORT` | Cube API port | `4000` |
| `BONNARD_PORT` | Bonnard server port | `3000` |
| `CORS_ORIGIN` | Allowed CORS origins | `*` |
| `CUBE_VERSION` | Cube Docker image tag | `v1.6` |
| `BONNARD_VERSION` | Bonnard Docker image tag | `latest` |

See `.env.example` for a full annotated configuration file.

## Architecture

| Service | Image | Role |
|---------|-------|------|
| `cube` | `cubejs/cube` | Semantic layer engine — executes queries against your warehouse |
| `cubestore` | `cubejs/cubestore` | Pre-aggregation cache — stores materialized results for fast reads |
| `bonnard` | `ghcr.io/bonnard-data/bonnard` | MCP server, admin UI, deploy API — the interface layer for agents and tools |

All three services communicate over an internal Docker network. Only `bonnard` (port 3000) and optionally `cube` (port 4000) are exposed externally.

## Monitoring

```bash
# Health check
curl http://localhost:3000/health

# View logs
docker compose logs -f

# View active MCP sessions
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/mcp/sessions
```

## Deploying Schema Updates

From your development machine:

```bash
bon deploy
```

This pushes your cube/view YAML files to the running server. No restart needed — Cube picks up changes automatically.

## Pinning Versions

Control image versions via `.env`:

```env
CUBE_VERSION=v1.6
BONNARD_VERSION=latest
```

## Supported Data Sources

**Warehouses:** Snowflake, Google BigQuery, Databricks, PostgreSQL (including Supabase, Neon, RDS), Amazon Redshift, DuckDB (including MotherDuck), ClickHouse

See the [full documentation](https://docs.bonnard.dev/docs/getting-started) for connection guides.

## Ecosystem

- **[@bonnard/cli](https://www.npmjs.com/package/@bonnard/cli)** — scaffold projects, deploy models, connect agents
- **[@bonnard/sdk](https://www.npmjs.com/package/@bonnard/sdk)** — query the semantic layer from JavaScript/TypeScript
- **[@bonnard/react](https://www.npmjs.com/package/@bonnard/react)** — React chart components and dashboard viewer

## Community

- [Discord](https://discord.com/invite/RQuvjGRz): ask questions, share feedback, connect with the team
- [GitHub Issues](https://github.com/bonnard-data/bonnard/issues): bug reports and feature requests
- [LinkedIn](https://www.linkedin.com/company/bonnarddev/): follow for updates
- [Website](https://www.bonnard.dev): learn more about Bonnard

## License

[Apache 2.0](./LICENSE)
