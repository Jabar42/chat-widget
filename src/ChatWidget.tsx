import { useState, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import { useHermesChat } from "./useHermesChat";
import type { Message } from "./useHermesChat";

export interface ChatWidgetProps {
  /** WebSocket URL for the Hermes WebChat plugin, e.g. "ws://vps-tp3.com:8765" */
  hermesUrl: string;
  /** Brand name shown in the header, default: "Tp3studio" */
  brandName?: string;
  /** Subtitle shown below the brand name, default: "Asistente virtual" */
  brandSubtitle?: string;
  /** Welcome message shown on first open */
  welcomeMessage?: string;
  /**
   * Name of the agent (e.g. "Mariana"). When set, it becomes the header title
   * and the launcher turns into a pill ("Chatea con Mariana"). Without it the
   * widget looks exactly as before: brand name in the header, icon launcher.
   */
  agentName?: string;
  /**
   * Image of the agent. Shown in the launcher pill, the header and next to
   * every assistant message. Without it, a circle with the initials is used
   * wherever an agent identity is rendered.
   */
  avatarUrl?: string;
  /** Status label next to the green dot, default: "En línea". "" hides it. */
  onlineLabel?: string;
  /**
   * Suggested questions, rendered as chips under the welcome message while the
   * conversation is empty. Clicking one sends it as the first message.
   */
  suggestions?: string[];
  /**
   * Milliseconds before a greeting bubble shows up next to the closed launcher.
   * 0 (default) disables it. The bubble is shown once per browser session.
   */
  teaserDelay?: number;
  /** Text of the greeting bubble; defaults to `welcomeMessage`. */
  teaserMessage?: string;
  /** Launcher pill text when `agentName` is set; default: "Chatea con {agentName}". */
  launcherLabel?: string;
}

/**
 * Minimal markdown -> HTML for LLM-generated text.
 *
 * Exported so the escaping can be tested against the built bundle.
 */
export function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, "<em>$1</em>");

  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_: string, label: string, href: string) => {
      const safe = /^https?:\/\//i.test(href);
      if (!safe) return label;
      // `<` and `&` are already escaped above; a quote would still close the
      // attribute and let the model (or whoever feeds it) inject attributes.
      const attr = href.replace(/"/g, "&quot;");
      return `<a href="${attr}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
  );

  html = html.replace(/^#{1,4}\s+(.+)$/gm, "<strong>$1</strong>");
  html = html.replace(/^[\t ]*[-*]\s+(.+)$/gm, "• $1");
  html = html.replace(/\n\n/g, "<br><br>");
  html = html.replace(/\n/g, "<br>");

  return html;
}

const DEFAULTS = {
  brandName: "Tp3studio",
  brandSubtitle: "Asistente virtual",
  welcomeMessage:
    "👋 ¡Hola! Soy el asistente de Tp3studio. ¿En qué puedo ayudarte?",
  onlineLabel: "En línea",
} as const;

// Per-tab state. sessionStorage, not localStorage: the conversation can carry
// a name and a phone number, so it must not outlive the tab.
const OPEN_KEY = "hermes-chat-open";
const TEASER_KEY = "hermes-chat-teaser-seen";

function readSession(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // best-effort
  }
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function Avatar({
  url,
  name,
  size,
  tone,
}: {
  url?: string;
  name: string;
  size: number;
  /** "onPrimary": sits on the primary colour (header, launcher). "onLight": sits on the bubbles. */
  tone: "onPrimary" | "onLight";
}) {
  const base = {
    width: size,
    height: size,
    borderRadius: "50%",
    flexShrink: 0,
  } as const;
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        style={{ ...base, objectFit: "cover", display: "block" }}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      style={{
        ...base,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 600,
        fontSize: Math.round(size * 0.4),
        background:
          tone === "onPrimary"
            ? "var(--chat-avatar-bg, rgba(255,255,255,.22))"
            : "var(--chat-primary, #6366F1)",
        color:
          tone === "onPrimary"
            ? "var(--chat-primary-fg, #fff)"
            : "var(--chat-primary-fg, #fff)",
      }}
    >
      {initials(name)}
    </div>
  );
}

const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const IconChat = () => (
  <svg {...iconProps} width={22} height={22}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const IconSend = () => (
  <svg {...iconProps}>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);
const IconClose = () => (
  <svg {...iconProps} width={16} height={16}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IconExpand = () => (
  <svg {...iconProps} width={16} height={16}>
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);
const IconCollapse = () => (
  <svg {...iconProps} width={16} height={16}>
    <polyline points="4 14 10 14 10 20" />
    <polyline points="20 10 14 10 14 4" />
    <line x1="14" y1="10" x2="21" y2="3" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);
const IconRestart = () => (
  <svg {...iconProps} width={16} height={16}>
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </svg>
);

// ---------------------------------------------------------------------------
// Inner component — only rendered on the client
// ---------------------------------------------------------------------------

function ChatWidgetInner({
  hermesUrl,
  brandName = DEFAULTS.brandName,
  brandSubtitle = DEFAULTS.brandSubtitle,
  welcomeMessage = DEFAULTS.welcomeMessage,
  agentName = "",
  avatarUrl,
  onlineLabel = DEFAULTS.onlineLabel,
  suggestions = [],
  teaserDelay = 0,
  teaserMessage,
  launcherLabel,
}: ChatWidgetProps) {
  // Persist the open state across page navigation: Astro remounts the widget
  // on every route (client:load), so a plain useState(false) would collapse
  // the window every time the user changes page.
  const [open, setOpen] = useState<boolean>(() => readSession(OPEN_KEY) === "1");
  const [closing, setClosing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [teaserVisible, setTeaserVisible] = useState(false);
  // If the widget mounts already open (persisted state), the welcome message
  // must be visible too — otherwise the panel shows blank with no greeting.
  // Only skip the welcome when there is restored history (messages exist).
  const [welcomeShown, setWelcomeShown] = useState<boolean>(
    () => readSession(OPEN_KEY) === "1"
  );

  const messagesEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, status, sendMessage, clearHistory } = useHermesChat({
    hermesUrl,
    sessionNamespace: "default",
  });
  const messageCount = useRef(messages.length);
  messageCount.current = messages.length;

  const hasIdentity = Boolean(agentName || avatarUrl);
  const title = agentName || brandName;
  const displayName = agentName || brandName;

  const allMessages = welcomeShown || messages.length > 0 ? messages : [];

  // Only a real in-flight stream disables the input. "connecting" and
  // "disconnected" must NOT block typing or show the typing dots — a dead
  // socket would otherwise leave the widget stuck on three dots with a
  // disabled input (the reported bug).
  const loading = status === "streaming";
  // The welcome bubble must show even while the WebSocket is connecting —
  // otherwise the panel looks dead (blank + typing dots) until the socket
  // opens. Connection failures should not hide the greeting either.
  const welcomeVisible = welcomeShown && allMessages.length === 0 && status !== "streaming";
  const suggestionsVisible = welcomeVisible && suggestions.length > 0;

  // Mirror the open state so it survives remounts (same tab only).
  useEffect(() => {
    writeSession(OPEN_KEY, open ? "1" : "0");
  }, [open]);

  // Greeting bubble next to the closed launcher: once per tab, only while the
  // chat is closed and nothing has been said yet.
  useEffect(() => {
    if (open || teaserDelay <= 0) return;
    if (readSession(TEASER_KEY) === "1") return;
    const timer = setTimeout(() => {
      if (messageCount.current === 0) setTeaserVisible(true);
    }, teaserDelay);
    return () => clearTimeout(timer);
  }, [open, teaserDelay]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open && !loading) {
      const timer = setTimeout(() => inputRef.current?.focus(), 400);
      return () => clearTimeout(timer);
    }
  }, [open, loading]);

  function dismissTeaser() {
    setTeaserVisible(false);
    writeSession(TEASER_KEY, "1");
  }

  function openChat() {
    dismissTeaser();
    setOpen(true);
    setWelcomeShown(true);
  }

  function closeChat() {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 250);
  }

  function resetInputHeight() {
    const el = inputRef.current;
    if (el) el.style.height = "auto";
  }

  function send(text: string) {
    const clean = text.trim();
    if (!clean || loading) return;
    setInput("");
    resetInputHeight();
    if (!welcomeShown) setWelcomeShown(true);
    sendMessage(clean);
  }

  function handleSend() {
    send(input);
  }

  function newConversation() {
    if (loading) return;
    clearHistory();
    setInput("");
    resetInputHeight();
    setWelcomeShown(true);
  }

  const chatWidth = expanded ? 480 : 380;
  const chatHeight = expanded ? "calc(100dvh - 48px)" : 540;

  const bubbleBase = {
    maxWidth: "85%",
    padding: "10px 14px",
    borderRadius: 16,
    fontSize: 14,
    lineHeight: 1.45,
  } as const;

  const headerButton = {
    width: 32,
    height: 32,
    borderRadius: 12,
    background: "var(--chat-close-btn-bg, rgba(255,255,255,.12))",
    border: "none",
    color: "var(--chat-primary-fg, #fff)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  } as const;

  const online = status !== "disconnected";

  return (
    <>
      <style>{`
        @keyframes slide-up { from { opacity:0; transform:translateY(16px) scale(0.96); } to { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes slide-down { from { opacity:1; transform:translateY(0) scale(1); } to { opacity:0; transform:translateY(16px) scale(0.96); } }
        .chat-window { animation:slide-up .35s cubic-bezier(.16,1,.3,1) forwards; }
        .chat-window-out { animation:slide-down .25s ease-in forwards; }
        .chat-teaser { animation:slide-up .35s cubic-bezier(.16,1,.3,1) forwards; }
        @keyframes typing-dot { 0%,60% { opacity:.2; transform:translateY(0); } 30% { opacity:1; transform:translateY(-6px); } 100% { opacity:.2; transform:translateY(0); } }
        .typing-indicator { display:flex; align-items:center; gap:4px; padding:8px 14px; }
        .typing-indicator span { width:7px; height:7px; border-radius:50%; background:var(--chat-primary, #6366F1); animation:typing-dot 1.4s infinite ease-in-out; }
        .typing-indicator span:nth-child(2) { animation-delay:.15s; }
        .typing-indicator span:nth-child(3) { animation-delay:.3s; }
        .bot-msg a { color:var(--chat-primary, #6366F1); text-decoration:underline; }
        .bot-msg a:hover { color:var(--chat-primary-hover, #4F46E5); }
        .bot-msg code { background:var(--chat-code-bg, rgba(99,102,241,.12)); color:var(--chat-primary, #6366F1); padding:1px 5px; border-radius:4px; font-size:.9em; font-family:monospace; }
        .bot-msg strong { font-weight:600; color:var(--chat-bot-text, #18181B); }
        .bot-msg em { font-style:italic; }
        .chat-chip { background:var(--chat-chip-bg, transparent); color:var(--chat-primary, #6366F1); border:1px solid var(--chat-primary, #6366F1); border-radius:999px; padding:7px 12px; font-size:13px; line-height:1.2; cursor:pointer; font-family:inherit; text-align:left; }
        .chat-chip:hover { background:var(--chat-chip-hover-bg, var(--chat-code-bg, rgba(99,102,241,.12))); }
        .chat-launcher:hover { filter:brightness(1.06); }
        .chat-header-btn:hover { background:var(--chat-close-btn-hover-bg, rgba(255,255,255,.22)) !important; }
        @media (max-width: 480px) {
          .chat-window, .chat-window-out {
            width: 100% !important; height: 100% !important;
            max-width: 100% !important; max-height: 100% !important;
            bottom: 0 !important; right: 0 !important;
            border-radius: 0 !important;
          }
          .chat-teaser { right: 16px !important; left: 16px !important; max-width: none !important; }
        }
      `}</style>

      {!open && teaserVisible && (
        <div
          className="chat-teaser"
          role="status"
          style={{
            position: "fixed", bottom: 24 + 56 + 12, right: 24, zIndex: 9999,
            maxWidth: 300,
            background: "var(--chat-primary-fg, #fff)",
            color: "var(--chat-bot-text, #18181B)",
            borderRadius: 16, borderBottomRightRadius: 4,
            boxShadow: "var(--chat-shadow-lg, 0 12px 48px rgba(0,0,0,.18))",
            padding: "12px 36px 12px 14px",
            fontSize: 14, lineHeight: 1.45,
            fontFamily: "var(--chat-font-body, 'Nunito', sans-serif)",
            display: "flex", gap: 10, alignItems: "flex-start",
          }}
        >
          {hasIdentity && <Avatar url={avatarUrl} name={displayName} size={32} tone="onLight" />}
          <button
            onClick={openChat}
            style={{
              background: "none", border: "none", padding: 0, margin: 0,
              color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer",
            }}
          >
            {teaserMessage || welcomeMessage}
          </button>
          <button
            onClick={dismissTeaser}
            aria-label="Cerrar saludo"
            style={{
              position: "absolute", top: 8, right: 8,
              width: 24, height: 24, borderRadius: 8,
              background: "transparent", border: "none", cursor: "pointer",
              color: "inherit", opacity: 0.6,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <IconClose />
          </button>
        </div>
      )}

      {!open && (
        <button
          className="chat-launcher"
          onClick={openChat}
          style={{
            position: "fixed", bottom: 24, right: 24, zIndex: 9999,
            height: 56, minWidth: 56,
            width: hasIdentity ? "auto" : 56,
            padding: hasIdentity ? "0 20px 0 8px" : 0,
            borderRadius: hasIdentity ? 28 : 16,
            background: "var(--chat-primary, #6366F1)",
            color: "var(--chat-primary-fg, #fff)",
            border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            flexShrink: 0,
            fontFamily: "var(--chat-font-body, 'Nunito', sans-serif)",
            fontSize: 14, fontWeight: 600,
            boxShadow: "var(--chat-shadow, 0 8px 24px rgba(0,0,0,.12))",
          }}
          data-chat-toggle=""
          aria-label="Abrir chat"
        >
          {hasIdentity ? (
            <>
              <Avatar url={avatarUrl} name={displayName} size={40} tone="onPrimary" />
              <span>{launcherLabel || `Chatea con ${displayName}`}</span>
            </>
          ) : (
            <IconChat />
          )}
          {teaserVisible && (
            <span
              aria-hidden="true"
              style={{
                position: "absolute", top: -2, right: -2,
                width: 12, height: 12, borderRadius: "50%",
                background: "var(--chat-badge, #EF4444)",
                border: "2px solid var(--chat-primary-fg, #fff)",
              }}
            />
          )}
        </button>
      )}

      {open && (
        <div
          className={closing ? "chat-window-out" : "chat-window"}
          role="dialog"
          aria-label={`Chat con ${displayName}`}
          style={{
            position: "fixed", bottom: 24, right: 24, zIndex: 9998,
            width: chatWidth, maxWidth: "calc(100vw - 48px)",
            height: chatHeight, maxHeight: "calc(100dvh - 48px)",
            background: "var(--chat-primary-fg, #fff)",
            display: "flex", flexDirection: "column", borderRadius: 16,
            boxShadow: "var(--chat-shadow-lg, 0 12px 48px rgba(0,0,0,.18))",
            touchAction: "none",
            transition: "width .25s ease, height .25s ease",
          }}
        >
          <div style={{
            background: "var(--chat-primary, #6366F1)",
            color: "var(--chat-primary-fg, #fff)",
            padding: "12px 12px 12px 16px", display: "flex",
            alignItems: "center", justifyContent: "space-between", gap: 12,
            flexShrink: 0, borderRadius: "16px 16px 0 0",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              {hasIdentity && <Avatar url={avatarUrl} name={displayName} size={38} tone="onPrimary" />}
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontFamily: "var(--chat-font-heading, 'Outfit', sans-serif)",
                  fontWeight: 600, fontSize: 16, lineHeight: 1.2,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {title}
                </div>
                <div style={{
                  fontSize: 12, opacity: 0.85, marginTop: 2,
                  display: "flex", alignItems: "center", gap: 6,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {onlineLabel && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: online
                            ? "var(--chat-online, #22C55E)"
                            : "var(--chat-offline, #EF4444)",
                          boxShadow: online ? "0 0 0 2px rgba(34,197,94,.25)" : "none",
                        }}
                      />
                      {online ? onlineLabel : "Sin conexión"}
                    </span>
                  )}
                  {onlineLabel && brandSubtitle && <span aria-hidden="true">·</span>}
                  {brandSubtitle && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{brandSubtitle}</span>}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <button
                className="chat-header-btn"
                onClick={newConversation}
                disabled={loading}
                style={{ ...headerButton, opacity: loading ? 0.5 : 1 }}
                aria-label="Nueva conversación"
                title="Nueva conversación"
              >
                <IconRestart />
              </button>
              <button
                className="chat-header-btn"
                onClick={() => setExpanded((v) => !v)}
                style={headerButton}
                aria-label={expanded ? "Reducir chat" : "Ampliar chat"}
                title={expanded ? "Reducir" : "Ampliar"}
              >
                {expanded ? <IconCollapse /> : <IconExpand />}
              </button>
              <button
                className="chat-header-btn"
                onClick={closeChat}
                style={headerButton}
                aria-label="Cerrar chat"
                title="Cerrar"
              >
                <IconClose />
              </button>
            </div>
          </div>

          <div data-chat-messages style={{
            flex: 1, overflowY: "auto", overscrollBehavior: "contain",
            touchAction: "pan-y", padding: "12px 16px",
            display: "flex", flexDirection: "column", gap: 10,
            fontFamily: "var(--chat-font-body, 'Nunito', sans-serif)",
          }}>
            <div style={{ flex: 1, minHeight: 0 }} />

            {welcomeVisible && (
              <BotRow show={hasIdentity} url={avatarUrl} name={displayName}>
                <div className="bot-msg" style={{
                  ...bubbleBase,
                  background: "var(--chat-bot-bubble, #F4F4F5)",
                  color: "var(--chat-bot-text, #18181B)",
                  borderBottomLeftRadius: 4,
                }}>
                  <span dangerouslySetInnerHTML={{ __html: renderMarkdown(welcomeMessage) }} />
                </div>
              </BotRow>
            )}

            {suggestionsVisible && (
              <div
                data-chat-suggestions
                style={{
                  display: "flex", flexWrap: "wrap", gap: 8,
                  paddingLeft: hasIdentity ? 34 : 0,
                }}
              >
                {suggestions.map((s) => (
                  <button
                    key={s}
                    className="chat-chip"
                    onClick={() => send(s)}
                    disabled={loading}
                    data-chat-suggestion=""
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {allMessages.map((msg: Message) =>
              msg.role === "assistant" ? (
                <BotRow key={msg.id} show={hasIdentity} url={avatarUrl} name={displayName}>
                  <div
                    className="bot-msg"
                    style={{
                      ...bubbleBase,
                      background: "var(--chat-bot-bubble, #F4F4F5)",
                      color: "var(--chat-bot-text, #18181B)",
                      borderBottomLeftRadius: 4,
                    }}
                  >
                    <span dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
                  </div>
                </BotRow>
              ) : (
                <div
                  key={msg.id}
                  style={{
                    ...bubbleBase,
                    alignSelf: "flex-end",
                    background: "var(--chat-primary, #6366F1)",
                    color: "var(--chat-primary-fg, #fff)",
                    borderBottomRightRadius: 4,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {msg.text}
                </div>
              )
            )}

            {loading && (
              <BotRow show={hasIdentity} url={avatarUrl} name={displayName}>
                <div
                  className="typing-indicator"
                  role="status"
                  aria-label={`${displayName} está escribiendo`}
                  style={{
                    background: "var(--chat-bot-bubble, #F4F4F5)",
                    borderRadius: 16, borderBottomLeftRadius: 4,
                  }}
                >
                  <span /><span /><span />
                </div>
              </BotRow>
            )}

            <div ref={messagesEnd} />
          </div>

          {status === "disconnected" && (
            <div style={{
              padding: "6px 16px", fontSize: 12, textAlign: "center",
              background: "var(--chat-error-bg, #FEE2E2)",
              color: "var(--chat-error-text, #B91C1C)",
              borderTop: "1px solid var(--chat-error-border, #FECACA)",
            }}>
              ⚠️ No se pudo conectar con el servidor. Verificá tu conexión e intentá de nuevo.
            </div>
          )}

          <div style={{
            display: "flex", gap: 8, padding: "12px 16px 16px", alignItems: "flex-end",
            borderTop: "1px solid var(--chat-border, #E4E4E7)", flexShrink: 0,
          }}>
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
              }}
              placeholder={`Escribile a ${displayName}...`}
              aria-label="Mensaje"
              disabled={loading}
              style={{
                flex: 1, padding: "10px 14px", margin: 0,
                border: "1px solid var(--chat-border, #E4E4E7)",
                borderRadius: 12, fontSize: 14, lineHeight: 1.4, outline: "none",
                resize: "none", overflowY: "auto", maxHeight: 110,
                fontFamily: "var(--chat-font-body, 'Nunito', sans-serif)",
                background: "var(--chat-primary-fg, #fff)",
                color: "var(--chat-bot-text, #18181B)",
              }}
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              style={{
                width: 40, height: 40, borderRadius: 12,
                background: "var(--chat-primary, #6366F1)",
                color: "var(--chat-primary-fg, #fff)",
                border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
                opacity: loading || !input.trim() ? 0.4 : 1,
              }}
              aria-label="Enviar"
            >
              <IconSend />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** An assistant row: the avatar (when there is an identity) beside the bubble. */
function BotRow({
  show,
  url,
  name,
  children,
}: {
  show: boolean;
  url?: string;
  name: string;
  children: ReactNode;
}) {
  if (!show) {
    return <div style={{ display: "flex", alignSelf: "flex-start", maxWidth: "100%" }}>{children}</div>;
  }
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, alignSelf: "flex-start", maxWidth: "100%" }}>
      <Avatar url={url} name={name} size={26} tone="onLight" />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default export — SSR-safe wrapper
// ---------------------------------------------------------------------------

export default function ChatWidget(props: ChatWidgetProps) {
  // The widget only works in the browser, but branching on `typeof window`
  // breaks React hydration: the server renders the placeholder and the client
  // renders the full widget on its *first* render, so the trees don't match.
  // React then throws #418 and, rather than patching the difference, discards
  // the server HTML and re-renders the whole page on the client.
  //
  // Gating on mount instead keeps the first client render identical to the
  // server's — both produce the placeholder — and swaps in the widget from an
  // effect, which runs after hydration has finished. Astro's `client:load`
  // still gets its placeholder div to mount into.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div id="hermes-chat-ssr-placeholder" />;
  }

  return <ChatWidgetInner {...props} />;
}
