// src/controllers/categoriaController.js (VERSÃO COMPLETA E CORRIGIDA)

const { Categoria } = require("../models");
const uploadService = require("../services/uploadService"); // Precisamos do serviço de upload

const categoriaController = {
    async listarCategorias(req, res, next) {
        try {
            const categorias = await Categoria.findAll({
                order: [['nome', 'ASC']]
            });
            res.json(categorias);
        } catch (error) {
            next(error);
        }
    },

    // --- FUNÇÃO DE CRIAÇÃO CORRIGIDA ---
    async criarCategoria(req, res, next) {
        try {
            const { nome, descricao, ativo = true } = req.body;

            if (!nome) {
                return res.status(400).json({ erro: "Nome da categoria é obrigatório" });
            }

            const categoriaExistente = await Categoria.findOne({ where: { nome } });
            if (categoriaExistente) {
                return res.status(400).json({ erro: "Já existe uma categoria com este nome" });
            }

            // 1. Cria a categoria primeiro com os dados de texto
            const categoria = await Categoria.create({
                nome,
                descricao,
                ativo
            });

            // 2. Se um arquivo de imagem foi enviado na mesma requisição...
            if (req.file) {
                // ...processa e salva a imagem usando o uploadService...
                const imagemInfo = await uploadService.processarESalvarImagem(req.file);
                // ...e atualiza a categoria recém-criada com a URL da imagem.
                categoria.imagemUrl = imagemInfo.url;
                await categoria.save();
            }

            res.status(201).json(categoria);
        } catch (error) {
            next(error);
        }
    },

    async buscarCategoria(req, res, next) {
        try {
            const { id } = req.params;
            const categoria = await Categoria.findByPk(id);
            if (!categoria) {
                return res.status(404).json({ erro: "Categoria não encontrada" });
            }
            res.json(categoria);
        } catch (error) {
            next(error);
        }
    },

    // --- FUNÇÃO DE ATUALIZAÇÃO CORRIGIDA ---
    async atualizarCategoria(req, res, next) {
        try {
            const { id } = req.params;
            const { nome, descricao, ativo } = req.body;

            const categoria = await Categoria.findByPk(id);
            if (!categoria) {
                return res.status(404).json({ erro: "Categoria não encontrada" });
            }

            if (nome && nome !== categoria.nome) {
                const categoriaExistente = await Categoria.findOne({ where: { nome } });
                if (categoriaExistente) {
                    return res.status(400).json({ erro: "Já existe uma categoria com este nome" });
                }
            }

            // 1. Atualiza os dados de texto
            if (nome) categoria.nome = nome;
            if (descricao !== undefined) categoria.descricao = descricao;
            if (ativo !== undefined) categoria.ativo = ativo;

            // 2. Se uma nova imagem foi enviada, processa e atualiza a URL
            if (req.file) {
                // Opcional: deletar a imagem antiga do File Server se existir
                // if (categoria.imagemUrl) {
                //   await uploadService.removerArquivo(categoria.imagemUrl);
                // }
                const imagemInfo = await uploadService.processarESalvarImagem(req.file);
                categoria.imagemUrl = imagemInfo.url;
            }

            // 3. Salva todas as alterações (texto e/ou imagem)
            await categoria.save();

            res.json(categoria);
        } catch (error) {
            next(error);
        }
    },

    async removerCategoria(req, res, next) {
        try {
            const { id } = req.params;
            const categoria = await Categoria.findByPk(id);
            if (!categoria) {
                return res.status(404).json({ erro: "Categoria não encontrada" });
            }
            // Opcional: remover a imagem associada do File Server
            // if (categoria.imagemUrl) {
            //   await uploadService.removerArquivo(categoria.imagemUrl);
            // }
            await categoria.destroy();
            res.json({ mensagem: "Categoria removida com sucesso" });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = categoriaController;