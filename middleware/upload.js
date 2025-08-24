// middleware/upload.js

const multer = require("multer");

/**
 * Configuração de Armazenamento: Armazenamento em Memória
 * 
 * Em vez de salvar o arquivo em um diretório temporário no disco,
 * `multer.memoryStorage()` mantém o arquivo como um Buffer na memória.
 * O objeto do arquivo ficará disponível em `req.file.buffer`.
 * Isso é ideal para processamento de imagens com bibliotecas como o Sharp,
 * pois evita operações de leitura/escrita desnecessárias no disco.
 */
const storage = multer.memoryStorage();


/**
 * Filtro de Arquivos
 * 
 * Esta função é executada para cada arquivo no upload.
 * Ela verifica se o 'mimetype' (tipo do arquivo) está em nossa lista de permissões.
 * Isso é uma medida de segurança para garantir que apenas os tipos de arquivo
 * esperados (imagens, vídeos, pdfs, etc.) sejam processados pelo servidor.
 */
const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "application/pdf",
        "application/zip",
        "application/x-zip-compressed",
        "video/mp4",
        "video/webm",
        "video/ogg",
        "video/quicktime",
        "video/x-msvideo",
        "video/x-matroska"
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
        // Se o tipo de arquivo é permitido, passamos 'true' para o callback.
        cb(null, true);
    } else {
        // Se não for permitido, passamos um erro. O Multer irá rejeitar o arquivo.
        cb(new Error("Tipo de arquivo não suportado. Verifique os formatos permitidos."), false);
    }
};


/**
 * Instância Principal do Multer
 * 
 * Aqui, criamos a instância do multer que será usada em todo o projeto.
 * Ela combina a configuração de armazenamento e o filtro de arquivos,
 * além de definir um limite de tamanho global para os uploads.
 */
const upload = multer({
    storage: storage,      // Usa o armazenamento em memória definido acima.
    fileFilter: fileFilter, // Usa a função de filtro definida acima.
    limits: {
        fileSize: 50 * 1024 * 1024 // Limite global de 50MB por arquivo.
    }
});


/**
 * Exportação
 * 
 * Exportamos um objeto contendo a instância 'upload' com um nome genérico
 * ('uploadProductFile') para ser usado nas rotas.
 * 
 * Ao exportar a instância completa, as rotas podem chamar os métodos
 * necessários, como `.single('nomeDoCampo')` para um arquivo ou
 * `.array('nomeDoCampo', 10)` para múltiplos arquivos.
 * Isso corrige o erro 'TypeError: Cannot read properties of undefined (reading 'array')'.
 */
module.exports = {
    uploadProductFile: upload
};