// src/models/Produto.js

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
    // --- NOVOS CAMPOS DO PDF ---
    subtitulo: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Ex: Suplemento para manutenção das articulações...'
    },
    finalidade: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Descrição detalhada do propósito do produto.'
    },
    niveisDeGarantia: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Armazena um array de objetos: [{ componente, quantidade }]'
    },
    umidadeMaxima: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Ex: 18,0%'
    },
    composicaoBasica: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Lista de ingredientes da composição básica.'
    },
    modoDeUsar: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Instruções de dosagem e administração.'
    },
    informacoesAdicionais: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Objeto com advertencias (array), conservacao (string), apresentacao (objeto).'
    },
    informacoesFabricante: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Objeto com dados do fabricante, CNPJ, SIF, etc.'
    },
    // --- FIM DOS NOVOS CAMPOS ---
    
    // --- Campos existentes mantidos ---
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
    // Dimensões para cálculo de frete
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
      // Hook para gerar/atualizar o slug automaticamente a partir do nome
      beforeValidate: (produto) => {
        if (produto.nome) {
          produto.slug = slugify(produto.nome, { lower: true, strict: true, remove: /[*+~.()'"!:@]/g });
        }
      }
    }
  }
);

module.exports = Produto;