const { Pedido, Usuario, Produto, Pagamento, ArquivoProduto, Frete, VariacaoProduto } = require("../models")
const { enviarEmail, templateConfirmacaoPedido } = require("../utils/email")
const cupomService = require("./cupomService")
const notificacaoService = require("./notificacaoService")
const pagamentoService = require("./pagamentoService")
const { Op } = require('sequelize');

const pedidoService = {
  async criarPedido(usuarioId, itensPedido, enderecoEntrega, freteId, cupomCodigo = null) {
    try {
      let total = 0;
      let desconto = 0;
      let valorFrete = 0;
      let dadosFrete = null;
      let cupomAplicadoId = null;

      const verificacoesDigitais = await Promise.all(itensPedido.map(async (item) => {
        if (item.variacaoId) {
          const variacao = await VariacaoProduto.findOne({ where: { id: item.variacaoId, produtoId: item.produtoId }});
          if (!variacao || !variacao.ativo) return false;
          return variacao.digital;
        }
        return false;
      }));
      const todosDigitais = verificacoesDigitais.every(isDigital => isDigital);
      if (!todosDigitais && !enderecoEntrega) {
        throw new Error("Endereço de entrega é obrigatório para produtos físicos.");
      }

      const itensProcessados = [];
      let quantidadeTotalItens = 0;
      for (const item of itensPedido) {
        const produto = await Produto.findByPk(item.produtoId);
        if (!produto || !produto.ativo) throw new Error(`Produto ${item.produtoId} não encontrado ou inativo.`);
        
        // --- MUDANÇA CRÍTICA AQUI ---
        // O preço base agora vem DIRETAMENTE do produto principal.
        const precoBase = produto.preco;
        let variacao = null;
        let eDigital = false;

        if (item.variacaoId) {
          variacao = await VariacaoProduto.findOne({ where: { id: item.variacaoId, produtoId: item.produtoId } });
          if (!variacao || !variacao.ativo) throw new Error(`Tamanho ${item.variacaoId} para ${produto.nome} não encontrado ou inativo.`);
          eDigital = variacao.digital;
          if (!eDigital && variacao.estoque < item.quantidade) throw new Error(`Estoque insuficiente para o tamanho "${variacao.nome}".`);
        } else {
            // Se o item não tem um ID de variação, é um erro, pois o tamanho é obrigatório.
            throw new Error(`É necessário selecionar um tamanho para o produto "${produto.nome}".`);
        }

        total += parseFloat(precoBase) * item.quantidade;
        quantidadeTotalItens += item.quantidade;
        itensProcessados.push({
          produtoId: item.produtoId,
          variacaoId: item.variacaoId,
          nome: variacao ? `${produto.nome} - ${variacao.nome}` : produto.nome,
          preco: parseFloat(precoBase),
          quantidade: item.quantidade,
          subtotal: parseFloat(precoBase) * item.quantidade,
          digital: eDigital,
        });
      }

      if (cupomCodigo) {
        const cupom = await cupomService.validarCupom(cupomCodigo, total, quantidadeTotalItens, usuarioId);

        if (cupom.tipo === "percentual") {
          desconto = (total * cupom.valor) / 100;
        } else {
          desconto = cupom.valor;
        }

        total = Math.max(0, total - desconto);
        cupomAplicadoId = cupom.id;
      }

      if (!todosDigitais) {
        const freteOpts = await require('./freteService').calcularFrete(
          await require('./configuracaoLojaService').obterEnderecoOrigem(),
          enderecoEntrega, itensPedido.filter((_, index) => !verificacoesDigitais[index])
        );
        const freteSelecionado = freteOpts.find(opt => opt.id === freteId);
        if (!freteSelecionado) throw new Error("Método de frete selecionado inválido.");
        valorFrete = parseFloat(freteSelecionado.price);
        dadosFrete = { servico: freteSelecionado.name, valor: valorFrete, prazoEntrega: freteSelecionado.delivery_time, statusEntrega: "pendente" };
      } else {
          valorFrete = 0;
      }
      
      const totalFinal = total + valorFrete;

      const pedido = await Pedido.create({
        usuarioId,
        itens: itensProcessados,
        total: totalFinal,
        valorFrete,
        desconto,
        cupomAplicado: cupomCodigo,
        cupomAplicadoId,
        enderecoEntrega: todosDigitais ? null : enderecoEntrega,
        status: "pendente",
      });

      if (cupomAplicadoId) {
        await cupomService.incrementarUso(cupomAplicadoId);
      }
      
      if (dadosFrete && !todosDigitais) await Frete.create({ pedidoId: pedido.id, ...dadosFrete });

      for (const item of itensProcessados) {
        if (!item.digital) {
            if (item.variacaoId) {
                const variacao = await VariacaoProduto.findByPk(item.variacaoId);
                if (variacao) {
                  variacao.estoque -= item.quantidade;
                  await variacao.save();
                }
            }
        }
      }

      return pedido;
    } catch (error) {
      console.error("Erro ao criar pedido:", error);
      throw error;
    }
  },

  async atualizarStatusPedido(pedidoId, status) {
    try {
      const pedido = await Pedido.findByPk(pedidoId, {
        include: [{ model: Usuario }],
      })

      if (!pedido) {
        throw new Error("Pedido não encontrado")
      }

      if (pedido.status === "pendente" && status === "cancelado" && pedido.cupomAplicadoId) {
         await cupomService.decrementarUso(pedido.cupomAplicadoId);
      }
      else if (pedido.status !== "cancelado" && status === "cancelado" && pedido.cupomAplicadoId) {
          await cupomService.decrementarUso(pedido.cupomAplicadoId);
      }

      pedido.status = status
      await pedido.save()

      try {
        await notificacaoService.enviarAtualizacaoStatus(pedidoId, status)
      } catch (emailError) {
        console.error("Erro ao enviar notificação:", emailError)
      }

      if (status === "pago") {
        await enviarEmail(pedido.Usuario.email, "Pedido Confirmado", templateConfirmacaoPedido(pedido))
      }

      return pedido
    } catch (error) {
      throw error
    }
  },

  async listarPedidos(usuarioId, filtros = {}) {
    try {
      const { status, page = 1, limit = 10 } = filtros
      const where = {}
      if (usuarioId != null) where.usuarioId = usuarioId

      if (status) {
        where.status = status
      }

      const offset = (page - 1) * limit

      const { count, rows } = await Pedido.findAndCountAll({
        where,
        include: [{ model: Usuario, attributes: ["nome", "email"] }],
        limit: Number.parseInt(limit),
        offset,
        order: [["createdAt", "DESC"]],
      })

      const pedidosComDetalhes = await Promise.all(rows.map(async (pedido) => {
        const itensComDetalhes = await Promise.all(pedido.itens.map(async (item) => {
          const produto = await Produto.findByPk(item.produtoId, {
            include: [{ model: ArquivoProduto, as: 'ArquivoProdutos' }]
          });
          
          let imagemUrl = null;
          if (produto && produto.ArquivoProdutos && produto.ArquivoProdutos.length > 0) {
            imagemUrl = produto.ArquivoProdutos[0].url;
          }

          return {
            ...item,
            produto: {
              id: produto ? produto.id : null,
              nome: produto ? produto.nome : 'Produto não encontrado',
              imagemUrl: imagemUrl
            }
          };
        }));
        
        return { ...pedido.toJSON(), itens: itensComDetalhes };
      }));

      return {
        pedidos: pedidosComDetalhes,
        total: count,
        totalPages: Math.ceil(count / limit),
        currentPage: Number.parseInt(page),
      }
    } catch (error) {
      throw error;
    }
  },
  
  async buscarPedidoPorId(pedidoId) {
    try {
      const pedido = await Pedido.findByPk(pedidoId, {
        include: [{ model: Usuario, attributes: ["nome", "email"] }, { model: Pagamento }],
      })

      if (!pedido) {
        throw new Error("Pedido não encontrado")
      }

      return pedido
    } catch (error) {
      throw error
    }
  },

  async cancelarPedido(pedidoId) {
    try {
      const pedido = await Pedido.findByPk(pedidoId)
      if (!pedido) throw new Error("Pedido não encontrado")
      if (pedido.status === "entregue") throw new Error("Não é possível cancelar pedido já entregue")

      if (pedido.cupomAplicadoId && pedido.status !== "cancelado") {
        await cupomService.decrementarUso(pedido.cupomAplicadoId);
      }

      for (const item of pedido.itens) {
        if (!item.digital) {
          if (item.variacaoId) {
            const variacao = await VariacaoProduto.findByPk(item.variacaoId)
            if (variacao) { variacao.estoque += item.quantidade; await variacao.save() }
          }
        }
      }

      pedido.status = "cancelado"
      await pedido.save()
      return pedido
    } catch (error) {
      throw error
    }
  },

  async verificarSeUsuarioComprouProduto(usuarioId, produtoId) {
    try {
      const pedidos = await Pedido.findAll({
        where: {
          usuarioId,
          status: {
            [Op.in]: ["pago", "processando", "enviado", "entregue"],
          },
        },
      })

      if (!pedidos || pedidos.length === 0) return false

      const comprouProduto = pedidos.some((pedido) =>
        pedido.itens.some((item) => item.produtoId === produtoId)
      )
      return comprouProduto
    } catch (error) {
      throw error
    }
  },

  async listarProdutosPagosPorUsuario(usuarioId) {
    try {
      const pedidos = await Pedido.findAll({
        where: {
          usuarioId,
          status: {
            [Op.in]: ["pago", "processando", "enviado", "entregue"],
          },
        },
      })

      const produtosPagos = []
      for (const pedido of pedidos) {
        for (const item of pedido.itens) {
          const produto = await Produto.findByPk(item.produtoId, {
            include: [{ model: ArquivoProduto }],
          })
          if (produto) {
            produtosPagos.push({
              produtoId: produto.id,
              nome: produto.nome,
              arquivos: produto.ArquivoProdutos,
            })
          }
        }
      }

      return produtosPagos
    } catch (error) {
      throw error
    }
  },

  async obterDownloadsPorUsuario(usuarioId) {
    try {
      const pedidos = await Pedido.findAll({
        where: {
          usuarioId,
          status: ['pago', 'processando', 'enviado', 'entregue', 'concluido'],
        },
        attributes: ['itens'],
      });

      const uniqueDigitalProductIds = new Set();

      for (const pedido of pedidos) {
        if (pedido.itens && Array.isArray(pedido.itens)) {
          for (const item of pedido.itens) {
            if (item.digital) {
                 uniqueDigitalProductIds.add(item.produtoId);
            }
          }
        }
      }

      if (uniqueDigitalProductIds.size === 0) {
          return [];
      }

      const baseUrl = process.env.BASE_URL || 'http://localhost:3035';

      const produtosDigitaisComArquivos = await Produto.findAll({
        where: {
          id: { [Op.in]: Array.from(uniqueDigitalProductIds) },
          ativo: true, 
        },
        include: [{
          model: ArquivoProduto,
          as: 'ArquivoProdutos',
          where: { 
              [Op.or]: [
                  { tipo: 'arquivo' }, 
                  { tipo: 'imagem', principal: true }
              ]
          }, 
          required: false
        }],
        attributes: [ 'id', 'nome', 'slug', 'descricao' ], 
      });

      const downloadsFormatados = produtosDigitaisComArquivos.map(produto => {
        const produtoJSON = produto.toJSON();
        const arquivosDoProduto = produtoJSON.ArquivoProdutos || [];

        const imagemPrincipal = arquivosDoProduto.find(arq => arq.tipo === 'imagem' && arq.principal);
        const imagemUrl = imagemPrincipal?.url ? new URL(imagemPrincipal.url.replace(/\\/g, '/'), baseUrl).href : 'https://placehold.co/80x80.png';

        const arquivosDigitaisFormatados = arquivosDoProduto
          .filter(arq => arq.tipo === 'arquivo')
          .map(arq => ({
            id: arq.id,
            nome: arq.nome,
            url: arq.url,
            fullUrl: new URL(arq.url.replace(/\\/g, '/'), baseUrl).href,
            mimeType: arq.mimeType,
            tamanho: arq.tamanho,
          }));

        return {
          produtoId: produtoJSON.id,
          nome: produtoJSON.nome, 
          slug: produtoJSON.slug, 
          descricao: produtoJSON.descricao,
          imagemUrl: imagemUrl,
          arquivos: arquivosDigitaisFormatados,
        };
      });

       const downloadsComArquivosReais = downloadsFormatados.filter(item => item.arquivos.length > 0);

      return downloadsComArquivosReais;

    } catch (error) {
      console.error("Erro ao obter downloads do usuário:", error);
       if (error.original?.sqlMessage) {
           console.error("Detalhes do erro SQL:", error.original.sqlMessage, error.sql);
       }
       if (error.original?.code === 'ER_BAD_FIELD_ERROR') {
            throw new Error("Erro na estrutura do banco de dados. A coluna 'slug' pode estar faltando na tabela 'produtos'.");
       }
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

      const baseUrl = process.env.BASE_URL || 'http://localhost:3035';
      const produtosFormatados = relacionados.map(produto => {
        const p = produto.toJSON();
        p.imagens = (p.ArquivoProdutos || [])
          .filter(arq => arq.tipo === 'imagem')
          .sort((a, b) => (a.principal ? -1 : 1) - (b.principal ? -1 : 1))
          .map(arq => new URL(arq.url.replace(/\\/g, '/'), baseUrl).href);
         delete p.ArquivoProdutos; 
        return p;
      });

      return produtosFormatados;

    } catch (error) {
      console.error("Erro ao buscar produtos relacionados:", error);
      throw error;
    }
  },
}

module.exports = pedidoService;