/**
 * Host half of dsh-plugin-chat.
 *
 * Chat mode is two things that the Host owns:
 *
 *   1. a place to talk — one Workspace the plugin provisions itself, so the
 *      user never picks a directory (the Client half opens it through
 *      `uiWorkspace.startSession`);
 *   2. what the conversation may do — the `chat` Agent preset declared beside
 *      this row in `cordis.patch.yml`, plus the editable instructions section
 *      registered below for every Agent composed from that preset.
 *
 * The saved system prompt lives in this plugin's own storage domain rather
 * than in its Loader config: the section text is read on every assembly, so a
 * saved prompt applies to the next step of a live conversation and the plugin
 * never restarts mid-conversation. The `systemPrompt` config field stays as the
 * initial default and the YAML-level override.
 *
 * @module dsh-plugin-chat
 */
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Cordis plugin name. */
export const name = 'dsh-plugin-chat'

/** The composed Web server carries the two routes the Client half reads. */
export const inject = ['webServer']

/** Chat preset id declared by this bundle; also the Session's `agentPreset`. */
export const PRESET_ID = 'chat'

/** Read-only description of chat mode for the Client half. */
export const INFO_ROUTE = '/dsh-plugin-chat/v1/info'

/** Save the chat system prompt. */
export const PROMPT_ROUTE = '/dsh-plugin-chat/v1/system-prompt'

/** Citation ledger of one conversation, for the Client half's source section. */
export const CITATIONS_ROUTE = '/dsh-plugin-chat/v1/citations'

/** The only global tools a chat Agent may keep: conversation and web research. */
const CONVERSATIONAL_TOOLS = ['web_search', 'web_fetch', 'ask_user_question']

/** Prompt section registered for each chat Agent, after the persona prefix. */
const SECTION_NAME = 'chat-mode:instructions'
const SECTION_ORDER = 40
const CONTEXT_NAME = 'chat-mode:citations'
const CONTEXT_ORDER = 1000

/** Plugin-owned settings file under the DSH home, holding the saved prompt. */
const SETTINGS_FILE = 'dsh-plugin-chat.json'
const SETTINGS_VERSION = 1

/** Plugin-owned citation ledger: which numbers a conversation already handed out. */
const LEDGER_FILE = 'dsh-plugin-chat-citations.json'
const LEDGER_VERSION = 1
/** Sources kept per conversation; older ones stay numbered in the transcript only. */
const LEDGER_LIMIT = 400
/** Tool the chat Agent calls to reserve the next citation numbers. */
const CITATION_TOOL = 'citation_index'

/** Largest accepted prompt, in characters. */
const MAX_PROMPT_CHARS = 20000


/**
 * Path of the citation ledger beside the settings file.
 * @returns {string} absolute file path.
 */
function ledgerPath () {
  return join(dirname(settingsPath()), LEDGER_FILE)
}

/**
 * Read the whole ledger, tolerating a missing or damaged file.
 * @returns {Promise<{ version: number, sessions: Record<string, { next: number, sources: object[] }> }>} ledger.
 */
async function readLedger () {
  let raw
  try {
    raw = await readFile(ledgerPath(), 'utf8')
  } catch {
    return { version: LEDGER_VERSION, sessions: {} }
  }
  try {
    const parsed = JSON.parse(raw)
    const sessions = parsed !== null && typeof parsed === 'object' && parsed.sessions !== null && typeof parsed.sessions === 'object'
      ? parsed.sessions
      : {}
    return { version: LEDGER_VERSION, sessions }
  } catch {
    return { version: LEDGER_VERSION, sessions: {} }
  }
}

/** Write the whole ledger atomically, readable by the owner only. */
let ledgerWrite = Promise.resolve()
/**
 * Persist the ledger without overlapping writes.
 * @param {object} ledger - the in-memory ledger.
 * @returns {Promise<void>} completion of this write.
 */
function saveLedger (ledger) {
  const file = ledgerPath()
  const body = JSON.stringify(ledger, null, 2) + '\n'
  ledgerWrite = ledgerWrite.then(async () => {
    await mkdir(dirname(file), { recursive: true })
    const temporary = file + '.tmp-' + process.pid
    await writeFile(temporary, body, { mode: 0o600 })
    await rename(temporary, file)
  }).catch(() => {})
  return ledgerWrite
}

