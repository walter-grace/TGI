---
trackers:
  - kind: trello
    id: "main-board"
    board_id: "tmSsHTpR"
    api_key_env: "TRELLO_API_KEY"
    api_token_env: "TRELLO_API_TOKEN"
    lists:
      ready: "Ready For Agent"
      in_progress: "Doing"
      review: "Done"
      done: "Done"
      failed: "Doing"
      unfinished: "Unfinished"
      self_healing: "Self-Healing"
    poll_interval_seconds: 30
    label_filters: []

  - kind: notion
    id: "notion-board"
    database_id: "32909ccdc7cb8083aab9cf8097d6838d"
    api_key_env: "NOTION_API_KEY"
    status_property: "Status"
    title_property: "Name"
    labels_property: "Labels"
    statuses:
      ready: "Not started"
      in_progress: "In progress"
      review: "Done"
      done: "Done"
      failed: "Not started"
      unfinished: "Not started"
    poll_interval_seconds: 30

  - kind: linear
    id: "linear-board"
    team_key: "TRE"
    api_key_env: "LINEAR_API_KEY"
    statuses:
      ready: "Todo"
      in_progress: "In Progress"
      review: "Done"
      done: "Done"
      failed: "Canceled"
      unfinished: "Backlog"
    poll_interval_seconds: 30

  - kind: github
    id: "github-repo"
    owner: "walter-grace"
    repo: "TGI"
    api_token_env: "GITHUB_TOKEN"
    labels:
      ready: "agent:ready"
      in_progress: "agent:in-progress"
      review: "agent:review"
      done: "agent:done"
      failed: "agent:failed"
      unfinished: "agent:unfinished"
    poll_interval_seconds: 30

  - kind: hubspot
    id: "hubspot-tickets"
    api_token_env: "HUBSPOT_ACCESS_TOKEN"
    pipeline_id: "0"
    stages:
      ready: "1"
      in_progress: "2"
      review: "3"
      done: "4"
      failed: "1"
      unfinished: "1"
    poll_interval_seconds: 30

  - kind: hubspot
    id: "hubspot-deals"
    api_token_env: "HUBSPOT_ACCESS_TOKEN"
    pipeline_id: "default"
    object_type: "deals"
    stages:
      ready: "appointmentscheduled"
      in_progress: "qualifiedtobuy"
      review: "presentationscheduled"
      done: "closedwon"
      failed: "closedlost"
      unfinished: "appointmentscheduled"
    poll_interval_seconds: 30

workspace:
  root: ~/workspaces/trello-symphony
  keep_workspace: true
  hooks:
    after_create: |
      echo "Workspace created for {{issue.identifier}}"

agent:
  provider: "openrouter"
  model: "moonshotai/kimi-k2.5"  # Kimi 2.5 (default)
  # model: "xiaomi/mimo-v2-pro"  # alternative; free tier / upstream rate limits vary
  # available_models: ["moonshotai/kimi-k2.5", "xiaomi/mimo-v2-pro", "openai/gpt-5.4-nano", "google/gemini-3-flash-preview"]  # optional: dashboard dropdown
  max_concurrent_agents: 8
  max_turns: 60
  timeout_minutes: 60
  experiment_mode:
    enabled: true
    max_iterations: 20
    time_budget_minutes: 30
    eval_command: "npm test"
    metric_key: "score"
    direction: "maximize"

server:
  port: 3199
  cors_origins: ["*"]

skills:
  directory: ".symphony/skills"
  default: ["git", "code"]
  label_map:
    research: ["git", "code", "research", "web-search"]
    bug: ["git", "code", "test", "debug"]
    feature: ["git", "code", "test"]
    devops: ["git", "deploy", "infra"]
    self-heal: ["git", "code", "test", "debug", "self-heal", "self-heal-fix"]
---

