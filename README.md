# @tp3/chat-widget

Chat widget React que se conecta por WebSocket directo a Hermes Agent (plugin `hermes-webchat`).

Sin dependencias de Cloudflare Agents SDK ni bibliotecas externas de chat — usa el WebSocket nativo del browser.

## Instalación

```bash
npm install @tp3/chat-widget
```

## Uso

```tsx
import ChatWidget from "@tp3/chat-widget";

<ChatWidget hermesUrl="ws://vps-tp3.com:8765" />
```

### Props

| Prop | Default | Descripción |
|------|---------|-------------|
| `hermesUrl` | *(requerido)* | URL del WebSocket de Hermes (`ws://` o `wss://`) |
| `brandName` | `"Tp3studio"` | Nombre en el header |
| `brandSubtitle` | `"Asistente virtual"` | Subtítulo en el header |
| `welcomeMessage` | `"👋 ¡Hola!..."` | Mensaje de bienvenida |

## Protocolo

El widget habla un protocolo JSON simple sobre WebSocket:

```
Cliente -> {"type":"message","text":"Hola","sessionId":"abc"}
Servidor -> {"type":"status","status":"typing"}
Servidor -> {"type":"token","text":"Hola! "}
Servidor -> {"type":"done","messageId":"msg_1"}
```

## Personalización con CSS

```css
:root {
  --chat-primary: #4A7C59;
  --chat-primary-fg: #fff;
  --chat-bot-bubble: #F0F2F0;
  --chat-bot-text: #1A1A1A;
  --chat-font-heading: "Proza Libre", sans-serif;
  --chat-font-body: "Inter", sans-serif;
  --chat-border: #D4D4D4;
  --chat-shadow: 0 8px 24px rgba(0,0,0,.12);
  --chat-shadow-lg: 0 12px 48px rgba(0,0,0,.18);
  --chat-code-bg: rgba(74,124,89,.12);
  --chat-close-btn-bg: rgba(255,255,255,.15);
}
```

## Licencia

MIT