/**
 * One conversation's ledger, created on first use.
 * @param {{ sessions: Record<string, { next: number, sources: object[] }> }} ledger - whole ledger.
 * @param {string} sessionId - conversation id.
 * @returns {{ next: number, sources: object[] }} the conversation entry.
 */
function sessionEntry (ledger, sessionId) {
  let entry = ledger.sessions[sessionId]
  if (entry === undefined || entry === null || typeof entry !== 'object') {
    entry = { next: 1, sources: [] }
    ledger.sessions[sessionId] = entry
  }
  if (!Number.isFinite(entry.next) || entry.next < 1) entry.next = 1
  if (!Array.isArray(entry.sources)) entry.sources = []
  return entry
}

/**
 * Reserve numbers for new sources and record them.
 * @param {{ sessions: Record<string, { next: number, sources: object[] }> }} ledger - whole ledger.
 * @param {string} sessionId - conversation id.
 * @param {Array<{ title?: string, url?: string }>} sources - new sources in reading order.
 * @returns {Array<{ index: number, title: string, url: string }>} assigned numbers.
 */
function reserveCitations (ledger, sessionId, sources) {
  const entry = sessionEntry(ledger, sessionId)
  const assigned = []
  for (const source of sources) {
    const url = typeof source.url === 'string' ? source.url.trim() : ''
    if (url === '') continue
    const title = typeof source.title === 'string' && source.title.trim() !== '' ? source.title.trim() : url
    const index = entry.next
    entry.next += 1
    assigned.push({ index, title, url })
  }
  if (assigned.length > 0) {
    entry.sources.push(...assigned)
    if (entry.sources.length > LEDGER_LIMIT) entry.sources.splice(0, entry.sources.length - LEDGER_LIMIT)
  }
  return assigned
}

const DEFAULT_TITLE = '对话'

/** Used when neither the config nor the store carries a prompt. */
const DEFAULT_PROMPT = [
  '你是 DeepSeek 的对话助手。这里是纯对话模式：用户只想聊天、提问、查资料，不写代码，也不创建文件。',
  '- 用简体中文、自然、简洁地回答；先给结论，再补必要的细节。',
  '- 需要事实、版本、价格、新闻或外部链接时，用 web_search 检索、用 web_fetch 打开页面核实。',
  '- 引用来源时用带方括号编号的 Markdown 链接：正文写成 [[1]](https://…) 这种形式（不要只写 [1]，也不要留裸链接），按首次引用顺序编号。',
  '- 不允许用普通 markdown 链接或「主要来源：…」清单充当出处：正文只编号，清单由插件生成。',
  '- 编号在整个对话里连续：不因新一轮提问回到 1。检索到新来源后先调用 citation_index（action=reserve，按顺序附上 title 与 url）登记，正文用返回的编号；只复用已有来源时沿用原编号。',
  '- 不要在回答里写「来源」「参考来源」等来源列表：文末来源由插件按编号自动生成。检索到新来源后调用 citation_index 登记编号，正文用编号引用即可。',
  '- 你没有文件、shell、编辑或子代理工具，也不要假装执行过它们；如果用户确实要改代码，提醒他切换到「写代码」模式。',
  '- 不确定就说不确定，不要编造来源或数字。',
].join('\n')

/**
 * Live Host state shared by every route handler and section text callback.
 * Module level so a plugin reload swaps the implementation behind the same
 * installed route instead of stacking a second route on the same path.
 * @type {{
 *   workspaceId: string | undefined,
 *   workspacePath: string | undefined,
 *   workspaceTitle: string,
 *   prompt: string,
 *   defaultPrompt: string,
 *   promptPath: string,
 *   ledger: { version: number, sessions: Record<string, { next: number, sources: object[] }> },
 *   toolError: string,
 *   storageReason: string,
 * }}
 */
const state = {
  workspaceId: undefined,
  workspacePath: undefined,
  workspaceTitle: DEFAULT_TITLE,
  prompt: DEFAULT_PROMPT,
  defaultPrompt: DEFAULT_PROMPT,
  promptPath: '',
  ledger: { version: LEDGER_VERSION, sessions: {} },
  toolError: '',
  storageReason: 'pending',
}