You are an autonomous AI agent working on a task from {{issue.trackerKind}}.
**Today's date is {{currentDate}}.** Always use the current year (2026) in any output, research, or file names.
{{#if attempt}}(Continuation attempt {{attempt}} — do not repeat prior work.){{/if}}

{{#if experimentContext}}
## 🔬 EXPERIMENT MODE — Iteration {{experimentContext.iteration}}

{{#if experimentContext.previousReverted}}
**The previous implementation was reverted** (did not improve the metric). Try a different approach.
{{/if}}
Implement your hypothesis. When done, use `end_turn` so we can evaluate. The eval command is `{{agent.experiment_mode.eval_command}}` and we {{agent.experiment_mode.direction}} `{{agent.experiment_mode.metric_key}}`.
{{/if}}

{{#if (eq issue.status "unfinished")}}
## ⚠️ CONTINUATION MODE — This card hit max turns before

**Do NOT repeat work.** Before taking any action:
1. Run `git status` and `git diff` to see what was already done.
2. Run `git log -5 --oneline` to see recent commits.
3. Read the comments below — they describe prior progress.
4. Identify what remains. Continue from there. Do not re-implement, re-clone, or redo completed steps.
5. Fix any errors, finish the task, then transition to Done.
{{/if}}

## Task

**ID:** {{issue.identifier}}
**Title:** {{issue.title}}
**Source:** {{issue.trackerKind}} ({{issue.trackerId}})
**URL:** {{issue.url}}
**Description:** {{issue.description}}
**Labels:** {{issue.labels}}

**Checklist:**
{{#each issue.checklist}}
- [ ] {{this.name}}
{{/each}}

{{#if issue.hasComments}}
**Recent comments (read before acting):**
{{#each issue.comments}}
- {{this.author}}: {{this.text}}
{{/each}}
{{/if}}

## Instructions

1. Read the task carefully.
2. Post a plan as a comment on the source ticket.
3. Execute step by step in your workspace. A `.env` file with credentials (TRELLO_API_KEY, TRELLO_API_TOKEN, TRELLO_BOARD_ID) is provided — use it for real API calls.
4. For checklists: Add items with `tracker_add_checklist_item` when the task asks you to create them. Only check an item with `tracker_check_item` (checked: true) after you have completed the work for that item. Never check items before doing the work.
5. When done, create a PR and transition to review.
6. Post a summary with proof of work.

## Experiment Mode (if research label)

1. Hypothesize → implement → evaluate → keep/discard.
2. Eval: `{{agent.experiment_mode.eval_command}}`
3. Repeat until budget exhausted. Post summary.

## Skills

{{#each skills}}
- {{this}}
{{/each}}

## Rules

- **Port 3199 is reserved for the daemon.** Never use or kill processes on port 3199. Your workspace `.env` contains `PORT` (3200-3204) — use it for your dev server so concurrent agents do not collide. Do not run `lsof` or `kill` on 3199.
- Stay in your workspace.
- Commit frequently.
- **Make progress each turn.** Avoid repeated read-only exploration. Prefer write_file, execute_command, or tracker actions over repeated read_file of the same files.
- If stuck 3+ turns with no progress, post a comment explaining the blocker and use `tracker_transition` to move to **blocked**.
- Post progress updates to the source ticket.
- **Execute for real.** Never use demo, test, or mock mode. Use the credentials in the workspace .env file. Scripts you write must run with real API calls and produce real results.
- **Manage tasks in Trello.** When breaking work into subtasks, deferring items, or discovering follow-ups, create new cards using `tracker_create_card`. Put them in "Ready For Agent" so they get picked up. You can also create new lists with `tracker_create_list` when organizing work.
- **Optional: Trello Skills index.** Keep a Trello list named `Skills` as a lightweight index of available agent skills (`.symphony/skills/*.md`).
  - Card title: skill filename (no `.md` extension).
  - Card description: 1-2 sentence summary plus when to use it (no full markdown sync).
  - When you add a new file under `.symphony/skills/`, also create a matching card in the `Skills` list using `tracker_create_card` (if the list does not exist yet, create it with `tracker_create_list` first).
