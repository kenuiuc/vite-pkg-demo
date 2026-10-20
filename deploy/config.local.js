/**
 * 本地运行期配置。
 * 用于构建产物 + 本地后端（4000）的验证。
 */
window.__APP_CONFIG__ = {
  VITE_ENV_NAME: 'local',
  VITE_BASE_URL: 'http://localhost:4000',
  VITE_API_URL: '/api',
  VITE_APP_TITLE: 'Vite Package Once Demo (local)',
  VITE_APP_TENANT_ENABLE: 'false',
  VITE_APP_CAPTCHA_ENABLE: 'true'
}