/** Route disposer while both routes are installed. */
let releaseRoutes
/** Per-Agent section disposers keyed by Session id. */
const sections = new Map()

/**
 * Resolve the plugin config, filling in the documented defaults.
 * @param {unknown} config - the Loader row's config.
 * @returns {{ systemPrompt: string, workspaceDir: string, workspaceTitle: string }} resolved config.
 */
function normalize (config) {
  const source = config !== null && typeof config === 'object' ? config : {}
  const prompt = typeof source.systemPrompt === 'string' && source.systemPrompt.trim() !== ''
    ? source.systemPrompt
    : DEFAULT_PROMPT
  const dir = typeof source.workspaceDir === 'string' && source.workspaceDir.trim() !== ''
    ? source.workspaceDir.trim()
    : join(homedir(), 'DSH-Chat')
  const title = typeof source.workspaceTitle === 'string' && source.workspaceTitle.trim() !== ''
    ? source.workspaceTitle.trim()
    : DEFAULT_TITLE
  return { systemPrompt: prompt, workspaceDir: resolve(dir), workspaceTitle: title }
}

/**
 * Create the chat directory when missing and return its canonical path.
 * @param {string} dir - configured directory.
 * @returns {Promise<string>} the `fs.realpath` of the directory.
 */
async function ensureDirectory (dir) {
  await mkdir(dir, { recursive: true })
  return realpath(dir)
}

/**
 * Resolve (or provision) the Workspace chat Sessions belong to.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {string} dir - canonical chat directory.
 * @param {string} title - Workspace title for a fresh record.
 * @returns {Promise<{ id: string, path: string } | undefined>} the Workspace identity.
 */
async function ensureWorkspace (ctx, dir, title) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) return undefined
  const existing = await registry.resolveByPath(dir)
  if (existing !== undefined && existing !== null) {
    return { id: String(existing.id), path: String(existing.path ?? dir) }
  }
  const created = await registry.create(dir, title)
  return { id: String(created.id), path: String(created.path ?? dir) }
}

/**
 * Resolve the plugin's own settings file: a JSON document under the DSH home,
 * beside the profile and outside every workspace.
 * @returns {string} absolute file path.
 */
function settingsPath () {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  const home = configured === '' ? join(homedir(), '.dsh') : configured
  return join(home, SETTINGS_FILE)
}

/**
 * Read the saved prompt from the settings file.
 * @param {string} file - settings file path.
 * @returns {Promise<{ prompt: string | undefined, reason: string }>} saved prompt and storage state.
 */
async function readStoredPrompt (file) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    return { prompt: undefined, reason: error?.code === 'ENOENT' ? 'file-empty' : 'file-unreadable' }
  }
  try {
    const parsed = JSON.parse(raw)
    const prompt = typeof parsed?.systemPrompt === 'string' && parsed.systemPrompt.trim() !== ''
      ? parsed.systemPrompt
      : undefined
    return { prompt, reason: 'file' }
  } catch {
    return { prompt: undefined, reason: 'file-malformed' }
  }
}

/**
 * Persist the chat prompt, atomically and readable by the owner only.
 * @param {string} file - settings file path.
 * @param {string} text - validated prompt.
 * @returns {Promise<void>} completion.
 */
async function writeStoredPrompt (file, text) {
  await mkdir(dirname(file), { recursive: true })
  const temporary = file + '.tmp-' + process.pid
  const body = JSON.stringify({ version: SETTINGS_VERSION, systemPrompt: text }, null, 2) + '\n'
  await writeFile(temporary, body, { mode: 0o600 })
  await rename(temporary, file)
}

/**
 * Resolve the preset that composed one live Agent.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{ id: string }} agent - live agent.
 * @returns {string | undefined} the preset id, when known.
 */
function presetOf (ctx, agent) {
  const sessions = ctx.get('sessions')
  const session = sessions === undefined ? undefined : sessions.get(agent.id)
  if (session === undefined || session === null) return undefined
  const presets = ctx.get('agentPresets')
  if (presets !== undefined) {
    try {
      const id = presets.presetForSession(session)
      if (typeof id === 'string' && id !== '') return id
    } catch {
      /* fall through to the Session header */
    }
  }
  return session.header?.agentPreset
}

