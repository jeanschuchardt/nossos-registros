export default function NotFound() {
  return (
    <main className="event">
      <header className="cover cover-default cover-short">
        <div className="cover-text">
          <h1 className="event-name">Link incompleto</h1>
        </div>
      </header>
      <section className="panel panel-message">
        <h2>Não encontramos este evento</h2>
        <p>Use o QR Code ou o link completo enviado pelos organizadores. Se você copiou o link, confira se ele veio inteiro, incluindo a parte depois do “?k=”.</p>
      </section>
    </main>
  );
}
