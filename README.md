# Nossos Registros — upload direto para Google Drive

Aplicação mobile-first para convidados enviarem fotos e vídeos de um casamento. A Vercel **não recebe o conteúdo dos arquivos**: ela valida metadados, renova o token OAuth e inicia uma sessão resumível. Cada `PUT` de 16 MiB sai do navegador diretamente para a URL de sessão do Google Drive.

## Viabilidade e limitações concretas

O fluxo é compatível com Next.js na Vercel Hobby e com a Drive API v3. A requisição à Function contém somente `filename`, `mimeType` e `size`; portanto o limite de payload de Functions não afeta vídeos grandes. A sessão do Drive expira após uma semana e aceita consulta de status/continuação via HTTP 308.

- O limite técnico atual de `files.create` no Drive API é **5.120 GB (5 TB) por arquivo**. Isso não significa que a conta tenha esse espaço disponível. O armazenamento contratado e as cotas do Google continuam valendo; contas Google Workspace também estão sujeitas ao limite documentado de 750 GB enviados por usuário em 24 horas.
- O limite **operacional da aplicação** é independente: `MAX_FILE_SIZE_GB=10` por padrão. Dez GB acomoda vídeos 4K/60 longos produzidos por celulares modernos; pode ser alterado sem mudar o código. Cinco GB é uma alternativa mais conservadora se espaço e duração do evento forem prioritários.
- A aba deve continuar aberta. A recuperação funciona após falhas de rede durante a sessão atual; recarregar/fechar perde a referência ao `File` por restrição do navegador.
- iOS pode suspender completamente uma aba em segundo plano. Android/Chrome também pode limitar ou encerrar páginas conforme memória, bateria e política do fabricante. Mantenha navegador em primeiro plano e tela desbloqueada.
- Sem banco, KV ou serviço externo, o rate limit em memória é por instância da Function e **não é um limite global confiável**. O token reduz descoberta casual, mas pode ser compartilhado. Proteção global exigiria relaxar a infraestrutura (Firewall/rate limiting pago, KV etc.).
- A URL resumível é uma credencial temporária de upload e necessariamente chega ao navegador. Ela não é salva nem registrada.
- MIME informado pelo navegador não prova o conteúdo. A aplicação cruza MIME e extensão; inspeção binária exigiria ler bytes no backend, contrariando a arquitetura.
- Apps OAuth em **Testing** têm autorizações/refresh tokens de Drive expirando em 7 dias. Coloque o app em Production antes do evento.
- Hobby destina-se a projetos pessoais/não comerciais e possui cotas próprias.

## Arquitetura e fluxo

```text
Convidado /upload?t=EVENT_TOKEN
  └─ POST JSON → Vercel /api/upload/initiate
       ├─ valida token, IP, nome, extensão, MIME e tamanho
       ├─ refresh token → Google OAuth access token
       └─ POST metadata → Drive resumable upload
              └─ Location → navegador

Navegador ── PUT chunks de 16 MiB ──→ Google Drive
           ← 308 + Range / 200-201 ←
```

O backend fixa `parents: [GOOGLE_DRIVE_FOLDER_ID]`; o cliente nunca envia pasta ou credencial. A concorrência é 2 por aparelho. O chunk de 16 MiB equivale a 64 × 256 KiB: para cada GiB são 64 requests, metade das 128 necessárias com 8 MiB, mas uma falha retransmite no máximo 16 MiB. Já 32 MiB reduz mais o overhead, porém duplica o custo de retransmissão e o buffer de cada upload; com dois simultâneos poderia manter cerca de 64 MiB em corpos de requests. Por isso 16 MiB é o equilíbrio escolhido para redes móveis.

A iniciação encaminha ao Drive o header `Origin` validado da página. Isso vincula as respostas CORS da sessão à origem do navegador, permitindo que ele leia `308`, `Range` e o `200/201` final. O progresso visual só chega a 100% depois dessa confirmação; enviar todos os bytes do último chunk não é tratado isoladamente como sucesso.