/**
 * Collect the global tools chat mode does not offer.
 *
 * The `chat` preset already composes no filesystem, shell, subagent or workflow
 * tool; this mask also covers the tools a deployment registers globally, such
 * as MCP servers and the working-directory switcher, which a preset cannot
 * remove on its own. Tools that appear after the Agent was created are not
 * covered — the preset still keeps them away from code work.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @returns {string[]} names to deny, empty when the registry is unavailable.
 */
function conversationalDenyList (ctx) {
  const tools = ctx.get('tools')
  if (tools === undefined || typeof tools.definitions !== 'function') return []
  let definitions
  try {
    definitions = tools.definitions()
  } catch {
    return []
  }
  const keep = new Set(CONVERSATIONAL_TOOLS)
  const names = []
  for (const definition of definitions) {
    const name = String(definition.name)
    if (!keep.has(name)) names.push(name)
  }
  return names
}

/**
 * Append the chat instructions to one Agent's system prompt.
 *
 * The text callback reads `state.prompt`, so a prompt saved later in Settings
 * reaches the next step of that same conversation.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} agent - live agent.
 */

/** How many trailing session events the citation ledger reads. */
const CITATION_SCAN_EVENTS = 400

/**
 * Highest citation number this conversation has already used.
 *
 * The model restarts its numbering unless it is reminded, so every step gets the
 * ledger as a runtime-context line instead of trusting the model to count the
 * transcript itself.
 * @param {object} ctx - plugin context with access to `sessions`.
 * @param {string} sessionId - session to scan.
 * @returns {number} the highest number in the recent transcript, 0 when none.
 */
function highestCitation (ctx, sessionId) {
  const sessions = ctx.get('sessions')
  if (sessions === undefined || typeof sessions.get !== 'function') return 0
  const session = sessions.get(sessionId)
  if (session === undefined || session === null) return 0
  let highest = 0
  try {
    const from = Math.max(0, Number(session.seq) - CITATION_SCAN_EVENTS)
    for (const event of session.snapshotEvents(from)) {
      if (event.type !== 'assistant/message') continue
      const message = event.data === undefined ? undefined : event.data.message
      const blocks = message === undefined || !Array.isArray(message.content) ? [] : message.content
      for (const block of blocks) {
        if (block === null || typeof block !== 'object' || block.type !== 'text' || typeof block.text !== 'string') continue
        for (const match of block.text.matchAll(/\[(\d{1,3})\]/g)) {
          const value = Number(match[1])
          if (value > highest) highest = value
        }
      }
    }
  } catch {
    /* a session that cannot be read contributes no ledger */
  }
  return highest
}

/**
 * The runtime-context line that keeps citation numbering continuous.
 * @param {object} ctx - plugin context with access to `sessions`.
 * @param {string} sessionId - session whose transcript is measured.
 * @returns {string} the context text for this step.
 */
function citationContext (ctx, sessionId) {
  const entry = sessionEntry(state.ledger, sessionId)
  const scanned = highestCitation(ctx, sessionId)
  const next = Math.max(entry.next, scanned + 1)
  return '引用编号：本对话下一个可用编号是 ' + next + '。本轮检索到新来源后，先调用 ' + CITATION_TOOL
    + '（action=reserve，按顺序附上 title 与 url）登记，正文和文末来源列表都用它返回的编号；'
    + '只是复用已有来源时沿用原编号，绝对不要从 1 重新开始。'
}


/**
 * Render a ledger answer for the model.
 * @param {unknown} value - the tool's return value.
 * @returns {string} readable lines.
 */
function renderLedgerAnswer (value) {
  const payload = value !== null && typeof value === 'object' ? value : {}
  const assigned = Array.isArray(payload.assigned) ? payload.assigned : []
  const lines = []
  if (assigned.length > 0) {
    for (const item of assigned) lines.push('- [' + item.index + '] ' + item.title + ' — ' + item.url)
  } else {
    lines.push('（还没有登记过来源）')
  }
  lines.push('')
  lines.push('下一个可用编号：' + payload.next)
  return lines.join('\n')
}

