# 把「一次打包、多环境运行」重放到完整 Yudao 项目

> 对应示例仓库：`vite-pkg-demo`（本仓库）
> 目标工程：`yudao-cip-web`（Vue 3 + Vite 8 + Element Plus）
> 相关文档（目标工程内）：
> - `/.github/README-PACKAGE-ONCE.md`
> - `/.github/TASKS/027-frontend-package-once-implementation.md`
> - `/.github/TASKS/028-nginx-cache-config.md`

---

## 1. 这个示例演示了什么

同一个 `dist` 产物，配合不同的 `config.js`，运行在 local / sit / uat / prod 四个环境：

```text
                 ┌─ dist/config.js ← deploy/config.local.js → localhost:4000
pnpm build ──▶ dist ─┼─ dist/config.js ← deploy/config.sit.js   → localhost:4001
（只执行一次）        ├─ dist/config.js ← deploy/config.uat.js   → localhost:4002
                 └─ dist/config.js ← deploy/config.prod.js  → localhost:4003
```

关键点：

1. `vite build` 只执行一次，产物中**不固化**环境地址；
2. 业务代码仍然写 `import.meta.env.VITE_*`，**不需要改任何业务组件**；
3. `index.html` 在入口模块之前加载 `/config.js`；
4. 部署时只替换 `dist/config.js`；
5. Nginx 为 `config.js` 增加一条精确匹配的 `no-store` 规则。

---

## 2. 重放前先理解三件事

### 2.1 `define` 的作用

Vite 默认会把 `import.meta.env.VITE_X` 在构建时替换成字面量。示例项目在 `vite.config.ts` 中覆盖为：

```ts
`((typeof window !== 'undefined' ? window.__APP_CONFIG__ : null)?.${key} ?? ${JSON.stringify(env[key] ?? '')})`
```

于是构建产物里不再是具体值，而是：

```js
window.__APP_CONFIG__?.VITE_BASE_URL ?? "构建期兜底值"
```

### 2.2 为什么标题不能再用 `%VITE_APP_TITLE%`

`index.html` 里的 `%VITE_APP_TITLE%` 也会被 `define` 替换成上面的读取表达式，导致 JS 执行前页面标题显示原始表达式。因此：

- `index.html` 中使用静态标题；
- `src/main.ts` 用 `import.meta.env.VITE_APP_TITLE` 在运行期覆盖。

### 2.3 为什么必须处理 Nginx 缓存

如果 Nginx 有 `location ~* \.(js|css)$` 强缓存规则，`config.js` 也会被缓存（示例目标工程内是一年 + immutable），换环境后不会生效。必须新增：

```nginx
location = /config.js {
    root /Apps/cip/html/dist;
    add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
    add_header Pragma "no-cache";
    add_header Expires "0";
}
```

完整说明见 `/.github/TASKS/028-nginx-cache-config.md`。

---

## 3. 文件级重放清单

| 文件 | 操作 | 预计改动 |
|---|---|---|
| `vite.config.ts` | 修改 | +25 行左右 |
| `index.html` | 修改 | +4 / -1 行 |
| `src/main.ts` | 修改 | +3 行 |
| `public/config.js` | 新增 | 1 个空模板 |
| `deploy/config.local.js` 等 4 个 | 新增 | 每个约 15 行 |
| `.env.prod` | 修改 | 2 行 |
| `Dockerfile`（若使用） | 修改 | 1 行 |
| Nginx 配置 | 修改 | +7 行 |

**不需要改**：`src/config/axios/config.ts`、登录页、上传组件、`webSocket/index.vue` 等任何业务文件。

---

## 4. 逐步操作

### 4.1 `vite.config.ts`

在导出函数内部、`loadEnv` 之后、`return {` 之前加入：

```ts
// 需要运行期可变的键；新增键时必须同步更新 deploy/config.<env>.js
const runtimeKeys = [
  'VITE_BASE_URL',
  'VITE_APP_TITLE',
  'VITE_APP_TENANT_ENABLE',
  'VITE_APP_CAPTCHA_ENABLE',
  'VITE_APP_DOCALERT_ENABLE',
  'VITE_APP_BAIDU_CODE',
  'VITE_BAIDU_MAP_KEY',
  'VITE_GOVIEW_URL',
  'VITE_MALL_H5_DOMAIN',
  'VITE_APP_API_ENCRYPT_ENABLE',
  'VITE_APP_API_ENCRYPT_HEADER',
  'VITE_APP_API_ENCRYPT_ALGORITHM',
  'VITE_APP_API_ENCRYPT_REQUEST_KEY',
  'VITE_APP_API_ENCRYPT_RESPONSE_KEY'
] as const

const runtimeDefine = Object.fromEntries(
  runtimeKeys.map((key) => [
    `import.meta.env.${key}`,
    `((typeof window !== 'undefined' ? window.__APP_CONFIG__ : null)?.${key} ?? ${JSON.stringify(env[key] ?? '')})`
  ])
)
```

