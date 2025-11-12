const { DataTypes } = require("sequelize")
const { sequelize } = require("../config/database")

const Pedido = sequelize.define(
  "Pedido",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    usuarioId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "usuarios",
        key: "id",
      },
    },
    itens: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pendente", "pago", "processando", "enviado", "entregue", "cancelado", "concluido"),
      defaultValue: "pendente",
    },
    total: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    comprovantePagamento: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    desconto: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    enderecoEntrega: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    valorFrete: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    obsInterna: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: sequelize.literal('CURRENT_TIMESTAMP'),
      allowNull: false,
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: sequelize.literal('CURRENT_TIMESTAMP'),
      allowNull: false,
    },
  },
  {
    tableName: "pedidos",
    timestamps: true,
    underscored: true,
  },
)

module.exports = Pedido
