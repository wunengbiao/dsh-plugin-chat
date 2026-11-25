# dsh-plugin-chat

English | [中文](README.zh.md)

Chat mode for DeepSeek Harness: a two-state switch beside the sidebar collapse control opens a conversation-only session — no directory to pick, no coding tools, web search included, and an editable system prompt.

```
🐟 deepseek HARNESS  ( 对话 | </> )  ⧉          ← desktop, sidebar expanded: chrome strip
🐟 deepseek HARNESS  ⧉ │ ( 对话 | </> )  标题     ← browser shell, sidebar expanded
                                                   (a collapsed rail shows no switch)
```

## What it adds

| Part | Kind | What it does |
|---|---|---|
| `shell.overlay` occupant `dsh-plugin-chat-switch` | Client slot | The switch as a frame-level floating control anchored to the measured sidebar collapse control (desktop shell) |
| `shell.overlay` occupant `dsh-plugin-chat-sidebar-filter` | Client slot | One stylesheet that narrows the sidebar to the active mode |
| `conversation.header.leading` occupant | Client slot | The switch in flow, immediately right of the sidebar edge — only while the sidebar is expanded and the shell has no chrome strip (browser shell) |
| `conversation.session.header.actions` `dsh-plugin-chat-mode` | Client slot | Renders nothing; publishes which mode the displayed Session belongs to |
| `settings.section` `dsh-plugin-chat` | Client slot | Settings page that edits the chat system prompt |
| `dsh-plugin-chat` Host row | Host plugin | Provisions the chat Workspace, serves `/dsh-plugin-chat/v1/info` and `/dsh-plugin-chat/v1/system-prompt`, appends the instructions section and the tool mask to every `chat` Agent |
| `preset-chat` row | Agent preset | The `chat` composition: persona + `web_search`/`web_fetch` + `ask_user_question` + compaction, and no filesystem, shell, edit, subagent or workflow tool |

## Two isolated modes

The sidebar follows the mode. In chat mode every workspace row and every non-chat Session is hidden and the remaining rows drop their depth padding and leading status cell, so the sidebar is a flush-left list of conversations; the section header reads 对话 and its add button becomes new chat, while the chat Workspace itself never appears as a folder. The composer drops the sandbox-preset and third-party mode controls, which only matter for code work. In code mode that Workspace and all of its Sessions are hidden instead, so the two sets never mix.

The host's session list exposes no filtering seat, so the filter is one generated stylesheet over the host's own `data-row-key` rows (`workspace:<id>` / `session:<id>`). Nothing in the host tree is mutated, and creating a Session re-runs the filter.

## How the two halves meet

The switch asks the Host for the Workspace it provisions (`~/DSH-Chat` by default), then opens that Workspace's blank Session through `uiWorkspace.startSession` under the `chat` preset, so no directory picker ever appears. `写代码` opens the most recent Workspace that is not the chat one. The displayed Session's working directory decides which segment is active.

Because a preset cannot remove tools a deployment registers globally, the Host half also restricts each chat Agent to `web_search`, `web_fetch`, and `ask_user_question`; MCP servers, the working-directory switcher, and every other global tool stay out of chat sessions.

## Install

```
plugin_manager action=install_bundle target=/absolute/path/to/dsh-plugin-chat
```

New conversations pick up the `chat` preset; an open conversation keeps the preset it started with.

## Configure

`cordis.patch.yml` carries the defaults:

| Field | Default | Meaning |
|---|---|---|
| `systemPrompt` | built-in Chinese prompt | Initial default and what Settings restores; a prompt saved in Settings wins |
| `workspaceDir` | `~/DSH-Chat` | Directory behind the chat Workspace |
| `workspaceTitle` | `对话` | Workspace name in the sidebar |

A saved prompt is stored in `$DSH_HOME/dsh-plugin-chat.json` (0600) and read on every prompt assembly, so it applies from the next message without restarting the plugin.

## Limits

- The sidebar's own top strip (the row the collapse control sits in) exposes no slot, so the switch cannot render *inside* the sidebar beside that control; it renders in the conversation header's leading cell, which the host centres on the same row.
- Tools that a deployment registers *after* a chat Agent was created are not masked; the `chat` preset still keeps code work out.
