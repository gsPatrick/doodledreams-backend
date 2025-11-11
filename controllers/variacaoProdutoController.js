const { VariacaoProduto, Produto } = require("../models")

const variacaoProdutoController = {
  // Criar variação vinculada ao produto
  async criar(req, res, next) {
    try {
      const { produtoId } = req.params
      // <-- MUDANÇA AQUI: Sai 'preco', entra 'medidas'
      const { nome, medidas, digital = false, estoque = 0, ativo = true } = req.body

      const produto = await Produto.findByPk(produtoId)
      if (!produto) {
        return res.status(444).json({ erro: "Produto não encontrado" })
      }

      const variacao = await VariacaoProduto.create({
        produtoId,
        nome,
        medidas, // <-- MUDANÇA AQUI
        digital,
        estoque,
        ativo,
      })

      res.status(201).json(variacao)
    } catch (error) {
      next(error)
    }
  },

  // Criar múltiplas variações de uma vez
  async criarEmLote(req, res, next) {
    try {
      const { produtoId } = req.params
      const variacoes = req.body

      if (!Array.isArray(variacoes)) {
        return res.status(400).json({ erro: "O corpo da requisição deve ser um array de variações" })
      }

      const produto = await Produto.findByPk(produtoId)
      if (!produto) {
        return res.status(404).json({ erro: "Produto não encontrado" })
      }

      // <-- MUDANÇA AQUI: Lógica de formatação ajustada
      const variacoesComProdutoId = variacoes.map(variacao => {
        return {
          produtoId,
          nome: variacao.nome || "Tamanho Único",
          medidas: variacao.medidas || null,
          digital: !!variacao.digital,
          estoque: parseInt(variacao.estoque) || 0,
          ativo: variacao.ativo !== false
        };
      });

      const variacoesCriadas = await VariacaoProduto.bulkCreate(variacoesComProdutoId)
      res.status(201).json(variacoesCriadas)
    } catch (error) {
      next(error)
    }
  },

  // Listar variações de um produto
  async listar(req, res, next) {
    try {
      const { produtoId } = req.params
      const variacoes = await VariacaoProduto.findAll({ where: { produtoId } })
      res.json(variacoes)
    } catch (error) {
      next(error)
    }
  },

  // Atualizar variação
  async atualizar(req, res, next) {
    try {
      const { id } = req.params
      const variacao = await VariacaoProduto.findByPk(id)
      if (!variacao) {
        return res.status(404).json({ erro: "Variação não encontrada" })
      }
      
      // <-- MUDANÇA AQUI: Removemos a referência ao preço
      if (req.body.preco !== undefined) delete req.body.preco;
      
      await variacao.update(req.body)
      res.json(variacao)
    } catch (error) {
      next(error)
    }
  },

  // Remover variação
  async remover(req, res, next) {
    try {
      const { id } = req.params
      const variacao = await VariacaoProduto.findByPk(id)
      if (!variacao) {
        return res.status(404).json({ erro: "Variação não encontrada" })
      }
      await variacao.destroy()
      res.json({ message: "Variação removida com sucesso" })
    } catch (error) {
      next(error)
    }
  },
}

module.exports = variacaoProdutoController