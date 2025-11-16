// /models/Pagamento.js

const { DataTypes } = require("sequelize")
const { sequelize } = require("../config/database")

const Pagamento = sequelize.define(
  "Pagamento",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    pedidoId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "pedidos",
        key: "id",
      },
    },
    usuarioId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "usuarios",
        key: "id",
      },
    },
    valor: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    metodo: {
      // --- MUDANÇA PRINCIPAL AQUI ---
      // Adicionamos os novos métodos para o Checkout Transparente
      type: DataTypes.ENUM(
        "cartao", 
        "pix", 
        "boleto", 
        "mercado_pago", 
        "mercado_pago_api_card", 
        "mercado_pago_api_pix"
      ),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pendente", "aprovado", "rejeitado", "cancelado", "in_process"),
      defaultValue: "pendente",
    },
    transacaoId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    dadosTransacao: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  },
  {
    tableName: "pagamentos",
    timestamps: true,
  },
)

module.exports = Pagamento