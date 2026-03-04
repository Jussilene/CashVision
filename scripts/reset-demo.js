const fs = require("fs");
const path = require("path");

const dbBase = path.join(__dirname, "..", "data", "cashvision.sqlite");
const files = [dbBase, `${dbBase}-wal`, `${dbBase}-shm`];

let removed = 0;
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  try {
    fs.unlinkSync(file);
    removed += 1;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Falha ao remover ${file}: ${err.message}`);
    process.exitCode = 1;
  }
}

if (process.exitCode) {
  // eslint-disable-next-line no-console
  console.error("Nao foi possivel resetar totalmente. Feche o servidor e tente novamente.");
} else {
  // eslint-disable-next-line no-console
  console.log(`Reset concluido. Arquivos removidos: ${removed}`);
}
