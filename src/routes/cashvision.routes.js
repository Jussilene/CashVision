const express = require("express");
const { db, nowIso } = require("../db");
const { requireAuth, attachTenant } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth, attachTenant);

function parseNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

router.get("/accounts", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const rows = db
    .prepare(
      `SELECT * FROM cv_accounts
       WHERE tenant_user_id = ? AND empresa_id = ?
       ORDER BY ativo DESC, nome ASC`
    )
    .all(userId, empresaId);
  res.json(rows);
});

router.post("/accounts", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const { nome, tipo, saldo_inicial = 0 } = req.body;
  if (!nome || !tipo) return res.status(400).json({ error: "nome e tipo sao obrigatorios" });
  const info = db
    .prepare(
      `INSERT INTO cv_accounts (tenant_user_id, empresa_id, nome, tipo, saldo_inicial)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, empresaId, nome, tipo, parseNumber(saldo_inicial));
  const row = db.prepare("SELECT * FROM cv_accounts WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json(row);
});

router.put("/accounts/:id", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const id = Number(req.params.id);
  const { nome, tipo, saldo_inicial, ativo } = req.body;
  db.prepare(
    `UPDATE cv_accounts
     SET nome = COALESCE(?, nome),
         tipo = COALESCE(?, tipo),
         saldo_inicial = COALESCE(?, saldo_inicial),
         ativo = COALESCE(?, ativo)
     WHERE id = ? AND tenant_user_id = ? AND empresa_id = ?`
  ).run(nome ?? null, tipo ?? null, saldo_inicial ?? null, ativo ?? null, id, userId, empresaId);
  const row = db
    .prepare("SELECT * FROM cv_accounts WHERE id = ? AND tenant_user_id = ? AND empresa_id = ?")
    .get(id, userId, empresaId);
  if (!row) return res.status(404).json({ error: "Conta nao encontrada" });
  res.json(row);
});

router.delete("/accounts/:id", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const id = Number(req.params.id);
  db.prepare(
    "UPDATE cv_accounts SET ativo = 0 WHERE id = ? AND tenant_user_id = ? AND empresa_id = ?"
  ).run(id, userId, empresaId);
  res.json({ ok: true });
});

router.get("/categories", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const rows = db
    .prepare(
      `SELECT * FROM cv_categories
       WHERE tenant_user_id = ? AND empresa_id = ?
       ORDER BY ordem ASC, nome ASC`
    )
    .all(userId, empresaId);
  res.json(rows);
});

router.post("/categories", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const { nome, tipo, ordem = 0 } = req.body;
  if (!nome || !tipo) return res.status(400).json({ error: "nome e tipo sao obrigatorios" });
  const info = db
    .prepare(
      `INSERT INTO cv_categories (tenant_user_id, empresa_id, nome, tipo, ordem)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, empresaId, nome, tipo, parseNumber(ordem));
  res.status(201).json(db.prepare("SELECT * FROM cv_categories WHERE id = ?").get(info.lastInsertRowid));
});

router.put("/categories/:id", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const id = Number(req.params.id);
  const { nome, tipo, ordem, ativo } = req.body;
  db.prepare(
    `UPDATE cv_categories
     SET nome = COALESCE(?, nome),
         tipo = COALESCE(?, tipo),
         ordem = COALESCE(?, ordem),
         ativo = COALESCE(?, ativo)
     WHERE id = ? AND tenant_user_id = ? AND empresa_id = ?`
  ).run(nome ?? null, tipo ?? null, ordem ?? null, ativo ?? null, id, userId, empresaId);
  const row = db
    .prepare("SELECT * FROM cv_categories WHERE id = ? AND tenant_user_id = ? AND empresa_id = ?")
    .get(id, userId, empresaId);
  if (!row) return res.status(404).json({ error: "Categoria nao encontrada" });
  res.json(row);
});

router.delete("/categories/:id", (req, res) => {
  const { userId, empresaId } = req.tenant;
  db.prepare(
    "UPDATE cv_categories SET ativo = 0 WHERE id = ? AND tenant_user_id = ? AND empresa_id = ?"
  ).run(Number(req.params.id), userId, empresaId);
  res.json({ ok: true });
});

