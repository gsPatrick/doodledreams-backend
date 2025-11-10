// /routes/produtoRoutes.js

const express = require("express");
const produtoController = require("../controllers/produtoController");
const avaliacaoController = require("../controllers/avaliacaoController");
const { verifyToken, isAdmin } = require("../middleware/auth");
const { uploadProductFile } = require("../middleware/upload");

const router = express.Router();

// Rotas públicas
router.get("/lancamentos", produtoController.listarLancamentos);
router.get("/mais-vendidos", produtoController.listarMaisVendidos);
router.get("/", produtoController.listarProdutos);
router.get("/:id", produtoController.buscarProduto);
router.get("/:id/relacionados", produtoController.listarProdutosRelacionados);

// Rotas para avaliações
router.get("/:produtoId/avaliacoes", avaliacaoController.listarAvaliacoesPorProduto);
router.get("/:produtoId/avaliacoes/media", avaliacaoController.obterMediaAvaliacoes);
router.post("/:produtoId/avaliacoes", verifyToken, avaliacaoController.criarAvaliacao);

// --- ROTAS ADMINISTRATIVAS ---
router.post("/", verifyToken, isAdmin, uploadProductFile.array('files', 10), produtoController.criarProduto);
router.put("/:id", verifyToken, isAdmin, produtoController.atualizarProduto);
router.delete("/:id", verifyToken, isAdmin, produtoController.removerProduto);
router.post("/:id/relacionados", verifyToken, isAdmin, produtoController.definirProdutosRelacionados);
router.post("/:id/arquivos", verifyToken, isAdmin, produtoController.enviarArquivoProduto);
router.get("/:id/arquivos/download", verifyToken, produtoController.baixarArquivosPagos);

// --- REMOVIDA A ROTA DE VARIAÇÕES ---
// router.use('/:produtoId/variacoes', variacaoProdutoRoutes);

module.exports = router;