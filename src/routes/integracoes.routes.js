const express = require("express");
const { db, nowIso } = require("../db");
const { requireAuth, attachTenant } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth, attachTenant);

router.get("/fluxonf/notas", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const { inicio, fim } = req.query;
  const params = [userId, empresaId];
  let where = "tenant_user_id = ? AND empresa_id = ?";
  if (inicio) {
    where += " AND data_emissao >= ?";
    params.push(inicio);
  }
  if (fim) {
    where += " AND data_emissao <= ?";
    params.push(fim);
  }
  const rows = db
    .prepare(
      `SELECT *
       FROM fluxonf_notes
       WHERE ${where}
       ORDER BY data_emissao DESC, id DESC`
    )
    .all(...params);
  res.json(rows);
});

router.post("/fluxonf/gerar-lancamentos", (req, res) => {
  const { userId, empresaId } = req.tenant;
  const { nota_ids = [], account_id, category_id, status = "REALIZADO", data_caixa } = req.body;
  if (!Array.isArray(nota_ids) || nota_ids.length === 0) {
    return res.status(400).json({ error: "nota_ids obrigatorio" });
  }
  const notas = db
    .prepare(
      `SELECT *
       FROM fluxonf_notes
       WHERE tenant_user_id = ? AND empresa_id = ?
       AND id IN (${nota_ids.map(() => "?").join(",")})`
    )
    .all(userId, empresaId, ...nota_ids.map(Number));

  const created = [];
  const skipped = [];
  db.transaction(() => {
    for (const nota of notas) {
      const exists = db
        .prepare(
          `SELECT id
           FROM cv_transactions
           WHERE tenant_user_id = ? AND empresa_id = ? AND ref_type = 'FLUXONF_NOTE' AND ref_id = ?`
        )
        .get(userId, empresaId, nota.id);
      if (exists) {
        skipped.push({ nota_id: nota.id, reason: "ja_importada" });
        continue;
      }

      const tipo = /EMITIDA/i.test(nota.tipo) ? "RECEITA" : "DESPESA";
      const info = db
        .prepare(
          `INSERT INTO cv_transactions
           (tenant_user_id, empresa_id, account_id, category_id, tipo, status, data_competencia, data_caixa, valor, descricao, tags, documento_ref, ref_type, ref_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FLUXONF_NOTE', ?, ?)`
        )
        .run(
          userId,
          empresaId,
          account_id || null,
          category_id || null,
          tipo,
          status,
          nota.data_emissao,
          data_caixa || nota.data_emissao,
          Number(nota.valor),
          `Importado da nota ${nota.numero} (${nota.tipo})`,
          "fluxonf-import",
          nota.documento_ref || null,
          nota.id,
          nowIso()
        );
      created.push({ nota_id: nota.id, transaction_id: info.lastInsertRowid, tipo });
    }
  })();

  res.json({ created, skipped, total_notas: notas.length });
});

module.exports = router;