/**
 * The chat Agent's citation ledger tool.
 *
 * It is the authority for numbering: the model reserves the next numbers before it
 * writes a citation, the plugin stores them per conversation, and the per-step
 * runtime context repeats the next number so a new turn never restarts at 1.
 * @param {object} ctx - plugin context used to read the transcript.
 * @param {string} sessionId - conversation id.
 * @returns {object} a ToolDefinition.
 */
function citationTool (ctx, sessionId) {
  return {
    name: CITATION_TOOL,
    description: '引用编号登记。检索到新的来源后，先调用本工具（action=reserve，按引用顺序附上来源的 title 与 url），'
      + '拿到它会话内唯一的编号，再在正文里用这些编号、并在文末来源列表写同样的编号。'
      + '只引用已有来源时不要登记，沿用原编号即可。action=state 可查看当前下一个可用编号。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['reserve', 'state', 'list'],
          description: 'reserve 登记新来源并取得编号；state 只查看当前状态；list 返回可直接粘贴的规范化来源列表。',
        },
        sources: {
          type: 'array',
          description: 'reserve 时必填：本轮新检索到的来源，按引用顺序排列。',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '文章标题。' },
              url: { type: 'string', description: '文章链接。' },
            },
            required: ['url'],
            additionalProperties: false,
          },
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          next: { type: 'number' },
          count: { type: 'number' },
          assigned: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'number' },
                title: { type: 'string' },
                url: { type: 'string' },
              },
            },
          },
        },
      },
      render: (args, value) => [{ type: 'text', text: renderLedgerAnswer(value) }],
    },
    async execute (args) {
      const input = args !== null && typeof args === 'object' ? args : {}
      const entry = sessionEntry(state.ledger, sessionId)
      // Never hand out a number the transcript already used.
      const scanned = highestCitation(ctx, sessionId)
      if (entry.next <= scanned) entry.next = scanned + 1
      if (input.action === 'state') {
        return { next: entry.next, count: entry.sources.length, assigned: [] }
      }
      if (input.action === 'list') {
        // A ready-to-paste list: one bullet per source, so the answer never renders the
        // whole list as one flowing paragraph.
        const listed = entry.sources.slice(-40)
        return { next: entry.next, count: listed.length, assigned: listed }
      }
      const sources = Array.isArray(input.sources) ? input.sources : []
      const assigned = reserveCitations(state.ledger, sessionId, sources)
      if (assigned.length > 0) await saveLedger(state.ledger)
      return { next: entry.next, count: assigned.length, assigned }
    },
  }
}

function attach (ctx, agent) {
  const key = String(agent.id)
  if (sections.has(key)) return
  if (presetOf(ctx, agent) !== PRESET_ID) return
  const agentCtx = agent.ctx
  const prompt = agentCtx === undefined ? undefined : agentCtx.get('systemPrompt')
  if (prompt === undefined) return
  const denied = conversationalDenyList(ctx)
  const dispose = agentCtx.effect(() => {
    const releasePrompt = prompt.section({
      name: SECTION_NAME,
      order: SECTION_ORDER,
      text: () => state.prompt,
    })
    // Runtime context, re-evaluated every step: the running citation number.
    let releaseCitations = () => {}
    if (typeof prompt.context === 'function') {
      try {
        releaseCitations = prompt.context({
          name: CONTEXT_NAME,
          order: CONTEXT_ORDER,
          text: () => citationContext(ctx, String(agent.id)),
        })
      } catch {
        /* a registry that refuses the contribution must not break chat mode */
        releaseCitations = () => {}
      }
    }
    // The numbering authority: the model reserves numbers through this tool.
    let releaseCitationTool = () => {}
    const tools = agentCtx.get('tools')
    if (tools !== undefined && typeof tools.register === 'function') {
      try {
        releaseCitationTool = tools.register(citationTool(ctx, String(agent.id)))
      } catch (error) {
        /* a registry that refuses the tool must not break chat mode */
        state.toolError = messageOf(error)
        releaseCitationTool = () => {}
      }
    }
    let releaseTools = () => {}
    if (denied.length > 0 && agentCtx.get('tools') !== undefined) {
      try {
        releaseTools = agentCtx.tools.restrict({ deny: denied })
      } catch {
        /* an already-restricted name keeps the prompt-only behavior */
        releaseTools = () => {}
      }
    }
    return () => {
      try {
        releaseTools()
      } catch {
        /* the scope may already be gone */
      }
      try {
        releaseCitationTool()
      } catch {
        /* the scope may already be gone */
      }
      try {
        releaseCitations()
      } catch {
        /* the scope may already be gone */
      }
      releasePrompt()
    }
  }, 'dsh-plugin-chat: chat composition')
  sections.set(key, dispose)
}

