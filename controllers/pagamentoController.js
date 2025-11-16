// /controllers/pagamentoController.js (VERSÃO CORRIGIDA E COMPLETA)

const pagamentoService = require("../services/pagamentoService");

const pagamentoController = {
  
  /**
   * Orquestra o processamento de um pagamento (cartão ou pix).
   * É chamado pela rota POST /processar.
   */
  async processarPagamento(req, res, next) {
    try {
      const { payment_method, ...dados } = req.body;
      const usuarioId = req.usuario.id;

      if (!payment_method || !dados.pedidoId) {
        return res.status(400).json({ erro: "Método de pagamento e ID do pedido são obrigatórios." });
      }

      let resultado;

      if (payment_method === 'card') {
        resultado = await pagamentoService.processarPagamentoCartao(dados, usuarioId);
      } else if (payment_method === 'pix') {
        resultado = await pagamentoService.gerarPagamentoPix(dados.pedidoId, usuarioId);
      } else {
        return res.status(400).json({ erro: "Método de pagamento inválido." });
      }

      res.status(201).json(resultado);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Orquestra a criação de uma assinatura.
   * É chamado pela rota POST /assinaturas.
   */
  async criarAssinatura(req, res, next) {
    try {
        const dados = req.body;
        const usuarioId = req.usuario.id;

        if (!dados.planoId || !dados.token || !dados.frequencia || !dados.quantidade) {
            return res.status(400).json({ erro: "Dados insuficientes para criar a assinatura." });
        }

        const resultado = await pagamentoService.criarAssinaturaComCartao(dados, usuarioId);
        res.status(201).json(resultado);
    } catch (error) {
        next(error);
    }
  },
  
  // O webhook não muda
  async webhook(req, res, next) {
    try {
      await pagamentoService.processarWebhook(req.body);
      res.status(200).json({ message: "Webhook processado" });
    } catch (error) {
      console.error("Erro no webhook:", error);
      res.status(200).json({ message: "Webhook recebido" }); // Sempre retorna 200 para o MP
    }
  },

  // As rotas de consulta não mudam
  async verificarStatus(req, res, next) {
    try {
      const { pedidoId } = req.params;
      const pagamento = await pagamentoService.verificarStatusPagamento(pedidoId);
      res.json(pagamento);
    } catch (error) {
      next(error);
    }
  },

  async listarPagamentos(req, res, next) {
    try {
      const filtros = req.query;
      if (req.usuario.tipo !== "admin") {
        filtros.usuarioId = req.usuario.id;
      }
      const pagamentos = await pagamentoService.listarPagamentos(filtros);
      res.json(pagamentos);
    } catch (error) {
      next(error);
    }
  },
};

module.exports = pagamentoController;