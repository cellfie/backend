import fs from "fs/promises"
import path from "path"
import pool from "../src/db.js"

const fileArg = process.argv[2]

if (!fileArg) {
  console.error("Uso: node scripts/run-sql-file.js <ruta-relativa-al-backend>")
  process.exit(1)
}

const absPath = path.resolve(process.cwd(), fileArg)

const main = async () => {
  const sqlRaw = await fs.readFile(absPath, "utf8")

  // Este split es suficiente para tus migraciones actuales (no hay strings con ';')
  const statements = sqlRaw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !s.startsWith("--"))

  let okCount = 0

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]
    if (!stmt) continue
    await pool.query(stmt)
    okCount++
  }

  console.log(`Migración ejecutada: ${okCount} sentencias OK`)
}

main()
  .then(async () => {
    try {
      if (pool?.end) await pool.end()
    } catch {
      // noop
    }
  })
  .catch(async (err) => {
    console.error("Error ejecutando migración:", err?.message || err)
    try {
      if (pool?.end) await pool.end()
    } catch {
      // noop
    }
    process.exit(1)
  })

