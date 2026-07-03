// ===================================================
// Service Worker - Alarme Veicular PWA
// ===================================================
// Por enquanto faz o mínimo necessário para o app ser instalável.
// Push notification será adicionado na próxima etapa.
//
// IMPORTANTE: dados do alarme NÃO são cacheados - sempre vêm ao vivo
// pelo WebSocket. O cache aqui é só para os arquivos estáticos da
// interface (HTML/ícones), para o app abrir mesmo com internet ruim.

const CACHE_NOME = "alarme-v4";
const ARQUIVOS_CACHE = [
  "/",
  "/login.html",
  "/dashboard.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

// Instalação: faz cache dos arquivos estáticos
self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(CACHE_NOME).then((cache) => cache.addAll(ARQUIVOS_CACHE))
  );
  self.skipWaiting();
});

// Ativação: limpa caches antigos de versões anteriores
self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(
        nomes.filter((n) => n !== CACHE_NOME).map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

// Fetch: estratégia "network first" para o HTML (sempre tenta a versão
// mais nova), com fallback pro cache se estiver offline.
self.addEventListener("fetch", (evento) => {
  const url = new URL(evento.request.url);

  // WebSocket e requisições externas passam direto, sem cache
  if (evento.request.method !== "GET") return;

  evento.respondWith(
    fetch(evento.request)
      .then((resposta) => {
        // Atualiza o cache com a versão nova
        const clone = resposta.clone();
        caches.open(CACHE_NOME).then((cache) => cache.put(evento.request, clone));
        return resposta;
      })
      .catch(() => caches.match(evento.request)) // offline: usa cache
  );
});

// Push: recebe a notificação do servidor e mostra no dispositivo,
// mesmo com o app fechado.
self.addEventListener("push", (evento) => {
  let dados = { titulo: "Alarme Veicular", corpo: "Novo alerta" };
  try {
    if (evento.data) dados = evento.data.json();
  } catch {}

  evento.waitUntil(
    self.registration.showNotification(dados.titulo, {
      body: dados.corpo,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Vibração longa e insistente (padrão de emergência, repete o ritmo)
      vibrate: [300, 100, 300, 100, 300, 100, 300, 100, 300, 100, 300],
      tag: "alarme-alerta",
      renotify: true,
      requireInteraction: true, // fica na tela até o usuário interagir
      silent: false, // garante que use o som de notificação do sistema
    })
  );
});

// Ao tocar na notificação, abre/foca o dashboard
self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  evento.waitUntil(
    clients.matchAll({ type: "window" }).then((lista) => {
      for (const cliente of lista) {
        if (cliente.url.includes("/dashboard") && "focus" in cliente) {
          return cliente.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow("/dashboard");
    })
  );
});