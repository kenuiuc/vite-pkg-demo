<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchInfo, type InfoResponse } from './api/info'
import { apiBase, appTitle, captchaEnabled, envName, tenantEnabled } from './config/runtime'

const info = ref<InfoResponse | null>(null)
const error = ref('')
const loading = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    info.value = await fetchInfo()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <main>
    <h1 data-testid="title">{{ appTitle }}</h1>

    <section>
      <h2>Frontend runtime config</h2>
      <p>Environment: <strong data-testid="env-name">{{ envName }}</strong></p>
      <p>API base: <code data-testid="api-base">{{ apiBase }}</code></p>
      <p>Tenant enabled: <span data-testid="tenant">{{ tenantEnabled }}</span></p>
      <p>Captcha enabled: <span data-testid="captcha">{{ captchaEnabled }}</span></p>
    </section>

    <section>
      <h2>Backend response</h2>
      <button type="button" :disabled="loading" @click="load">
        {{ loading ? 'Loading...' : 'Reload' }}
      </button>
      <p v-if="error" data-testid="error">{{ error }}</p>
      <template v-else-if="info">
        <p>Backend env: <strong data-testid="api-env">{{ info.env }}</strong></p>
        <p>{{ info.message }}</p>
        <pre data-testid="api-result">{{ info }}</pre>
      </template>
      <p v-else>Loading...</p>
    </section>
  </main>
</template>

<style>
body {
  margin: 0;
  font-family: system-ui, sans-serif;
  color: #1f2937;
  background: #f8fafc;
}
main {
  max-width: 720px;
  margin: 40px auto;
  padding: 24px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 30px rgb(0 0 0 / 8%);
}
section {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #e5e7eb;
}
code,
pre {
  background: #f3f4f6;
  padding: 2px 6px;
  border-radius: 4px;
}
pre {
  padding: 12px;
  overflow: auto;
}
button {
  padding: 6px 12px;
  cursor: pointer;
}
</style>
