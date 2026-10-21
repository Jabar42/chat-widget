import { useState, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import { useHermesChat } from "./useHermesChat";
import type { ActionData, CardData, FormData, Message } from "./useHermesChat";

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
const IconWhatsApp = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2 22l5.3-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.9-4.44 9.9-9.9S17.5 2 12.04 2zm0 18.15c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 4.54 0 8.24 3.7 8.24 8.24s-3.7 8.24-8.24 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.16.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29z" />
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

  const { messages, status, sendMessage, sendFormSubmit, clearHistory } = useHermesChat({
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

            {allMessages.map((msg: Message) => {
              if (msg.role === "user") {
                return (
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
                );
              }
              if (msg.kind === "card" && msg.card) {
                return (
                  <BotRow key={msg.id} show={hasIdentity} url={avatarUrl} name={displayName}>
                    <CardBubble card={msg.card} onSend={send} disabled={loading} />
                  </BotRow>
                );
              }
              if (msg.kind === "form" && msg.form) {
                return (
                  <BotRow key={msg.id} show={hasIdentity} url={avatarUrl} name={displayName}>
                    <FormBubble
                      form={msg.form}
                      submitted={Boolean(msg.submitted)}
                      onSubmit={(values) => sendFormSubmit(msg.form!.id, values)}
                      disabled={loading}
                    />
                  </BotRow>
                );
              }
              if (msg.kind === "action" && msg.action) {
                return (
                  <BotRow key={msg.id} show={hasIdentity} url={avatarUrl} name={displayName}>
                    <ActionBubble action={msg.action} />
                  </BotRow>
                );
              }
              return (
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
              );
            })}

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

/** A project card: photo, title, subtitle, text and action buttons. */
function CardBubble({
  card,
  onSend,
  disabled,
}: {
  card: CardData;
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <div
      data-chat-card={card.id}
      style={{
        width: 268, maxWidth: "88%",
        background: "var(--chat-primary-fg, #fff)",
        border: "1px solid var(--chat-border, #E4E4E7)",
        borderRadius: 16, borderBottomLeftRadius: 4,
        overflow: "hidden",
        boxShadow: "var(--chat-shadow, 0 8px 24px rgba(0,0,0,.08))",
      }}
    >
      {card.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={card.image}
          alt=""
          style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }}
        />
      )}
      <div style={{ padding: "10px 12px 12px" }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: "var(--chat-bot-text, #18181B)" }}>
          {card.title}
        </div>
        {card.subtitle && (
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--chat-primary, #6366F1)", marginTop: 2 }}>
            {card.subtitle}
          </div>
        )}
        {card.text && (
          <div style={{ fontSize: 13, color: "var(--chat-bot-text, #18181B)", opacity: 0.8, marginTop: 6, lineHeight: 1.4 }}>
            {card.text}
          </div>
        )}
        {card.actions && card.actions.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {card.actions.map((a, i) => (
              <button
                key={`${a.label}-${i}`}
                type="button"
                data-chat-card-action={a.url ? "link" : "send"}
                disabled={disabled}
                onClick={() => {
                  if (a.url) window.open(a.url, "_blank", "noopener,noreferrer");
                  else if (a.send) onSend(a.send);
                }}
                style={{
                  background: a.url ? "var(--chat-primary, #6366F1)" : "transparent",
                  color: a.url ? "var(--chat-primary-fg, #fff)" : "var(--chat-primary, #6366F1)",
                  border: a.url ? "none" : "1px solid var(--chat-primary, #6366F1)",
                  borderRadius: 10, padding: "7px 12px", fontSize: 13,
                  cursor: disabled ? "default" : "pointer", fontFamily: "inherit", fontWeight: 600,
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** A lead form rendered inside the chat; disables itself once submitted. */
function FormBubble({
  form,
  submitted,
  onSubmit,
  disabled,
}: {
  form: FormData;
  submitted: boolean;
  onSubmit: (values: Record<string, string>) => void;
  disabled: boolean;
}) {
  const visible = form.fields.filter((f) => f.type !== "hidden");
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of form.fields) if (f.type === "hidden" && f.value != null) init[f.name] = f.value;
    return init;
  });
  const [error, setError] = useState("");

  function submit() {
    if (disabled || submitted) return;
    for (const f of visible) {
      if (f.required && !String(values[f.name] ?? "").trim()) {
        setError(`Completá «${f.label}».`);
        return;
      }
    }
    const tel = visible.find((f) => f.type === "tel");
    if (tel && values[tel.name] && !/^[+\d][\d\s().-]{5,}$/.test(values[tel.name])) {
      setError("Revisá el número de teléfono.");
      return;
    }
    setError("");
    onSubmit(values);
  }

  const fieldStyle = {
    width: "100%", boxSizing: "border-box" as const, marginTop: 4,
    padding: "8px 10px", border: "1px solid var(--chat-border, #E4E4E7)",
    borderRadius: 10, fontSize: 14, outline: "none",
    fontFamily: "var(--chat-font-body, 'Nunito', sans-serif)",
  } as const;

  return (
    <div
      data-chat-form={form.id}
      style={{
        width: 268, maxWidth: "88%",
        background: "var(--chat-primary-fg, #fff)",
        border: "1px solid var(--chat-border, #E4E4E7)",
        borderRadius: 16, borderBottomLeftRadius: 4,
        padding: "12px", boxShadow: "var(--chat-shadow, 0 8px 24px rgba(0,0,0,.08))",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 14, color: "var(--chat-bot-text, #18181B)" }}>
        {form.title || "Tus datos"}
      </div>
      {submitted ? (
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--chat-online, #22C55E)", marginTop: 8 }}>
          ✓ Enviado. ¡Gracias!
        </div>
      ) : (
        <>
          {visible.map((f) => (
            <label
              key={f.name}
              style={{ display: "block", marginTop: 10, fontSize: 12, color: "var(--chat-bot-text, #18181B)" }}
            >
              {f.label}
              {f.required ? " *" : ""}
              <input
                type={f.type === "tel" ? "tel" : f.type === "email" ? "email" : "text"}
                value={values[f.name] ?? ""}
                disabled={disabled}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                style={fieldStyle}
              />
            </label>
          ))}
          {error && (
            <div style={{ fontSize: 12, color: "var(--chat-offline, #EF4444)", marginTop: 8 }}>{error}</div>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={disabled}
            data-chat-form-submit=""
            style={{
              width: "100%", marginTop: 12,
              background: "var(--chat-primary, #6366F1)",
              color: "var(--chat-primary-fg, #fff)",
              border: "none", borderRadius: 10, padding: "10px 12px",
              fontSize: 14, fontWeight: 600, fontFamily: "inherit",
              cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
            }}
          >
            {form.submit || "Enviar"}
          </button>
        </>
      )}
    </div>
  );
}

/** An action button pushed by the agent (e.g. a WhatsApp hand-off). */
function ActionBubble({ action }: { action: ActionData }) {
  const isWhatsApp = action.kind === "whatsapp";
  return (
    <a
      href={action.url}
      target="_blank"
      rel="noopener noreferrer"
      data-chat-action={action.kind}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        background: isWhatsApp ? "var(--chat-wa, #25D366)" : "var(--chat-primary, #6366F1)",
        color: "#fff", textDecoration: "none",
        borderRadius: 12, padding: "10px 16px",
        fontSize: 14, fontWeight: 600,
        fontFamily: "var(--chat-font-body, 'Nunito', sans-serif)",
      }}
    >
      {isWhatsApp && <IconWhatsApp />}
      {action.label}
    </a>
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
