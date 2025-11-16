// /config/mercadoPago.js

const mercadopago = require("mercadopago");

// --- CREDENCIAIS DE PRODUÇÃO HARDCODED ---
const ACCESS_TOKEN_PRODUCAO = "APP_USR-7771336761487137-111518-d1feb7719fe0b484daae4f1c5f4cf8a9-2019519940";

mercadopago.configure({
  access_token: ACCESS_TOKEN_PRODUCAO,
});

module.exports = mercadopago;