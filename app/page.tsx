import Link from "next/link";

export default function Home() {
  return <main className="shell"><section className="card"><p className="eyebrow">Fran & Jean</p><h1>Nossos registros</h1><p>Use o endereço completo que acompanha o QR Code para compartilhar suas fotos e vídeos.</p><Link className="text-link" href="/upload">Ir para a página de envio</Link></section></main>;
}
