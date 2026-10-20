/**
 * 模拟 Yudao 的 src/config/axios/config.ts：
 * 这里只做与运行期配置相关的读取，业务组件不需要改。
 */
export const apiBase = import.meta.env.VITE_BASE_URL + import.meta.env.VITE_API_URL

export const envName = import.meta.env.VITE_ENV_NAME
export const appTitle = import.meta.env.VITE_APP_TITLE
export const tenantEnabled = import.meta.env.VITE_APP_TENANT_ENABLE === 'true'
export const captchaEnabled = import.meta.env.VITE_APP_CAPTCHA_ENABLE === 'true'
