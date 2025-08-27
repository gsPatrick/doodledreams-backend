const mercadopago = require("../config/mercadoPago")
const { Pagamento, Pedido, Usuario, AssinaturaUsuario } = require("../models")
const pedidoService = require("./pedidoService")
const facebookCapiService = require("./facebookCapiService"); // <-- NOVO: Importe o novo serviço

// Helper para formatar datas em ISO com offset para MercadoPago
function formatDateToPreference(date) {
  const pad = (n) => String(n).padStart(2, '0')
  const padMs = (n) => String(n).padStart(3, '0')
  
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  const ms = padMs(date.getMilliseconds())
  
  const offset = -date.getTimezoneOffset()
  const offsetHours = Math.floor(Math.abs(offset) / 60)
  const offsetMinutes = Math.abs(offset) % 60
  const offsetSign = offset >= 0 ? '-' : '+'
  const offsetFormatted = `${offsetSign}${pad(offsetHours)}:${pad(offsetMinutes)}`
  
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}${offsetFormatted}`
}

function getMercadoPagoDateFormat(date) {
  return date.toISOString().replace('Z', '-03:00'); // Força o fuso de Brasília (GMT-3)
}

const pagamentoService = {
  async criarCheckoutPro(pedidoId, usuarioId) {
    try {
      const pedido = await Pedido.findOne({
        where: { id: pedidoId, usuarioId },
        include: [{ model: Usuario }],
      });

      if (!pedido) throw new Error("Pedido não encontrado");
      if (pedido.status !== "pendente") throw new Error("Pedido já foi processado");

      const items = pedido.itens.map((item) => ({
        id: item.variacaoId ? item.variacaoId.toString() : item.produtoId.toString(),
        title: item.nome,
        unit_price: Number(item.preco),
        quantity: item.quantidade,
        category_id: "virtual_goods", // Categoria genérica
      }));

      if (pedido.valorFrete && pedido.valorFrete > 0) {
        items.push({
          id: "frete",
          title: "Custo de Envio",
          unit_price: Number(pedido.valorFrete),
          quantity: 1,
          category_id: "shipping",
        });
      }

      // --- USANDO A NOVA FUNÇÃO DE DATA ---
      const now = new Date();
      const expirationDate = new Date(now.getTime() + (24 * 60 * 60 * 1000)); // Expira em 24 horas

      const preference = {
        items,
        payer: { name: pedido.Usuario.nome, email: pedido.Usuario.email },
        back_urls: {
          success: `${process.env.FRONTEND_URL}/pagamento/sucesso?pedido=${pedidoId}`,
          failure: `${process.env.FRONTEND_URL}/pagamento/erro?pedido=${pedidoId}`,
          pending: `${process.env.FRONTEND_URL}/pagamento/pendente?pedido=${pedidoId}`,
        },
        auto_return: "approved",
        external_reference: pedidoId.toString(),
        notification_url: `${process.env.BASE_URL}/api/pagamentos/webhook`,
        statement_descriptor: "ATELIERAISA"
      };
      //teste

      const response = await mercadopago.preferences.create(preference);

      await Pagamento.create({
        pedidoId,
        usuarioId,
        valor: pedido.total,
        metodo: "mercado_pago",
        status: "pendente",
        transacaoId: response.body.id,
        dadosTransacao: response.body,
      });

      return {
        checkoutUrl: response.body.init_point,
        preferenceId: response.body.id,
      };
    } catch (error) {
      console.error("Erro ao criar checkout:", error);
      throw error;
    }
  },

  async processarWebhook(dados) {
    try {
      const { type, data, action } = dados;

      if (type === "payment") {
        const paymentId = data.id

        const payment = await mercadopago.payment.findById(paymentId)
        const paymentData = payment.body

        const pedidoId = paymentData.external_reference

        if (!pedidoId) {
          console.log("Webhook sem external_reference")
          return
        }

        const pagamento = await Pagamento.findOne({
          where: { pedidoId },
          include: [{ 
            model: Pedido, 
            include: [{ model: Usuario }] // <-- Aninhar a inclusão do Usuário
          }],
        })

        if (!pagamento) {
          console.log(`Pagamento não encontrado para pedido ${pedidoId}`)
          return
        }

        let novoStatus = "pendente"

        switch (paymentData.status) {
          case "approved":
            novoStatus = "aprovado"
            break
          case "rejected":
            novoStatus = "rejeitado"
            break
          case "cancelled":
            novoStatus = "cancelado"
            break
          case "pending":
          case "in_process":
            novoStatus = "pendente"
            break
        }

        await pagamento.update({
          status: novoStatus,
          dadosTransacao: paymentData,
        })

        if (novoStatus === "aprovado") {
          await pedidoService.atualizarStatusPedido(pedidoId, "pago");

          // !! ESTE É O LOCAL CORRETO PARA ENVIAR O EVENTO !!
          if (pagamento.Pedido && pagamento.Pedido.Usuario) {
             facebookCapiService.sendPurchaseEvent(pagamento.Pedido, pagamento.Pedido.Usuario);
          } else {
             console.error(`Facebook CAPI: Não foi possível enviar evento para o pedido #${pedidoId} pois os dados do pedido ou usuário não foram carregados.`);
          }
          
        } else if (novoStatus === "rejeitado" || novoStatus === "cancelado") {
          await pedidoService.cancelarPedido(pedidoId)
        }

        console.log(`Pagamento ${paymentId} atualizado para ${novoStatus}`)
      } else if (type === "preapproval") {
        // ... (seu código de assinatura permanece o mesmo)
      }
    } catch (error) {
      console.error("Erro ao processar webhook:", error)
      throw error
    }
  },

  async verificarStatusPagamento(pedidoId) {
    try {
      const pagamento = await Pagamento.findOne({
        where: { pedidoId },
        include: [{ model: Pedido }],
      })

      if (!pagamento) {
        throw new Error("Pagamento não encontrado")
      }

      if (pagamento.transacaoId) {
        try {
          const payment = await mercadopago.payment.findById(pagamento.transacaoId)
          const paymentData = payment.body

          let statusAtualizado = pagamento.status

          switch (paymentData.status) {
            case "approved":
              statusAtualizado = "aprovado"
              break
            case "rejected":
              statusAtualizado = "rejeitado"
              break
            case "cancelled":
              statusAtualizado = "cancelado"
              break
          }

          if (statusAtualizado !== pagamento.status) {
            await pagamento.update({ status: statusAtualizado })
          }
        } catch (mpError) {
          console.error("Erro ao verificar status no MP:", mpError)
        }
      }

      return pagamento
    } catch (error) {
      throw error
    }
  },

  async listarPagamentos(filtros = {}) {
    try {
      const { usuarioId, status, page = 1, limit = 10 } = filtros
      const where = {}

      if (usuarioId) where.usuarioId = usuarioId
      if (status) where.status = status

      const offset = (page - 1) * limit

      const { count, rows } = await Pagamento.findAndCountAll({
        where,
        include: [{ model: Pedido }, { model: Usuario, attributes: ["nome", "email"] }],
        limit: Number.parseInt(limit),
        offset,
        order: [["createdAt", "DESC"]],
      })

      return {
        pagamentos: rows,
        total: count,
        totalPages: Math.ceil(count / limit),
        currentPage: Number.parseInt(page),
      }
    } catch (error) {
      throw error
    }
  },
}

module.exports = pagamentoService