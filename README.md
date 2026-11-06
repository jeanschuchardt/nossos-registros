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

O cliente nunca escolhe a pasta do Drive. O servidor resolve o evento pelo slug **e pelo token de acesso** (`/e/<slug>?k=<token>`) e usa o `drive_folder_id` cadastrado no Neon. Na confirmação, nome interno, MIME, tamanho e pasta são verificados na API do Drive.

## Acesso e segurança dos envios

- O slug é legível e adivinhável; o token `k` (gerado por evento na migration 0004 ou no `create-event`) é o que libera o envio. Link sem token ou com token errado mostra "Link inválido", igual a um evento inexistente.
- `initiate` devolve um `uploadToken` (HMAC do ID do upload). `progress` e `confirm` só aceitam requisições com esse token.
- Rate limit persistente por IP em `initiate`, `progress` e `confirm`. Os limites são generosos porque convidados no Wi-Fi do local compartilham IP.
- CSP restringe conexões ao próprio site e a `www.googleapis.com`.

## Recuperação e limitações

- Falhas de rede usam até cinco tentativas com backoff e consulta do offset confirmado pelo Drive.
- A sessão resumível fica criptografada no Neon e pode ser retomada pelo mesmo identificador.
- Preparações interrompidas pela Vercel são liberadas automaticamente após `UPLOAD_PREPARATION_TIMEOUT_MS`.
- Sessões expiradas são invalidadas e recriadas na próxima tentativa.
- Uploads sem progresso por `UPLOAD_ABANDONED_TIMEOUT_MS` (2 h) liberam a reserva de capacidade na próxima preparação de upload do evento. Se o convidado voltar e ainda houver espaço, o upload retoma a mesma sessão do Drive sem perder o progresso.
- O IndexedDB preserva a identidade da fila, não uma cópia de vídeos grandes. Depois de fechar/recarregar a página, o navegador solicita que o usuário selecione novamente o arquivo original; nome, tamanho e `lastModified` precisam coincidir.
- iOS e Android podem suspender abas em segundo plano. Para vídeos grandes, mantenha a página aberta, em primeiro plano e a tela desbloqueada.
- MIME e extensão são cruzados, mas inspecionar o conteúdo binário exigiria transmitir bytes ao backend, fora da arquitetura proposta.

## Limites

- Sem teto fixo de eventos ativos (decisão de 03/11/2026); o limite real é o espaço no Drive.
- Capacidade padrão de 100 GB por evento, incluindo uploads em andamento reservados. Ao lotar, o convidado vê "Este evento atingiu o limite de armazenamento".
- Fotos (JPG, JPEG, PNG, WebP, HEIC, HEIF) até 50 MB; vídeos (MP4, MOV, M4V) até 5 GB. `max_file_size_bytes` do evento pode reduzir esse teto.
- Janela de envio: das 00:00 do dia anterior ao evento até o fim do 7º dia depois (horário de Brasília).
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
UPLOAD_SESSION_ENCRYPTION_KEY=...   # obrigatória, >= 32 caracteres: openssl rand -base64 48
SESSION_RATE_LIMIT_PER_MINUTE=120
UPLOAD_PREPARATION_TIMEOUT_MS=120000
UPLOAD_ABANDONED_TIMEOUT_MS=7200000
GOOGLE_DRIVE_PARENT_FOLDER_ID=...   # opcional
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

Criar um evento. O script cria a pasta exclusiva no Drive pelo próprio app (necessário com o escopo `drive.file`), calcula a janela de envio e imprime o link com token:

```bash
npm run db:create-event -- --slug casamento-ana-pedro --name "Casamento Ana e Pedro" --event-date 2026-12-12
npm run db:update-event -- --slug casamento-ana-pedro --status active
```

Opções: `--folder-id <id>` reaproveita uma pasta existente (validada no Drive e recusada se já pertencer a outro evento), `--parent-folder-id <id>`, `--capacity-gb 100`, `--active`. Para mudar a data: `npm run db:update-event -- --slug <slug> --event-date AAAA-MM-DD`.

Fechar ou arquivar:

```bash
npm run db:update-event -- --slug casamento-ana-pedro --status closed
npm run db:update-event -- --slug casamento-ana-pedro --status archived
```

URL pública: `https://seu-dominio/e/casamento-ana-pedro?k=<token>` (impressa pelo `create-event` e pelo `qr`).

Validar o OAuth e a pasta configurada para um evento:

```bash
npm run check:google -- --slug casamento-ana-pedro
```

## Capa do evento

Cada evento pode ter uma foto de capa escolhida pelo contratante; sem ela, a página usa uma capa padrão neutra. A foto é redimensionada (até 1600 px), convertida para WebP e gravada sem metadados (inclusive localização GPS). Fica no Neon (`event_covers`) e só abre com o token do evento.

```bash
npm run db:set-cover -- --slug casamento-ana-pedro --image ~/Downloads/capa.jpg
npm run db:set-cover -- --slug casamento-ana-pedro --remove   # volta para a capa padrão
```

O `create-event` também aceita `--cover foto.jpg`.

Para ver os eventos ativos com link, prazo e uso: `npm run db:list-events` (ou `-- --all`).

## QR Code

```bash
npm run qr -- --slug casamento-ana-pedro
```

Gera `public/qr-<slug>.png` (ou `--out arquivo.png`) com a URL completa, incluindo o token. Os PNGs de QR são ignorados pelo git porque são artefatos operacionais.

## Testes e validação

```bash
npm run lint
npm test        # inclui integração com Postgres em memória (PGlite)
npm run typecheck
npm run build
```

O GitHub Actions (`.github/workflows/ci.yml`) roda os mesmos passos em cada push para `main` e em pull requests.

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
