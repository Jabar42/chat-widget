/**
 * useHermesChat — WebSocket hook for Hermes Agent.
 *
 * Replaces useAgent() + useAgentChat() from @cloudflare/ai-chat + agents/react
 * with a direct WebSocket connection to the Hermes WebChat plugin.
 *
 * Beyond plain text it understands the plugin's rich frames: `card` (project
 * card), `form` (lead form), `action` (a button) and `event` (a page-measurable
 * event the widget re-emits as a CustomEvent). Any unknown frame type is
 * ignored, so the hook stays forward compatible with a newer server.
 */

import { useRef, useState, useCallback, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A button on a project card: opens `url`, or sends `send` as a user message. */
export interface CardAction {
  label: string;
  url?: string;
  send?: string;
}

/** A project card rendered inside the conversation. */
export interface CardData {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  text?: string;
  actions?: CardAction[];
}

/** A single field of a lead form. */
export interface FormField {
  name: string;
  label: string;
  type: "text" | "tel" | "email" | "hidden";
  required?: boolean;
  value?: string;
}

/** A lead form rendered inside the conversation. */
export interface FormData {
  id: string;
  title?: string;
  fields: FormField[];
  submit?: string;
}

/** An action button pushed by the agent (e.g. a WhatsApp hand-off). */
export interface ActionData {
  kind: string;
  label: string;
  url: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  /** Present when the message is a rich widget rather than plain text. */
  kind?: "card" | "form" | "action";
  card?: CardData;
  form?: FormData;
  action?: ActionData;
  /** A lead form is marked submitted so it cannot be sent twice. */
  submitted?: boolean;
}

type Status = "idle" | "connecting" | "streaming" | "disconnected";

export interface FrameStatus {
  type: "status";
  status: string;
}

export interface FrameToken {
  type: "token";
  text: string;
}

export interface FrameDone {
  type: "done";
  messageId?: string;
}

export interface FrameError {
  type: "error";
  text: string;
}

export interface FrameCard {
  type: "card";
  card: CardData;
}

export interface FrameForm {
  type: "form";
  form: FormData;
}

export interface FrameAction {
  type: "action";
  kind: string;
  label: string;
  url: string;
}

export interface FrameEvent {
  type: "event";
  name: string;
  data?: Record<string, unknown>;
}

export type Frame =
  | FrameStatus
  | FrameToken
  | FrameDone
  | FrameError
  | FrameCard
  | FrameForm
  | FrameAction
  | FrameEvent;

export interface UseHermesChatOptions {
  /** WebSocket URL, e.g. "ws://vps-tp3.com:8765" or "wss://chat.tp3studio.com" */
  hermesUrl: string;
  /** Optional session ID. Auto-generated with a 30-min sessionStorage TTL if omitted. */
  sessionId?: string;
  /** Unique agent/session namespace for the sessionStorage keys */
  sessionNamespace?: string;
}

export interface UseHermesChatReturn {
  messages: Message[];
  status: Status;
  sendMessage: (text: string) => void;
  /** Submit a lead form filled inside the chat; marks the form as sent. */
  sendFormSubmit: (formId: string, values: Record<string, string>) => void;
  /** Forgets the visible history and starts a new session with the agent. */
  clearHistory: () => void;
}

// ---------------------------------------------------------------------------
// Session ID persistence (30-minute TTL, survives reloads and in-tab
// navigation). sessionStorage on purpose: the conversation can carry a name
// and a phone number, so neither it nor its id may outlive the tab.
// ---------------------------------------------------------------------------

function createSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function storeSessionId(namespace: string, id: string): void {
  try {
    const key = `hermes-chat-session-${namespace}`;
    sessionStorage.setItem(key, id);
    sessionStorage.setItem(`${key}-ts`, String(Date.now()));
  } catch {
    // storage unavailable — the id lives in memory for this mount only
  }
}

function getOrCreateSessionId(namespace: string): string {
  if (typeof window === "undefined") return "ssr";
  const key = `hermes-chat-session-${namespace}`;
  const tsKey = `${key}-ts`;
  const TTL = 30 * 60 * 1000; // 30 minutes
  try {
    const stored = sessionStorage.getItem(key);
    const storedTs = sessionStorage.getItem(tsKey);
    const now = Date.now();
    if (stored && storedTs && now - Number(storedTs) < TTL) {
      sessionStorage.setItem(tsKey, String(now)); // bump
      return stored;
    }
  } catch {
    // fall through: new id
  }
  const id = createSessionId();
  storeSessionId(namespace, id);
  return id;
}

// ---------------------------------------------------------------------------
// Message history persistence (same 30-min TTL as the session id, so the
// history survives page navigation — Astro remounts the widget on every
// route — but is discarded once the session expires).
// ---------------------------------------------------------------------------

const HISTORY_TTL = 30 * 60 * 1000; // must match session TTL

function loadHistory(namespace: string): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const key = `hermes-chat-history-${namespace}`;
    const tsKey = `${key}-ts`;
    const stored = sessionStorage.getItem(key);
    const storedTs = sessionStorage.getItem(tsKey);
    const now = Date.now();
    if (stored && storedTs && now - Number(storedTs) < HISTORY_TTL) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed as Message[];
    }
    return [];
  } catch {
    return [];
  }
}