O arquivo nunca é lido integralmente em memória. Cada iteração usa `File.slice(offset, end)` e entrega apenas aquele `Blob` ao `XMLHttpRequest`. Em erro transitório há cinco retries com backoff exponencial e jitter; antes de continuar, o cliente envia uma consulta vazia `Content-Range: bytes */total`, interpreta `308`/`Range` e volta ao primeiro byte ainda não confirmado. Um timeout de cinco minutos evita que um request fique preso indefinidamente após troca de rede.

### Aproximadamente 100 convidados

A fila continua local, com no máximo dois uploads concorrentes por celular. Uma fila central não ajudaria no transporte, pois os bytes seguem de cada telefone ao Drive e exigiria persistência proibida pela arquitetura. Cem convidados significam até cerca de 200 PUTs concorrentes diretamente ao Google; apenas as iniciações pequenas chegam à Vercel. O rate limit local padrão foi dimensionado para 120 sessões/minuto por IP para reduzir falsos bloqueios quando muitos convidados compartilham o mesmo NAT/Wi-Fi. Ele continua sendo best effort por instância.

O gargalo operacional provável é a velocidade de upload do local e o espaço/cotas da conta, não memória ou bandwidth da Function. Faça teste de carga de iniciação e teste real na rede do evento.

### Limitações reais dos browsers móveis

- **Safari/iOS:** o WebKit pode suspender completamente abas quando vão ao background. Bloquear a tela, trocar de app ou pressão de memória pode congelar ou encerrar JavaScript e requests. Não existe garantia de upload contínuo em background.
- **Chrome/Android e Samsung Internet:** background sync existe em várias versões, mas tem tempo de execução limitado e não é uma garantia apropriada para transmitir um `File` de vários GB; fabricantes também aplicam políticas próprias de bateria/memória. Esta aplicação deliberadamente não promete upload em background.
- **Troca Wi-Fi ↔ 4G/5G:** normalmente derruba o PUT corrente. O timeout/erro aciona backoff, consulta o byte confirmado e retoma. Durante suspensão do sistema isso só acontece quando a página voltar a executar.
- **Tela bloqueada/background:** a interface avisa para manter tela desbloqueada e navegador aberto. Se a mesma página sobreviver, a recuperação retoma a sessão; se o SO matar/recarregar a aba, o site perde o objeto `File` e não pode reler o arquivo sem nova seleção do usuário.
- **Memória:** `File.slice()` restringe cada envio a 16 MiB. As miniaturas usam object URLs, não leitura/base64 do arquivo completo. Ainda assim, browser e sistema podem manter buffers internos próprios.

## Estrutura

```text
app/                         páginas, estilos e Route Handler
  api/upload/initiate/route.ts
  upload/page.tsx
components/                  área, fila, item e barra de progresso
lib/                         Drive/OAuth, upload, validação, nome e rate limit
types/upload.ts
scripts/generate-qr.ts
```

## Google Cloud, OAuth e pasta