router.get("/transactions", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const { inicio, fim, tipo, status, account_id, category_id } = req.query;
  const params = [userId, empresaId];
  let where = "t.tenant_user_id = ? AND t.empresa_id = ?";

  if (inicio) {
    where += " AND COALESCE(t.data_caixa, t.data_competencia) >= ?";
    params.push(inicio);
  }
  if (fim) {
    where += " AND COALESCE(t.data_caixa, t.data_competencia) <= ?";
    params.push(fim);
  }
  if (tipo) {
    where += " AND t.tipo = ?";
    params.push(tipo.toUpperCase());
  }
  if (status) {
    where += " AND t.status = ?";
    params.push(status.toUpperCase());
  }
  if (account_id) {
    where += " AND t.account_id = ?";
    params.push(Number(account_id));
  }
  if (category_id) {
    where += " AND t.category_id = ?";
    params.push(Number(category_id));
  }

  const rows = db
    .prepare(
      `SELECT t.*,
              a.nome AS conta_nome,
              c.nome AS categoria_nome
       FROM cv_transactions t
       LEFT JOIN cv_accounts a ON a.id = t.account_id
       LEFT JOIN cv_categories c ON c.id = t.category_id
       WHERE ${where}
       ORDER BY COALESCE(t.data_caixa, t.data_competencia) DESC, t.id DESC`
    )
    .all(...params);
  res.json(rows);
});

router.post("/transactions", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const {
    account_id,
    category_id,
    tipo,
    status,
    data_competencia,
    data_caixa,
    valor,
    descricao,
    tags,
    documento_ref
  } = req.body;

  if (!tipo || !status || !data_competencia || !valor) {
    return res.status(400).json({ error: "tipo, status, data_competencia e valor sao obrigatorios" });
  }

  const info = db
    .prepare(
      `INSERT INTO cv_transactions
      (tenant_user_id, empresa_id, account_id, category_id, tipo, status, data_competencia, data_caixa, valor, descricao, tags, documento_ref, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      empresaId,
      account_id || null,
      category_id || null,
      tipo,
      status,
      data_competencia,
      data_caixa || null,
      parseNumber(valor),
      descricao || null,
      tags || null,
      documento_ref || null,
      nowIso()
    );

  res.status(201).json(db.prepare("SELECT * FROM cv_transactions WHERE id = ?").get(info.lastInsertRowid));
});

router.put("/transactions/:id", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const id = Number(req.params.id);
  const {
    account_id,
    category_id,
    tipo,
    status,
    data_competencia,
    data_caixa,
    valor,
    descricao,
    tags,
    documento_ref
  } = req.body;

  db.prepare(
    `UPDATE cv_transactions
     SET account_id = COALESCE(?, account_id),
         category_id = COALESCE(?, category_id),
         tipo = COALESCE(?, tipo),
         status = COALESCE(?, status),
         data_competencia = COALESCE(?, data_competencia),
         data_caixa = COALESCE(?, data_caixa),
         valor = COALESCE(?, valor),
         descricao = COALESCE(?, descricao),
         tags = COALESCE(?, tags),
         documento_ref = COALESCE(?, documento_ref),
         updated_at = ?
     WHERE id = ? AND tenant_user_id = ? AND empresa_id = ?`
  ).run(
    account_id ?? null,
    category_id ?? null,
    tipo ?? null,
    status ?? null,
    data_competencia ?? null,
    data_caixa ?? null,
    valor ?? null,
    descricao ?? null,
    tags ?? null,
    documento_ref ?? null,
    nowIso(),
    id,
    userId,
    empresaId
  );

  const row = db
    .prepare("SELECT * FROM cv_transactions WHERE id = ? AND tenant_user_id = ? AND empresa_id = ?")
    .get(id, userId, empresaId);
  if (!row) return res.status(404).json({ error: "Lancamento nao encontrado" });
  res.json(row);
});

router.delete("/transactions/:id", (req, res) => {
  const { userId, empresaId } = req.tenant;
  db.prepare("DELETE FROM cv_transactions WHERE id = ? AND tenant_user_id = ? AND empresa_id = ?")
    .run(Number(req.params.id), userId, empresaId);
  res.json({ ok: true });
});

router.get("/cashflow", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const { inicio, fim, modo = "caixa", status = "todos" } = req.query;
  const campoData = modo === "competencia" ? "data_competencia" : "COALESCE(data_caixa, data_competencia)";
  const params = [userId, empresaId];
  let where = "tenant_user_id = ? AND empresa_id = ? AND tipo IN ('RECEITA','DESPESA')";

  if (status !== "todos") {
    where += " AND status = ?";
    params.push(status.toUpperCase());
  }
  if (inicio) {
    where += ` AND ${campoData} >= ?`;
    params.push(inicio);
  }
  if (fim) {
    where += ` AND ${campoData} <= ?`;
    params.push(fim);
  }

  const totals = db
    .prepare(
      `SELECT
         SUM(CASE WHEN tipo = 'RECEITA' THEN valor ELSE 0 END) AS entradas,
         SUM(CASE WHEN tipo = 'DESPESA' THEN valor ELSE 0 END) AS saidas
       FROM cv_transactions
       WHERE ${where}`
    )
    .get(...params);

  const saldoInicial = db
    .prepare(
      `SELECT COALESCE(SUM(saldo_inicial),0) AS total
       FROM cv_accounts
       WHERE tenant_user_id = ? AND empresa_id = ? AND ativo = 1`
    )
    .get(userId, empresaId).total;

  const acumuladoRealizado = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN tipo = 'RECEITA' THEN valor WHEN tipo = 'DESPESA' THEN -valor ELSE 0 END),0) AS total
       FROM cv_transactions
       WHERE tenant_user_id = ? AND empresa_id = ? AND status = 'REALIZADO' AND tipo IN ('RECEITA','DESPESA')`
    )
    .get(userId, empresaId).total;

  const extrato = db
    .prepare(
      `SELECT t.id, t.tipo, t.status, t.valor, t.descricao, t.data_competencia, t.data_caixa, t.documento_ref, a.nome AS conta_nome
       FROM cv_transactions t
       LEFT JOIN cv_accounts a ON a.id = t.account_id
       WHERE t.tenant_user_id = ? AND t.empresa_id = ?
       ORDER BY COALESCE(t.data_caixa, t.data_competencia) DESC
       LIMIT 12`
    )
    .all(userId, empresaId);

  const entradas = Number(totals.entradas || 0);
  const saidas = Number(totals.saidas || 0);
  res.json({
    saldo_atual: Number(saldoInicial || 0) + Number(acumuladoRealizado || 0),
    entradas_mes: entradas,
    saidas_mes: saidas,
    resultado_mes: entradas - saidas,
    extrato
  });
});

