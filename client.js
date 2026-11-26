/**
 * Client half of dsh-plugin-chat: the mode switch beside the brand mark and
 * the chat-mode settings page.
 *
 * The switch is a two-state control seated in `conversation.header.leading`,
 * the global navigation seat that renders before the Session title and
 * without a Session, i.e. immediately to the right of the sidebar brand.
 *
 * Choosing "对话" asks the Host for the chat Workspace it provisions and opens
 * that Workspace's blank Session under the `chat` preset, so the user never
 * picks a directory. Choosing "写代码" returns to the most recent Workspace
 * that is not the chat one. Which capabilities a chat Session has is decided by
 * the preset composition on the Host, not here.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-chat',
  factory (require) {
    'use strict'
    const React = require('react')
    const h = React.createElement

    const INFO_ROUTE = '/dsh-plugin-chat/v1/info'
    const PROMPT_ROUTE = '/dsh-plugin-chat/v1/system-prompt'
    const MODE_KEY = 'dsh-plugin-chat:mode'
    const CHAT_PRESET = 'chat'
    const EMPTY_ITEMS = []
    /**
     * Sources this conversation's web tools returned, keyed by URL. Filled from the
     * session's own `tool/result` events, so a citation's hover card shows the real
     * search result rather than a re-fetch.
     * @type {Map<string, { title?: string, snippet?: string }>}
     */
    const sourceIndex = new Map()

    /** Hover state of one citation chip: its URL and viewport rect. */
    const citationHover = {
      value: undefined,
      listeners: new Set(),
      /**
       * @param {{ url: string, rect: { left: number, top: number } } | undefined} value - hovered chip.
       */
      publish (value) {
        this.value = value
        for (const listener of this.listeners) listener()
      },
      /**
       * @param {() => void} listener - re-render callback.
       * @returns {() => void} unsubscribe.
       */
      subscribe (listener) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
    }

    /** Pending hide timer for a citation hover card. */
    let citationHideTimer = 0

    /** Give the pointer time to travel from the chip into the card. */
    function scheduleCitationHide () {
      if (citationHideTimer !== 0) clearTimeout(citationHideTimer)
      citationHideTimer = window.setTimeout(() => {
        citationHideTimer = 0
        citationHover.publish(undefined)
      }, 200)
    }

    /** Cancel a pending hide. */
    function cancelCitationHide () {
      if (citationHideTimer === 0) return
      clearTimeout(citationHideTimer)
      citationHideTimer = 0
    }

    /**
     * Index every web result carried by the session's tool events.
     * @param {{ entries?: readonly { event?: { type?: string, data?: { meta?: { sources?: readonly { url?: string, title?: string, snippet?: string }[] } } } }[] }} window - session event window.
     */
    function indexSources (window) {
      const entries = window?.entries ?? []
      let changed = false
      for (const entry of entries) {
        const event = entry?.event
        if (event?.type !== 'tool/result') continue
        const sources = event.data?.meta?.sources
        if (!Array.isArray(sources)) continue
        for (const source of sources) {
          const url = typeof source?.url === 'string' ? source.url : undefined
          if (url === undefined || sourceIndex.has(url)) continue
          sourceIndex.set(url, {
            title: typeof source.title === 'string' ? source.title : undefined,
            snippet: typeof source.snippet === 'string' ? source.snippet : undefined,
          })
          changed = true
        }
      }
      if (changed) citationHover.publish(citationHover.value)
    }

    /**
     * @param {string} url - citation target.
     * @returns {{ site: string, title: string, snippet: string }} card content.
     */
    function describeSource (url, hint) {
      const known = sourceIndex.get(url)
      let site = url
      try {
        site = new URL(url).hostname.replace(/^www\./, '')
      } catch {
        site = url
      }
      // A fetched page has no search snippet; the answer's own source list usually
      // links the same URL under its page title, which is the next best label.
      let loose
      if (known?.title === undefined) {
        for (const anchor of document.querySelectorAll('a[href]')) {
          if (anchor.getAttribute('href') !== url) continue
          if (anchor.classList.contains('dpc-cite')) continue
          const text = (anchor.textContent || '').trim()
          if (text === '' || text === url || text.startsWith('http')) continue
          loose = text
          break
        }
      }
      return {
        site,
        title: known?.title ?? (typeof hint === 'string' && hint !== '' ? hint : undefined) ?? loose ?? url,
        snippet: known?.snippet ?? '',
      }
    }

    /** A citation marker: the link text a chat answer uses for a source. */
    const CITATION_TEXT = /^\[\d{1,3}\]$/
    /** Sprite id of the host's "add workspace" header button icon. */
    const ADD_WORKSPACE_ICON = 'dsw-icon-project-add-outline-regular'
    /** Replacement glyph for chat mode: a speech bubble with a plus. */
    const NEW_CHAT_MASK = 'data:image/svg+xml;base64,' + btoa(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M2.4 3.6h11.2c.5 0 .9.4.9.9v4.9c0 .5-.4.9-.9.9H6.7L4.2 12.9v-2.6H2.4c-.5 0-.9-.4-.9-.9V4.5c0-.5.4-.9.9-.9z"/>'
      + '<path d="M8 5.2v2.9M6.6 6.6h2.9"/></svg>',
    )
    const EMPTY_IDS = []

    const zh = {
      modeGroup: '会话模式',
      chat: '对话',
      code: '写代码',
      chatHint: '对话模式：不选目录、不写代码，可以联网搜索',
      codeHint: '写代码模式：回到工作区里的编码会话',
      chatWorkspaceFailed: '对话工作区还没准备好，请稍后再试',
      openFailed: '切换失败',
      sidebarTitle: '对话',
      newChat: '新建对话',
      sectionTitle: '对话模式',
      sectionSubtitle: '聊天用的 system prompt。保存后，下一条消息就会按新提示词回答；已有会话不用重开。',
      promptLabel: '对话模式的 system prompt',
      promptHint: '和「对话模式」预设的人设叠加使用。留空无法保存；点「恢复默认」可以取回内置提示词。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      reset: '恢复默认',
      reload: '重新读取',
      charCount: '字',
      workspaceRow: '对话工作区',
      presetRow: 'Agent 预设',
      storageRow: '提示词存储',
      loadFailed: '读取失败',
      reasonEmpty: '提示词不能为空',
      reasonTooLong: '提示词太长',
      reasonStorage: '保存失败：写不进本机存储',
      reasonMissing: '请求缺少 system prompt',
      reasonBody: '请求格式不对',
      reasonMethod: '请求方式不对',
      unsupported: '保存失败，请改插件配置里的 systemPrompt。',
    }

    const en = {
      modeGroup: 'Conversation mode',
      chat: 'Chat',
      code: 'Code',
      chatHint: 'Chat mode: no directory to pick, no code, web search available',
      codeHint: 'Code mode: back to a coding session in a workspace',
      chatWorkspaceFailed: 'The chat workspace is not ready yet. Try again in a moment.',
      openFailed: 'Could not switch mode',
      sidebarTitle: 'Chat',
      newChat: 'New chat',
      sectionTitle: 'Chat mode',
      sectionSubtitle: 'The system prompt chat mode uses. A saved prompt applies from the next message on; open conversations keep working.',
      promptLabel: 'Chat mode system prompt',
      promptHint: 'Added on top of the Chat preset persona. Empty text cannot be saved; Restore default brings back the built-in prompt.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      reset: 'Restore default',
      reload: 'Reload',
      charCount: 'characters',
      workspaceRow: 'Chat workspace',
      presetRow: 'Agent preset',
      storageRow: 'Prompt storage',
      loadFailed: 'Could not load',
      reasonEmpty: 'The prompt cannot be empty',
      reasonTooLong: 'The prompt is too long',
      reasonStorage: 'Could not write the prompt to local storage',
      reasonMissing: 'The request carried no system prompt',
      reasonBody: 'Malformed request',
      reasonMethod: 'Wrong request method',
      unsupported: 'This version cannot save from here. Set systemPrompt in the plugin config instead.',
    }

    /** Chat bubble: a rounded outline with a tail. */
    const CHAT_GLYPH = [
      'M2.4 4.3c0-.78.63-1.4 1.4-1.4h8.4c.78 0 1.4.63 1.4 1.4v5.4c0 .78-.63 1.4-1.4 1.4H6.7L3.9 13.2v-2.4h-.1c-.78 0-1.4-.63-1.4-1.4z',
    ]
    /** Code brackets: `<`, `/`, `>`. */
    const CODE_GLYPH = [
      'M5.9 4.9 2.8 8l3.1 3.1',
      'M10.1 4.9 13.2 8l-3.1 3.1',
      'M9.2 3.7 6.8 12.3',
    ]

    const SWITCH_CSS = [
      '.dpc-mode{display:inline-flex;align-items:center;min-width:0;margin:0 10px 0 2px;-webkit-app-region:no-drag}',
      // No filled container: a fixed surface colour reads as a mismatched box on the
      // sidebar row, so only the active segment carries a surface.
      '.dpc-switch{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:999px;background:transparent;border:0.5px solid transparent;transition:border-color .12s ease}',
      '@media (hover:hover){.dpc-switch:hover{border-color:var(--dsw-alias-border-l3)}}',
      '.dpc-switch[data-error="true"]{border-color:var(--dsw-alias-state-error-primary)}',
      '.dpc-seg{display:inline-flex;align-items:center;justify-content:center;width:24px;height:20px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .12s ease,color .12s ease}',
      '.dpc-seg:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}',
      '.dpc-seg:disabled{opacity:.55;cursor:default}',
      '.dpc-seg[aria-pressed="true"]{background:var(--dsw-specific-sidebar-nav-item-active,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}',
      '@media (hover:hover){.dpc-seg:hover:not(:disabled):not([aria-pressed="true"]){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}',
      '.dpc-glyph{display:block;pointer-events:none}',
    ].join('')

    const SETTINGS_CSS = [
      '.dpc-page{display:flex;flex-direction:column;gap:16px;width:100%;max-width:860px;margin:0 auto;padding:4px 2px 28px;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}',
      '.dpc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}',
      '.dpc-head-main{min-width:0;flex:1 1 320px}',
      '.dpc-title{margin:0;font-size:18px;line-height:26px;font-weight:600}',
      '.dpc-sub{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);max-width:64ch}',
      '.dpc-card{border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);padding:14px}',
      '.dpc-label{display:block;font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary)}',
      '.dpc-hint{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);max-width:64ch}',
      '.dpc-textarea{display:block;width:100%;box-sizing:border-box;margin-top:10px;min-height:190px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:19px;resize:vertical}',
      '.dpc-textarea:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}',
      '.dpc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}',
      '.dpc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}',
      '.dpc-btn:disabled{opacity:.55;cursor:default}',
      '.dpc-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}',
      '.dpc-btn[data-primary="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-weight:600}',
      '@media (hover:hover){.dpc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}',
      '.dpc-count{margin-left:auto;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
      '.dpc-status{font-size:12px;line-height:18px;color:var(--dsw-alias-state-success-primary)}',
      '.dpc-fail{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}',
      '.dpc-meta{display:flex;flex-direction:column;gap:6px}',
      '.dpc-meta-row{display:flex;align-items:baseline;gap:10px;min-width:0;font-size:12px;line-height:18px}',
      '.dpc-meta-key{flex:none;width:92px;color:var(--dsw-alias-label-tertiary)}',
      '.dpc-meta-value{min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}',
      '.dpc-meta-value[data-mono="true"]{font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px}',
      '@media (pointer:coarse){.dpc-textarea{font-size:16px}.dpc-btn{height:36px}}',
    ].join('')

    /**
     * @param {unknown} error - thrown value.
     * @returns {string} a short message.
     */
    function messageOf (error) {
      if (error instanceof Error) return error.message
      return String(error)
    }

    /** @returns {'chat' | 'code'} the last chosen mode, defaulting to chat. */
    function readMode () {
      try {
        return window.localStorage.getItem(MODE_KEY) === 'code' ? 'code' : 'chat'
      } catch {
        return 'chat'
      }
    }

    /**
     * @param {'chat' | 'code'} mode - chosen mode.
     */
    function writeMode (mode) {
      try {
        window.localStorage.setItem(MODE_KEY, mode)
      } catch {
        /* a private-mode browser keeps the switch session-local */
      }
    }

    const infoCache = { value: undefined, pending: undefined }

    /**
     * Conversation mode, shared by the switch and the sidebar filter.
     *
     * The displayed Session decides it: a Session in the chat Workspace is chat
     * mode, any other Session is code mode, and with no Session displayed the
     * last chosen mode stands in. Keeping one derivation means the sidebar can
     * never hide the Session on screen.
     * @type {{
     *   probe: { sessionId: string, isChat: boolean } | undefined,
     *   fallback: 'chat' | 'code',
     *   listeners: Set<() => void>,
     * }}
     */
    const modeStore = {
      probe: undefined,
      fallback: readMode(),
      listeners: new Set(),
      /** @returns {'chat' | 'code'} the effective mode. */
      mode () {
        const probe = this.probe
        if (probe === undefined || probe === null) return this.fallback
        return probe.isChat ? 'chat' : 'code'
      },
      /** @param {{ sessionId: string, isChat: boolean } | undefined} value - displayed Session. */
      publishProbe (value) {
        this.probe = value
        this.emit()
      },
      /** @param {'chat' | 'code'} value - explicit choice. */
      choose (value) {
        this.fallback = value
        writeMode(value)
        this.emit()
      },
      /** Notify every subscriber. */
      emit () {
        for (const listener of this.listeners) listener()
      },
      /**
       * @param {() => void} listener - re-render callback.
       * @returns {() => void} unsubscribe.
       */
      subscribe (listener) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
    }

    /**
     * Geometry of the host's sidebar window-chrome strip — the row the collapse
     * control sits in. That strip is host-private (no slot, and every cell around
     * it clips its children), so when the shell renders one the switch is drawn
     * as a frame-level overlay anchored to the real collapse control instead of
     * inside the sidebar subtree. Without such a strip the switch stays in the
     * header's leading cell.
     * @type {{ value: { present: boolean, toggleLeft?: number, toggleCenterY?: number }, listeners: Set<() => void> }}
     */
    const chrome = {
      value: { placement: 'header' },
      listeners: new Set(),
      /**
       * @param {{ placement?: 'section' | 'header' | 'hidden', right?: number, centerY?: number, left?: number, top?: number }} value - measured placement.
       */
      publish (value) {
        const current = this.value
        if (
          current.placement === value.placement
          && current.right === value.right
          && current.centerY === value.centerY
          && current.left === value.left
          && current.top === value.top
        ) return
        this.value = value
        for (const listener of this.listeners) listener()
      },
      /**
       * @param {() => void} listener - re-render callback.
       * @returns {() => void} unsubscribe.
       */
      subscribe (listener) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
    }

    /**
     * Re-measure the shell: the sidebar chrome strip when the shell renders one,
     * and the sidebar's width (the conversation column's left edge), which tells
     * a collapsed rail apart from an expanded column.
     */
    function refreshChrome () {
      if (typeof document === 'undefined') return
      const header = document.querySelector('header[data-window-drag]')
      const headerRect = header === null ? undefined : header.getBoundingClientRect()
      // Before the shell lays the window out, rects read as zero; measuring then says
      // nothing about the sidebar. Keep the previous answer and measure again later.
      if (headerRect !== undefined && (headerRect.width === 0 || headerRect.left === 0)) return
      const sidebarWidth = headerRect === undefined ? window.innerWidth : headerRect.left
      // A collapsed rail is identified by the sidebar's own width, not by the section
      // row: mid-animation that row can still be wide, and drawing the switch then
      // lands it on the window's traffic lights.
      if (sidebarWidth < 200) {
        chrome.publish({ placement: 'hidden' })
        return
      }
      const section = document.querySelector('[data-sidebar-workspace-header]')
      const sectionRect = section === null ? undefined : section.getBoundingClientRect()
      if (sectionRect !== undefined && sectionRect.width > 0) {
        chrome.publish({
          placement: 'section',
          right: sectionRect.right,
          centerY: sectionRect.top + sectionRect.height / 2,
        })
        return
      }
      // No section row yet: keep the switch in the conversation header cell instead
      // of drawing nothing.
      chrome.publish({
        placement: 'header',
        left: headerRect === undefined ? 0 : headerRect.left + 22,
        top: headerRect === undefined ? 12 : headerRect.top + 12,
      })
    }

    /**
     * Track the sidebar chrome strip across resizes and sidebar toggles.
     * @returns {{ placement?: 'section' | 'header' | 'hidden', right?: number, centerY?: number, left?: number, top?: number }} placement.
     */
    function useChrome () {
      const [value, setValue] = React.useState(chrome.value)
      React.useEffect(() => {
        const sync = () => setValue(chrome.value)
        const release = chrome.subscribe(sync)

        // The sidebar (and with it the desktop chrome strip) can mount a frame or
        // more after the header, so one measurement at mount is not enough: keep
        // re-measuring briefly until the strip is found or the budget runs out.
        let timer = 0
        let attempts = 0
        let lastSignature = ''
        let stableTicks = 0
        // Adopting the store after subscribing matters: the first publish can land
        // while another instance is subscribing, and `publish` is a no-op afterwards
        // (unchanged value), which used to leave this instance stuck on the initial
        // snapshot and therefore render nothing.
        const adopt = () => setValue(chrome.value)
        const signatureOf = () => {
          const section = document.querySelector('[data-sidebar-workspace-header]')
          if (section === null) return 'none'
          const rect = section.getBoundingClientRect()
          return Math.round(rect.width) + ':' + Math.round(rect.left) + ':' + Math.round(rect.top)
        }
        const settle = () => {
          const signature = signatureOf()
          if (signature === lastSignature) stableTicks += 1
          else { lastSignature = signature; stableTicks = 0 }
          refreshChrome()
          adopt()
          attempts += 1
          // Keep going until the shell has settled for a while, so a window that is
          // still being laid out cannot freeze a provisional answer.
          if ((chrome.value.placement === 'section' && stableTicks >= 4) || attempts > 120) {
            if (timer !== 0) window.clearInterval(timer)
            timer = 0
          }
        }
        refreshChrome()
        adopt()
        timer = window.setInterval(settle, 120)
        const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(settle) : 0

        const onResize = () => { refreshChrome() }
        window.addEventListener('resize', onResize)
        window.addEventListener('focus', onResize)
        document.addEventListener('visibilitychange', onResize)
        const observed = document.querySelector('header[data-window-drag]') ?? document.querySelector('[class*="topStrip"]')
        const observer = observed !== null && observed !== undefined && typeof ResizeObserver === 'function'
          ? new ResizeObserver(onResize)
          : undefined
        if (observer !== undefined) observer.observe(observed)

        // The sidebar row can mount, unmount or come back at any time — a drawer, a
        // narrow window, the user reopening the rail. Watch for it appearing or
        // disappearing and re-measure only on that change.
        let rowSignature = ''
        let watchFrame = 0
        const rowState = () => {
          const section = document.querySelector('[data-sidebar-workspace-header]')
          const header = document.querySelector('header[data-window-drag]')
          const sectionRect = section === null ? null : section.getBoundingClientRect()
          const headerRect = header === null ? null : header.getBoundingClientRect()
          return [
            sectionRect === null ? 'none' : Math.round(sectionRect.width) + ':' + Math.round(sectionRect.left) + ':' + Math.round(sectionRect.top),
            headerRect === null ? 'none' : Math.round(headerRect.left),
          ].join('|')
        }
        rowSignature = rowState()
        const watch = () => {
          if (watchFrame !== 0) return
          watchFrame = requestAnimationFrame(() => {
            watchFrame = 0
            const signature = rowState()
            if (signature === rowSignature) return
            rowSignature = signature
            refreshChrome()
          })
        }
        const domObserver = typeof MutationObserver === 'function' ? new MutationObserver(watch) : undefined
        if (domObserver !== undefined) domObserver.observe(document.body, { childList: true, subtree: true })
        return () => {
          window.removeEventListener('resize', onResize)
          window.removeEventListener('focus', onResize)
          document.removeEventListener('visibilitychange', onResize)
          if (timer !== 0) window.clearInterval(timer)
          if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
          if (observer !== undefined) observer.disconnect()
          if (domObserver !== undefined) domObserver.disconnect()
          if (watchFrame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(watchFrame)
          release()
        }
      }, [])
      return value
    }

    /**
     * Subscribe to the Host description once it has loaded.
     * @returns {object | undefined} the Host answer.
     */
    function useInfo () {
      const [value, setValue] = React.useState(() => infoCache.value)
      // Depend on the health flag, never on the payload object: a rejected answer is a
      // fresh object every time, and keying the retry on it spun a request loop.
      const healthy = value !== undefined && value.ok === true
      React.useEffect(() => {
        if (healthy) return undefined
        let live = true
        let timer = 0
        let attempts = 0
        const load = () => {
          loadInfo(true).then(next => {
            if (!live) return
            if (next?.ok === true) { setValue(next); return }
            attempts += 1
            if (attempts < 15) timer = window.setTimeout(load, 800)
          }, () => {
            if (!live) return
            attempts += 1
            if (attempts < 15) timer = window.setTimeout(load, 800)
          })
        }
        load()
        return () => {
          live = false
          if (timer !== 0) window.clearTimeout(timer)
        }
      }, [healthy])
      return value
    }

    /**
     * Read the Host description of chat mode, sharing one request at a time.
     * @param {boolean} force - ignore the cached value.
     * @returns {Promise<object>} the Host answer.
     */
    function loadInfo (force) {
      if (force !== true && infoCache.value !== undefined) return Promise.resolve(infoCache.value)
      if (infoCache.pending !== undefined) return infoCache.pending
      const pending = (async () => {
        const response = await fetch(INFO_ROUTE, { headers: { accept: 'application/json' } })
        if (!response.ok) throw new Error('HTTP ' + response.status)
        const payload = await response.json()
        // A Host that is still starting answers `ok: false`; caching that would pin
        // a failed state for the whole window, so only a healthy answer is kept.
        if (payload !== null && typeof payload === 'object' && payload.ok === true) infoCache.value = payload
        return payload
      })()
      infoCache.pending = pending
      const settle = () => { infoCache.pending = undefined }
      pending.then(settle, settle)
      return pending
    }

    /**
     * Resolve one dictionary key, re-rendering when the locale changes.
     * @param {object} ctx - client plugin context.
     * @returns {(key: string) => string} translate function.
     */
    function useTranslate (ctx) {
      const [revision, setRevision] = React.useState(0)
      React.useEffect(() => ctx.locale.subscribe(() => setRevision(count => count + 1)), [ctx])
      return React.useMemo(() => ctx.locale.bind('dsh-plugin-chat'), [ctx, revision])
    }

    /**
     * Client services are read on use instead of declared as hard dependencies:
     * a hard `inject` holds the whole plugin in "loading" until that service
     * mounts, which left the switch missing for a while after the app opened.
     * @param {object} ctx - client plugin context.
     * @param {string} name - service key.
     * @returns {any} the service, or undefined when this shell has none.
     */
    function service (ctx, name) {
      return typeof ctx.get === 'function' ? ctx.get(name) : undefined
    }

    /**
     * Open one Workspace's Session through the Workspace UI service.
     * @param {object} ctx - client plugin context.
     * @param {string | undefined} workspaceId - target Workspace, undefined to inherit.
     * @param {{ agentPreset?: string }} options - Session choices.
     */
    function startSession (ctx, workspaceId, options) {
      const ui = service(ctx, 'uiWorkspace')
      if (ui === undefined || typeof ui.startSession !== 'function') throw new Error('workspace-ui-unavailable')
      ui.startSession(workspaceId, options)
    }

    /**
     * Resolve the client-side id of the chat Workspace, creating the record
     * through the Client service when the Host's row has not arrived yet.
     * @param {object} ctx - client plugin context.
     * @param {object} info - Host answer.
     * @param {readonly object[]} items - current Workspace rows.
     * @returns {Promise<string>} workspace id.
     */
    async function resolveChatWorkspace (ctx, info, items) {
      if (info === undefined || info.ok !== true || typeof info.workspaceId !== 'string') {
        throw new Error('chat-workspace')
      }
      const known = Array.isArray(items)
        ? items.find(item => item !== undefined && (item.workspaceId === info.workspaceId || item.path === info.workspacePath))
        : undefined
      if (known !== undefined) return known.workspaceId
      const workspaces = service(ctx, 'workspaces')
      if (workspaces === undefined) throw new Error('chat-workspace')
      const created = await workspaces.create({ path: info.workspacePath })
      if (typeof created?.workspaceId !== 'string') return info.workspaceId
      // The create request carries only a path, so name the fresh record the way
      // the Host intends instead of leaving the directory basename in the sidebar.
      if (typeof info.workspaceTitle === 'string' && info.workspaceTitle !== '') {
        try {
          await workspaces.rename(created.workspaceId, info.workspaceTitle)
        } catch {
          /* a rename failure leaves the basename, which is still usable */
        }
      }
      return created.workspaceId
    }

    /**
     * Pick the Workspace "写代码" returns to: the last listed row that is not
     * the chat Workspace.
     * @param {readonly object[]} items - current Workspace rows.
     * @param {string | undefined} chatWorkspaceId - chat Workspace id.
     * @returns {string | undefined} workspace id, or undefined to inherit.
     */
    function pickCodeWorkspace (items, chatWorkspaceId) {
      if (!Array.isArray(items)) return undefined
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index]
        if (item !== undefined && item.workspaceId !== chatWorkspaceId) return item.workspaceId
      }
      return undefined
    }

    /**
     * Open the chat Workspace's blank Session under the chat preset.
     * @param {object} ctx - client plugin context.
     * @param {readonly object[]} items - current Workspace rows.
     */
    async function openChatSession (ctx, items) {
      const info = await loadInfo(true)
      const workspaceId = await resolveChatWorkspace(ctx, info, items)
      startSession(ctx, workspaceId, { agentPreset: CHAT_PRESET, whenDraftExists: 'keep' })
    }

    /**
     * Find the host's add-workspace header button by its icon.
     * @returns {HTMLButtonElement | undefined} the button, when present.
     */
    function findAddWorkspaceButton () {
      if (typeof document === 'undefined') return undefined
      const icon = document.querySelector('[data-sidebar-workspace-header] [data-icon="' + ADD_WORKSPACE_ICON + '"]')
      const button = icon === null ? null : icon.closest('button')
      return button === null ? undefined : button
    }

    /**
     * Build the mode switch component bound to one client context.
     * @param {object} ctx - client plugin context.
     * @returns {Function} React component.
     */
    function createModeSwitch (ctx) {
      /**
       * @param {object} props - standard slot props.
       * @returns {object} React element.
       */
      return function ChatModeSwitch (props) {
        const placement = useChrome()
        const t = useTranslate(ctx)
        const useWorkspaces = props.useWorkspaces
        const items = typeof useWorkspaces === 'function' ? useWorkspaces(snapshot => snapshot.items) : EMPTY_ITEMS
        const [revision, setRevision] = React.useState(0)
        const [busy, setBusy] = React.useState(false)
        const [error, setError] = React.useState('')

        React.useEffect(() => modeStore.subscribe(() => setRevision(count => count + 1)), [])

        const probe = modeStore.probe
        const mode = modeStore.mode()


        /**
         * Switch mode and open the Session that belongs to it.
         * @param {'chat' | 'code'} next - requested mode.
         */
        const select = async (next) => {
          if (busy) return
          // With a Session displayed, the active segment is a no-op. Without
          // one, every click opens a Session of that mode.
          if (probe !== undefined && probe !== null && next === mode) return
          setBusy(true)
          setError('')
          try {
            const info = await loadInfo(true)
            if (next === 'chat') {
              await openChatSession(ctx, items)
            } else {
              const target = pickCodeWorkspace(items, info?.workspaceId)
              startSession(ctx, target, { whenDraftExists: 'keep' })
            }
            modeStore.choose(next)
          } catch (failure) {
            const reason = messageOf(failure)
            setError(reason === 'chat-workspace' ? t('chatWorkspaceFailed') : reason === '' ? t('openFailed') : reason)
          } finally {
            setBusy(false)
          }
        }

        const segment = (value, glyph, label, hint) => h('button', {
          type: 'button',
          className: 'dpc-seg',
          'aria-pressed': mode === value ? 'true' : 'false',
          'aria-label': label,
          title: hint,
          disabled: busy,
          onClick: (event) => {
            event.preventDefault()
            event.stopPropagation()
            void select(value)
          },
        }, h('svg', {
          className: 'dpc-glyph',
          viewBox: '0 0 16 16',
          width: 13,
          height: 13,
          'aria-hidden': 'true',
          focusable: 'false',
        }, glyph.map((d, index) => h('path', {
          key: index,
          d,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }))))

        const inSection = placement.placement === 'section'
        const inHeader = placement.placement === 'header'
        // One instance decides its own place, so there is no handoff between two
        // rendered variants. A collapsed rail draws nothing at all.
        if (!inSection && !inHeader) return null

        const style = inSection
          ? {
              position: 'fixed',
              left: placement.right - 12,
              top: placement.centerY,
              transform: 'translate(-100%, -50%)',
              zIndex: 60,
            }
          : {
              position: 'fixed',
              left: placement.left,
              top: placement.top,
              zIndex: 60,
            }

        const title = error === '' ? t('modeGroup') : t('openFailed') + '：' + error
        // In the section row the action buttons are pressed left to open the space
        // the switch occupies at the row's right end.
        const rowRule = inSection
          ? '[data-sidebar-workspace-header] [class*="headerActions"]{margin-right:70px !important}'
          : ''
        return h('div', { className: 'dpc-mode', style },
          h('style', null, SWITCH_CSS + rowRule),
          h('div', {
            className: 'dpc-switch',
            role: 'group',
            'aria-label': t('modeGroup'),
            title,
            'data-error': error === '' ? 'false' : 'true',
          },
          segment('chat', CHAT_GLYPH, t('chat'), t('chatHint')),
          segment('code', CODE_GLYPH, t('code'), t('codeHint'))))
      }
    }

    /**
     * Invisible Session-header entry that publishes which mode the displayed
     * Session belongs to. It lives in the Session-scoped actions seat because
     * that seat is the one that receives the Session identity; it renders
     * nothing, so the row keeps its layout.
     * @param {object} ctx - client plugin context.
     * @returns {Function} React component returning null.
     */
    function createModeProbe (ctx) {
      return function ChatModeProbe (props) {
        const sessionId = props.sessionId
        const useSessions = props.useSessions
        const cwd = typeof useSessions === 'function' && sessionId !== undefined
          ? props.useSessions(snapshot => snapshot.byId[sessionId]?.cwd)
          : undefined
        const info = useInfo()
        const isChat = typeof cwd === 'string' && typeof info?.workspacePath === 'string' && cwd === info.workspacePath
        const key = sessionId === undefined ? undefined : String(sessionId)

        React.useEffect(() => {
          if (key === undefined) return undefined
          modeStore.publishProbe({ sessionId: key, isChat })
          return () => {
            const current = modeStore.probe
            if (current !== undefined && current.sessionId === key) modeStore.publishProbe(undefined)
          }
        }, [key, isChat])

        // The same session binding carries the tool results the answers cite, so the
        // hover card can show the real search result for a cited URL.
        React.useEffect(() => {
          if (key === undefined) return undefined
          const sessions = service(ctx, 'sessions')
          const binding = sessions === undefined || typeof sessions.binding !== 'function' ? undefined : sessions.binding(key)
          if (binding === undefined || binding === null) return undefined
          const source = binding.eventSource
          const read = () => { indexSources(source.getSnapshot()) }
          read()
          return source.subscribe(read)
        }, [key])

        return null
      }
    }

    /**
     * Map one Host failure reason onto localized text.
     * @param {(key: string) => string} t - translate function.
     * @param {unknown} reason - Host reason token.
     * @returns {string} message.
     */
    function reasonText (t, reason) {
      switch (reason) {
        case 'empty': return t('reasonEmpty')
        case 'too-long': return t('reasonTooLong')
        case 'storage': return t('reasonStorage')
        case 'missing': return t('reasonMissing')
        case 'body': return t('reasonBody')
        case 'method': return t('reasonMethod')
        default: return t('unsupported')
      }
    }

    /** Styles for a stamped citation marker, matching the web chat's raised index. */
    const CITATION_CSS = [
      '.dpc-cite{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:16px;height:16px;margin:0 3px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:0;line-height:1;text-decoration:none;position:relative;top:-2px;vertical-align:baseline;overflow:hidden}',
      '.dpc-cite>svg{display:none !important}',
      '.dpc-cite::after{content:attr(data-dpc-cite);display:block;font-size:9px;font-weight:600;letter-spacing:0;line-height:1;text-align:center}',
      '.dpc-cite[data-dpc-wide="2"]::after{font-size:8px;letter-spacing:-.3px}',
      '.dpc-cite[data-dpc-wide="3"]::after{font-size:7px;letter-spacing:-.4px}',
      '.dpc-cite[data-dpc-bare="true"]{cursor:default;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary)}',
      '@media (hover:hover){.dpc-cite:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}',
    ]

    /**
     * Turn a rendered citation link into the raised index badge.
     *
     * Chat answers cite sources as `[[1]](url)`, which the host renders as an
     * ordinary link carrying a glyph and the literal `[1]`. Only a class and a
     * data attribute are written here — the link keeps its href and its click
     * behavior — so a streamed re-render simply gets stamped again.
     * @param {Array<object>} lists - numbered source lists in the transcript.
     */
    function stampCitations (lists) {
      if (typeof document === 'undefined') return
      for (const anchor of document.querySelectorAll('a[href]')) {
        if (anchor.classList.contains('dpc-cite')) continue
        const text = (anchor.textContent || '').trim()
        if (!CITATION_TEXT.test(text)) continue
        const number = Number(text.slice(1, -1))
        const entry = listForNode(anchor, lists, anchor.parentElement)
        const display = entry === undefined ? number : entry.base + number
        anchor.dataset.dpcCite = String(display)
        if (String(display).length > 1) anchor.dataset.dpcWide = String(String(display).length)
        anchor.classList.add('dpc-cite')
      }
    }

    /** Elements whose text must never be turned into a citation chip. */
    const CITE_SKIP = 'a,code,pre,script,style,textarea,input,button,kbd,samp'
    /** Text nodes that sit in a skip element and can be ignored from now on. */
    const bareSkip = new WeakSet()

    /**
     * Numbered source lists in the transcript, numbered across the conversation.
     *
     * Every turn that searches ends with a list of links; the model restarts at 1
     * each turn, so the running `base` continues the numbering from the turns
     * before it and the list itself is shifted with `start`.
     * @returns {Array<{ element: Element, items: Element[], links: Element[], base: number }>} lists.
     */
    function sourceLists () {
      const lists = []
      let running = 0
      for (const element of document.querySelectorAll('ol,ul')) {
        if (element.closest('.dpc-mode') !== null) continue
        const items = [...element.children].filter(child => child.tagName === 'LI')
        if (items.length < 2) continue
        const links = []
        let usable = true
        for (const item of items) {
          const link = item.querySelector(':scope > a[href]')
          if (link === null) { usable = false; break }
          const label = (link.textContent || '').trim()
          if (label === '' || label.startsWith('[')) { usable = false; break }
          links.push(link)
        }
        if (!usable) continue
        if (element.tagName === 'OL' && Number(element.getAttribute('start') ?? 1) !== running + 1) {
          element.setAttribute('start', String(running + 1))
        }
        lists.push({ element, items, links, base: running })
        running += items.length
      }
      return lists
    }

    /**
     * Resolve which source list a citation belongs to.
     * @param {Node} node - the citation (link or text node).
     * @param {Array<object>} lists - numbered source lists.
     * @param {Element | null} start - element around the citation.
     * @returns {object | undefined} the list, when one applies.
     */
    function listForNode (node, lists, start) {
      // A list in the same message that follows the sentence it backs.
      let ancestor = start
      for (let depth = 0; depth < 16 && ancestor !== null && ancestor !== document.body; depth += 1) {
        for (const entry of lists) {
          if (!ancestor.contains(entry.element)) continue
          if ((node.compareDocumentPosition(entry.element) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) continue
          return entry
        }
        ancestor = ancestor.parentElement
      }
      // No list of its own: the answer is citing an earlier turn's search, so the
      // nearest preceding list is the one it means.
      let previous
      for (const entry of lists) {
        if ((entry.element.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) continue
        previous = entry
      }
      return previous
    }

    /**
     * Repair citations the model wrote as bare `[n]` instead of a link, using the
     * numbered source list that applies to that sentence.
     */
    function stampBareCitations (known) {
      if (typeof document === 'undefined' || typeof NodeFilter === 'undefined') return
      const lists = known === undefined ? sourceLists() : known
      if (lists.length === 0) return
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)
      let budget = 8000
      let node = walker.nextNode()
      while (node !== null && budget > 0) {
        budget -= 1
        const value = node.nodeValue
        const current = node
        node = walker.nextNode()
        if (value === null || value.indexOf('[') < 0 || bareSkip.has(current)) continue
        const parent = current.parentElement
        if (parent === null) { bareSkip.add(current); continue }
        if (parent.closest(CITE_SKIP) !== null) { bareSkip.add(current); continue }
        const pattern = /\[(\d{1,3})\]/g
        if (!pattern.test(value)) continue
        pattern.lastIndex = 0
        const entry = listForNode(current, lists, parent)
        // Without any source list there is nothing to point at, and rewriting arbitrary
        // text would put chips in places like the sidebar's titles. Deliberately not
        // marked: during streaming the list is written after the prose.
        if (entry === undefined) continue
        const fragment = document.createDocumentFragment()
        let cursor = 0
        let match = pattern.exec(value)
        while (match !== null) {
          fragment.appendChild(document.createTextNode(value.slice(cursor, match.index)))
          const number = Number(match[1])
          const link = entry.links[number - 1]
          const display = entry.base + number
          const chip = document.createElement('a')
          chip.className = 'dpc-cite dpc-cite-bare'
          chip.dataset.dpcCite = String(display)
          if (String(display).length > 1) chip.dataset.dpcWide = String(String(display).length)
          if (link === undefined) {
            chip.dataset.dpcBare = 'true'
          } else {
            const href = link.getAttribute('href') ?? ''
            const title = (link.textContent || '').trim()
            chip.setAttribute('href', href)
            chip.dataset.dpcUrl = href
            if (title !== '') chip.dataset.dpcTitle = title
          }
          fragment.appendChild(chip)
          cursor = match.index + match[0].length
          match = pattern.exec(value)
        }
        fragment.appendChild(document.createTextNode(value.slice(cursor)))
        if (current.parentNode !== null) current.parentNode.replaceChild(fragment, current)
      }
    }

    /**
     * Narrow the sidebar to the active mode.
     *
     * The host's session list is a flat virtualized tree of `data-row-key` rows
     * (workspace and session rows are siblings), and it exposes no filtering
     * seat, so this occupant renders one stylesheet: chat mode drops every
     * workspace row and every non-chat Session, code mode drops the chat
     * Workspace and its Sessions. Nothing in the host tree is mutated.
     * @param {object} ctx - client plugin context.
     * @returns {Function} React component rendering a style element.
     */
    function createSidebarFilter (ctx) {
      return function SidebarModeFilter (props) {
        const t = useTranslate(ctx)
        const [, setRevision] = React.useState(0)
        React.useEffect(() => modeStore.subscribe(() => setRevision(count => count + 1)), [])
        const mode = modeStore.mode()
        const info = useInfo()
        const listState = typeof props.useSessions === 'function' ? props.useSessions(snapshot => snapshot) : undefined
        const workspaceState = typeof props.useWorkspaces === 'function' ? props.useWorkspaces(snapshot => snapshot) : undefined

        const chatWorkspaceId = typeof info?.workspaceId === 'string' ? info.workspaceId : undefined
        const workspaceItems = workspaceState?.items ?? EMPTY_ITEMS
        const chatWorkspace = chatWorkspaceId === undefined
          ? undefined
          : workspaceItems.find(item => item !== undefined && item.workspaceId === chatWorkspaceId)
        const chatSessions = new Set(chatWorkspace?.sessionIds ?? [])
        const rules = []
        /** @param {string} selector - row selector to hide. */
        const hide = (selector) => { rules.push(selector + '{display:none !important}') }
        const sessionRow = (id) => `[data-row-key="session:${id}"]`

        if (mode === 'chat' && chatWorkspaceId === undefined) {
          // The Host has not reported the chat Workspace yet (fresh start); leave the
          // sidebar alone rather than hiding every row.
        } else if (mode === 'chat') {
          hide('[data-row-key^="workspace:"]')
          // Only the chat Workspace's own overflow row matters here; the others belong
          // to hidden workspaces. The chat one is expanded by the effect below, so it
          // stays hidden too.
          for (const item of workspaceItems) {
            if (item === undefined || item.workspaceId === chatWorkspaceId) continue
            hide(`[data-row-key="overflow:${item.workspaceId}"]`)
          }
          hide(`[data-row-key="overflow:${chatWorkspaceId}"]`)
          // The section header keeps its shape but names the list and offers a new
          // conversation instead of a new workspace. The host header is private
          // too, so the text and the glyph are swapped by the same stylesheet.
          rules.push('[data-sidebar-workspace-header] [class*="sectionLabel"]{font-size:0 !important}')
          rules.push(
            '[data-sidebar-workspace-header] [class*="sectionLabel"]::after'
            + "{content:'" + t('sidebarTitle') + "';font-size:14px;line-height:20px}",
          )
          const addButton = '[data-sidebar-workspace-header] button:has(svg[data-icon="' + ADD_WORKSPACE_ICON + '"])'
          rules.push(addButton + ' svg{display:none !important}')
          rules.push(
            addButton + "::after{content:'';display:block;width:16px;height:16px;background-color:currentColor;"
            + '-webkit-mask:url("' + NEW_CHAT_MASK + '") center / 16px 16px no-repeat;'
            + 'mask:url("' + NEW_CHAT_MASK + '") center / 16px 16px no-repeat}',
          )
          // Without the workspace level there is no indentation to carry, so the
          // rows give up the depth padding and the leading status cell and line up
          // with the New-session row above them.
          rules.push('[data-row-key^="session:"]{padding-left:8px !important}')
          rules.push('[data-row-key^="session:"] [class*="slot"]{display:none !important}')
          for (const id of listState?.ids ?? EMPTY_IDS) {
            if (!chatSessions.has(id)) hide(sessionRow(id))
          }
          // The composer loses the two controls that only mean something for code
          // work: the sandbox/permission preset and the third-party mode selector.
          hide('[data-slot="conversation.input.permission"]')
          hide('[data-omo-mode-root]')
          // A new chat has no workspace or preset to pick: it always starts in the
          // chat Workspace under the chat preset, so the hero's picker row goes.
          hide('[class*="heroWorkspaceRow"]')
          hide('[data-slot="conversation.hero.agentPreset"]')
        } else if (chatWorkspaceId !== undefined) {
          hide(`[data-row-key="workspace:${chatWorkspaceId}"]`)
          hide(`[data-row-key="overflow:${chatWorkspaceId}"]`)
          for (const id of chatSessions) hide(sessionRow(id))
        }

        React.useEffect(() => {
          if (typeof MutationObserver !== 'function') return undefined
          let frame = 0
          let timer = 0
          const schedule = () => {
            // Repairing bare `[n]` rewrites text nodes, so it waits for the transcript
            // to settle instead of racing a streaming answer.
            if (timer !== 0) window.clearTimeout(timer)
            timer = window.setTimeout(() => {
              timer = 0
              const lists = sourceLists()
              stampCitations(lists)
              stampBareCitations(lists)
            }, 400)
            if (frame !== 0) return
            frame = requestAnimationFrame(() => {
              frame = 0
              stampCitations(sourceLists())
            })
          }
          const observer = new MutationObserver(schedule)
          observer.observe(document.body, { childList: true, subtree: true })
          stampCitations(sourceLists())
          return () => {
            observer.disconnect()
            if (frame !== 0) cancelAnimationFrame(frame)
            if (timer !== 0) window.clearTimeout(timer)
          }
        }, [])

        // Hovering a citation chip opens its source card; leaving both closes it.
        React.useEffect(() => {
          const show = (event) => {
            const node = event.target instanceof Element ? event.target.closest('.dpc-cite') : null
            if (node === null) return
            const url = node.getAttribute('href') ?? node.dataset.dpcUrl ?? ''
            if (url === '') return
            const rect = node.getBoundingClientRect()
            cancelCitationHide()
            citationHover.publish({
              url,
              title: node.dataset.dpcTitle ?? '',
              rect: { left: rect.left, top: rect.top },
            })
          }
          const hide = (event) => {
            const node = event.target instanceof Element ? event.target.closest('.dpc-cite') : null
            if (node === null) return
            scheduleCitationHide()
          }
          document.addEventListener('mouseover', show)
          document.addEventListener('mouseout', hide)
          document.addEventListener('focusin', show)
          document.addEventListener('focusout', hide)
          return () => {
            document.removeEventListener('mouseover', show)
            document.removeEventListener('mouseout', hide)
            document.removeEventListener('focusin', show)
            document.removeEventListener('focusout', hide)
            cancelCitationHide()
          }
        }, [])

        // The host caps each workspace's list behind an "expand the rest" button. Chat
        // mode is the whole conversation list, so press it once when it is collapsed;
        // `aria-expanded` keeps this from toggling it back and forth.
        React.useEffect(() => {
          if (mode !== 'chat' || chatWorkspaceId === undefined) return undefined
          let timer = 0
          let attempts = 0
          const expand = () => {
            if (modeStore.mode() !== 'chat') return
            const row = document.querySelector('[data-row-key="overflow:' + chatWorkspaceId + '"]')
            if (row === null) return
            if (row.getAttribute('aria-expanded') === 'true') return
            row.click()
            attempts += 1
            if (attempts < 4) timer = window.setTimeout(expand, 250)
          }
          expand()
          return () => {
            if (timer !== 0) window.clearTimeout(timer)
          }
        })

        const workspaceRef = React.useRef(EMPTY_ITEMS)
        workspaceRef.current = workspaceState?.items ?? EMPTY_ITEMS

        // Chat mode turns the header's add-workspace control into "new chat": the
        // glyph is swapped by the stylesheet above, the label here, and the click
        // is captured before the host's directory picker opens.
        React.useEffect(() => {
          const handler = (event) => {
            if (modeStore.mode() !== 'chat') return
            const node = event.target instanceof Element ? event.target : null
            const button = node === null ? null : node.closest('button')
            if (button === null || button.querySelector('[data-icon="' + ADD_WORKSPACE_ICON + '"]') === null) return
            if (button.closest('[data-sidebar-workspace-header]') === null) return
            event.preventDefault()
            event.stopPropagation()
            void openChatSession(ctx, workspaceRef.current)
          }
          document.addEventListener('click', handler, true)
          return () => document.removeEventListener('click', handler, true)
        }, [])

        React.useEffect(() => {
          const button = findAddWorkspaceButton()
          if (button === undefined) return
          if (button.dataset.dpcLabel === undefined) {
            button.dataset.dpcLabel = button.getAttribute('aria-label') ?? ''
            button.dataset.dpcTitle = button.getAttribute('title') ?? ''
          }
          const chatMode = mode === 'chat'
          const label = chatMode ? t('newChat') : button.dataset.dpcLabel
          button.setAttribute('aria-label', label)
          if (button.dataset.dpcTitle === '' && !chatMode) button.removeAttribute('title')
          else button.setAttribute('title', chatMode ? label : button.dataset.dpcTitle)
        })

        // Citation markers render like the web chat: a small raised index badge
        // instead of an inline link with a glyph. The link itself is untouched, so
        // it still opens the source; only its text is replaced by the badge.
        rules.push(...CITATION_CSS)

        return h('style', { 'data-dsh-plugin-chat': 'sidebar-filter' }, rules.join('\n'))
      }
    }

    /** Styles for a citation hover card. */
    const CITE_CARD_CSS = [
      '.dpc-cite-card{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 24px rgba(15,17,21,.18);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}',
      '.dpc-cite-card-head{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
      '.dpc-cite-card-badge{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:9px;font-weight:700}',
      '.dpc-cite-card-site{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dpc-cite-card-title{font-size:13px;line-height:19px;font-weight:600;color:var(--dsw-alias-label-primary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.dpc-cite-card-snippet{color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.dpc-cite-card-link{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '@media (hover:hover){.dpc-cite-card-link:hover{color:var(--dsw-alias-brand-primary)}}',
    ].join('')

    /**
     * Build the citation hover card: the source title and snippet the answer cited,
     * read from the session's own web tool results.
     * @param {object} ctx - client plugin context.
     * @returns {Function} React component rendering a floating card or nothing.
     */
    function createCitationCard (ctx) {
      return function CitationCard () {
        const [, setRevision] = React.useState(0)
        React.useEffect(() => citationHover.subscribe(() => setRevision(count => count + 1)), [])
        const hover = citationHover.value
        if (hover === undefined) return null
        const content = describeSource(hover.url, hover.title)
        const width = 360
        const left = Math.max(8, Math.min(hover.rect.left, window.innerWidth - width - 12))
        const style = {
          position: 'fixed',
          left,
          bottom: Math.max(8, window.innerHeight - hover.rect.top + 8),
          width,
          zIndex: 70,
        }
        return h('div', {
          className: 'dpc-cite-card',
          style,
          role: 'tooltip',
          onMouseEnter: cancelCitationHide,
          onMouseLeave: scheduleCitationHide,
        },
        h('style', null, CITE_CARD_CSS),
        h('div', { className: 'dpc-cite-card-head' },
          h('span', { className: 'dpc-cite-card-badge' }, content.site.slice(0, 1).toUpperCase()),
          h('span', { className: 'dpc-cite-card-site' }, content.site)),
        h('div', { className: 'dpc-cite-card-title' }, content.title),
        content.snippet === '' ? null : h('div', { className: 'dpc-cite-card-snippet' }, content.snippet),
        h('a', {
          className: 'dpc-cite-card-link',
          href: hover.url,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, hover.url))
      }
    }

    /**
     * Build the chat-mode settings page.
     * @param {object} ctx - client plugin context.
     * @returns {Function} React component.
     */
    function createSettings (ctx) {
      /**
       * @param {object} props - settings section owner props.
       * @returns {object} React element.
       */
      return function ChatSettings (props) {
        const t = useTranslate(ctx)
        const [info, setInfo] = React.useState(infoCache.value)
        const [draft, setDraft] = React.useState('')
        const [status, setStatus] = React.useState('idle')
        const [error, setError] = React.useState('')

        React.useEffect(() => {
          let live = true
          loadInfo(true).then(value => {
            if (!live) return
            setInfo(value)
            setDraft(typeof value.systemPrompt === 'string' ? value.systemPrompt : '')
          }, failure => {
            if (live) setError(messageOf(failure))
          })
          return () => { live = false }
        }, [])

        const max = typeof info?.maxPromptChars === 'number' ? info.maxPromptChars : 20000
        const saving = status === 'saving'
        const empty = draft.trim() === ''
        const tooLong = draft.length > max
        const storagePath = typeof info?.storagePath === 'string' ? info.storagePath : '—'

        const save = async () => {
          if (saving || empty || tooLong) return
          setStatus('saving')
          setError('')
          try {
            const response = await fetch(PROMPT_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ systemPrompt: draft }),
            })
            const payload = await response.json().catch(() => undefined)
            if (payload === undefined || payload.ok !== true) throw new Error(reasonText(t, payload?.reason))
            const saved = typeof payload.systemPrompt === 'string' ? payload.systemPrompt : draft.trim()
            setDraft(saved)
            setInfo(current => ({ ...(current === undefined ? {} : current), systemPrompt: saved }))
            infoCache.value = infoCache.value === undefined ? infoCache.value : { ...infoCache.value, systemPrompt: saved }
            setStatus('saved')
          } catch (failure) {
            setStatus('idle')
            setError(messageOf(failure))
          }
        }

        const reset = () => {
          const fallback = typeof info?.defaultPrompt === 'string' ? info.defaultPrompt : ''
          setDraft(fallback)
          setStatus('idle')
          setError('')
        }

        return h('section', { className: 'dpc-page' },
          h('style', null, SETTINGS_CSS),
          h('header', { className: 'dpc-head' },
            h('div', { className: 'dpc-head-main' },
              h('h2', { className: 'dpc-title' }, t('sectionTitle')),
              h('p', { className: 'dpc-sub' }, t('sectionSubtitle'))),
            h('button', {
              type: 'button',
              className: 'dpc-btn',
              onClick: () => {
                setError('')
                setStatus('idle')
                void loadInfo(true).then(value => {
                  setInfo(value)
                  setDraft(typeof value.systemPrompt === 'string' ? value.systemPrompt : '')
                }, failure => setError(messageOf(failure)))
              },
            }, t('reload'))),

          h('div', { className: 'dpc-card' },
            h('label', { className: 'dpc-label', htmlFor: 'dpc-prompt' }, t('promptLabel')),
            h('p', { className: 'dpc-hint' }, t('promptHint')),
            h('textarea', {
              id: 'dpc-prompt',
              className: 'dpc-textarea',
              value: draft,
              spellCheck: false,
              disabled: saving,
              onChange: (event) => {
                setDraft(event.target.value)
                setStatus('idle')
              },
            }),
            h('div', { className: 'dpc-row' },
              h('button', {
                type: 'button',
                className: 'dpc-btn',
                'data-primary': 'true',
                disabled: saving || empty || tooLong,
                onClick: () => { void save() },
              }, saving ? t('saving') : t('save')),
              h('button', {
                type: 'button',
                className: 'dpc-btn',
                disabled: saving,
                onClick: reset,
              }, t('reset')),
              h('span', { className: 'dpc-count' }, draft.length + ' / ' + max + ' ' + t('charCount'))),
            status === 'saved' && error === '' ? h('div', { className: 'dpc-status' }, t('saved')) : null,
            error === '' ? null : h('div', { className: 'dpc-fail', role: 'alert' }, error)),

          h('div', { className: 'dpc-card dpc-meta' },
            h('div', { className: 'dpc-meta-row' },
              h('span', { className: 'dpc-meta-key' }, t('workspaceRow')),
              h('span', { className: 'dpc-meta-value', 'data-mono': 'true' }, info?.workspacePath ?? '—')),
            h('div', { className: 'dpc-meta-row' },
              h('span', { className: 'dpc-meta-key' }, t('presetRow')),
              h('span', { className: 'dpc-meta-value', 'data-mono': 'true' }, info?.preset ?? CHAT_PRESET)),
            h('div', { className: 'dpc-meta-row' },
              h('span', { className: 'dpc-meta-key' }, t('storageRow')),
              h('span', { className: 'dpc-meta-value', 'data-mono': 'true' }, storagePath))))
      }
    }

    return {
      // `workspaces` creates the chat Workspace record when the Host row has
      // not reached this browser yet; `uiWorkspace` opens the Sessions.
      inject: ['slots', 'locale'],
      apply (ctx) {
        ctx.effect(() => ctx.locale.register('dsh-plugin-chat', { en, zh }), 'dsh-plugin-chat: dictionaries')

        // The conversation header's leading seat. The host does not expose the
        // sidebar's own window-chrome strip (the row the collapse control sits
        // in) to plugins: the strip is host-private, the brand cells clip their
        // children to a 24px box, and both frame columns clip overflow. This seat
        // is the closest supported cell — on the collapse control's row, against
        // the sidebar edge.
        const ModeSwitch = createModeSwitch(ctx)
        const Overlay = props => h(ModeSwitch, props)
        // The header cell only reserves the space the floating switch occupies when
        // the sidebar row is unavailable, keeping the Session title clear of it.
        const HeaderSpacer = () => {
          const placement = useChrome()
          if (placement.placement !== 'header') return null
          return h('span', { 'aria-hidden': 'true', style: { display: 'inline-block', width: '55px', height: '26px', margin: '0 10px 0 2px' } })
        }
        ctx.slots.inject('conversation.header.leading', () => ctx.slots.register({
          name: 'conversation.header.leading',
        }, HeaderSpacer))
        const CitationCard = createCitationCard(ctx)
        // Mode-scoped sidebar: chat mode shows only chat Sessions, code mode
        // hides the chat Workspace entirely.
        const SidebarFilter = createSidebarFilter(ctx)

        // Frame-level layer: unclipped, so the switch can sit over the sidebar's
        // own chrome strip beside the collapse control. All three occupants share
        // ONE injection: a second `ctx.slots.inject` on the same slot key replaces
        // the first, which silently dropped the switch (and the card) before.
        ctx.slots.inject('shell.overlay', function* () {
          yield ctx.slots.register({
            name: 'shell.overlay',
            id: 'dsh-plugin-chat-switch',
            order: 5,
          }, Overlay)
          yield ctx.slots.register({
            name: 'shell.overlay',
            id: 'dsh-plugin-chat-sidebar-filter',
            order: 6,
          }, SidebarFilter)
          yield ctx.slots.register({
            name: 'shell.overlay',
            id: 'dsh-plugin-chat-citation-card',
            order: 7,
          }, CitationCard)
        })

        const ModeProbe = createModeProbe(ctx)
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'dsh-plugin-chat-mode',
          order: -1000,
          label: '',
        }, ModeProbe))

        const Settings = createSettings(ctx)
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-plugin-chat',
          order: 94,
          label: () => ctx.locale.bind('dsh-plugin-chat')('sectionTitle'),
        }, Settings))
      },
    }
  },
})