1. Crie um projeto no [Google Cloud Console](https://console.cloud.google.com/) e habilite **Google Drive API**.
2. Em Google Auth Platform, configure Branding/Audience. Para Gmail pessoal, escolha **External**, adicione sua conta como test user durante a configuração e publique em **Production** antes do evento.
3. Em Data Access, adicione somente `https://www.googleapis.com/auth/drive.file`. Ele limita o app aos arquivos usados/criados por ele.
4. Crie um OAuth Client **Web application**. Para o método abaixo, adicione `https://developers.google.com/oauthplayground` como redirect URI autorizado.
5. Crie a pasta no Drive e copie o trecho após `/folders/` da URL como `GOOGLE_DRIVE_FOLDER_ID`. Não publique a pasta.

### Gerar o refresh token

1. Abra o [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Na engrenagem, marque **Use your own OAuth credentials** e informe Client ID/Secret.
3. No Step 1, informe `https://www.googleapis.com/auth/drive.file`, clique **Authorize APIs** e autorize com a conta dona da pasta.
4. No Step 2, clique **Exchange authorization code for tokens** e copie o `refresh_token`.
5. Se ele não aparecer, revogue o acesso anterior na Conta Google e autorize de novo. Depois, remova o redirect URI do Playground se não for mais usá-lo.

O código troca o refresh token por access token curto exclusivamente no servidor. Não existe endpoint OAuth público na aplicação.

## Configuração local

```bash
cp .env.example .env.local
npm install
npm run dev
```

Preencha `.env.local`:

```dotenv
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
GOOGLE_DRIVE_FOLDER_ID=...
EVENT_TOKEN=cole-um-token-com-pelo-menos-32-bytes-aleatorios
MAX_FILE_SIZE_GB=10
SESSION_RATE_LIMIT_PER_MINUTE=120
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Antes de iniciar o site, valide sem expor as credenciais se o refresh token pode ser
renovado e se a pasta está acessível:

```bash
npm run check:google
```

Se o comando retornar `invalid_grant`, gere um novo refresh token. Em apps OAuth com
status **Testing**, a autorização pode expirar em 7 dias; publique o app em
**Production** e gere o token novamente para evitar essa expiração de teste.

Gere o token com `openssl rand -hex 32`. Acesse `http://localhost:3000/upload?t=SEU_TOKEN`.

## QR Code

Com a URL final em `NEXT_PUBLIC_SITE_URL`:

```bash
npx tsx --env-file=.env.local scripts/generate-qr.ts
```

Cria `public/event-qr.png` apontando ao link completo. O PNG é ignorado pelo Git porque contém o token; use-o para impressão. Depois do evento, troque/remova `EVENT_TOKEN`.

## Vercel e deploy

1. Importe o repositório na Vercel como Next.js.
2. Em Settings → Environment Variables, cadastre todas as variáveis para Production. Use `NEXT_PUBLIC_SITE_URL=https://seu-dominio`.
3. Faça Deploy; não é necessário volume, banco ou Blob.
4. Teste o QR no domínio final antes de imprimir. Não use uma URL de preview.

Via CLI: `vercel`, configure as variáveis e execute `vercel --prod`.

## Erros

- 400: metadados, extensão, MIME ou tamanho acima de `MAX_FILE_SIZE_GB`;
- 403: token ausente/incorreto;
- 429: limite local de sessões;
- 502: OAuth/Drive indisponível, refresh token inválido ou pasta inacessível;
- 308: esperado em chunks intermediários;
- 404 do Drive: sessão expirou; inicie o item novamente;
- rede/429/5xx: backoff e consulta do offset; após cinco tentativas aparece **Tentar novamente**.

Logs incluem somente MIME, tamanho e resultado. Não incluem nomes, tokens, conteúdo ou session URL. Os arquivos recebem `AAAAMMDD_HHMMSS_UUID_nome.ext`, preservam os bytes e permanecem privados.

## Testes

```bash
npm test
npm run typecheck
npm run build
```

Antes do evento:

1. Envie JPG, PNG, WebP, HEIC/HEIF, MP4 e MOV de aparelhos reais.
2. Confirme em Network que os `PUT` vão a `googleapis.com`, nunca ao seu domínio.
3. Confirme no Drive pasta, tamanho exato, reprodução e ausência de compartilhamento público.
4. Teste dois simultâneos e uma fila com pelo menos cinco arquivos.
5. Em vídeos reais acima de 5 GB, interrompa a rede e alterne Wi-Fi/4G/5G; confirme que o upload consulta o Drive e retorna ao byte confirmado, não a zero.
6. Teste Safari/iOS e Chrome/Android, retrato e paisagem.
7. Teste limite, extensão falsa, token errado e 429.
8. Monitore espaço/cota do Drive e logs da Vercel.

Não há compressão ou conversão: `Blob.slice()` apenas seleciona intervalos dos bytes originais.
