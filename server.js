// ===================================================
// Alarme Veicular - Dashboard
// Servidor MQTT + HTTP + WebSocket + Autenticacao
// ===================================================
// Fluxo: ESP32 -> MQTT -> [este servidor] -> WebSocket -> navegador
//
// Acesso protegido por senha. A senha vem da variavel de ambiente
// DASHBOARD_SENHA (configurada no Railway). Em desenvolvimento local,
// usa um valor padrao se a variavel nao existir.

const mqtt = require("mqtt");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const webpush = require("web-push");

// --- Configuracao ---
const MQTT_BROKER = process.env.MQTT_BROKER || "mqtt://mqtt-dashboard.com:1883";
const TOPICO_BASE = process.env.TOPICO_BASE || "alarme/carro01";
const PORTA = process.env.PORT || 3000;
const SENHA = process.env.DASHBOARD_SENHA || "alarme123"; // troque via env no Railway!

// --- Push Notification (Web Push / VAPID) ---
// As chaves VAPID vem de variaveis de ambiente. Gere uma vez com:
//   npx web-push generate-vapid-keys
// e coloque em VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_EMAIL = process.env.VAPID_EMAIL || "mailto:admin@exemplo.com";

let pushHabilitado = false;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
  pushHabilitado = true;
  console.log("[PUSH] Web Push habilitado");
} else {
  console.log("[PUSH] Web Push DESABILITADO (defina VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY)");
}

// Inscricoes de push (navegadores/celulares que querem receber notificacoes).
// Persistidas em arquivo para sobreviver a reinicios do servidor.
const ARQUIVO_INSCRICOES = path.join(__dirname, "inscricoes-push.json");
let inscricoesPush = [];

// Carrega inscricoes salvas ao iniciar
try {
  if (fs.existsSync(ARQUIVO_INSCRICOES)) {
    inscricoesPush = JSON.parse(fs.readFileSync(ARQUIVO_INSCRICOES, "utf8"));
    console.log(`[PUSH] ${inscricoesPush.length} inscricao(oes) carregada(s) do disco`);
  }
} catch (e) {
  console.error("[PUSH] Erro ao carregar inscricoes:", e.message);
  inscricoesPush = [];
}

function salvarInscricoes() {
  try {
    fs.writeFileSync(ARQUIVO_INSCRICOES, JSON.stringify(inscricoesPush));
  } catch (e) {
    console.error("[PUSH] Erro ao salvar inscricoes:", e.message);
  }
}

// Adiciona uma inscricao, evitando duplicatas (compara pelo endpoint)
function adicionarInscricao(inscricao) {
  if (!inscricao || !inscricao.endpoint) return;
  const jaExiste = inscricoesPush.some((i) => i.endpoint === inscricao.endpoint);
  if (!jaExiste) {
    inscricoesPush.push(inscricao);
    salvarInscricoes();
    console.log(`[PUSH] Novo dispositivo inscrito (total: ${inscricoesPush.length})`);
  } else {
    console.log("[PUSH] Dispositivo ja inscrito (ignorado)");
  }
}

// Remove uma inscricao pelo endpoint (quando expira/invalida)
function removerInscricao(endpoint) {
  const antes = inscricoesPush.length;
  inscricoesPush = inscricoesPush.filter((i) => i.endpoint !== endpoint);
  if (inscricoesPush.length !== antes) {
    salvarInscricoes();
    console.log(`[PUSH] Inscricao removida (total: ${inscricoesPush.length})`);
  }
}

// Eventos que disparam notificacao push (violacoes de seguranca)
const EVENTOS_PUSH = {
  disparo: "🚨 ALARME DISPARADO",
  panico: "🚨 Pânico acionado",
  vibracao_forte: "🚨 Possível tentativa de reboque",
  coacao: "🚨 Alerta de coação",
};

