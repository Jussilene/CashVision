const { db } = require("../db");

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Nao autenticado" });
  }
  next();
}

function attachTenant(req, res, next) {
  const userId = Number(req.session.userId);
  const rawEmpresa = req.query.empresa_id || req.body.empresa_id || req.headers["x-empresa-id"] || req.session.empresaId;
  const empresaId = Number(rawEmpresa);

  if (!empresaId) {
    const first = db
      .prepare(
        `SELECT company_id
         FROM user_companies
         WHERE user_id = ?
         ORDER BY company_id ASC
         LIMIT 1`
      )
      .get(userId);
    if (!first) return res.status(403).json({ error: "Usuario sem empresa vinculada" });
    req.tenant = { userId, empresaId: Number(first.company_id) };
    req.session.empresaId = Number(first.company_id);
    return next();
  }

  const allowed = db
    .prepare("SELECT 1 FROM user_companies WHERE user_id = ? AND company_id = ?")
    .get(userId, empresaId);
  if (!allowed) return res.status(403).json({ error: "Empresa nao autorizada para esse usuario" });

  req.tenant = { userId, empresaId };
  req.session.empresaId = empresaId;
  next();
}

module.exports = {
  requireAuth,
  attachTenant
};