router.get("/transfers", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const rows = db
    .prepare(
      `SELECT tr.*,
              fa.nome AS from_account_nome,
              ta.nome AS to_account_nome
       FROM cv_transfers tr
       JOIN cv_accounts fa ON fa.id = tr.from_account_id
       JOIN cv_accounts ta ON ta.id = tr.to_account_id
       WHERE tr.tenant_user_id = ? AND tr.empresa_id = ?
       ORDER BY tr.data DESC, tr.id DESC`
    )
    .all(userId, empresaId);
  res.json(rows);
});

router.post("/transfers", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const { from_account_id, to_account_id, data, valor, descricao } = req.body;
  if (!from_account_id || !to_account_id || !data || !valor) {
    return res.status(400).json({ error: "from_account_id, to_account_id, data e valor sao obrigatorios" });
  }
  if (Number(from_account_id) === Number(to_account_id)) {
    return res.status(400).json({ error: "Conta origem e destino devem ser diferentes" });
  }
  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO cv_transfers
         (tenant_user_id, empresa_id, from_account_id, to_account_id, data, valor, descricao)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(userId, empresaId, from_account_id, to_account_id, data, parseNumber(valor), descricao || null);

    db.prepare(
      `INSERT INTO cv_transactions
       (tenant_user_id, empresa_id, account_id, tipo, status, data_competencia, data_caixa, valor, descricao, tags, ref_type, ref_id, updated_at)
       VALUES (?, ?, ?, 'TRANSFERENCIA', 'REALIZADO', ?, ?, ?, ?, ?, 'TRANSFER_OUT', ?, ?),
              (?, ?, ?, 'TRANSFERENCIA', 'REALIZADO', ?, ?, ?, ?, ?, 'TRANSFER_IN', ?, ?)`
    ).run(
      userId, empresaId, from_account_id, data, data, parseNumber(valor), descricao || "Transferencia - Saida", "transferencia",
      info.lastInsertRowid, nowIso(),
      userId, empresaId, to_account_id, data, data, parseNumber(valor), descricao || "Transferencia - Entrada", "transferencia",
      info.lastInsertRowid, nowIso()
    );
    return info.lastInsertRowid;
  });

  const id = tx();
  res.status(201).json(db.prepare("SELECT * FROM cv_transfers WHERE id = ?").get(id));
});

module.exports = router;
