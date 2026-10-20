import { createApp } from 'vue'
import App from './App.vue'

// 与 Yudao 项目一致：用运行期配置覆盖 index.html 里的静态标题
document.title = import.meta.env.VITE_APP_TITLE || document.title

createApp(App).mount('#app')
