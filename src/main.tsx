import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Auto-reload em caso de chunk JS desatualizado (clássico problema de
// deploy em SPA com code-splitting). Quando Vercel deploya nova versão,
// os hashes dos chunks mudam — abas abertas com o index.html antigo
// tentam carregar chunks que não existem mais e recebem o fallback HTML.
//
// Estratégia: escuta `vite:preloadError` (emitido por failed dynamic
// imports) + listener defensivo de error global. Recarrega a página
// uma única vez por sessão pra não cair em loop infinito.
function configurarAutoReloadEmChunkError() {
  const RELOAD_KEY = "chunk-error-reload-ts";
  const COOLDOWN_MS = 60_000; // 1 min entre reloads forçados

  const tentarReload = (motivo: string) => {
    const ultimo = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - ultimo < COOLDOWN_MS) {
      console.warn(`[chunk-error] Reload já ocorreu há <1min. Não recarrego (motivo: ${motivo})`);
      return;
    }
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    console.info(`[chunk-error] Recarregando página por chunk desatualizado (${motivo})`);
    window.location.reload();
  };

  // Vite dispara este evento quando dynamic import falha
  window.addEventListener("vite:preloadError", (e) => {
    e.preventDefault();
    tentarReload("vite:preloadError");
  });

  // Fallback: escuta erros não capturados que indicam chunk MIME errado
  // (Vercel devolve text/html quando o JS não existe — fallback SPA)
  window.addEventListener("error", (event) => {
    const msg = event.message || "";
    const isChunkError =
      msg.includes("Failed to fetch dynamically imported module") ||
      msg.includes("Loading chunk") ||
      msg.includes("Expected a JavaScript-or-Wasm module script") ||
      msg.includes('MIME type of "text/html"');
    if (isChunkError) tentarReload("window.error: " + msg.slice(0, 60));
  });

  // Promise rejections de dynamic import também caem aqui
  window.addEventListener("unhandledrejection", (event) => {
    const reason = String(event.reason?.message ?? event.reason ?? "");
    if (
      reason.includes("Failed to fetch dynamically imported module") ||
      reason.includes("Loading chunk")
    ) {
      tentarReload("unhandledrejection: " + reason.slice(0, 60));
    }
  });
}

configurarAutoReloadEmChunkError();

createRoot(document.getElementById("root")!).render(<App />);
