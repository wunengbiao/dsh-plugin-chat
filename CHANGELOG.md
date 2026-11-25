# Changelog

## 0.1.0 — 2026-11-25

First release.

- A two-state 对话 / 写代码 switch on the sidebar collapse control's row (frame-level overlay anchored to the measured control on desktop; the header's leading cell in the browser shell). Hidden on a collapsed rail.
- The `chat` Agent preset: persona, `web_search` / `web_fetch`, `ask_user_question`, compaction — no filesystem, shell, editing, subagent or workflow tool.
- A tool mask on every chat Agent that keeps only the three conversational tools, covering deployment-wide registrations such as MCP servers.
- A provisioned chat Workspace (`~/DSH-Chat`, name 对话) so a chat never asks for a directory.
- A mode-scoped sidebar: chat mode lists only conversations (no workspace rows, flush-left rows, section header renamed to 对话 with a new-chat button), code mode hides the chat Workspace and its Sessions.
- A Settings section that edits the chat system prompt (`$DSH_HOME/dsh-plugin-chat.json`, applied from the next message without a restart).
- Bracketed link citations: the default prompt asks for `[[n]](url)` markers plus a 来源 section, so answers render clickable `[1]` citations instead of dead brackets.
- Composer cleanup in chat mode: sandbox preset, third-party mode selector, and the new-session workspace/preset pickers are hidden.
