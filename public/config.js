/**
 * 运行期配置模板。
 * - 构建时原样拷贝到 dist/config.js；
 * - 部署时用 deploy/config.<env>.js 整体覆盖；
 * - 所有值必须是字符串。
 */
window.__APP_CONFIG__ = {}