/**
 * Persist a new chat system prompt.
 * @param {string} text - validated prompt.
 * @returns {Promise<void>} completion.
 */
async function writePrompt (text) {
  await writeStoredPrompt(state.promptPath, text)
}

/**
 * Serve the read-only description of chat mode.
 * @param {import('node:http').IncomingMessage} request - incoming request.
 * @param {import('node:http').ServerResponse} response - outgoing response.
 */
function handleInfo (request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(response, 405, { ok: false, reason: 'method' }, { allow: 'GET, HEAD' })
    return
  }
  send(response, 200, {
    ok: state.workspaceId !== undefined,
    reason: state.workspaceId === undefined ? 'workspace' : undefined,
    preset: PRESET_ID,
    workspaceId: state.workspaceId,
    workspacePath: state.workspacePath,
    workspaceTitle: state.workspaceTitle,
    systemPrompt: state.prompt,
    defaultPrompt: state.defaultPrompt,
    maxPromptChars: MAX_PROMPT_CHARS,
    storage: state.storageReason,
    storagePath: state.promptPath,
    citationToolError: state.toolError,
  })
}

/**
 * Read one JSON body with a byte cap.
 * @param {import('node:http').IncomingMessage} request - incoming request.
 * @param {number} limit - byte cap.
 * @returns {Promise<unknown>} the parsed body.
 */
async function readJson (request, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw new Error('payload too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? undefined : JSON.parse(text)
}

/**
 * Save the chat system prompt for the next assembly.
 * @param {import('node:http').IncomingMessage} request - incoming request.
 * @param {import('node:http').ServerResponse} response - outgoing response.
 */
async function handlePrompt (request, response) {
  if (request.method !== 'POST') {
    send(response, 405, { ok: false, reason: 'method' }, { allow: 'POST' })
    return
  }
  let body
  try {
    body = await readJson(request, MAX_PROMPT_CHARS * 4 + 4096)
  } catch (error) {
    send(response, 400, { ok: false, reason: 'body', error: messageOf(error) })
    return
  }
  const text = body !== null && typeof body === 'object' ? body.systemPrompt : undefined
  if (typeof text !== 'string') {
    send(response, 400, { ok: false, reason: 'missing' })
    return
  }
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    send(response, 400, { ok: false, reason: 'empty' })
    return
  }
  if (trimmed.length > MAX_PROMPT_CHARS) {
    send(response, 400, { ok: false, reason: 'too-long', maxPromptChars: MAX_PROMPT_CHARS })
    return
  }
  try {
    await writePrompt(trimmed)
  } catch (error) {
    send(response, 503, { ok: false, reason: 'storage', error: messageOf(error) })
    return
  }
  state.prompt = trimmed
  send(response, 200, { ok: true, systemPrompt: state.prompt })
}

/**
 * Write one no-store JSON response.
 * @param {import('node:http').ServerResponse} response - outgoing response.
 * @param {number} status - HTTP status.
 * @param {object} payload - JSON body.
 * @param {Record<string, string>} [headers] - extra headers.
 */
function send (response, status, payload, headers = {}) {
  if (response.headersSent) return
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  response.end(JSON.stringify(payload))
}


/**
 * Serve one conversation's citation ledger.
 * @param {import('node:http').IncomingMessage} request - incoming request.
 * @param {import('node:http').ServerResponse} response - outgoing response.
 */
