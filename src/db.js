const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const dbPath = path.join(__dirname, "..", "data", "cashvision.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function hasColumn(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

function migrate() {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS user_companies (
      user_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, company_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS cv_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_user_id INTEGER NOT NULL,
      empresa_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('BANCO','CAIXA','OUTROS')),
      saldo_inicial REAL NOT NULL DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS cv_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_user_id INTEGER NOT NULL,
      empresa_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('RECEITA','DESPESA','MISTA')),
      ordem INTEGER NOT NULL DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS cv_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_user_id INTEGER NOT NULL,
      empresa_id INTEGER NOT NULL,
      account_id INTEGER,
      category_id INTEGER,
      tipo TEXT NOT NULL CHECK (tipo IN ('RECEITA','DESPESA','TRANSFERENCIA')),
      status TEXT NOT NULL CHECK (status IN ('REALIZADO','PREVISTO')),
      data_competencia TEXT NOT NULL,
      data_caixa TEXT,
      valor REAL NOT NULL,
      descricao TEXT,
      tags TEXT,
      documento_ref TEXT,
      ref_type TEXT,
      ref_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES cv_accounts(id),
      FOREIGN KEY (category_id) REFERENCES cv_categories(id)
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS cv_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_user_id INTEGER NOT NULL,
      empresa_id INTEGER NOT NULL,
      from_account_id INTEGER NOT NULL,
      to_account_id INTEGER NOT NULL,
      data TEXT NOT NULL,
      valor REAL NOT NULL,
      descricao TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (from_account_id) REFERENCES cv_accounts(id),
      FOREIGN KEY (to_account_id) REFERENCES cv_accounts(id)
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS cv_customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_user_id INTEGER NOT NULL,
      empresa_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      documento TEXT,
      email TEXT,
      telefone TEXT,
      endereco TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS cv_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_user_id INTEGER NOT NULL,
      empresa_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      numero INTEGER NOT NULL,
      data_emissao TEXT NOT NULL,
      data_vencimento TEXT NOT NULL,
      valor_total REAL NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ABERTO','PAGO','ATRASADO','CANCELADO')) DEFAULT 'ABERTO',
      observacoes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES cv_customers(id)
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS cv_invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      descricao TEXT NOT NULL,
      qtd REAL NOT NULL,
      valor_unit REAL NOT NULL,
      valor_total REAL NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES cv_invoices(id) ON DELETE CASCADE
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS fluxonf_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_user_id INTEGER NOT NULL,
      empresa_id INTEGER NOT NULL,
      numero TEXT NOT NULL,
      tipo TEXT NOT NULL,
      data_emissao TEXT NOT NULL,
      valor REAL NOT NULL,
      documento_ref TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ).run();

  db.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_cv_invoices_numero_empresa
    ON cv_invoices (tenant_user_id, empresa_id, numero)`
  ).run();
  db.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_cv_tx_ref_unique
    ON cv_transactions (tenant_user_id, empresa_id, ref_type, ref_id)
    WHERE ref_type IS NOT NULL AND ref_id IS NOT NULL`
  ).run();

  if (!hasColumn("cv_transfers", "created_at")) {
    db.prepare(
      "ALTER TABLE cv_transfers ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))"
    ).run();
  }

  let user = db.prepare("SELECT id FROM users WHERE email = ?").get("admin@cashvision.local");
  if (!user) {
    const passwordHash = bcrypt.hashSync("123456", 10);
    const userInfo = db
      .prepare("INSERT INTO users (nome, email, password_hash) VALUES (?, ?, ?)")
      .run("Administrador", "admin@cashvision.local", passwordHash);
    user = { id: Number(userInfo.lastInsertRowid) };
  }

  let company = db.prepare("SELECT id FROM companies WHERE nome = ?").get("Empresa Demo");
  if (!company) {
    const companyInfo = db.prepare("INSERT INTO companies (nome) VALUES (?)").run("Empresa Demo");
    company = { id: Number(companyInfo.lastInsertRowid) };
  }

  db.prepare("INSERT OR IGNORE INTO user_companies (user_id, company_id) VALUES (?, ?)")
    .run(user.id, company.id);

  seedDemoData(user.id, company.id);
}

