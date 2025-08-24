// routes/categoriaRoutes.js

const express = require("express");
const categoriaController = require("../controllers/categoriaController");
const { verifyToken, isAdmin } = require("../middleware/auth");
// --- MUDANÇA AQUI: Padronizando o nome da importação ---
const { uploadProductFile } = require("../middleware/upload");

const router = express.Router();

// Rotas públicas (não precisam de upload)
router.get("/", categoriaController.listarCategorias);
router.get("/:id", categoriaController.buscarCategoria);

// --- ROTAS ADMINISTRATIVAS ---
// Usando uploadProductFile.single() para um arquivo chamado 'file'
router.post("/", verifyToken, isAdmin, uploadProductFile.single('file'), categoriaController.criarCategoria);

// Usando uploadProductFile.single() para um arquivo chamado 'file'
router.put("/:id", verifyToken, isAdmin, uploadProductFile.single('file'), categoriaController.atualizarCategoria);

// Rota de exclusão (não precisa de upload)
router.delete("/:id", verifyToken, isAdmin, categoriaController.removerCategoria);

module.exports = router;