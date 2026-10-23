# 耕云

技术方案见 [docs/TECH-PLAN.md](docs/TECH-PLAN.md)。

## 本机运行

需要 Node.js 24。

```sh
npm install
# 写入演示账号（虚构数据，只用于本机和预览环境）
DEMO_PASSWORD=<自定义密码> npm run seed:demo -w @genyun/api
npm run dev:api   # 后端 http://localhost:3000/api
npm run dev:web   # 前端 http://localhost:5173
```

演示账号：`admin@demo.genyun.net.cn`（客户机构管理员）、`expert@demo.genyun.net.cn`（专业人员）、`ops@demo.genyun.net.cn`（运营管理员）。

## 检查

```sh
npm run typecheck
npm test                         # 单元测试与越权测试
npx playwright install chromium  # 首次运行端到端测试前
npm run e2e                      # 浏览器端到端测试
```

## 目录

- `apps/web`：客户、专家、运营三个工作区（React + Ant Design 6）
- `apps/api`：后端接口（NestJS + Drizzle）
- `packages/shared`：前后端共用的规则（角色、字段校验）
- `e2e`：浏览器端到端测试