function seedDemoData(userId, empresaId) {
  const accountCount = db
    .prepare("SELECT COUNT(*) AS n FROM cv_accounts WHERE tenant_user_id = ? AND empresa_id = ?")
    .get(userId, empresaId).n;
  if (accountCount === 0) {
    db.prepare(
      `INSERT INTO cv_accounts (tenant_user_id, empresa_id, nome, tipo, saldo_inicial)
       VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`
    ).run(
      userId, empresaId, "Banco Principal", "BANCO", 12500,
      userId, empresaId, "Caixa", "CAIXA", 1800,
      userId, empresaId, "Conta PIX", "OUTROS", 2400
    );
  }

  const categoryCount = db
    .prepare("SELECT COUNT(*) AS n FROM cv_categories WHERE tenant_user_id = ? AND empresa_id = ?")
    .get(userId, empresaId).n;
  if (categoryCount === 0) {
    db.prepare(
      `INSERT INTO cv_categories (tenant_user_id, empresa_id, nome, tipo, ordem)
       VALUES
       (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?),
       (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`
    ).run(
      userId, empresaId, "Servicos contabeis", "RECEITA", 1,
      userId, empresaId, "Mensalidades", "RECEITA", 2,
      userId, empresaId, "Folha de pagamento", "DESPESA", 3,
      userId, empresaId, "Impostos", "DESPESA", 4,
      userId, empresaId, "Marketing", "DESPESA", 5,
      userId, empresaId, "Operacional", "MISTA", 6
    );
  }

  const accounts = db
    .prepare(
      `SELECT id, nome
       FROM cv_accounts
       WHERE tenant_user_id = ? AND empresa_id = ?
       ORDER BY id`
    )
    .all(userId, empresaId);
  const categories = db
    .prepare(
      `SELECT id, nome
       FROM cv_categories
       WHERE tenant_user_id = ? AND empresa_id = ?
       ORDER BY id`
    )
    .all(userId, empresaId);

  const accountByName = Object.fromEntries(accounts.map((a) => [a.nome, a.id]));
  const categoryByName = Object.fromEntries(categories.map((c) => [c.nome, c.id]));

  const txCount = db
    .prepare("SELECT COUNT(*) AS n FROM cv_transactions WHERE tenant_user_id = ? AND empresa_id = ?")
    .get(userId, empresaId).n;
  if (txCount === 0) {
    db.prepare(
      `INSERT INTO cv_transactions
       (tenant_user_id, empresa_id, account_id, category_id, tipo, status, data_competencia, data_caixa, valor, descricao, tags, documento_ref, updated_at)
       VALUES
       (?, ?, ?, ?, 'RECEITA', 'REALIZADO', date('now','-25 day'), date('now','-25 day'), 4800, 'Plano mensal - Cliente Alpha', 'demo,recorrente', NULL, datetime('now')),
       (?, ?, ?, ?, 'RECEITA', 'REALIZADO', date('now','-19 day'), date('now','-19 day'), 2750, 'Consultoria tributaria', 'demo,servico', NULL, datetime('now')),
       (?, ?, ?, ?, 'DESPESA', 'REALIZADO', date('now','-18 day'), date('now','-18 day'), 1900, 'Folha - pro labore', 'demo,pessoal', NULL, datetime('now')),
       (?, ?, ?, ?, 'DESPESA', 'REALIZADO', date('now','-15 day'), date('now','-15 day'), 620, 'Campanha de anuncios', 'demo,marketing', NULL, datetime('now')),
       (?, ?, ?, ?, 'DESPESA', 'REALIZADO', date('now','-11 day'), date('now','-11 day'), 740, 'DAS mensal', 'demo,imposto', NULL, datetime('now')),
       (?, ?, ?, ?, 'RECEITA', 'REALIZADO', date('now','-8 day'), date('now','-8 day'), 5300, 'Fechamento contabil - lote abril', 'demo,servico', NULL, datetime('now')),
       (?, ?, ?, ?, 'DESPESA', 'PREVISTO', date('now','+5 day'), NULL, 1450, 'Folha prevista (proxima quinzena)', 'demo,previsto', NULL, datetime('now')),
       (?, ?, ?, ?, 'RECEITA', 'PREVISTO', date('now','+7 day'), NULL, 6100, 'Recebimento previsto carteira', 'demo,previsto', NULL, datetime('now'))`
    ).run(
      userId, empresaId, accountByName["Banco Principal"], categoryByName["Mensalidades"],
      userId, empresaId, accountByName["Conta PIX"], categoryByName["Servicos contabeis"],
      userId, empresaId, accountByName["Banco Principal"], categoryByName["Folha de pagamento"],
      userId, empresaId, accountByName["Conta PIX"], categoryByName["Marketing"],
      userId, empresaId, accountByName["Banco Principal"], categoryByName["Impostos"],
      userId, empresaId, accountByName["Banco Principal"], categoryByName["Servicos contabeis"],
      userId, empresaId, accountByName["Banco Principal"], categoryByName["Folha de pagamento"],
      userId, empresaId, accountByName["Conta PIX"], categoryByName["Mensalidades"]
    );
  }

  const transferCount = db
    .prepare("SELECT COUNT(*) AS n FROM cv_transfers WHERE tenant_user_id = ? AND empresa_id = ?")
    .get(userId, empresaId).n;
  if (transferCount === 0) {
    const transferInfo = db
      .prepare(
        `INSERT INTO cv_transfers
         (tenant_user_id, empresa_id, from_account_id, to_account_id, data, valor, descricao)
         VALUES (?, ?, ?, ?, date('now','-6 day'), 950, 'Reforco de caixa')`
      )
      .run(userId, empresaId, accountByName["Banco Principal"], accountByName["Caixa"]);

    const transferId = Number(transferInfo.lastInsertRowid);
    db.prepare(
      `INSERT INTO cv_transactions
       (tenant_user_id, empresa_id, account_id, tipo, status, data_competencia, data_caixa, valor, descricao, tags, ref_type, ref_id, updated_at)
       VALUES
       (?, ?, ?, 'TRANSFERENCIA', 'REALIZADO', date('now','-6 day'), date('now','-6 day'), 950, 'Transferencia para caixa', 'demo,transferencia', 'TRANSFER_OUT', ?, datetime('now')),
       (?, ?, ?, 'TRANSFERENCIA', 'REALIZADO', date('now','-6 day'), date('now','-6 day'), 950, 'Transferencia recebida do banco', 'demo,transferencia', 'TRANSFER_IN', ?, datetime('now'))`
    ).run(
      userId, empresaId, accountByName["Banco Principal"], transferId,
      userId, empresaId, accountByName["Caixa"], transferId
    );
  }

  const customerCount = db
    .prepare("SELECT COUNT(*) AS n FROM cv_customers WHERE tenant_user_id = ? AND empresa_id = ?")
    .get(userId, empresaId).n;
  if (customerCount === 0) {
    db.prepare(
      `INSERT INTO cv_customers
       (tenant_user_id, empresa_id, nome, documento, email, telefone, endereco)
       VALUES
       (?, ?, 'Alpha Comercio LTDA', '12.345.678/0001-90', 'financeiro@alpha.com', '(11) 98888-1111', 'Rua das Flores, 120'),
       (?, ?, 'Beta Servicos ME', '98.765.432/0001-11', 'contato@betaservicos.com', '(11) 97777-2222', 'Av. Brasil, 885'),
       (?, ?, 'Clinica Vida Integrada', '55.111.999/0001-03', 'adm@clinicavida.com', '(11) 96666-3333', 'Rua Sao Bento, 44'),
       (?, ?, 'Loja Horizonte', '44.222.333/0001-77', 'fiscal@horizonte.com', '(11) 95555-4444', 'Alameda Norte, 451')`
    ).run(
      userId, empresaId,
      userId, empresaId,
      userId, empresaId,
      userId, empresaId
    );
  }

  const invoiceCount = db
    .prepare("SELECT COUNT(*) AS n FROM cv_invoices WHERE tenant_user_id = ? AND empresa_id = ?")
    .get(userId, empresaId).n;
  if (invoiceCount === 0) {
    const customers = db
      .prepare(
        `SELECT id, nome
         FROM cv_customers
         WHERE tenant_user_id = ? AND empresa_id = ?
         ORDER BY id`
      )
      .all(userId, empresaId);
    const cByName = Object.fromEntries(customers.map((c) => [c.nome, c.id]));

    const insertInvoice = db.prepare(
      `INSERT INTO cv_invoices
       (tenant_user_id, empresa_id, customer_id, numero, data_emissao, data_vencimento, valor_total, status, observacoes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    );
    const insertItem = db.prepare(
      `INSERT INTO cv_invoice_items (invoice_id, descricao, qtd, valor_unit, valor_total)
       VALUES (?, ?, ?, ?, ?)`
    );

    const inv1 = insertInvoice.run(
      userId, empresaId, cByName["Alpha Comercio LTDA"], 1001, "2026-02-03", "2026-02-10", 3200, "PAGO",
      "Pacote mensal contabil"
    );
    insertItem.run(inv1.lastInsertRowid, "Honorario mensal", 1, 2800, 2800);
    insertItem.run(inv1.lastInsertRowid, "Suporte fiscal", 1, 400, 400);

    const inv2 = insertInvoice.run(
      userId, empresaId, cByName["Beta Servicos ME"], 1002, "2026-02-15", "2026-02-22", 1850, "ABERTO",
      "Consultoria de regularizacao"
    );
    insertItem.run(inv2.lastInsertRowid, "Consultoria", 5, 370, 1850);

    const inv3 = insertInvoice.run(
      userId, empresaId, cByName["Clinica Vida Integrada"], 1003, "2026-01-08", "2026-01-18", 2400, "ATRASADO",
      "Fechamento mensal e folha"
    );
    insertItem.run(inv3.lastInsertRowid, "Servicos contabeis", 1, 2400, 2400);

    const inv4 = insertInvoice.run(
      userId, empresaId, cByName["Loja Horizonte"], 1004, "2026-02-20", "2026-02-28", 990, "CANCELADO",
      "Cancelada por revisao comercial"
    );
    insertItem.run(inv4.lastInsertRowid, "Analise fiscal", 1, 990, 990);

    db.prepare(
      `INSERT OR IGNORE INTO cv_transactions
       (tenant_user_id, empresa_id, account_id, category_id, tipo, status, data_competencia, data_caixa, valor, descricao, tags, documento_ref, ref_type, ref_id, updated_at)
       VALUES (?, ?, ?, ?, 'RECEITA', 'REALIZADO', '2026-02-03', '2026-02-10', 3200, 'Recebimento fatura #1001 - Alpha Comercio LTDA', 'invoice:demo', NULL, 'INVOICE', ?, datetime('now'))`
    ).run(
      userId,
      empresaId,
      accountByName["Banco Principal"],
      categoryByName["Mensalidades"],
      inv1.lastInsertRowid
    );
  }

  const noteCount = db
    .prepare("SELECT COUNT(*) AS n FROM fluxonf_notes WHERE tenant_user_id = ? AND empresa_id = ?")
    .get(userId, empresaId).n;
  if (noteCount === 0) {
    db.prepare(
      `INSERT INTO fluxonf_notes (tenant_user_id, empresa_id, numero, tipo, data_emissao, valor, documento_ref)
       VALUES
       (?, ?, 'NF-1001', 'NFS-e EMITIDA', date('now','-5 day'), 3200.00, 'fluxonf://docs/nf-1001.pdf'),
       (?, ?, 'NF-2209', 'NFS-e TOMADA', date('now','-2 day'), 890.00, 'fluxonf://docs/nf-2209.pdf'),
       (?, ?, 'NF-3310', 'NFS-e EMITIDA', date('now','-1 day'), 1450.00, 'fluxonf://docs/nf-3310.pdf'),
       (?, ?, 'NF-4478', 'NFS-e TOMADA', date('now','-9 day'), 610.00, 'fluxonf://docs/nf-4478.pdf')`
    ).run(
      userId, empresaId,
      userId, empresaId,
      userId, empresaId,
      userId, empresaId
    );
  }
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  db,
  migrate,
  nowIso
};
