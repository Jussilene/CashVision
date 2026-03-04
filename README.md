# CashVision

Sistema financeiro web para fluxo de caixa, faturamento e integração fiscal em um painel simples e rápido.

## Descricao curta (GitHub)

CashVision e um sistema financeiro com Fluxo de Caixa, Contas a Receber e importacao de notas para lancamentos automaticos.

## Funcionalidades

- Fluxo de Caixa (contas, categorias, lancamentos, transferencias, painel cashflow)
- Faturamento / Contas a Receber (clientes, faturas, marcar pago gerando receita realizada)
- Integracao fiscal simulada FluxoNF (listar notas e gerar lancamentos com `documento_ref`)

## Requisitos

- Node.js 18+

## Como rodar

```bash
npm install
npm start
```

Aplicacao: `http://localhost:3105`

Usuario demo:

- Email: `admin@cashvision.local`
- Senha: `123456`

## Validacao de demo

Resetar base demo:

```bash
npm run reset-demo
```

Rodar smoke test completo:

```bash
npm run qa:smoke
```

## Namespaces de API

- `/api/cashvision/*`
- `/api/cashvision-billing/*`
- `/api/cashvision-integracoes/*`

## Observacoes

- Banco SQLite em `data/cashvision.sqlite`
- Migrações seguras com `CREATE TABLE IF NOT EXISTS` e ajustes incrementais
- Multi-tenant por `tenant_user_id + empresa_id`
