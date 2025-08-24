// src/routes/produtoRoutes.js (VERSÃO COMPLETA E CORRIGIDA)

const express = require("express");
const produtoController = require("../controllers/produtoController");
const avaliacaoController = require("../controllers/avaliacaoController");
const { verifyToken, isAdmin } = require("../middleware/auth");
const { validarEntrada, schemas } = require("../middleware/validarEntrada");
const variacaoProdutoRoutes = require('./variacaoProdutoRoutes');
const { uploadProductFile } = require("../middleware/upload"); // Importamos a instância do multer

const router = express.Router();

// Rotas públicas de vitrine
router.get("/lancamentos", produtoController.listarLancamentos);
router.get("/mais-vendidos", produtoController.listarMaisVendidos);

// Rotas públicas
router.get("/", produtoController.listarProdutos);
router.get("/:id", produtoController.buscarProduto);
router.get("/:id/relacionados", produtoController.listarProdutosRelacionados);

// Rotas para avaliações
router.get("/:produtoId/avaliacoes", avaliacaoController.listarAvaliacoesPorProduto);
router.get("/:produtoId/avaliacoes/media", avaliacaoController.obterMediaAvaliacoes);
router.post("/:produtoId/avaliacoes", verifyToken, avaliacaoController.criarAvaliacao);

// --- ROTAS ADMINISTRATIVAS CORRIGIDAS ---

// ROTA DE CRIAÇÃO: Agora aceita um array de arquivos com o nome 'files'
router.post("/", verifyToken, isAdmin, uploadProductFile.array('files', 10), produtoController.criarProduto);

// Rota de atualização (sem upload, pois já temos componentes para isso)
router.put("/:id", verifyToken, isAdmin, produtoController.atualizarProduto);

router.delete("/:id", verifyToken, isAdmin, produtoController.removerProduto);
router.post("/:id/relacionados", verifyToken, isAdmin, produtoController.definirProdutosRelacionados);

// Rotas para arquivos (mantidas para downloads)
router.post("/:id/arquivos", verifyToken, isAdmin, produtoController.enviarArquivoProduto);
router.get("/:id/arquivos/download", verifyToken, produtoController.baixarArquivosPagos);

// Rotas para variações
router.use('/:produtoId/variacoes', variacaoProdutoRoutes);

module.exports = router;