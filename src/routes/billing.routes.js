const express = require("express");
const { db, nowIso } = require("../db");
const { requireAuth, attachTenant } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth, attachTenant);

function asNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

router.get("/customers", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const rows = db
    .prepare(
      `SELECT *
       FROM cv_customers
       WHERE tenant_user_id = ? AND empresa_id = ?
       ORDER BY nome ASC`
    )
    .all(userId, empresaId);
  res.json(rows);
});

router.post("/customers", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const { nome, documento, email, telefone, endereco } = req.body;
  if (!nome) return res.status(400).json({ error: "nome obrigatorio" });
  const info = db
    .prepare(
      `INSERT INTO cv_customers
       (tenant_user_id, empresa_id, nome, documento, email, telefone, endereco)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userId, empresaId, nome, documento || null, email || null, telefone || null, endereco || null);
  res.status(201).json(db.prepare("SELECT * FROM cv_customers WHERE id = ?").get(info.lastInsertRowid));
});

router.put("/customers/:id", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const id = Number(req.params.id);
  const { nome, documento, email, telefone, endereco } = req.body;
  db.prepare(
    `UPDATE cv_customers
     SET nome = COALESCE(?, nome),
         documento = COALESCE(?, documento),
         email = COALESCE(?, email),
         telefone = COALESCE(?, telefone),
         endereco = COALESCE(?, endereco)
     WHERE id = ? AND tenant_user_id = ? AND empresa_id = ?`
  ).run(nome ?? null, documento ?? null, email ?? null, telefone ?? null, endereco ?? null, id, userId, empresaId);
  const row = db
    .prepare("SELECT * FROM cv_customers WHERE id = ? AND tenant_user_id = ? AND empresa_id = ?")
    .get(id, userId, empresaId);
  if (!row) return res.status(404).json({ error: "Cliente nao encontrado" });
  res.json(row);
});

router.delete("/customers/:id", (req, res) => {
  const { userId, empresaId } = req.tenant;
  db.prepare("DELETE FROM cv_customers WHERE id = ? AND tenant_user_id = ? AND empresa_id = ?")
    .run(Number(req.params.id), userId, empresaId);
  res.json({ ok: true });
});

router.get("/invoices", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const rows = db
    .prepare(
      `SELECT i.*, c.nome AS customer_nome
       FROM cv_invoices i
       JOIN cv_customers c ON c.id = i.customer_id
       WHERE i.tenant_user_id = ? AND i.empresa_id = ?
       ORDER BY i.data_vencimento DESC, i.id DESC`
    )
    .all(userId, empresaId);
  const mapped = rows.map((r) => {
    if (r.status === "ABERTO" && r.data_vencimento < new Date().toISOString().slice(0, 10)) {
      return { ...r, status: "ATRASADO" };
    }
    return r;
  });
  res.json(mapped);
});

router.get("/invoices/:id/items", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const id = Number(req.params.id);
  const invoice = db
    .prepare("SELECT id FROM cv_invoices WHERE id = ? AND tenant_user_id = ? AND empresa_id = ?")
    .get(id, userId, empresaId);
  if (!invoice) return res.status(404).json({ error: "Fatura nao encontrada" });
  const items = db.prepare("SELECT * FROM cv_invoice_items WHERE invoice_id = ? ORDER BY id").all(id);
  res.json(items);
});

router.post("/invoices", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const {
    customer_id,
    numero,
    data_emissao,
    data_vencimento,
    valor_total,
    status = "ABERTO",
    observacoes,
    itens = []
  } = req.body;

  if (!customer_id || !data_emissao || !data_vencimento || !valor_total) {
    return res.status(400).json({ error: "customer_id, data_emissao, data_vencimento e valor_total sao obrigatorios" });
  }

  const maxNumero = db
    .prepare(
      "SELECT COALESCE(MAX(numero),0) AS max_numero FROM cv_invoices WHERE tenant_user_id = ? AND empresa_id = ?"
    )
    .get(userId, empresaId).max_numero;
  const finalNumero = numero ? Number(numero) : Number(maxNumero) + 1;

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO cv_invoices
         (tenant_user_id, empresa_id, customer_id, numero, data_emissao, data_vencimento, valor_total, status, observacoes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        empresaId,
        Number(customer_id),
        finalNumero,
        data_emissao,
        data_vencimento,
        asNum(valor_total),
        status,
        observacoes || null,
        nowIso()
      );

    if (Array.isArray(itens) && itens.length > 0) {
      const stmt = db.prepare(
        `INSERT INTO cv_invoice_items (invoice_id, descricao, qtd, valor_unit, valor_total)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const item of itens) {
        const qtd = asNum(item.qtd || 1);
        const valorUnit = asNum(item.valor_unit);
        stmt.run(info.lastInsertRowid, item.descricao || "Item", qtd, valorUnit, qtd * valorUnit);
      }
    }

    return info.lastInsertRowid;
  });

  const id = tx();
  res.status(201).json(db.prepare("SELECT * FROM cv_invoices WHERE id = ?").get(id));
});

