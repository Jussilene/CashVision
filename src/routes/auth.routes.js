const express = require("express");
const bcrypt = require("bcryptjs");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email e senha sao obrigatorios" });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Credenciais invalidas" });
  }

  req.session.userId = user.id;
  const companies = db
    .prepare(
      `SELECT c.id, c.nome
       FROM companies c
       JOIN user_companies uc ON uc.company_id = c.id
       WHERE uc.user_id = ?
       ORDER BY c.nome`
    )
    .all(user.id);
  req.session.empresaId = companies[0]?.id || null;

  return res.json({
    user: { id: user.id, nome: user.nome, email: user.email },
    companies,
    empresa_id: req.session.empresaId
  });
});

router.post("/logout", requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get("/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT id, nome, email FROM users WHERE id = ?").get(req.session.userId);
  const companies = db
    .prepare(
      `SELECT c.id, c.nome
       FROM companies c
       JOIN user_companies uc ON uc.company_id = c.id
       WHERE uc.user_id = ?`
    )
    .all(req.session.userId);
  res.json({ user, companies, empresa_id: req.session.empresaId || companies[0]?.id || null });
});

router.post("/select-company", requireAuth, (req, res) => {
  const empresaId = Number(req.body.empresa_id);
  if (!empresaId) return res.status(400).json({ error: "empresa_id invalido" });
  const allowed = db
    .prepare("SELECT 1 FROM user_companies WHERE user_id = ? AND company_id = ?")
    .get(req.session.userId, empresaId);
  if (!allowed) return res.status(403).json({ error: "Empresa nao autorizada" });
  req.session.empresaId = empresaId;
  res.json({ ok: true, empresa_id: empresaId });
});

module.exports = router;
