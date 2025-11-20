const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { verificarToken, isAdmin } = require('../middlewares/authMiddleware');

// Todas as rotas de dashboard devem ser protegidas para admin
router.use(verificarToken, isAdmin);

// Metricas gerais (KPIs)
router.get('/metricas', dashboardController.obterMetricas);

// Gráfico de vendas
router.get('/vendas-periodo', dashboardController.obterVendasPorPeriodo);

// Produtos mais vendidos
router.get('/produtos-mais-vendidos', dashboardController.obterProdutosMaisVendidos);

// Clientes TOP
router.get('/clientes-top', dashboardController.obterClientesTop);

module.exports = router;