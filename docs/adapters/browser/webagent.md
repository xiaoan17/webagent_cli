# WebAgent

Drive **WebAgent / 产业决策智能体** ([agent.famou.com](https://agent.famou.com)) from the terminal. Commands use the signed-in browser session and WebAgent's own `/proxyApi/console/v1/...` endpoints.

**Mode**: 🔐 Browser · **Domain**: `agent.famou.com`

## Commands

| Command | Description | Access |
|---------|-------------|--------|
| `opencli webagent status` | Check page availability, login state, and current session | read |
| `opencli webagent history` | List recent sessions | read |
| `opencli webagent read` | Read the current `/chat/<id>` session | read |
| `opencli webagent detail <id>` | Read a session by ID or URL | read |
| `opencli webagent ask <prompt>` | Start a session and wait for the assistant reply | write |
| `opencli webagent ask <prompt> --id <id>` | Continue an existing session and wait for the reply | write |
| `opencli webagent send <id> <prompt>` | Send to an existing session and keep the stream open until completion | write |
| `opencli webagent new` | Open the WebAgent workspace | write |
| `opencli webagent cancel <id>` | Cancel a running session | write |

## Usage Examples

```bash
# Check login/session state
opencli webagent status

# Ask a new task
opencli webagent ask "帮我分析这份排产约束，并给出执行方案"

# Continue an existing task
opencli webagent ask "继续细化交付步骤" --id sess_123456789
opencli webagent send https://agent.famou.com/chat/sess_123456789 "停止当前方向，改成成本优先"

# Read history and details
opencli webagent history --limit 10
opencli webagent detail sess_123456789 --turns 10
opencli webagent read

# Open a blank workspace or cancel a session
opencli webagent new
opencli webagent cancel sess_123456789
```

## Options

### `ask`

| Option | Description |
|--------|-------------|
| `prompt` | Prompt to send (required positional) |
| `--id` | Existing session ID or `https://agent.famou.com/chat/<id>` URL |
| `--timeout` | Max seconds to wait for the reply (default: `120`) |
| `--project-id` | Optional WebAgent `project_id` for a new session |
| `--agent-type` | WebAgent `config.agent_type` for a new session (default: `opencode`) |

### `send`

| Option | Description |
|--------|-------------|
| `id` | Existing session ID or chat URL |
| `prompt` | Prompt to send |
| `--timeout` | Max seconds to keep the stream open (default: `120`) |

### `history`

| Option | Description |
|--------|-------------|
| `--limit` | Max sessions to list (default: `20`) |
| `--page` | History page number (default: `1`) |

### `read` / `detail`

| Option | Description |
|--------|-------------|
| `--turns` | Number of recent turns to fetch (default: `10`) |

## Output Columns

| Command | Columns |
|---------|---------|
| `status` | `status, login, user, session_id, url` |
| `history` | `index, title, id, status, updated_at, url` |
| `read` / `detail` | `role, text` |
| `ask` | `response, session_id, url` |
| `send` | `status, session_id, response` |
| `new` | `status, url` |
| `cancel` | `status, session_id` |

## Prerequisites

- Chrome is running
- You are already signed into [agent.famou.com](https://agent.famou.com)
- [Browser Bridge extension](/guide/browser-bridge) is installed

## Notes

- `ask` creates a server session only when the first prompt is submitted; `new` only opens the WebAgent workspace.
- This adapter uses WebAgent's browser-authenticated HTTP/SSE endpoints rather than clicking the React UI.
- The response stream ends when WebAgent emits a terminal status (`idle`, `ended`, `failed`, or `cancelled`).
- File upload is not implemented yet; prompts are sent as text content.
