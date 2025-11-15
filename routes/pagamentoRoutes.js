// /routes/pagamentoRoutes.js

const express = require("express");
const pagamentoController = require("../controllers/pagamentoController");
const autenticar = require("../middleware/autenticar");

const router = express.Router();

// Webhook do Mercado Pago (público)
router.post("/webhook", pagamentoController.webhook);

// Todas as rotas abaixo exigem autenticação
router.use(autenticar);

// Rota principal para processar pagamentos (cartão, pix)
router.post("/processar", pagamentoController.processarPagamento);

// Rota para criar assinaturas
router.post("/assinaturas", pagamentoController.criarAssinatura);

// Rotas de consulta
router.get("/status/:pedidoId", pagamentoController.verificarStatus);
router.get("/", pagamentoController.listarPagamentos);

module.exports = router;