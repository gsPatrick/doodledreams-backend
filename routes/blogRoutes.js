// routes/blogRoutes.js

const express = require("express");
const blogController = require("../controllers/blogController");
const autenticar = require("../middleware/autenticar"); // Supondo que você use este
const { verifyToken, isAdmin } = require("../middleware/auth"); // Ou este

// --- MUDANÇA CRUCIAL 1: Importar a instância correta do middleware ---
// Em vez de importar 'uploadImage' e 'processUploadedImage',
// importamos a instância principal do multer.
const { uploadProductFile } = require('../middleware/upload');

const router = express.Router();

// Rotas públicas
router.get("/", blogController.listarPosts);
router.get("/:slug", blogController.buscarPorSlug);

// As rotas abaixo precisam de autenticação de admin
router.use(verifyToken, isAdmin);

// Rotas administrativas
router.get("/admin/todos", blogController.listarTodosAdmin);
router.post("/", blogController.criarPost);
router.put("/:id", blogController.atualizarPost);
router.delete("/:id", blogController.excluirPost);
router.post("/:id/aprovar", blogController.aprovarPost);

// --- MUDANÇA CRUCIAL 2: Usar a instância correta do multer ---
// A rota para upload de imagem de destaque do blog agora usa 'uploadProductFile'
// e chama o método '.single()', passando o nome do campo ('imagem').
//
// REMOVEMOS 'processUploadedImage' daqui, pois o processamento
// agora é responsabilidade do controller/service que recebe o buffer.
router.post(
    '/upload-imagem',
    uploadProductFile.single('imagem'), // O middleware do multer é chamado aqui
    blogController.uploadImagemDestaque // O controller lida com o arquivo em req.file.buffer
);

module.exports = router;