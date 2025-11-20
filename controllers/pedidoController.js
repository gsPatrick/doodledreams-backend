// src/controllers/pedidoController.js

const pedidoService = require("../services/pedidoService")
const cupomService = require("../services/cupomService")
const freteService = require("../services/freteService")
const configuracaoLojaService = require("../services/configuracaoLojaService")
require("dotenv").config()

const pedidoController = {
 async criarPedido(req, res, next) {
    try {
      const usuarioId = req.user.id; 
      const { itens, enderecoEntrega, freteId, cupomCodigo } = req.body;

      if (!itens || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ erro: "O campo 'itens' é obrigatório e não pode estar vazio." });
      }

      const novoPedido = await pedidoService.criarPedido(
        usuarioId,
        itens,
        enderecoEntrega,
        freteId,
        cupomCodigo
      );

      res.status(201).json(novoPedido);
    } catch (error) {
      next(error);
    }
  },

  async atualizarStatus(req, res, next) {
    try {
      const { id } = req.params
      const { status } = req.body

      if (!status) {
        return res.status(400).json({ erro: "Status é obrigatório" })
      }

      const pedido = await pedidoService.atualizarStatusPedido(id, status)
      res.json(pedido)
    } catch (error) {
      next(error)
    }
  },

  async cancelarPedido(req, res, next) {
    try {
      const { id } = req.params
      const usuarioId = req.usuario.id

      if (req.usuario.tipo !== "admin") {
        const pedidoExistente = await pedidoService.buscarPedidoPorId(id)
        if (!pedidoExistente || pedidoExistente.usuarioId !== usuarioId) {
          return res.status(403).json({ erro: "Acesso negado" })
        }
      }

      const pedido = await pedidoService.cancelarPedido(id)
      res.json(pedido)
    } catch (error) {
      next(error)
    }
  },

  async listarPedidosAdmin(req, res, next) {
    try {
      const pedidos = await pedidoService.listarPedidos(null, req.query);
      res.json(pedidos);
    } catch (error) {
      next(error);
    }
  },

  async listarPedidosCliente(req, res, next) {
    try {
      const usuarioId = req.usuario.id;
      const pedidos = await pedidoService.listarPedidos(usuarioId, req.query);
      res.json(pedidos);
    } catch (error) {
      next(error);
    }
  },

  async buscarPedido(req, res, next) {
    try {
      const { id } = req.params
      
      // Validação básica do ID
      if (!id || id === 'undefined' || id === 'null') {
        return res.status(400).json({ erro: "ID do pedido inválido fornecido." });
      }

      const pedido = await pedidoService.buscarPedidoPorId(id)

      // Verificar se o pedido pertence ao usuário (exceto admin)
      if (req.usuario.tipo !== "admin" && (!pedido || pedido.usuarioId !== req.usuario.id)) {
        return res.status(403).json({ erro: "Acesso negado. Este pedido não pertence a você." })
      }

      res.json(pedido)
    } catch (error) {
      // Tratamento específico para 404
      if (error.message === "Pedido não encontrado") {
        return res.status(404).json({ erro: "Pedido não encontrado." });
      }
      next(error)
    }
  },

  async adicionarNotaInterna(req, res, next) {
    try {
      const { id } = req.params
      const { nota } = req.body
      const pedido = await pedidoService.buscarPedidoPorId(id) // O Service já lança erro se não achar
      
      pedido.obsInterna = nota
      await pedido.save()
      res.json(pedido)
    } catch (error) {
      if (error.message === "Pedido não encontrado") {
        return res.status(404).json({ erro: "Pedido não encontrado." });
      }
      next(error)
    }
  },

  async gerarEtiqueta(req, res, next) {
    try {
      const { id } = req.params
      const pedido = await pedidoService.buscarPedidoPorId(id)
      
      const enderecoDestino = pedido.enderecoEntrega
      const enderecoOrigem = await configuracaoLojaService.obterEnderecoOrigem()

      if (!enderecoOrigem || !enderecoOrigem.cep) {
        throw new Error("Endereço de origem não configurado no sistema.");
      }

      const etiqueta = await freteService.gerarEtiqueta(id, enderecoOrigem, enderecoDestino, pedido.itens)
      res.json(etiqueta)
    } catch (error) {
      next(error)
    }
  },

  async comprarEtiqueta(req, res, next) {
    try {
      const { etiquetaId } = req.body
      if (!etiquetaId) {
        return res.status(400).json({ erro: "O ID da etiqueta é obrigatório." })
      }
      
      const resultado = await freteService.comprarEtiqueta([etiquetaId])
      res.json(resultado)
    } catch (error) {
      next(error)
    }
  },

  async imprimirEtiqueta(req, res, next) {
    try {
      const { etiquetaId } = req.body
      if (!etiquetaId) {
        return res.status(400).json({ erro: "O ID da etiqueta é obrigatório." })
      }
      
      const pdf = await freteService.imprimirEtiqueta([etiquetaId])
      
      res.set(pdf.headers);
      res.send(pdf.data);

    } catch (error) {
      next(error)
    }
  },

  async obterDownloadsUsuario(req, res, next) {
    try {
      const usuarioId = req.usuario.id;
      const downloads = await pedidoService.obterDownloadsPorUsuario(usuarioId);
      res.status(200).json(downloads);
    } catch (error) {
      next(error);
    }
  },
}

module.exports = pedidoController;