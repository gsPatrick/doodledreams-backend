// /models/Produto.js

const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");
const slugify = require('slugify');

const Produto = sequelize.define(
  "Produto",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    nome: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    slug: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    // --- CAMPOS DE PREÇO E ESTOQUE MOVIDOS PARA CÁ ---
    preco: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00,
    },
    estoque: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    // --- FIM DOS NOVOS CAMPOS ---
    subtitulo: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    finalidade: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    niveisDeGarantia: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    umidadeMaxima: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    composicaoBasica: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    modoDeUsar: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    informacoesAdicionais: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    informacoesFabricante: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    categoriaId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'categorias',
        key: 'id'
      }
    },
    ativo: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    peso: {
      type: DataTypes.DECIMAL(10, 3),
      allowNull: true,
      defaultValue: 0.300, 
    },
    largura: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 10.00,
    },
    altura: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 10.00,
    },
    comprimento: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 10.00,
    },
  },
  {
    tableName: "produtos",
    timestamps: true,
    hooks: {
      beforeValidate: (produto) => {
        if (produto.nome) {
          produto.slug = slugify(produto.nome, { lower: true, strict: true, remove: /[*+~.()'"!:@]/g });
        }
      }
    }
  }
);

module.exports = Produto;