然后在返回对象中加入一行：

```ts
return {
  base: env.VITE_BASE_PATH,
  define: runtimeDefine,   // ← 新增
  root: root,
  // ...其余保持原样
}
```

注意：

- Yudao 的 `vite.config.ts` 里 `env` 已经存在（来自 `loadEnv`），直接复用；
- 不要映射 `VITE_BASE_PATH`、`VITE_DROP_CONSOLE`、`VITE_SOURCEMAP`、`VITE_COMPRESS`、`VITE_OUT_DIR`、`DEV`、`PROD`；
- 使用 `??` 而不是 `||`，允许配置显式传空字符串；
- 必须使用三元 + `?.`，不要写成 `window.__APP_CONFIG__ && ... ?? ...`（`false ?? fallback` 会得到 `false`）。

### 4.2 `index.html`

把原来的：

```html
<title>%VITE_APP_TITLE%</title>
```

改成：

```html
<!-- 标题由 src/main.ts 在运行期覆盖；不要在这里使用 %VITE_APP_TITLE% -->
<title>芋道管理系统</title>
<!-- 运行期配置：必须在 module 入口之前加载，不能加 defer/async/type=module -->
<script src="/config.js"></script>
```

`config.js` 必须位于入口 `<script type="module" src="/src/main.ts">` 之前。

如果部署在子路径，把 `src` 改为 `%VITE_BASE_PATH%config.js`。

### 4.3 新增 `public/config.js`

```js
/**
 * 运行期配置模板。
 * - 构建时原样拷贝到 dist/config.js；
 * - 部署时用 deploy/config.<env>.js 整体覆盖；
 * - 所有值必须是字符串。
 */
window.__APP_CONFIG__ = {}
```

空对象表示本地开发回落到 `.env` / `.env.local`，行为与改造前一致。

### 4.4 `src/main.ts`

在 import 区域之后加入：

```ts
// 运行期标题：index.html 的标题是静态占位，这里用运行期配置覆盖它
document.title = import.meta.env.VITE_APP_TITLE || document.title
```

### 4.5 新增 `deploy/config.{local,sit,uat,prod}.js`

文件内容形如：

```js
window.__APP_CONFIG__ = {
  VITE_BASE_URL: 'http://10.1.2.3:48080',
  VITE_APP_TITLE: '某某管理系统（SIT）',
  VITE_APP_TENANT_ENABLE: 'true',
  VITE_APP_CAPTCHA_ENABLE: 'false',
  VITE_APP_DOCALERT_ENABLE: 'true',
  VITE_APP_BAIDU_CODE: '',
  VITE_BAIDU_MAP_KEY: '',
  VITE_GOVIEW_URL: 'http://10.1.2.9:3000',
  VITE_MALL_H5_DOMAIN: 'http://10.1.2.3:3000',
  VITE_APP_API_ENCRYPT_ENABLE: 'false',
  VITE_APP_API_ENCRYPT_HEADER: 'X-Api-Encrypt',
  VITE_APP_API_ENCRYPT_ALGORITHM: 'AES',
  VITE_APP_API_ENCRYPT_REQUEST_KEY: '',
  VITE_APP_API_ENCRYPT_RESPONSE_KEY: ''
}
```

要求：

- 全部是**字符串**（源码里有 `=== 'true'` / `!== 'false'` 比较）；
- 不使用 `export default`；
- 文件名固定为 `config.js` 的替换源，但仓库中可命名为 `config.<env>.js`；
- 不要提交真正的服务端秘密。

### 4.6 `.env.prod`

```ini
# 构建期留空，避免产物中残留旧地址
VITE_BASE_URL=''

# 输出目录统一为 dist
VITE_OUT_DIR=dist
```

`.env.stage` / `.env.test` 如果不再使用，可以保持不变；**发布只使用 `build:prod`**。

### 4.7 `Dockerfile`（仅当使用容器构建）

```dockerfile
COPY --from=build /app/dist /usr/share/nginx/html
```

### 4.8 Nginx

按第 2.3 节新增 `location = /config.js`，然后：

```bash
nginx -t
nginx -s reload
```

---

## 5. 本地开发

Yudao 的命令保持不变：

```bash
corepack pnpm dev     # vite --mode env.local
```

