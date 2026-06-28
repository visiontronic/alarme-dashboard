# 🚗 Alarme Veicular — Dashboard

![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![License](https://img.shields.io/badge/license-MIT-green)

Dashboard web (PWA) para monitoramento e controle do [Alarme Veicular Inteligente ESP32](https://github.com/visiontronic/alarme-esp32).

Mostra em tempo real o estado do alarme, portas, ignição, bomba de combustível, GPS e conexão — e permite armar, desarmar, travar, controlar vidros e acionar pânico remotamente. Instalável como app no celular.

---

## Arquitetura

```
ESP32  ──MQTT──>  Broker  ──MQTT──>  [Servidor Node.js]  ──WebSocket──>  Navegador/App
```

O dashboard não fala direto com o ESP32. Ambos se comunicam pelo broker MQTT, e o servidor Node.js faz a ponte entre o MQTT e o navegador via WebSocket, servindo também a interface protegida por login.

---

## Funcionalidades

- 📊 Status em tempo real (estado, portas, ignição, bomba, GPS, conexão)
- 🎮 Controles remotos (armar, desarmar, travar, vidros, pânico)
- 🔄 Botão de atualização manual
- 🔒 Acesso protegido por senha
- 📱 PWA instalável (funciona como app no celular)
- 📋 Histórico de eventos

---

## Rodando localmente

```bash
npm install
npm start
```
Acesse `http://localhost:3000`. Senha padrão local: `alarme123`.

---

## Deploy no Railway

1. Suba este repositório no GitHub
2. No [Railway](https://railway.app), crie um projeto a partir do repositório
3. Configure as variáveis de ambiente (veja `.env.example`):
   - `DASHBOARD_SENHA` — senha de acesso (use uma senha forte)
   - `MQTT_BROKER` — endereço do broker
   - `TOPICO_BASE` — tópico base do alarme
4. O Railway detecta o Node.js, roda `npm install` e `npm start` automaticamente

---

## Estrutura

```
alarme-dashboard/
├── package.json
├── server.js              # servidor MQTT + HTTP + WebSocket + auth
├── .env.example
└── public/
    ├── login.html         # tela de login
    ├── dashboard.html     # painel principal
    ├── manifest.json      # PWA
    ├── sw.js              # service worker
    ├── icon-192.png
    └── icon-512.png
```

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `DASHBOARD_SENHA` | `alarme123` | Senha de acesso ao dashboard |
| `MQTT_BROKER` | `mqtt://mqtt-dashboard.com:1883` | Broker MQTT |
| `TOPICO_BASE` | `alarme/carro01` | Tópico base do alarme |
| `PORT` | `3000` | Porta (Railway define automaticamente) |

---

## 📄 Licença

[MIT](LICENSE)
