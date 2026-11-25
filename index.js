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

/** The only global tools a chat Agent may keep: conversation and web research. */
const CONVERSATIONAL_TOOLS = ['web_search', 'web_fetch', 'ask_user_question']

/** Prompt section registered for each chat Agent, after the persona prefix. */
const SECTION_NAME = 'chat-mode:instructions'
const SECTION_ORDER = 40

/** Plugin-owned settings file under the DSH home, holding the saved prompt. */
const SETTINGS_FILE = 'dsh-plugin-chat.json'
const SETTINGS_VERSION = 1

/** Largest accepted prompt, in characters. */
const MAX_PROMPT_CHARS = 20000

const DEFAULT_TITLE = '对话'

/** Used when neither the config nor the store carries a prompt. */
const DEFAULT_PROMPT = [
  '你是 DeepSeek 的对话助手。这里是纯对话模式：用户只想聊天、提问、查资料，不写代码，也不创建文件。',
  '- 用简体中文、自然、简洁地回答；先给结论，再补必要的细节。',
  '- 需要事实、版本、价格、新闻或外部链接时，用 web_search 检索、用 web_fetch 打开页面核实，并在回答里给出链接。',
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
  const releasePrompt = webServer.register({
    kind: 'exact',
    path: PROMPT_ROUTE,
    handler: (request, response) => { void handlePrompt(request, response) },
  })
  return () => {
    if (typeof releaseInfo === 'function') releaseInfo()
    if (typeof releasePrompt === 'function') releasePrompt()
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
  const stored = await readStoredPrompt(state.promptPath)
  state.storageReason = stored.reason
  state.prompt = stored.prompt ?? settings.systemPrompt

  try {
    const dir = await ensureDirectory(settings.workspaceDir)
    const workspace = await ensureWorkspace(ctx, dir, settings.workspaceTitle)
    state.workspacePath = workspace === undefined ? dir : workspace.path
    state.workspaceId = workspace === undefined ? undefined : workspace.id
  } catch (error) {
    state.workspaceId = undefined
    state.workspacePath = settings.workspaceDir
    ctx.logger?.warn?.(`dsh-plugin-chat: chat workspace unavailable: ${messageOf(error)}`)
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