router.put("/invoices/:id", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const id = Number(req.params.id);
  const { data_vencimento, valor_total, status, observacoes } = req.body;
  db.prepare(
    `UPDATE cv_invoices
     SET data_vencimento = COALESCE(?, data_vencimento),
         valor_total = COALESCE(?, valor_total),
         status = COALESCE(?, status),
         observacoes = COALESCE(?, observacoes),
         updated_at = ?
     WHERE id = ? AND tenant_user_id = ? AND empresa_id = ?`
  ).run(data_vencimento ?? null, valor_total ?? null, status ?? null, observacoes ?? null, nowIso(), id, userId, empresaId);
  const row = db
    .prepare("SELECT * FROM cv_invoices WHERE id = ? AND tenant_user_id = ? AND empresa_id = ?")
    .get(id, userId, empresaId);
  if (!row) return res.status(404).json({ error: "Fatura nao encontrada" });
  res.json(row);
});

router.post("/invoices/:id/mark-paid", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const id = Number(req.params.id);
  const { account_id, category_id, data_pagamento, descricao } = req.body;
  const invoice = db
    .prepare(
      `SELECT i.*, c.nome AS customer_nome
       FROM cv_invoices i
       JOIN cv_customers c ON c.id = i.customer_id
       WHERE i.id = ? AND i.tenant_user_id = ? AND i.empresa_id = ?`
    )
    .get(id, userId, empresaId);
  if (!invoice) return res.status(404).json({ error: "Fatura nao encontrada" });
  if (invoice.status === "PAGO") return res.json({ ok: true, already_paid: true });

  const paymentDate = data_pagamento || new Date().toISOString().slice(0, 10);

  db.transaction(() => {
    db.prepare(
      "UPDATE cv_invoices SET status = 'PAGO', updated_at = ? WHERE id = ? AND tenant_user_id = ? AND empresa_id = ?"
    ).run(nowIso(), id, userId, empresaId);

    const exists = db
      .prepare(
        `SELECT id FROM cv_transactions
         WHERE tenant_user_id = ? AND empresa_id = ? AND ref_type = 'INVOICE' AND ref_id = ?`
      )
      .get(userId, empresaId, id);
    if (!exists) {
      db.prepare(
        `INSERT INTO cv_transactions
         (tenant_user_id, empresa_id, account_id, category_id, tipo, status, data_competencia, data_caixa, valor, descricao, tags, documento_ref, ref_type, ref_id, updated_at)
         VALUES (?, ?, ?, ?, 'RECEITA', 'REALIZADO', ?, ?, ?, ?, ?, ?, 'INVOICE', ?, ?)`
      ).run(
        userId,
        empresaId,
        account_id || null,
        category_id || null,
        invoice.data_emissao,
        paymentDate,
        asNum(invoice.valor_total),
        descricao || `Recebimento fatura #${invoice.numero} - ${invoice.customer_nome}`,
        `invoice:${invoice.id}`,
        null,
        id,
        nowIso()
      );
    }
  })();

  res.json({ ok: true });
});

router.delete("/invoices/:id", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const id = Number(req.params.id);
  db.transaction(() => {
    db.prepare(
      "DELETE FROM cv_invoice_items WHERE invoice_id IN (SELECT id FROM cv_invoices WHERE id = ? AND tenant_user_id = ? AND empresa_id = ?)"
    ).run(id, userId, empresaId);
    db.prepare("DELETE FROM cv_invoices WHERE id = ? AND tenant_user_id = ? AND empresa_id = ?")
      .run(id, userId, empresaId);
  })();
  res.json({ ok: true });
});

module.exports = router;
