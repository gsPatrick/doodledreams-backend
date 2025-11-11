const { DataTypes } = require("sequelize")
const { sequelize } = require("../config/database")

const VariacaoProduto = sequelize.define(
  "VariacaoProduto",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    produtoId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "produtos",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    nome: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: "Nome da variação, ex: 'P', 'M', 'G'",
    },
    // --- MUDANÇA AQUI: REMOÇÃO DO PREÇO ---
    // preco: { ... } // Campo removido

    // --- MUDANÇA AQUI: ADIÇÃO DAS MEDIDAS ---
    medidas: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Campo de texto livre para descrever as medidas do tamanho.",
    },
    // --------------------------------------
    digital: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    estoque: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    ativo: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
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
    tableName: "variacoes_produto",
    timestamps: true,
    underscored: true,
  },
)

module.exports = VariacaoProduto