import sharp from "sharp";

export const COVER_MAX_WIDTH = 1600;
export const COVER_MAX_HEIGHT = 2000;

export interface ProcessedCover {
  image: Buffer;
  mimeType: "image/webp";
  width: number;
  height: number;
}

/**
 * Prepara a foto de capa enviada pelo contratante: aplica a rotação do EXIF,
 * limita o tamanho, converte para WebP e descarta todos os metadados
 * (inclusive localização GPS da câmera).
 */
export async function processCoverImage(input: Buffer): Promise<ProcessedCover> {
  const metadata = await sharp(input).metadata().catch(() => null);
  if (!metadata?.width || !metadata.height) throw new Error("O arquivo não é uma imagem válida.");
  if (metadata.width < 600 || metadata.height < 600) {
    throw new Error(`A imagem é pequena demais (${metadata.width}×${metadata.height}); use pelo menos 600 px em cada lado.`);
  }
  const { data, info } = await sharp(input)
    .rotate()
    .resize({ width: COVER_MAX_WIDTH, height: COVER_MAX_HEIGHT, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer({ resolveWithObject: true });
  return { image: data, mimeType: "image/webp", width: info.width, height: info.height };
}
