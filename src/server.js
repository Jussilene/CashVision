const fs = require("fs");
const path = require("path");
const express = require("express");
const session = require("express-session");
const { migrate } = require("./db");

const authRoutes = require("./routes/auth.routes");
const cashvisionRoutes = require("./routes/cashvision.routes");
const billingRoutes = require("./routes/billing.routes");
const integracoesRoutes = require("./routes/integracoes.routes");

const app = express();
const PORT = process.env.PORT || 3105;

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

migrate();

app.use(express.json({ limit: "2mb" }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "cashvision-secret-dev",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 12
    }
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/cashvision", cashvisionRoutes);
app.use("/api/cashvision-billing", billingRoutes);
app.use("/api/cashvision-integracoes", integracoesRoutes);

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "cashvision", date: new Date().toISOString() });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`CashVision online em http://localhost:${PORT}`);
});