行为：

- `public/config.js` 是 `{}`；
- 所有运行期键回落到 `.env` / `.env.local`；
- `VITE_BASE_URL=''`，`/admin-api` 由 Vite 代理到 `localhost:48080`。

如果要验证运行期配置，可临时：

```bash
cp deploy/config.local.js public/config.js   # 验证后恢复
```

---

## 6. 构建与 CI 产物

### 6.1 构建（只执行一次）

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build:prod
```

产物：`dist/`。

自检：

```bash
ls -la dist/
grep -r 'localhost:48080' dist || echo "OK: no baked backend url"
grep -n 'config.js\|type="module"' dist/index.html
cat dist/config.js
```

### 6.2 CI 产物

```text
artifacts/
├─ frontend-dist-<git-sha>.tar.gz   # dist 的全部内容，与环境无关
├─ SHA256SUMS
├─ version.txt
└─ configs/
   ├─ config.local.js
   ├─ config.sit.js
   ├─ config.uat.js
   └─ config.prod.js
```

命令示例：

```bash
GIT_SHA="$(git rev-parse --short HEAD)"
mkdir -p artifacts/configs
tar -czf "artifacts/frontend-dist-${GIT_SHA}.tar.gz" -C dist .
cp deploy/config.local.js artifacts/configs/config.local.js
cp deploy/config.sit.js   artifacts/configs/config.sit.js
cp deploy/config.uat.js   artifacts/configs/config.uat.js
cp deploy/config.prod.js  artifacts/configs/config.prod.js
(cd artifacts && sha256sum frontend-dist-*.tar.gz configs/*.js > SHA256SUMS)
```

### 6.3 部署

```bash
# 同一份 dist 解包到目标目录（不要用 rsync --delete）
tar -xzf frontend-dist-<git-sha>.tar.gz -C /Apps/cip/html/dist

# 按目标环境覆盖配置
cp config.sit.js /Apps/cip/html/dist/config.js

# 验证
curl -I http://<host>/index.html
curl -I http://<host>/config.js
curl -I http://<host>/assets/<任意文件>.js
```

---

## 7. 验收清单

- [ ] `dist/index.html` 中 `config.js` 位于 module 入口之前；
- [ ] `dist/config.js` 存在；
- [ ] `grep -r 'localhost:48080' dist` 无结果；
- [ ] 同一份 `dist` 配 `config.sit.js`，标题 / 开关 / API 地址为 SIT 的值；
- [ ] 同一份 `dist` 配 `config.prod.js`，标题 / 开关 / API 地址为 PROD 的值；
- [ ] `pnpm dev` 行为与改造前一致；
- [ ] `curl -I /config.js` 返回 `no-store`；
- [ ] 未改任何业务组件。

---

## 8. 新增一个运行期配置键

1. 在 `vite.config.ts` 的 `runtimeKeys` 中增加键名；
2. 在 `deploy/config.{local,sit,uat,prod}.js` 中增加对应值；
3. 可选：在 `.env` / `.env.*` 中保留兜底值；
4. 重新构建并验证产物中出现 `window.__APP_CONFIG__` 读取。

只加 `.env`、不加 `runtimeKeys` → 该键仍然会在构建期固化。

---

## 9. 常见坑

| 坑 | 说明 |
|---|---|
| `index.html` 使用 `%VITE_APP_TITLE%` | 会被 `define` 替换成读取表达式，页面标题短暂显示原始表达式 |
| 写成 `import.meta.env[key]` | 动态下标不会被静态替换 |
| 使用 `\|\|` 做兜底 | 配置显式传空字符串时会被当成"没配" |
| 用 `&&` 链 + `??` | 非浏览器环境会得到 `false`，必须用三元 + `?.` |
| 构建机存在 `.env.local` | 其独有的键会进入产物，CI 必须使用干净检出 |
| 忘记 Nginx 的 `/config.js` 精确匹配 | `config.js` 被 js/css 强缓存命中，换环境不生效 |
| 部署使用 `rsync --delete` | 旧 `index.html` 仍引用旧 chunk，会出现 404 / 白屏 |
| `config.js` 值写成布尔 | 源码按字符串比较，布尔值会导致开关判断错误 |

---

## 10. 回滚

- **回滚配置**：把上一份 `config.js` 覆盖回去，无需重新构建或重启 Nginx。
- **回滚代码**：用上一份 `dist` 整体覆盖，并带上匹配的 `config.js`。
- **回滚改造**：删除 `define` 映射、`index.html` 的 `config.js`、`public/config.js`、`main.ts` 标题行，其余业务代码不受影响。
