// 本机演练用：用 PGlite 冒充 db 容器里的 pg_dump / psql（本机没有 Docker 和 PostgreSQL）。
// 数据库就是 e2e 用的 PGlite 目录（REHEARSAL_DB），pg_dump 用 @electric-sql/pglite-tools（WASM 版 pg_dump）。
// 用法（由 fake-docker.sh 调用）：
//   node fake-pg.mjs dump            把数据库导出成 SQL，写到标准输出
//   node fake-pg.mjs recreate        删库重建（对应 DROP DATABASE / CREATE DATABASE）
//   node fake-pg.mjs load            从标准输入读 SQL 导入
//   node fake-pg.mjs count           打印各表行数（演练前后比对用）
// 依赖：PGLITE_TOOLS_DIR 指向装了 @electric-sql/pglite 和 @electric-sql/pglite-tools 的目录（见 README）
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = process.env.REHEARSAL_DB;
const tools = process.env.PGLITE_TOOLS_DIR;
if (!dir || !tools) throw new Error('需要 REHEARSAL_DB 和 PGLITE_TOOLS_DIR');
const mod = (p) => import(pathToFileURL(join(tools, 'node_modules', p)).href);
const { PGlite } = await mod('@electric-sql/pglite/dist/index.js');

async function stdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const cmd = process.argv[2];
if (cmd === 'recreate') {
  rmSync(dir, { recursive: true, force: true });
  const pg = new PGlite(dir);
  await pg.waitReady;
  await pg.close();
} else {
  const pg = new PGlite(dir);
  await pg.waitReady;
  if (cmd === 'dump') {
    const { pgDump } = await mod('@electric-sql/pglite-tools/dist/pg_dump.js');
    // PGlite 的 exec 不支持 COPY … FROM stdin，演练里改用 INSERT 语句导出；真实服务器上的 psql 两种都能导入
    const file = await pgDump({ pg, args: ['--no-owner', '--no-privileges', '--inserts'] });
    process.stdout.write(await file.text());
  } else if (cmd === 'load') {
    // psql 的元命令（以反斜杠开头的行，如 \restrict）PGlite 不认识，去掉
    const sql = (await stdin())
      .split('\n')
      .filter((l) => !l.startsWith('\\'))
      .join('\n');
    await pg.exec(sql);
  } else if (cmd === 'count') {
    const { rows } = await pg.query(
      `select table_schema || '.' || table_name as t from information_schema.tables
       where table_schema in ('public', 'drizzle') and table_type = 'BASE TABLE' order by 1`,
    );
    for (const { t } of rows) {
      const [{ n }] = (await pg.query(`select count(*)::int as n from ${t}`)).rows;
      console.log(`${t} ${n}`);
    }
  } else {
    throw new Error(`不认识的命令 ${cmd}`);
  }
  await pg.close();
}
