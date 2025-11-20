const { Pedido, Produto, Usuario, Pagamento, ArquivoProduto } = require("../models")
const { Op, Sequelize } = require("sequelize")
const sequelize = require("../config/database").sequelize

const dashboardService = {
  async obterMetricasGerais() {
    try {
      const hoje = new Date()
      const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      const inicioAno = new Date(hoje.getFullYear(), 0, 1)

      // Vendas do dia
      const vendasHoje = await Pedido.sum("total", {
        where: {
          status: "pago",
          createdAt: {
            [Op.gte]: new Date(hoje.setHours(0, 0, 0, 0)),
          },
        },
      })

      // Vendas do mês
      const vendasMes = await Pedido.sum("total", {
        where: {
          status: "pago",
          createdAt: {
            [Op.gte]: inicioMes,
          },
        },
      })

      // Vendas do ano
      const vendasAno = await Pedido.sum("total", {
        where: {
          status: "pago",
          createdAt: {
            [Op.gte]: inicioAno,
          },
        },
      })

      // Total de pedidos
      const totalPedidos = await Pedido.count()

      // Pedidos pendentes
      const pedidosPendentes = await Pedido.count({
        where: { status: "pendente" },
      })

      // Total de usuários
      const totalUsuarios = await Usuario.count({
        where: { ativo: true },
      })

      // Total de produtos
      const totalProdutos = await Produto.count({
        where: { ativo: true },
      })

      // Produtos com estoque baixo (menos de 10)
      // CORREÇÃO: Busca direta na tabela Produto, pois VariacaoProduto foi removido
      const countEstoqueBaixo = await Produto.count({
        where: {
            ativo: true,
            estoque: { [Op.lt]: 10 } // Menor que 10
        }
      });

      // Contar número de pedidos pagos hoje
      const inicioDia = new Date()
      inicioDia.setHours(0, 0, 0, 0)
      const vendasHojeCount = await Pedido.count({
        where: {
          status: "pago",
          createdAt: { [Op.gte]: inicioDia },
        },
      })
      
      return {
        vendasHoje: vendasHojeCount,
        faturamentoHoje: Number.parseFloat(vendasHoje || 0),
        clientesTotal: totalUsuarios,
        produtosTotal: totalProdutos,
        estoqueBaixo: countEstoqueBaixo
      }
    } catch (error) {
      console.error("Erro ao obter métricas gerais:", error);
      throw error
    }
  },

  async obterVendasPorPeriodo(periodo = "mes") {
    try {
      // Buscar todos os pedidos pagos dos últimos 30 dias
      const ultimosDias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const pedidos = await Pedido.findAll({
        attributes: ['id', 'total', 'createdAt'],
        where: {
          status: "pago",
          createdAt: {
            [Op.gte]: ultimosDias
          }
        },
        raw: true
      });

      // Processar os dados em memória 
      const vendasAgrupadas = {};

      pedidos.forEach(pedido => {
        let chave;
        const data = new Date(pedido.createdAt);

        switch (periodo) {
          case "dia":
            chave = data.toISOString().split('T')[0]; // YYYY-MM-DD
            break;
          case "mes":
            chave = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
            break;
          case "ano":
            chave = `${data.getFullYear()}`; // YYYY
            break;
          default:
            chave = data.toISOString().split('T')[0];
        }

        if (!vendasAgrupadas[chave]) {
          vendasAgrupadas[chave] = {
            periodo: chave,
            total: 0,
            quantidade: 0
          };
        }

        vendasAgrupadas[chave].total += Number(pedido.total);
        vendasAgrupadas[chave].quantidade += 1;
      });

      // Converter para array e ordenar
      return Object.values(vendasAgrupadas)
        .sort((a, b) => a.periodo.localeCompare(b.periodo));
    } catch (error) {
      throw error
    }
  },

  async obterProdutosMaisVendidos(limit = 10) {
    try {
      // Buscar produtos mais vendidos através dos pedidos
      const produtosVendidos = await Pedido.findAll({
        attributes: ['id', 'itens', 'status'],
        where: { status: "pago" },
        raw: true,
      })

      // Processar itens dos pedidos para contar vendas
      const contadorProdutos = {}

      for (const pedido of produtosVendidos) {
        if (pedido && pedido.itens) {
          for (const item of pedido.itens) {
            if (!contadorProdutos[item.produtoId]) {
              contadorProdutos[item.produtoId] = {
                produtoId: item.produtoId,
                nome: item.nome,
                quantidade: 0,
                total: 0,
              }
            }
            contadorProdutos[item.produtoId].quantidade += item.quantidade
            contadorProdutos[item.produtoId].total += item.preco * item.quantidade
          }
        }
      }

      // Converter para array e ordenar
      const produtosOrdenados = Object.values(contadorProdutos)
        .sort((a, b) => b.quantidade - a.quantidade)
        .slice(0, limit)

      // Buscar informações detalhadas dos produtos
      // CORREÇÃO: Removida a inclusão de VariacaoProduto
      const produtosDetalhados = await Promise.all(
        produtosOrdenados.map(async (item) => {
          const produto = await Produto.findByPk(item.produtoId, {
            include: [
              {
                model: ArquivoProduto,
                as: 'ArquivoProdutos',
                where: { tipo: 'imagem' },
                required: false
              }
            ]
          });
          
          return {
            id: item.produtoId,
            nome: item.nome,
            quantidade: item.quantidade,
            faturamento: item.total,
            produto: produto
          };
        })
      );

      return produtosDetalhados;
    } catch (error) {
      throw error
    }
  },

  async obterClientesTop(limit = 10) {
    try {
      // Buscar todos os pedidos pagos
      const pedidos = await Pedido.findAll({
        attributes: ['id', 'usuarioId', 'total'],
        where: { status: "pago" },
        include: [
          {
            model: Usuario,
            attributes: ['id', 'nome', 'email'],
          }
        ],
        raw: true,
        nest: true // Necessário para aninhar o objeto Usuario
      });

      // Agrupar vendas por cliente
      const clientesVendas = {};

      pedidos.forEach(pedido => {
        const usuarioId = pedido.usuarioId;

        if (!clientesVendas[usuarioId]) {
          clientesVendas[usuarioId] = {
            usuario: {
              id: pedido.Usuario.id,
              nome: pedido.Usuario.nome,
              email: pedido.Usuario.email
            },
            totalGasto: 0,
            totalPedidos: 0
          };
        }

        clientesVendas[usuarioId].totalGasto += Number(pedido.total);
        clientesVendas[usuarioId].totalPedidos += 1;
      });

      // Converter para array, ordenar e limitar
      const clientesList = Object.values(clientesVendas)
        .sort((a, b) => b.totalGasto - a.totalGasto)
        .slice(0, limit)
      return clientesList.map(c => ({
        id: c.usuario.id,
        nome: c.usuario.nome,
        email: c.usuario.email,
        pedidos: c.totalPedidos,
        valorTotal: c.totalGasto,
      }))
    } catch (error) {
      throw error
    }
  },
}

module.exports = dashboardService