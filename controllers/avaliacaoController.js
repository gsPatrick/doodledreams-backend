const avaliacaoService = require("../services/avaliacaoService")

const avaliacaoController = {
  async criarAvaliacao(req, res, next) {
    try {
      // --- CORREÇÃO APLICADA AQUI ---
      const usuarioId = req.usuario.id;
      const { produtoId } = req.params; // 1. Pegar o ID do produto da URL.
      
      // 2. Montar o objeto de dados combinando o corpo da requisição e o ID do produto.
      // O backend agora espera 'nota' e 'comentario' do frontend.
      const dadosParaCriar = {
        ...req.body,
        produtoId: produtoId, 
      };

      const avaliacao = await avaliacaoService.criarAvaliacao(usuarioId, dadosParaCriar);
      res.status(201).json(avaliacao);
    } catch (error) {
      // Adiciona um log mais claro no servidor para ajudar em futuros diagnósticos
      console.error(`[criarAvaliacao] Erro ao criar avaliação para o produto ${req.params.produtoId}:`, error.message);
      next(error);
    }
  },

  async listarAvaliacoesPorProduto(req, res, next) {
    try {
      const { produtoId } = req.params
      // Opcional: verifica se há um usuário logado e se é admin para mostrar todas as avaliações
      const incluirNaoAprovadas = req.usuario?.tipo === "admin"

      const avaliacoes = await avaliacaoService.listarAvaliacoesPorProduto(produtoId, incluirNaoAprovadas)

      res.json(avaliacoes)
    } catch (error) {
      next(error)
    }
  },

  async listarMinhasAvaliacoes(req, res, next) {
    try {
      const usuarioId = req.usuario.id
      const avaliacoes = await avaliacaoService.listarAvaliacoesPorUsuario(usuarioId)
      res.json(avaliacoes)
    } catch (error) {
      next(error)
    }
  },

  async buscarAvaliacao(req, res, next) {
    try {
      const { id } = req.params
      const avaliacao = await avaliacaoService.buscarAvaliacaoPorId(id)
      res.json(avaliacao)
    } catch (error) {
      next(error)
    }
  },

  async atualizarAvaliacao(req, res, next) {
    try {
      const { id } = req.params
      const usuarioId = req.usuario.id
      const avaliacao = await avaliacaoService.atualizarAvaliacao(id, usuarioId, req.body)
      res.json(avaliacao)
    } catch (error) {
      next(error)
    }
  },

  async removerAvaliacao(req, res, next) {
    try {
      const { id } = req.params
      const usuarioId = req.usuario.id
      // Se for admin, pode remover qualquer uma. Se não, só a própria.
      const podeRemover = req.usuario.tipo === 'admin' ? null : usuarioId;
      const resultado = await avaliacaoService.removerAvaliacao(id, podeRemover)
      res.json(resultado)
    } catch (error) {
      next(error)
    }
  },

  // Rotas apenas para Admin
  async aprovarAvaliacao(req, res, next) {
    try {
      const { id } = req.params
      const avaliacao = await avaliacaoService.aprovarAvaliacao(id)
      res.json(avaliacao)
    } catch (error) {
      next(error)
    }
  },

  async listarAvaliacoesPendentes(req, res, next) {
    try {
      const avaliacoes = await avaliacaoService.listarAvaliacoesPendentes()
      res.json(avaliacoes)
    } catch (error) {
      next(error)
    }
  },

  async obterMediaAvaliacoes(req, res, next) {
    try {
      const { produtoId } = req.params
      const media = await avaliacaoService.calcularMediaAvaliacoes(produtoId)
      res.json(media)
    } catch (error) {
      next(error)
    }
  },
}

module.exports = avaliacaoController