// Envia uma notificacao push para todos os dispositivos inscritos
async function enviarPush(titulo, corpo) {
  if (!pushHabilitado) return;
  if (inscricoesPush.length === 0) {
    console.log("[PUSH] Nenhum dispositivo inscrito - notificacao nao enviada");
    return;
  }
  const payload = JSON.stringify({ titulo, corpo });
  console.log(`[PUSH] Enviando "${titulo}" para ${inscricoesPush.length} dispositivo(s)`);

  // Copia a lista para iterar com segurança (podemos remover durante o loop)
  for (const inscricao of [...inscricoesPush]) {
    try {
      await webpush.sendNotification(inscricao, payload);
    } catch (err) {
      // Inscricao invalida/expirada: remove do disco
      if (err.statusCode === 410 || err.statusCode === 404) {
        removerInscricao(inscricao.endpoint);
      }
      console.error("[PUSH] Erro ao enviar:", err.statusCode || err.message);
    }
  }
}

// Tokens de sessao validos (em memoria - reiniciar o servidor desloga todos)
const tokensValidos = new Set();

function gerarToken() {
  const token = crypto.randomBytes(24).toString("hex");
  tokensValidos.add(token);
  return token;
}

function tokenValido(token) {
  return token && tokensValidos.has(token);
}

// Le o token do cabecalho Authorization ou query string
function extrairToken(req) {
  const auth = req.headers["authorization"];
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7);
  const url = new URL(req.url, "http://x");
  return url.searchParams.get("token");
}

// ===================================================
// 1. SERVIDOR HTTP
// ===================================================
const tiposMime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function lerCorpo(req) {
  return new Promise((resolve) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", () => resolve(corpo));
  });
}

const servidorHttp = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const rota = url.pathname;

  // --- API: login ---
  if (rota === "/api/login" && req.method === "POST") {
    const corpo = await lerCorpo(req);
    let senhaEnviada = "";
    try {
      senhaEnviada = JSON.parse(corpo).senha || "";
    } catch {}

    if (senhaEnviada === SENHA) {
      const token = gerarToken();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, token }));
    } else {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
    }
    return;
  }

  // --- API: logout ---
  if (rota === "/api/logout" && req.method === "POST") {
    const token = extrairToken(req);
    tokensValidos.delete(token);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // --- API: chave publica VAPID (para o navegador se inscrever) ---
  if (rota === "/api/vapid-public" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ chave: VAPID_PUBLIC, habilitado: pushHabilitado }));
    return;
  }

  // --- API: registrar inscricao de push (protegida) ---
  if (rota === "/api/inscrever-push" && req.method === "POST") {
    const token = extrairToken(req);
    if (!tokenValido(token)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
      return;
    }
    const corpo = await lerCorpo(req);
    try {
      const inscricao = JSON.parse(corpo);
      adicionarInscricao(inscricao);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
    }
    return;
  }

  // --- Pagina de login (publica) ---
  if (rota === "/" || rota === "/login.html") {
    servirArquivo(res, "login.html");
    return;
  }

  // --- Dashboard (protegido: so serve o HTML; a validacao real
  //     acontece no WebSocket. O HTML em si nao tem segredo) ---
  if (rota === "/dashboard" || rota === "/dashboard.html") {
    servirArquivo(res, "dashboard.html");
    return;
  }

  // --- Arquivos estaticos (manifest, icones, sw) ---
  let caminho = rota === "/" ? "/login.html" : rota;
  caminho = caminho.split("?")[0];
  const arquivoLocal = path.join(__dirname, "public", caminho);
  if (!arquivoLocal.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(403);
    res.end("Acesso negado");
    return;
  }
  servirArquivoCompleto(res, arquivoLocal);
});

function servirArquivo(res, nome) {
  servirArquivoCompleto(res, path.join(__dirname, "public", nome));
}

function servirArquivoCompleto(res, arquivoLocal) {
  fs.readFile(arquivoLocal, (err, conteudo) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Arquivo nao encontrado");
      return;
    }
    const ext = path.extname(arquivoLocal);
    res.writeHead(200, { "Content-Type": tiposMime[ext] || "text/plain" });
    res.end(conteudo);
  });
}

// ===================================================
// 2. WEBSOCKET (exige token valido na conexao)
// ===================================================
const wss = new WebSocketServer({ server: servidorHttp });
const clientesWeb = new Set();
const ultimasMensagens = {};

