import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { COVER_MAX_WIDTH, processCoverImage } from "./cover-image";

async function photo(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 180, g: 140, b: 110 } } })
    .jpeg()
    .withExif({ IFD0: { Make: "Câmera de teste" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "23/1 33/1 0/1" } })
    .toBuffer();
}

describe("processCoverImage", () => {
  it("redimensiona, converte para WebP e remove metadados", async () => {
    const original = await photo(4000, 3000);
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const result = await processCoverImage(original);
    expect(result.mimeType).toBe("image/webp");
    expect(result.width).toBe(COVER_MAX_WIDTH);
    const metadata = await sharp(result.image).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.exif).toBeUndefined();
  });
  it("não amplia imagens menores que o limite", async () => {
    const result = await processCoverImage(await photo(900, 1200));
    expect([result.width, result.height]).toEqual([900, 1200]);
  });
  it("recusa imagens pequenas demais e arquivos que não são imagem", async () => {
    await expect(processCoverImage(await photo(400, 300))).rejects.toThrow(/pequena/);
    await expect(processCoverImage(Buffer.from("não é imagem"))).rejects.toThrow(/imagem válida/);
  });
});