function handleCitations (request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(response, 405, { ok: false, reason: 'method' }, { allow: 'GET, HEAD' })
    return
  }
  let sessionId = ''
  try {
    sessionId = new URL(request.url ?? '/', 'http://localhost').searchParams.get('session') ?? ''
  } catch {
    sessionId = ''
  }
  const entry = sessionId === '' ? undefined : state.ledger.sessions[sessionId]
  const sources = entry === undefined || !Array.isArray(entry.sources) ? [] : entry.sources
  send(response, 200, {
    ok: true,
    next: entry === undefined || typeof entry.next !== 'number' ? 1 : entry.next,
    sources: sources.slice(-200),
  })
}

/**
 * Install both routes once per process.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @returns {() => void} disposer for the installed routes.
 */
function installRoutes (ctx) {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return () => {}
  const releaseInfo = webServer.register({
    kind: 'exact',
    path: INFO_ROUTE,
    handler: (request, response) => { handleInfo(request, response) },
  })
  const releaseCitations = webServer.register({
    kind: 'exact',
    path: CITATIONS_ROUTE,
    handler: (request, response) => { handleCitations(request, response) },
  })
  const releasePrompt = webServer.register({
    kind: 'exact',
    path: PROMPT_ROUTE,
    handler: (request, response) => { void handlePrompt(request, response) },
  })
  return () => {
    if (typeof releaseInfo === 'function') releaseInfo()
    if (typeof releasePrompt === 'function') releasePrompt()
    if (typeof releaseCitations === 'function') releaseCitations()
  }
}

/**
 * @param {unknown} error - thrown value.
 * @returns {string} a short message.
 */
function messageOf (error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Host half entry: provision the chat Workspace, read the saved prompt, serve
 * the two routes, and add the instructions section to every chat Agent.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {unknown} config - the Loader row's config.
 */
export async function apply (ctx, config) {
  const settings = normalize(config)
  // The config default is also the baseline the Settings page restores.
  state.defaultPrompt = DEFAULT_PROMPT
  state.workspaceTitle = settings.workspaceTitle

  state.promptPath = settingsPath()
  state.ledger = await readLedger()
  const stored = await readStoredPrompt(state.promptPath)
  state.storageReason = stored.reason
  state.prompt = stored.prompt ?? settings.systemPrompt

  // Provision lazily: the workspace registry may mount after this row, and a plain
  // `ctx.get` would then read undefined and leave chat mode without a Workspace for
  // the rest of the process. `ctx.inject` runs the callback once it is available.
  const provision = async (scoped) => {
    try {
      const dir = await ensureDirectory(settings.workspaceDir)
      let workspace
      try {
        workspace = await ensureWorkspace(scoped, dir, settings.workspaceTitle)
      } catch (error) {
        // A failed create is usually a race with another record for the same path;
        // resolving again picks that record up.
        workspace = await ensureWorkspace(scoped, dir, settings.workspaceTitle)
        if (workspace === undefined) throw error
      }
      state.workspacePath = workspace === undefined ? dir : workspace.path
      state.workspaceId = workspace === undefined ? undefined : workspace.id
    } catch (error) {
      state.workspaceId = undefined
      state.workspacePath = settings.workspaceDir
      ctx.logger?.warn?.(`dsh-plugin-chat: chat workspace unavailable: ${messageOf(error)}`)
    }
  }
  state.workspacePath = settings.workspaceDir
  if (typeof ctx.inject === 'function') {
    ctx.inject(['workspaceRegistry'], (scoped) => { void provision(scoped) })
  } else {
    await provision(ctx)
  }

  if (releaseRoutes === undefined) {
    releaseRoutes = installRoutes(ctx)
    ctx.effect(() => () => {
      const release = releaseRoutes
      releaseRoutes = undefined
      if (typeof release === 'function') release()
    }, 'dsh-plugin-chat: routes')
  }

  ctx.effect(() => () => {
    for (const dispose of sections.values()) {
      try {
        dispose()
      } catch {
        /* the Agent scope may already be gone */
      }
    }
    sections.clear()
  }, 'dsh-plugin-chat: instruction sections')

  ctx.on('agent/created', ({ agent }) => { attach(ctx, agent) })

  const agents = ctx.get('agents')
  if (agents !== undefined) {
    for (const agent of agents.list()) attach(ctx, agent)
  }
}