wss.on("connection", (ws, req) => {
  // Valida o token passado na query string (?token=...)
  const token = extrairToken(req);
  if (!tokenValido(token)) {
    ws.close(4001, "nao autorizado");
    console.log("[WS] Conexao rejeitada - token invalido");
    return;
  }

  clientesWeb.add(ws);
  console.log(`[WS] Navegador conectado (total: ${clientesWeb.size})`);

  ws.send(JSON.stringify({ tipo: "_conexao", mensagem: "conectado ao servidor" }));

  for (const tipo in ultimasMensagens) {
    ws.send(JSON.stringify(ultimasMensagens[tipo]));
  }

  ws.on("message", (dadosBrutos) => {
    let msg;
    try {
      msg = JSON.parse(dadosBrutos.toString());
    } catch {
      return;
    }
    if (msg.acao === "comando" && msg.comando) {
      const payload = JSON.stringify(msg.comando);
      const topicoComando = TOPICO_BASE + "/comando";
      clienteMqtt.publish(topicoComando, payload);
      console.log(`[WS->MQTT] Comando publicado em ${topicoComando}: ${payload}`);
    }
  });

  ws.on("close", () => {
    clientesWeb.delete(ws);
    console.log(`[WS] Navegador desconectado (total: ${clientesWeb.size})`);
  });

  ws.on("error", (err) => console.error("[WS] Erro:", err.message));
});

function transmitirParaNavegadores(dados) {
  const mensagem = JSON.stringify(dados);
  for (const ws of clientesWeb) {
    if (ws.readyState === 1) ws.send(mensagem);
  }
}

// ===================================================
// 3. CLIENTE MQTT
// ===================================================
const clienteMqtt = mqtt.connect(MQTT_BROKER, {
  clientId: "dashboard_servidor_" + Math.random().toString(16).slice(2, 8),
  reconnectPeriod: 5000,
});

clienteMqtt.on("connect", () => {
  console.log("[MQTT] Conectado ao broker:", MQTT_BROKER);
  const topico = TOPICO_BASE + "/#";
  clienteMqtt.subscribe(topico, (err) => {
    if (err) console.error("[MQTT] Erro ao inscrever:", err.message);
    else console.log("[MQTT] Inscrito em:", topico);
  });
});

clienteMqtt.on("message", (topico, payload) => {
  const mensagem = payload.toString();
  const horario = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
  console.log(`[${horario}] mensagem em ${topico}`);

  const subtopico = topico.replace(TOPICO_BASE + "/", "");
  let dados;
  try {
    dados = JSON.parse(mensagem);
  } catch {
    dados = { _texto: mensagem };
  }

  const pacote = { tipo: subtopico, dados: dados, horario: horario };
  if (subtopico === "status" || subtopico === "conexao") {
    ultimasMensagens[subtopico] = pacote;
  }
  transmitirParaNavegadores(pacote);

  // Dispara push notification para eventos de violação de segurança.
  // O tipo do evento vem em dados.tipo (ex: "disparo", "panico").
  if (subtopico === "evento" && dados && dados.tipo) {
    const tituloPush = EVENTOS_PUSH[dados.tipo];
    if (tituloPush) {
      const corpo = dados.descricao || "Verifique seu veículo";
      enviarPush(tituloPush, corpo);
    }
  }
  // O alerta de coação vem em tópico próprio (retained)
  if (subtopico === "coacao") {
    enviarPush("🚨 Alerta de coação", "Desarme sob coação detectado");
  }
});

clienteMqtt.on("error", (err) => console.error("[MQTT] Erro:", err.message));
clienteMqtt.on("reconnect", () => console.log("[MQTT] Reconectando..."));
clienteMqtt.on("offline", () => console.log("[MQTT] Offline"));

// ===================================================
// INICIAR
// ===================================================
servidorHttp.listen(PORTA, () => {
  console.log("===========================================");
  console.log("  Alarme Dashboard - com autenticacao");
  console.log("  Servidor rodando em: http://localhost:" + PORTA);
  console.log("  Senha de acesso:", SENHA === "alarme123" ? "alarme123 (PADRAO - troque!)" : "(definida via env)");
  console.log("===========================================");
});