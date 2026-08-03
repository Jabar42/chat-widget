/**
 * useHermesChat — WebSocket hook for Hermes Agent.
 *
 * Replaces useAgent() + useAgentChat() from @cloudflare/ai-chat + agents/react
 * with a direct WebSocket connection to the Hermes WebChat plugin.
 */

import { useRef, useState, useCallback, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

type Status = "idle" | "connecting" | "streaming";

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

export type Frame = FrameStatus | FrameToken | FrameDone | FrameError;

export interface UseHermesChatOptions {
  /** WebSocket URL, e.g. "ws://vps-tp3.com:8765" or "wss://chat.tp3studio.com" */
  hermesUrl: string;
  /** Optional session ID. Auto-generated with 30min localStorage TTL if omitted. */
  sessionId?: string;
  /** Unique agent/session namespace for localStorage key */
  sessionNamespace?: string;
}

export interface UseHermesChatReturn {
  messages: Message[];
  status: Status;
  sendMessage: (text: string) => void;
  clearHistory: () => void;
}

// ---------------------------------------------------------------------------
// Session ID persistence (30-minute TTL, survives reloads)
// ---------------------------------------------------------------------------

function getOrCreateSessionId(namespace: string): string {
  if (typeof window === "undefined") return "ssr";
  const key = `hermes-chat-session-${namespace}`;
  const tsKey = `${key}-ts`;
  const stored = localStorage.getItem(key);
  const storedTs = localStorage.getItem(tsKey);
  const now = Date.now();
  const TTL = 30 * 60 * 1000; // 30 minutes
  if (stored && storedTs && now - Number(storedTs) < TTL) {
    localStorage.setItem(tsKey, String(now)); // bump
    return stored;
  }
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  localStorage.setItem(tsKey, String(now));
  return id;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useHermesChat(
  options: UseHermesChatOptions
): UseHermesChatReturn {
  const { hermesUrl, sessionId: externalSessionId, sessionNamespace } = options;
  const namespace = sessionNamespace || "default";

  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>("idle");

  // SSR guard: skip hook logic during server-side rendering
  const isSSR = typeof window === "undefined";
  if (isSSR) {
    return { messages, status, sendMessage: () => {}, clearHistory: () => {} };
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

  // ---- WebSocket message handler ----
  const handleFrame = useCallback((frame: Frame) => {
    switch (frame.type) {
      case "token":
        currentTextRef.current += frame.text;
        // Update the last assistant message live. If no assistant message is
        // active (a "done" already closed the previous segment — e.g. an
        // interim commentary before a tool call), OPEN A NEW assistant message
        // instead of silently dropping the token. Without this, the final
        // response after an MCP/tool call never reaches the chat (the agent
        // "goes away and never comes back" even though the task completed).
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant" && last.id === currentMsgIdRef.current) {
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
        setStatus("idle");
        break;

      case "status":
        if (frame.status === "typing") {
          setStatus("streaming");
        }
        break;

      case "error":
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
    }
  }, []);

  // ---- Connect WebSocket ----
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");

    // Ensure trailing slash and session path
    let url = hermesUrl.replace(/\/+$/, "");
    const ws = new WebSocket(url);

    ws.onopen = () => {
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
      // Auto-reconnect with backoff if not intentional
      if (reconnectAttempt.current < 5) {
        const delay = Math.min(1000 * 2 ** reconnectAttempt.current, 10000);
        reconnectAttempt.current += 1;
        reconnectTimer.current = setTimeout(() => connect(), delay);
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

  // ---- Send message ----
  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        // Try reconnecting
        connect();
        // Still add user message so UX feels responsive
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
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "message",
            text: text.trim(),
            sessionId: sessionIdRef.current,
          })
        );
      }
    },
    [connect]
  );

  // ---- Clear history ----
  const clearHistory = useCallback(() => {
    setMessages([]);
    currentTextRef.current = "";
    currentMsgIdRef.current = "";
  }, []);

  return { messages, status, sendMessage, clearHistory };
}
