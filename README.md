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
| `agentName` | — | Nombre del agente («Mariana»). Pasa a ser el título de la cabecera y convierte el lanzador en una píldora con avatar y texto |
| `avatarUrl` | — | Imagen del agente: lanzador, cabecera y al lado de cada respuesta. Sin imagen se usan las iniciales |
| `onlineLabel` | `"En línea"` | Texto junto al punto verde de estado. `""` lo oculta. Con el socket caído muestra «Sin conexión» |
| `suggestions` | `[]` | Preguntas sugeridas: chips bajo el saludo mientras la conversación está vacía. Al tocar una se envía |
| `teaserDelay` | `0` | Milisegundos hasta mostrar una burbuja de saludo junto al lanzador cerrado. `0` la desactiva. Se muestra una vez por pestaña |
| `teaserMessage` | `welcomeMessage` | Texto de esa burbuja |
| `launcherLabel` | `"Chatea con {agentName}"` | Texto de la píldora del lanzador |
| `mode` | `"floating"` | `"inline"` dibuja solo el panel, siempre abierto, en el lugar donde se renderiza (una sección de la página). Sin lanzador ni burbuja de saludo |
| `inlineHeight` | `560` | Alto del panel en modo `inline` |
| `disclaimer` | — | Letra chica bajo la caja de texto («Asistente de IA. Puede equivocarse…») |
| `maxLength` | `1500` | Tope de caracteres por mensaje |

Sin `agentName` ni `avatarUrl` el widget se ve como en 0.2.x: nombre de la marca en la cabecera y lanzador con icono. En la cabecera hay tres botones: nueva conversación (borra el historial y abre una sesión nueva con el agente), ampliar/reducir y cerrar. La caja de texto crece hasta cuatro líneas (Enter envía, Shift+Enter salta de línea).

### Abrir el chat desde la página

Dos vías. Un evento, que funciona una vez montado el widget:

```js
document.dispatchEvent(new Event("hermes-chat:open"));
```

Y una bandera para el clic que llega **antes** de que el widget monte (normalmente se carga perezoso): el widget la lee al montar y abre.

```js
window.__hermesChatOpen = true;
```

El lanzador sigue llevando `data-chat-toggle` para quien prefiera hacerle clic.

### Teclado y lectores de pantalla

Escape cierra el panel y el foco vuelve al lanzador. En pantallas táctiles abrir el chat no levanta el teclado: primero se lee el saludo y las sugerencias. En el celular, con el chat a pantalla completa, la página de atrás no se desplaza. La lista de mensajes es un `role="log"` con `aria-live`, así que las respuestas se anuncian.

### Estado y privacidad

El id de sesión, la conversación y el estado abierto/cerrado se guardan en `sessionStorage` (30 min de inactividad), nunca en `localStorage`: la charla puede llevar nombre y teléfono y no debe sobrevivir a la pestaña.

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
  --chat-close-btn-hover-bg: rgba(255,255,255,.25);
  --chat-online: #22C55E;        /* punto de estado */
  --chat-offline: #EF4444;
  --chat-badge: #EF4444;         /* punto de «no leído» sobre el lanzador */
  --chat-avatar-bg: rgba(255,255,255,.22); /* iniciales sobre el color primario */
  --chat-chip-bg: transparent;   /* preguntas sugeridas */
  --chat-chip-hover-bg: rgba(74,124,89,.12);
}
```

## Licencia

MIT
