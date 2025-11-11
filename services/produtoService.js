// src/services/produtoService.js

const { Produto, ArquivoProduto, Avaliacao, Usuario, ItemPedido, Pedido, Categoria, VariacaoProduto } = require("../models")
const { Op } = require("sequelize")

const produtoService = {
  async criarProduto(dados) {
    try {
      // --- CORREÇÃO APLICADA ---
      // O objeto 'dados' recebido do controller (que contém nome, preco, etc.)
      // é passado diretamente para o método de criação do Sequelize.
      const produto = await Produto.create(dados);
      return produto;
    } catch (error) {
      console.error("Erro no serviço ao criar produto:", error);
      throw error;
    }
  },

  async atualizarProduto(id, dados) {
    try {
      const produto = await Produto.findByPk(id)
      if (!produto) {
        throw new Error("Produto não encontrado")
      }

      // 'preco' agora pode ser atualizado. 'estoque' não pertence a este modelo.
      if (dados.estoque !== undefined) delete dados.estoque;

      await produto.update(dados)

      return produto
    } catch (error) {
      throw error
    }
  },

  async removerProduto(id) {
    try {
      const produto = await Produto.findByPk(id)
      if (!produto) {
        throw new Error("Produto não encontrado")
      }

      const arquivosAssociados = await ArquivoProduto.findAll({ where: { produtoId: id } });
      for (const arquivo of arquivosAssociados) {
          try {
              await require('./uploadService').removerArquivo(arquivo.url);
              await arquivo.destroy();
          } catch (err) {
              console.warn(`Falha ao remover arquivo ${arquivo.url}: ${err.message}`);
          }
      }

      await produto.destroy()
      return { message: "Produto removido com sucesso" }
    } catch (error) {
      throw error
    }
  },

  async listarProdutos(filtros = {}) {
    try {
      const { categorias, busca, page = 1, limit = 10, ordenarPor } = filtros;
      const where = { ativo: true };

      if (categorias) {
        const listaCategorias = categorias.split(',').map(c => c.trim());
        if (listaCategorias.length > 0) {
          where.categoriaId = { [Op.in]: listaCategorias };
        }
      }

      if (busca) {
        const palavras = busca.trim().split(/\s+/).filter(Boolean);
        if (palavras.length > 0) {
          where[Op.and] = palavras.map(palavra => ({
            [Op.or]: [
              { nome: { [Op.like]: `%${palavra}%` } },
              { descricao: { [Op.like]: `%${palavra}%` } }
            ]
          }));
        }
      }

      const totalCount = await Produto.count({ where });
      const offset = (page - 1) * limit;
      let order = [];

      const includeOptions = [
        { model: ArquivoProduto, as: 'ArquivoProdutos', required: false },
        { model: Avaliacao, include: [{ model: Usuario, attributes: ["nome"] }], required: false },
        { model: VariacaoProduto, as: 'variacoes', required: false }
      ];

      const findOptions = {
        where,
        include: includeOptions,
        order,
        subQuery: false,
      };
      
      if (totalCount > parseInt(limit)) {
        findOptions.limit = parseInt(limit);
        findOptions.offset = offset;
      }

      switch (ordenarPor) {
        case "nome_asc": order.push(["nome", "ASC"]); break;
        case "nome_desc": order.push(["nome", "DESC"]); break;
        case "lancamentos":
        default:
          order.push(["createdAt", "DESC"]);
      }

      const produtos = await Produto.findAll(findOptions);

      const produtosFormatados = produtos.map(produto => {
        const p = produto.toJSON();
        p.imagens = (p.ArquivoProdutos || []).filter(arq => arq.tipo === 'imagem').sort((a, b) => (a.principal ? -1 : 1) || a.ordem - b.ordem).map(arq => arq.url);
        p.itensDownload = (p.ArquivoProdutos || []).filter(arq => arq.tipo === 'arquivo').map(arq => ({ id: arq.id, nome: arq.nome, url: arq.url }));
        p.videos = (p.ArquivoProdutos || []).filter(arq => arq.tipo === 'video').map(arq => ({ id: arq.id, nome: arq.nome, url: arq.url, metadados: arq.metadados }));
        return p;
      });

      return {
        produtos: produtosFormatados,
        total: totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        currentPage: parseInt(page),
      }
    } catch (error) {
      console.error("Erro ao listar produtos:", error);
      throw error
    }
  },

  async buscarProdutoPorId(idOuSlug) {
    try {
      const isNumeric = !isNaN(parseFloat(idOuSlug)) && isFinite(idOuSlug);
      const whereClause = isNumeric 
        ? { id: idOuSlug, ativo: true } 
        : { slug: idOuSlug, ativo: true };

      const produto = await Produto.findOne({
        where: whereClause,
        include: [
          { model: ArquivoProduto, as: "ArquivoProdutos", required: false },
          { model: Avaliacao, include: [{ model: Usuario, attributes: ["nome"] }] },
          { model: Categoria, as: 'categoria', attributes: ['id', 'nome'] },
          { model: VariacaoProduto, as: 'variacoes', required: false }
        ],
      });

      if (!produto) {
        throw new Error("Produto não encontrado");
      }

      const produtoJSON = produto.toJSON();
      produtoJSON.imagens = (produtoJSON.ArquivoProdutos || []).filter(arq => arq.tipo === 'imagem').sort((a, b) => (a.principal === b.principal) ? 0 : a.principal ? -1 : 1).map(arq => arq.url);
      produtoJSON.itensDownload = (produtoJSON.ArquivoProdutos || []).filter(arq => arq.tipo === 'arquivo').map(arq => ({ id: arq.id, nome: arq.nome, url: arq.url }));
      produtoJSON.videos = (produtoJSON.ArquivoProdutos || []).filter(arq => arq.tipo === 'video').map(arq => ({ id: arq.id, nome: arq.nome, url: arq.url, metadados: arq.metadados }));

      return produtoJSON;
    } catch (error) {
      throw error;
    }
  },

  async adicionarImagemProduto(produtoId, imagemInfo) {
    try {
      const produto = await Produto.findByPk(produtoId)
      if (!produto) throw new Error("Produto não encontrado")
      const arquivoProduto = await ArquivoProduto.create({
        produtoId,
        nome: imagemInfo.nomeOriginal,
        url: imagemInfo.url,
        mimeType: imagemInfo.tipo,
        tamanho: imagemInfo.tamanho,
        tipo: "imagem",
        metadados: imagemInfo.metadados
      })
      return arquivoProduto
    } catch (error) {
      throw error
    }
  },

  async adicionarArquivoProduto(produtoId, arquivoInfo) {
    try {
      const produto = await Produto.findByPk(produtoId)
      if (!produto) throw new Error("Produto não encontrado")
      const arquivoProduto = await ArquivoProduto.create({
        produtoId,
        nome: arquivoInfo.nomeOriginal,
        url: arquivoInfo.url,
        mimeType: arquivoInfo.tipo,
        tamanho: arquivoInfo.tamanho,
        tipo: 'arquivo',
        metadados: {}
      })
      return arquivoProduto
    } catch (error) {
      throw error
    }
  },

  async removerArquivoProduto(produtoId, arquivoId) {
    try {
      const arquivo = await ArquivoProduto.findOne({ where: { id: arquivoId, produtoId: produtoId } })
      if (!arquivo) throw new Error("Arquivo não encontrado")
      const uploadService = require('./uploadService');
      await uploadService.removerArquivo(arquivo.url);
      await arquivo.destroy()
      return { message: "Arquivo removido com sucesso" }
    } catch (error) {
      throw error
    }
  },

  async listarArquivosPorProduto(produtoId) {
    try {
      const arquivos = await ArquivoProduto.findAll({ where: { produtoId } })
      return arquivos
    } catch (error) {
      throw error
    }
  },

  async listarLancamentos({ limit = 10 } = {}) {
    try {
      const produtos = await Produto.findAll({
        where: { ativo: true },
        include: [
          { model: ArquivoProduto, as: 'ArquivoProdutos', required: false },
          { model: VariacaoProduto, as: 'variacoes', required: false }
        ],
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit, 10),
      });
      const produtosFormatados = produtos.map(produto => {
        const produtoJSON = produto.toJSON();
        produtoJSON.imagens = (produtoJSON.ArquivoProdutos || []).filter(arq => arq.tipo === 'imagem').sort((a, b) => (a.principal === b.principal) ? 0 : a.principal ? -1 : 1).map(arq => arq.url);
        produtoJSON.itensDownload = (produtoJSON.ArquivoProdutos || []).filter(arq => arq.tipo === 'arquivo').map(arq => ({ id: arq.id, nome: arq.nome, url: arq.url }));
        produtoJSON.videos = (produtoJSON.ArquivoProdutos || []).filter(arq => arq.tipo === 'video').map(arq => ({ id: arq.id, nome: arq.nome, url: arq.url, metadados: arq.metadados }));
        return produtoJSON;
      });
      return produtosFormatados;
    } catch (error) {
      throw error;
    }
  },

  async listarMaisVendidos({ limit = 10 } = {}) {
    try {
      const pedidos = await Pedido.findAll({
        where: { status: { [Op.in]: ['pago', 'processando', 'enviado', 'entregue'] } },
        attributes: ['itens']
      });
      if (pedidos.length === 0) return [];
      const contagemDeVendas = pedidos.reduce((acc, pedido) => {
        if (pedido.itens && Array.isArray(pedido.itens)) {
          pedido.itens.forEach(item => {
            if (item.produtoId && item.quantidade) {
              acc[item.produtoId] = (acc[item.produtoId] || 0) + item.quantidade;
            }
          });
        }
        return acc;
      }, {});
      if (Object.keys(contagemDeVendas).length === 0) return [];
      const maisVendidosIds = Object.entries(contagemDeVendas).sort(([, a], [, b]) => b - a).slice(0, parseInt(limit, 10)).map(([id]) => id);
      if (maisVendidosIds.length === 0) return [];
      const produtos = await Produto.findAll({
        where: { id: { [Op.in]: maisVendidosIds }, ativo: true },
        include: [
          { model: ArquivoProduto, as: 'ArquivoProdutos', required: false },
          { model: VariacaoProduto, as: 'variacoes', required: false }
        ]
      });
      const produtosNaoFormatados = maisVendidosIds.map(id => produtos.find(p => p.id == id)).filter(p => p);
      const produtosFormatados = produtosNaoFormatados.map(produto => {
        const produtoJSON = produto.toJSON();
        produtoJSON.imagens = (produtoJSON.ArquivoProdutos || []).filter(arq => arq.tipo === 'imagem').sort((a, b) => (a.principal === b.principal) ? 0 : a.principal ? -1 : 1).map(arq => arq.url);
        produtoJSON.itensDownload = (produtoJSON.ArquivoProdutos || []).filter(arq => arq.tipo === 'arquivo').map(arq => ({ id: arq.id, nome: arq.nome, url: arq.url }));
        produtoJSON.videos = (produtoJSON.ArquivoProdutos || []).filter(arq => arq.tipo === 'video').map(arq => ({ id: arq.id, nome: arq.nome, url: arq.url, metadados: arq.metadados }));
        return produtoJSON;
      });
      return produtosFormatados;
    } catch (error) {
      console.error("Erro detalhado ao listar mais vendidos:", error);
      throw error;
    }
  },

  async buscarProdutosRelacionados(idOuSlug, limite = 4) {
    try {
      const isNumeric = !isNaN(parseFloat(idOuSlug)) && isFinite(idOuSlug);
      const whereClause = isNumeric ? { id: idOuSlug } : { slug: idOuSlug };
      const produtoAtual = await Produto.findOne({ where: whereClause });
      if (!produtoAtual || !produtoAtual.categoriaId) {
        return [];
      }
      const relacionados = await Produto.findAll({
        where: {
          categoriaId: produtoAtual.categoriaId,
          id: { [Op.ne]: produtoAtual.id },
          ativo: true,
        },
        limit: parseInt(limite),
        include: [
          { model: ArquivoProduto, as: 'ArquivoProdutos', required: false },
          { model: VariacaoProduto, as: 'variacoes', required: false },
        ],
      });
      const produtosFormatados = relacionados.map(produto => {
        const p = produto.toJSON();
        p.imagens = (p.ArquivoProdutos || []).filter(arq => arq.tipo === 'imagem').sort((a, b) => (a.principal ? -1 : 1) - (b.principal ? -1 : 1)).map(arq => arq.url);
        return p;
      });
      return produtosFormatados;
    } catch (error) {
      console.error("Erro ao buscar produtos relacionados:", error);
      throw error;
    }
  },
}

module.exports = produtoService;