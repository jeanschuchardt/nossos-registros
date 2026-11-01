# Banco de dados

O diretório `db/migrations` é a fonte versionada da estrutura do Neon PostgreSQL.
O banco deve poder ser reconstruído aplicando esses arquivos em ordem alfabética.

## Regras

- Uma migration aplicada nunca deve ser alterada.
- Mudanças futuras recebem um novo arquivo numerado, por exemplo
  `0002_add_event_settings.sql`.
- Cada migration deve ser segura para executar dentro de uma transação.
- Credenciais e dados reais nunca devem ser adicionados ao repositório.
- Seeds, quando necessários, ficam separados das migrations e não contêm dados
  pessoais ou segredos.

## Aplicação

Com `DATABASE_URL_UNPOOLED` ou `DATABASE_URL` configurada no `.env.local`:

```bash
npm run db:migrate
```

O executor registra nome e checksum em `schema_migrations`. Se uma migration já
aplicada for modificada, a execução falha em vez de alterar silenciosamente o
histórico do banco.

Para conferir as estruturas essenciais e o histórico aplicado:

```bash
npm run db:check
```

Para validar estados e capacidade dentro de uma transação que sempre é revertida:

```bash
npm run db:check-uploads
```
