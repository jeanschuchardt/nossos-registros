# Nossos Registros

Aplicação multi-eventos para convidados enviarem fotos e vídeos diretamente do navegador ao Google Drive. A Vercel controla eventos, autorização e sessões resumíveis; os bytes dos arquivos não passam pela Vercel.

## Arquitetura

```text
Convidado /e/<slug>
  ├─ POST metadados → Next.js/Vercel → Neon
  ├─ Next.js cria sessão resumível na pasta do evento
  ├─ navegador envia chunks de 16 MiB → Google Drive
  └─ Next.js confere arquivo/pasta no Drive → Neon: completed
```

- **Next.js/Vercel:** páginas, APIs e controle do fluxo.
- **Neon PostgreSQL:** eventos, capacidade, estados, sessões criptografadas e rate limit.
- **Google Drive:** uma pasta independente por evento.
- **IndexedDB:** metadados da fila para recuperação após recarregar a página.

O cliente nunca escolhe a pasta do Drive. O servidor resolve o evento pelo slug e usa o `drive_folder_id` cadastrado no Neon. Na confirmação, nome interno, MIME, tamanho e pasta são verificados na API do Drive.

## Recuperação e limitações

- Falhas de rede usam até cinco tentativas com backoff e consulta do offset confirmado pelo Drive.
- A sessão resumível fica criptografada no Neon e pode ser retomada pelo mesmo identificador.
- Preparações interrompidas pela Vercel são liberadas automaticamente após `UPLOAD_PREPARATION_TIMEOUT_MS`.
- Sessões expiradas são invalidadas e recriadas na próxima tentativa.
- O IndexedDB preserva a identidade da fila, não uma cópia de vídeos grandes. Depois de fechar/recarregar a página, o navegador solicita que o usuário selecione novamente o arquivo original; nome, tamanho e `lastModified` precisam coincidir.
- iOS e Android podem suspender abas em segundo plano. Para vídeos grandes, mantenha a página aberta, em primeiro plano e a tela desbloqueada.
- MIME e extensão são cruzados, mas inspecionar o conteúdo binário exigiria transmitir bytes ao backend, fora da arquitetura proposta.

## Limites

- Até cinco eventos com status `active`, garantido por trigger no banco.
- Capacidade padrão de 100 GB por evento, incluindo uploads em andamento reservados.
- Tamanho padrão máximo de 10 GB por arquivo, configurável por evento no Neon.
- Dois uploads simultâneos por navegador.
- Rate limit de criação de sessões persistido no Neon e identificado por hash do IP.

## Configuração local

```bash
cp .env.example .env.local
npm install
npm run db:migrate
npm run dev
```

Variáveis necessárias:

```dotenv
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
DATABASE_URL=...
DATABASE_URL_UNPOOLED=...
UPLOAD_SESSION_ENCRYPTION_KEY=chave-aleatoria-de-pelo-menos-32-bytes
MAX_FILE_SIZE_GB=10
SESSION_RATE_LIMIT_PER_MINUTE=120
UPLOAD_PREPARATION_TIMEOUT_MS=120000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

O OAuth deve usar o escopo `https://www.googleapis.com/auth/drive.file`. Em Google Auth Platform, publique o app em Production; autorizações de aplicativos em Testing podem expirar.

## Banco e eventos

Aplicar e verificar migrations:

```bash
npm run db:migrate
npm run db:check
npm run db:check-uploads
```

Criar um evento usando temporariamente a pasta indicada no comando:

```bash
GOOGLE_DRIVE_FOLDER_ID=ID_DA_PASTA npm run db:create-event -- --slug casamento-ana-pedro --name "Casamento Ana e Pedro"
npm run db:update-event -- --slug casamento-ana-pedro --status active
```

Fechar ou arquivar:

```bash
npm run db:update-event -- --slug casamento-ana-pedro --status closed
npm run db:update-event -- --slug casamento-ana-pedro --status archived
```

URL pública: `https://seu-dominio/e/casamento-ana-pedro`.

Validar o OAuth e a pasta configurada para um evento:

```bash
npm run check:google -- --slug casamento-ana-pedro
```

## QR Code

```bash
npm run qr -- --slug casamento-ana-pedro
```

O arquivo `public/event-qr.png` aponta para a URL exclusiva do evento. O diretório `public/` local permanece ignorado porque o QR é um artefato operacional.

## Testes e validação

```bash
npm test
npm run typecheck
npm run build
```

Antes de um evento real:

1. Teste cada link e confirme a pasta correta no Drive.
2. Envie formatos e tamanhos variados em aparelhos reais.
3. Interrompa a rede durante um upload e confirme a retomada.
4. Recarregue a página, selecione novamente o mesmo arquivo e confirme a retomada.
5. Teste uploads simultâneos nos eventos ativos.
6. Feche um evento e confirme que novas sessões são bloqueadas.
7. Monitore uploads em `creating_session`, `retry_pending` e `awaiting_confirmation`.

## Segurança e privacidade

- Credenciais OAuth permanecem no servidor.
- URLs resumíveis são tratadas como credenciais temporárias e armazenadas com AES-256-GCM.
- APIs validam origem, evento, metadados, capacidade e vínculo do upload.
- Logs usam IDs, MIME, tamanho e estado; não registram conteúdo, credenciais ou URL de sessão.
- Os arquivos permanecem privados no Drive, salvo se a pasta for compartilhada manualmente.

Não há compressão ou conversão: `Blob.slice()` envia intervalos dos bytes originais diretamente ao Google Drive.
