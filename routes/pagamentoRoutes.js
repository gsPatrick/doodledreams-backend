// /routes/pagamentoRoutes.js (VERSÃO CORRIGIDA E COMPLETA)

const express = require("express");
const pagamentoController = require("../controllers/pagamentoController");
const autenticar = require("../middleware/autenticar");

const router = express.Router();

// Webhook do Mercado Pago (rota pública, sem autenticação)
router.post("/webhook", pagamentoController.webhook);

// Todas as rotas abaixo exigem que o usuário esteja logado
router.use(autenticar);

// --- ROTA CORRIGIDA ---
// Esta é a nova rota que seu frontend está tentando chamar.
router.post("/processar", pagamentoController.processarPagamento);

// Rota para criar assinaturas (pagamentos recorrentes)
router.post("/assinaturas", pagamentoController.criarAssinatura);

// Rotas de consulta que já existiam e continuam úteis
router.get("/status/:pedidoId", pagamentoController.verificarStatus);
router.get("/", pagamentoController.listarPagamentos);

module.exports = router;