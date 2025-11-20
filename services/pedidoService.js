// src/services/pedidoService.js

const { Pedido, Usuario, Produto, Pagamento, ArquivoProduto, Frete, Cupom } = require("../models");
const { enviarEmail, templateConfirmacaoPedido } = require("../utils/email");
const cupomService = require("./cupomService");
const notificacaoService = require("./notificacaoService");
const freteService = require("./freteService");
const configuracaoLojaService = require("./configuracaoLojaService");
const { Op } = require('sequelize');
require("dotenv").config();

const pedidoService = {
  
  async criarPedido(usuarioId, itensPedido, enderecoEntrega, freteId, cupomCodigo = null) {
    try {
      let total = 0;
      let desconto = 0;
      let valorFrete = 0;
      let dadosFrete = null;
      let cupomAplicadoId = null; 
      const itensProcessados = [];
      let quantidadeTotalItens = 0;

      // 1. Identificar produtos e verificar se o pedido é 100% digital
      const produtoIds = itensPedido.map(item => item.produtoId);
      const produtosParaVerificacao = await Produto.findAll({ where: { id: { [Op.in]: produtoIds } } });
      
      // Mapeia os produtos encontrados para fácil acesso
      const produtoMap = new Map(produtosParaVerificacao.map(p => [p.id, p]));
      
      const todosDigitais = itensPedido.every(item => {
        const produto = produtoMap.get(item.produtoId);
        // Assume-se que o produto tenha um flag 'digital' ou verificamos se tem arquivo associado
        // Aqui estamos usando a flag 'digital' que deve existir no modelo ou ser inferida
        return produto && produto.digital; 
      });

      // Se tiver itens físicos, endereço é obrigatório
      if (!todosDigitais && !enderecoEntrega) {
        throw new Error("Endereço de entrega é obrigatório para produtos físicos.");
      }

      // 2. Processar itens, calcular subtotal e validar estoque
      for (const item of itensPedido) {
        const produto = produtoMap.get(item.produtoId);
        
        if (!produto || !produto.ativo) {
          throw new Error(`Produto com ID ${item.produtoId} não encontrado ou inativo.`);
        }
        
        const precoBase = produto.preco;
        
        // Validação de estoque para produtos físicos
        if (!produto.digital && produto.estoque < item.quantidade) {
          throw new Error(`Estoque insuficiente para o produto "${produto.nome}".`);
        }
        
        total += parseFloat(precoBase) * item.quantidade;
        quantidadeTotalItens += item.quantidade;
        
        itensProcessados.push({
          produtoId: item.produtoId,
          nome: produto.nome,
          subtitulo: produto.subtitulo,
          preco: parseFloat(precoBase),
          quantidade: item.quantidade,
          subtotal: parseFloat(precoBase) * item.quantidade,
          digital: produto.digital,
          dimensoes: {
            peso: produto.peso,
            largura: produto.largura,
            altura: produto.altura,
            comprimento: produto.comprimento,
          }
        });
      }

      // 3. Validar e aplicar cupom de desconto
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

      // 4. Calcular Frete (apenas se houver itens físicos)
      if (!todosDigitais) {
        const enderecoOrigem = await configuracaoLojaService.obterEnderecoOrigem();
        
        // Filtra apenas itens físicos para o cálculo
        const itensFisicos = itensPedido.filter(item => !produtoMap.get(item.produtoId)?.digital);
        
        const opcoesFrete = await freteService.calcularFrete(enderecoOrigem, enderecoEntrega, itensFisicos);
        
        const freteSelecionado = opcoesFrete.find(opt => opt.id === freteId);
        
        if (!freteSelecionado) {
           // Fallback: Se o ID do frete não bater com o calculado na hora (ex: expiração),
           // tenta recalcular ou lançar erro. Aqui lançamos erro.
           throw new Error("Método de frete selecionado é inválido ou não está mais disponível.");
        }
        
        valorFrete = parseFloat(freteSelecionado.price);
        
        dadosFrete = { 
          servico: freteSelecionado.name, 
          valor: valorFrete, 
          prazoEntrega: freteSelecionado.delivery_time, 
          statusEntrega: "pendente" 
        };
      } else {
        valorFrete = 0;
      }
      
      const totalFinal = total + valorFrete;

      // 5. Criar o Pedido
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

      // 6. Incrementar uso do Cupom
      if (cupomAplicadoId) {
        await cupomService.incrementarUso(cupomAplicadoId);
      }
      
      // 7. Criar registro de Frete e Baixar Estoque
      if (dadosFrete && !todosDigitais) {
        await Frete.create({ pedidoId: pedido.id, ...dadosFrete });
      }
      
      // Atualiza estoque
      for (const item of itensProcessados) {
        if (!item.digital) {
            const produto = await Produto.findByPk(item.produtoId);
            if (produto) { 
              produto.estoque -= item.quantidade; 
              await produto.save(); 
            }
        }
      }

      return pedido;
    } catch (error) {
      console.error("Erro detalhado ao criar pedido no serviço:", error);
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

      // Se o pedido for cancelado, devolver o uso do cupom
      if (pedido.status !== "cancelado" && status === "cancelado" && pedido.cupomAplicadoId) {
          await cupomService.decrementarUso(pedido.cupomAplicadoId);
      }
      
      // Se o pedido estava cancelado e voltou para outro status (raro, mas possível via admin), 
      // deveríamos idealmente re-incrementar o cupom e re-baixar estoque, 
      // mas por simplicidade focamos no cancelamento.

      pedido.status = status
      await pedido.save()

      // Enviar notificações
      try {
        await notificacaoService.enviarAtualizacaoStatus(pedidoId, status)
      } catch (emailError) {
        console.error("Erro ao enviar notificação de status:", emailError)
      }

      if (status === "pago") {
        try {
            await enviarEmail(pedido.Usuario.email, "Pedido Confirmado", templateConfirmacaoPedido(pedido))
        } catch (emailError) {
            console.error("Erro ao enviar email de confirmação de pedido:", emailError);
        }
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
      if (status) where.status = status

      const offset = (page - 1) * limit

      const { count, rows } = await Pedido.findAndCountAll({
        where,
        include: [{ model: Usuario, attributes: ["nome", "email"] }],
        limit: Number.parseInt(limit),
        offset,
        order: [["createdAt", "DESC"]],
      })

      // Enriquece os itens do pedido com imagens e detalhes atuais do produto
      const pedidosComDetalhes = await Promise.all(rows.map(async (pedido) => {
        const itensComDetalhes = await Promise.all(pedido.itens.map(async (item) => {
          const produto = await Produto.findByPk(item.produtoId, {
            include: [{ model: ArquivoProduto, as: 'ArquivoProdutos', where: { tipo: 'imagem', principal: true }, required: false }]
          });
          
          const baseUrl = process.env.BASE_URL || 'http://localhost:3045';
          let imagemUrl = '/placeholder-produto.png';

          if (produto?.ArquivoProdutos?.[0]?.url) {
             // Garante URL absoluta se não estiver salva assim
             imagemUrl = produto.ArquivoProdutos[0].url.startsWith('http') 
                ? produto.ArquivoProdutos[0].url 
                : new URL(produto.ArquivoProdutos[0].url.replace(/\\/g, '/'), baseUrl).href;
          }

          return {
            ...item,
            produto: {
              id: produto ? produto.id : null,
              nome: produto ? produto.nome : 'Produto não encontrado (Removido)',
              imagemUrl: imagemUrl
            }
          };
        }));
        
        const pedidoJSON = pedido.toJSON();
        pedidoJSON.itens = itensComDetalhes;
        return pedidoJSON;
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
      // Validação robusta para evitar erro de "undefined" no Sequelize
      if (!pedidoId || pedidoId === 'undefined' || pedidoId === 'null') {
         throw new Error("ID de pedido inválido fornecido para busca.");
      }

      const pedido = await Pedido.findByPk(pedidoId, {
        include: [
          { model: Usuario, attributes: ["nome", "email"] }, 
          { model: Pagamento, required: false }
        ],
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
      if (pedido.status === "cancelado") throw new Error("Pedido já está cancelado")

      // Devolver uso do cupom
      if (pedido.cupomAplicadoId) {
        await cupomService.decrementarUso(pedido.cupomAplicadoId);
      }

      // Devolver estoque dos itens físicos
      for (const item of pedido.itens) {
        if (!item.digital) {
            const produto = await Produto.findByPk(item.produtoId)
            if (produto) { 
              produto.estoque += item.quantidade; 
              await produto.save();
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
          status: { [Op.in]: ["pago", "processando", "enviado", "entregue", "concluido"] },
        },
      })

      if (!pedidos || pedidos.length === 0) return false

      const comprouProduto = pedidos.some((pedido) =>
        pedido.itens.some((item) => item.produtoId == produtoId) // == para evitar erro de tipo (string vs int)
      )
      return comprouProduto
    } catch (error) {
      throw error
    }
  },

  async obterDownloadsPorUsuario(usuarioId) {
    try {
      // Busca pedidos pagos do usuário
      const pedidos = await Pedido.findAll({
        where: {
          usuarioId,
          status: { [Op.in]: ['pago', 'processando', 'enviado', 'entregue', 'concluido'] },
        },
        attributes: ['itens'],
      });

      const uniqueDigitalProductIds = new Set();

      // Filtra os itens que são digitais dentro dos pedidos
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

      const baseUrl = process.env.BASE_URL || 'http://localhost:3045';

      // Busca os detalhes dos produtos digitais e seus arquivos
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
        attributes: ['id', 'nome', 'slug', 'descricao'], 
      });

      // Formata a resposta
      const downloadsFormatados = produtosDigitaisComArquivos.map(produto => {
        const produtoJSON = produto.toJSON();
        const arquivosDoProduto = produtoJSON.ArquivoProdutos || [];
        
        const imagemPrincipal = arquivosDoProduto.find(arq => arq.tipo === 'imagem' && arq.principal);
        const imagemUrl = imagemPrincipal?.url 
            ? (imagemPrincipal.url.startsWith('http') ? imagemPrincipal.url : new URL(imagemPrincipal.url.replace(/\\/g, '/'), baseUrl).href)
            : 'https://placehold.co/80x80.png';

        const arquivosDigitaisFormatados = arquivosDoProduto
          .filter(arq => arq.tipo === 'arquivo')
          .map(arq => ({
            id: arq.id,
            nome: arq.nome,
            url: arq.url, // Caminho relativo ou absoluto salvo
            fullUrl: arq.url.startsWith('http') ? arq.url : new URL(arq.url.replace(/\\/g, '/'), baseUrl).href,
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

      // Retorna apenas produtos que tenham arquivos disponíveis
      const downloadsComArquivosReais = downloadsFormatados.filter(item => item.arquivos.length > 0);
      return downloadsComArquivosReais;

    } catch (error) {
      console.error("Erro ao obter downloads do usuário:", error);
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
        ],
      });

      const baseUrl = process.env.BASE_URL || 'http://localhost:3045';
      
      const produtosFormatados = relacionados.map(produto => {
        const p = produto.toJSON();
        p.imagens = (p.ArquivoProdutos || [])
          .filter(arq => arq.tipo === 'imagem')
          .sort((a, b) => (a.principal ? -1 : 1) - (b.principal ? -1 : 1))
          .map(arq => {
              if (arq.url.startsWith('http')) return arq.url;
              return new URL(arq.url.replace(/\\/g, '/'), baseUrl).href;
          });
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