function saveHistory(namespace: string, messages: Message[]): void {
  if (typeof window === "undefined") return;
  try {
    const key = `hermes-chat-history-${namespace}`;
    sessionStorage.setItem(key, JSON.stringify(messages));
    sessionStorage.setItem(`${key}-ts`, String(Date.now()));
  } catch {
    // Storage full / unavailable — history is best-effort
  }
}

function clearStoredHistory(namespace: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = `hermes-chat-history-${namespace}`;
    sessionStorage.removeItem(key);
    sessionStorage.removeItem(`${key}-ts`);
  } catch {
    // ignore
  }
}

let widgetSeq = 0;
function widgetId(prefix: string): string {
  widgetSeq += 1;
  return `${prefix}-${Date.now()}-${widgetSeq}`;
}

/**
 * Drop the empty assistant placeholder created by `sendMessage` when a rich
 * frame arrives, so a card/form/action does not leave a blank bubble behind.
 * The text of a later `token` then opens a fresh message (the placeholder is
 * gone, so the id check in the token branch simply misses).
 */
function dropEmptyAssistant(prev: Message[]): Message[] {
  const last = prev[prev.length - 1];
  if (last && last.role === "assistant" && !last.kind && !last.text.trim()) {
    return prev.slice(0, -1);
  }
  return prev;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useHermesChat(
  options: UseHermesChatOptions
): UseHermesChatReturn {
  const { hermesUrl, sessionId: externalSessionId, sessionNamespace } = options;
  const namespace = sessionNamespace || "default";

  const [messages, setMessages] = useState<Message[]>(() =>
    loadHistory(namespace)
  );
  const [status, setStatus] = useState<Status>("idle");

  // SSR guard: skip hook logic during server-side rendering
  const isSSR = typeof window === "undefined";
  if (isSSR) {
    return {
      messages,
      status,
      sendMessage: () => {},
      sendFormSubmit: () => {},
      clearHistory: () => {},
    };
  }

  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string>(
    externalSessionId || getOrCreateSessionId(namespace)
  );
  // Accumulates streaming tokens for the current assistant message
  const currentTextRef = useRef<string>("");
  const currentMsgIdRef = useRef<string>("");
  const reconnectAttempt = useRef<number>(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- WebSocket message handler ----
  const handleFrame = useCallback((frame: Frame) => {
    switch (frame.type) {
      case "token":
        currentTextRef.current += frame.text;
        if (streamTimeout.current) {
          clearTimeout(streamTimeout.current);
          streamTimeout.current = null;
        }
        // Update the last assistant message live. If no assistant message is
        // active (a "done" already closed the previous segment — e.g. an
        // interim commentary before a tool call), OPEN A NEW assistant message
        // instead of silently dropping the token. Without this, the final
        // response after an MCP/tool call never reaches the chat (the agent
        // "goes away and never comes back" even though the task completed).
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (
            last?.role === "assistant" &&
            !last.kind &&
            last.id === currentMsgIdRef.current
          ) {
            copy[copy.length - 1] = { ...last, text: currentTextRef.current };
            return copy;
          }
          // New segment after a done: open a fresh assistant message.
          const newId = `assistant-${Date.now()}-${copy.length}`;
          currentMsgIdRef.current = newId;
          return [
            ...copy,
            {
              id: newId,
              role: "assistant",
              text: currentTextRef.current,
              timestamp: Date.now(),
            },
          ];
        });
        break;

      case "done":
        // Finalise the current assistant message
        currentTextRef.current = "";
        currentMsgIdRef.current = "";
        if (streamTimeout.current) {
          clearTimeout(streamTimeout.current);
          streamTimeout.current = null;
        }
        setStatus("idle");
        break;

      case "status":
        if (frame.status === "typing") {
          setStatus("streaming");
          // Streaming watchdog: if the server goes silent mid-stream (no
          // token/done ever arrives), drop back to idle so the input is not
          // disabled forever on the typing indicator.
          if (streamTimeout.current) clearTimeout(streamTimeout.current);
          streamTimeout.current = setTimeout(() => {
            setStatus((s) => (s === "streaming" ? "idle" : s));
          }, 30000);
        }
        break;

      case "card":
        setMessages((prev) => [
          ...dropEmptyAssistant(prev),
          {
            id: widgetId("card"),
            role: "assistant",
            text: "",
            timestamp: Date.now(),
            kind: "card",
            card: frame.card,
          },
        ]);
        break;

      case "form":
        setMessages((prev) => [
          ...dropEmptyAssistant(prev),
          {
            id: widgetId("form"),
            role: "assistant",
            text: "",
            timestamp: Date.now(),
            kind: "form",
            form: frame.form,
          },
        ]);
        break;

      case "action":
        setMessages((prev) => [
          ...dropEmptyAssistant(prev),
          {
            id: widgetId("action"),
            role: "assistant",
            text: "",
            timestamp: Date.now(),
            kind: "action",
            action: { kind: frame.kind, label: frame.label, url: frame.url },
          },
        ]);
        break;

      case "event":
        // The widget never draws events: it re-emits them to the page so the
        // site's own analytics (GA4, Meta Pixel) can measure the conversion.
        try {
          window.dispatchEvent(
            new CustomEvent(`chat:${frame.name}`, { detail: frame.data ?? {} })
          );
        } catch {
          // CustomEvent unsupported — ignore
        }
        break;

      case "error":
        if (streamTimeout.current) {
          clearTimeout(streamTimeout.current);
          streamTimeout.current = null;
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "assistant",
            text: `⚠️ Error: ${frame.text}`,
            timestamp: Date.now(),
          },
        ]);
        setStatus("idle");
        break;

      default:
        // Unknown frame type: ignore, stay forward compatible.
        break;
    }
  }, []);

  // ---- Connect WebSocket ----
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");
    // If the socket does not open within CONNECT_TIMEOUT_MS, drop out of
    // "connecting" so the UI does not stay stuck on the typing indicator
    // with a disabled input forever (e.g. wrong host, no server, offline).
    const connectTimer = setTimeout(() => {
      setStatus((s) => (s === "connecting" ? "idle" : s));
    }, 8000);

    // Ensure trailing slash and session path
    let url = hermesUrl.replace(/\/+$/, "");
    const ws = new WebSocket(url);

    ws.onopen = () => {
      clearTimeout(connectTimer);
      reconnectAttempt.current = 0;
      setStatus("idle");
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const frame: Frame = JSON.parse(event.data);
        handleFrame(frame);
      } catch {
        // Ignore non-JSON messages
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      clearTimeout(connectTimer);
      // Auto-reconnect with backoff if not intentional
      if (reconnectAttempt.current < 5) {
        const delay = Math.min(1000 * 2 ** reconnectAttempt.current, 10000);
        reconnectAttempt.current += 1;
        reconnectTimer.current = setTimeout(() => connect(), delay);
      } else {
        // Give up: terminal state. The UI must not stay stuck on the
        // typing indicator with a disabled input — surface the failure.
        setStatus("disconnected");
      }
    };

    ws.onerror = () => {
      // onclose will fire after this
    };

    wsRef.current = ws;
  }, [hermesUrl, handleFrame]);

  // ---- Disconnect ----
  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (streamTimeout.current) {
      clearTimeout(streamTimeout.current);
      streamTimeout.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null; // prevent reconnect
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("idle");
  }, []);

  // ---- Lifecycle ----
  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  // Persist history on every change so a page navigation (Astro remount)
  // restores the visible conversation for the same session.
  useEffect(() => {
    saveHistory(namespace, messages);
  }, [namespace, messages]);

  // ---- Send message ----
  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        // Try reconnecting, but do NOT fake a streaming turn: the message
        // cannot be delivered, and setting "streaming" here would stick the
        // UI on the typing indicator with a disabled input forever.
        connect();
        return;
      }

      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        text: text.trim(),
        timestamp: Date.now(),
      };

      // Create a placeholder for the assistant reply
      const msgId = `assistant-${Date.now()}`;
      const assistantPlaceholder: Message = {
        id: msgId,
        role: "assistant",
        text: "",
        timestamp: Date.now(),
      };

      currentTextRef.current = "";
      currentMsgIdRef.current = msgId;

      setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
      setStatus("streaming");

      // Send via WebSocket
      wsRef.current.send(
        JSON.stringify({
          type: "message",
          text: text.trim(),
          sessionId: sessionIdRef.current,
        })
      );
    },
    [connect]
  );

  // ---- Submit a lead form filled inside the chat ----
  const sendFormSubmit = useCallback(
    (formId: string, values: Record<string, string>) => {
      // Mark the form sent first: even if the socket is momentarily down the
      // visitor must not be able to send it twice.
      setMessages((prev) =>
        prev.map((m) =>
          m.kind === "form" && m.form?.id === formId
            ? { ...m, submitted: true }
            : m
        )
      );
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        connect();
        return;
      }
      wsRef.current.send(
        JSON.stringify({
          type: "form_submit",
          formId,
          sessionId: sessionIdRef.current,
          values,
        })
      );
    },
    [connect]
  );

  // ---- Clear history ----
  // Also rotates the session id (unless the host pinned one): a "new
  // conversation" must be new for the agent too, not just for the screen.
  const clearHistory = useCallback(() => {
    setMessages([]);
    currentTextRef.current = "";
    currentMsgIdRef.current = "";
    clearStoredHistory(namespace);
    if (!externalSessionId) {
      const id = createSessionId();
      sessionIdRef.current = id;
      storeSessionId(namespace, id);
    }
  }, [namespace, externalSessionId]);

  return { messages, status, sendMessage, sendFormSubmit, clearHistory };
}
