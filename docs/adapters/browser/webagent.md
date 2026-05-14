# WebAgent

Drive **WebAgent / 产业决策智能体** ([agent.famou.com](https://agent.famou.com)) from the terminal. Commands use the signed-in browser session and WebAgent's own `/proxyApi/console/v1/...` endpoints.

**Mode**: 🔐 Browser · **Domain**: `agent.famou.com`

## Commands

| Command | Description | Access |
|---------|-------------|--------|
| `opencli webagent status` | Check page availability, login state, and current session | read |
| `opencli webagent projects` | List WebAgent projects | read |
| `opencli webagent history` | List recent sessions | read |
| `opencli webagent read` | Read the current `/chat/<id>` session | read |
| `opencli webagent detail <id>` | Read a session by ID or URL | read |
| `opencli webagent share <id>` | Create a share link for a session | write |
| `opencli webagent rename <id> <title>` | Rename a session | write |
| `opencli webagent delete <id>` | Delete a session | write |
| `opencli webagent move <id> --project-id <project_id>` | Move a session to a project | write |
| `opencli webagent project-create <name>` | Create a project | write |
| `opencli webagent project-detail <id>` | Read project details | read |
| `opencli webagent project-rename <id> <name>` | Rename a project | write |
| `opencli webagent project-remove-session <id> --project-id <project_id>` | Remove a session from a project | write |
| `opencli webagent project-delete <id>` | Delete a project | write |
| `opencli webagent ask <prompt>` | Start a session and wait for the assistant reply | write |
| `opencli webagent ask <prompt> --data <text>` | Start a session with inline data uploaded as a text attachment | write |
| `opencli webagent ask <prompt> --data-file <path>` | Start a session with a local data file attachment | write |
| `opencli webagent ask <prompt> --file <path>` | Start a session with a local file attachment | write |
| `opencli webagent ask <prompt> --id <id>` | Continue an existing session and wait for the reply | write |
| `opencli webagent send <id> <prompt>` | Send to an existing session and keep the stream open until completion | write |
| `opencli webagent clarify <id>` | Submit default answers to the latest clarification card | write |
| `opencli webagent receipt <id>` | Show the latest task receipt, artifact links, and suggested next actions | read |
| `opencli webagent evolve <id>` | Start the WebAgent deep-evolution action for the latest suggestion card | write |
| `opencli webagent evolve <id> --later` | Click the WebAgent “稍后再说” action for the latest suggestion card | write |
| `opencli webagent new` | Open the WebAgent workspace | write |
| `opencli webagent cancel <id>` | Cancel a running session | write |

## Usage Examples

```bash
# Check login/session state
opencli webagent status

# List projects
opencli webagent projects --limit 20

# Ask a new task
opencli webagent ask "帮我分析这份排产约束，并给出执行方案"

# Ask with inline data uploaded as an attachment
opencli webagent ask "根据附件数据分析新能源汽车产业链投资机会" \
  --data "company,segment,revenue\n宁德时代,动力电池,4000\n比亚迪,整车,6000"

# Ask with a local data file or spreadsheet
opencli webagent ask "根据这份数据给我做一版排产优化" --data-file ./orders.csv
opencli webagent ask "分析这个附件" --file ./industry-report.pdf

# Attach the task to an existing WebAgent project
opencli webagent ask "基于项目资料继续分析" --project-id <project_id>

# Continue an existing task
opencli webagent ask "继续细化交付步骤" --id sess_123456789
opencli webagent send https://agent.famou.com/chat/sess_123456789 "停止当前方向，改成成本优先"
opencli webagent send sess_123456789 "结合这份补充数据更新结论" --data-file ./update.csv

# Submit answers to the latest clarification card
opencli webagent clarify sess_123456789
opencli webagent clarify sess_123456789 --answer 4="不对，按各门店分别往返仓库距离加总"

# Show the final receipt, attached artifacts, session URL, and available follow-ups
opencli webagent receipt sess_123456789

# Start or dismiss WebAgent's deep-evolution suggestion
opencli webagent evolve sess_123456789
opencli webagent evolve sess_123456789 --later

# Read history and details
opencli webagent history --limit 10
opencli webagent detail sess_123456789 --turns 10
opencli webagent read

# Manage sessions
opencli webagent share sess_123456789
opencli webagent rename sess_123456789 "新的任务标题"
opencli webagent move sess_123456789 --project-id <project_id>
opencli webagent delete sess_123456789

# Manage projects
opencli webagent project-create "供应链分析"
opencli webagent project-detail <project_id>
opencli webagent project-rename <project_id> "供应链分析-新版"
opencli webagent project-remove-session sess_123456789 --project-id <project_id>
opencli webagent project-delete <project_id>

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
| `--file` | Local file to upload and attach |
| `--data` | Inline text data to upload as a generated `.txt` attachment |
| `--data-file` | Local data file to upload and attach |

### `send`

| Option | Description |
|--------|-------------|
| `id` | Existing session ID or chat URL |
| `prompt` | Prompt to send |
| `--timeout` | Max seconds to keep the stream open (default: `120`) |
| `--file` | Local file to upload and attach |
| `--data` | Inline text data to upload as a generated `.txt` attachment |
| `--data-file` | Local data file to upload and attach |

### `clarify`

| Option | Description |
|--------|-------------|
| `id` | Existing session ID or chat URL |
| `--answer` | Optional answer override in `question=value` form; question can be 1-based index or label |
| `--note` | Optional extra note appended as `补充说明` |
| `--force` | Submit even if the latest clarification already has a following user answer |
| `--turns` | Number of recent turns to inspect (default: `20`) |
| `--timeout` | Max seconds to wait for response (default: `120`) |

### `receipt`

| Option | Description |
|--------|-------------|
| `id` | Existing session ID or chat URL |
| `--turns` | Number of recent turns to inspect (default: `10`) |

### `evolve`

| Option | Description |
|--------|-------------|
| `id` | Existing session ID or chat URL |
| `--later` | Click WebAgent's `稍后再说` action instead of starting deep evolution |
| `--force` | Send `/evolve` even if no recent suggestion card is found |
| `--skip-check` | Skip the WebAgent credit check before submitting |
| `--turns` | Number of recent turns to inspect for an evolution suggestion (default: `10`) |
| `--timeout` | Max seconds to wait for the evolution response (default: `300`) |

### `projects`

| Option | Description |
|--------|-------------|
| `--limit` | Max projects to list (default: `100`) |
| `--page` | Project page number (default: `1`) |

### `history`

| Option | Description |
|--------|-------------|
| `--limit` | Max sessions to list (default: `20`) |
| `--page` | History page number (default: `1`) |

### Session Management

| Command | Options |
|---------|---------|
| `share <id>` | `--title`, `--expire-days` (default: `7`) |
| `rename <id> <title>` | Rename a session |
| `move <id>` | `--project-id`, optional `--from-project-id` |
| `delete <id>` | Delete a session |

### Project Management

| Command | Options |
|---------|---------|
| `project-create <name>` | Create a project |
| `project-detail <id>` | Read project metadata, file names, and task IDs |
| `project-rename <id> <name>` | Rename a project |
| `project-remove-session <id>` | `--project-id`; remove the session from that project without deleting the session |
| `project-delete <id>` | Delete a project |

### `read` / `detail`

| Option | Description |
|--------|-------------|
| `--turns` | Number of recent turns to fetch (default: `10`) |

## Output Columns

| Command | Columns |
|---------|---------|
| `status` | `status, login, user, session_id, url` |
| `projects` | `index, name, id, file_count, skill_count, task_count, created_at, file_limit, size_limit` |
| `history` | `index, title, id, status, project_id, updated_at, url` |
| `read` / `detail` | `role, text` |
| `ask` | `response, session_id, url, files, receipt, artifacts, evolve, next_actions` |
| `send` | `status, session_id, url, response, files, receipt, artifacts, evolve, next_actions` |
| `clarify` | `status, session_id, url, submitted, response, receipt, artifacts, evolve, next_actions` |
| `receipt` | `session_id, url, receipt, response, artifacts, evolve, next_actions` |
| `evolve` | `status, session_id, url, response, credits, artifacts, evolve, next_actions` |
| `share` | `session_id, title, expire_days, share_url` |
| `rename` | `status, session_id, title` |
| `move` | `status, session_id, from_project_id, project_id` |
| `delete` | `status, session_id` |
| `project-create` | `status, name, id` |
| `project-detail` | `name, id, file_count, skill_count, task_count, task_ids, files` |
| `project-rename` | `status, project_id, name` |
| `project-remove-session` | `status, session_id, project_id` |
| `project-delete` | `status, project_id` |
| `new` | `status, url` |
| `cancel` | `status, session_id` |

## Prerequisites

- Chrome is running
- You are already signed into [agent.famou.com](https://agent.famou.com)
- [Browser Bridge extension](/guide/browser-bridge) is installed

## Notes

- `ask` creates a server session only when the first prompt is submitted; `new` only opens the WebAgent workspace.
- Most commands use WebAgent's browser-authenticated HTTP/SSE endpoints; `clarify` opens the chat page and clicks the clarification card's submit button so it matches the WebAgent UI flow.
- `ask`, `send`, `clarify`, `receipt`, and `evolve` surface the WebAgent session URL. When WebAgent returns `<artifacts>` or `<evolve>` cards, the CLI exposes artifact download links, reasons for deep evolution, and follow-up commands.
- `evolve` first calls WebAgent's evolution credit check endpoint, then clicks the page action when available. If the page button is not present, it falls back to sending `/evolve` to the session. `--later` is a page-local dismissal action, matching the web UI.
- The response stream ends when WebAgent emits a terminal status (`idle`, `ended`, `failed`, or `cancelled`).
- File upload uses WebAgent's browser-authenticated BOS upload flow. The CLI currently limits browser-side uploads to 25 MB per file.
- `--file`, `--data-file`, and `--data` are submitted as WebAgent attachments. `--data` creates a temporary `.txt` attachment; local files are not copied into the prompt text.
