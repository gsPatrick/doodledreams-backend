const express = require('express');
const router = express.Router();
const pedidoController = require('../controllers/pedidoController');
const { verifyToken, isAdmin } = require("../middleware/auth");

// --- ROTAS DO CLIENTE ---

// Criar um novo pedido
router.post('/', verificarToken, pedidoController.criarPedido);

// Listar pedidos do usuário logado
router.get('/meus-pedidos', verificarToken, pedidoController.listarPedidosCliente);

// Listar produtos digitais (downloads) disponíveis para o usuário
router.get('/meus-downloads', verificarToken, pedidoController.obterDownloadsUsuario);

// --- ROTAS DO ADMINISTRADOR ---

// Listar todos os pedidos do sistema (Painel Admin)
router.get('/admin', verificarToken, isAdmin, pedidoController.listarPedidosAdmin);

// Atualizar status do pedido (ex: enviado, entregue)
router.put('/:id/status', verificarToken, isAdmin, pedidoController.atualizarStatus);

// Adicionar nota interna ao pedido (visível apenas para admins)
router.post('/:id/nota', verificarToken, isAdmin, pedidoController.adicionarNotaInterna);

// --- ROTAS DE ETIQUETAS / FRETE (ADMIN) ---

// Gerar cotação/prévia da etiqueta para um pedido
router.post('/:id/etiqueta', verificarToken, isAdmin, pedidoController.gerarEtiqueta);

// Comprar etiqueta (transação real com a transportadora)
router.post('/etiqueta/comprar', verificarToken, isAdmin, pedidoController.comprarEtiqueta);

// Obter link/PDF da etiqueta para impressão
router.post('/etiqueta/imprimir', verificarToken, isAdmin, pedidoController.imprimirEtiqueta);

// --- ROTAS COMUNS (ID) ---
// Importante: Devem ficar por último para não conflitar com rotas fixas como 'admin' ou 'meus-pedidos'

// Buscar detalhes de um pedido específico
router.get('/:id', verificarToken, pedidoController.buscarPedido);

// Cancelar um pedido (Cliente pode cancelar se pendente, Admin pode forçar)
router.post('/:id/cancelar', verificarToken, pedidoController.cancelarPedido);

module.exports = router;