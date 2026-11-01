import { UploadArea } from "@/components/UploadArea";

export const dynamic = "force-dynamic";

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const params = await searchParams;
  const eventToken = typeof params.t === "string" ? params.t : "";
  const valid = Boolean(eventToken && process.env.EVENT_TOKEN && eventToken === process.env.EVENT_TOKEN);
  const maxFileSizeGb = Number(process.env.MAX_FILE_SIZE_GB);
  if (!Number.isFinite(maxFileSizeGb) || maxFileSizeGb <= 0) {
    throw new Error("MAX_FILE_SIZE_GB deve ser configurado com um número positivo.");
  }
  return (
    <main className="shell">
      <section className="card">
        <header className="hero"><p className="eyebrow">Fran & Jean</p><h1>Compartilhe seus registros<br />do nosso casamento</h1><p>Adicione aqui as fotos e vídeos que você registrou durante esse dia.</p></header>
        {valid ? <UploadArea eventSlug="casamento-fran-jean" maxFileSizeGb={maxFileSizeGb} /> : <div className="invalid"><h2>Link inválido</h2><p>Abra novamente o link do QR Code do casamento.</p></div>}
        {valid && (
          <footer className="page-footer">
            <a
              className="gallery-link"
              href="https://drive.google.com/drive/folders/1Wm6zFKafJVRXbMr0S36rCnNMF125Jwy5?usp=drive_link"
              target="_blank"
              rel="noopener noreferrer"
            >
              Ver fotos e vídeos já enviados
              <span aria-hidden="true">↗</span>
            </a>
          </footer>
        )}
      </section>
    </main>
  );
}
