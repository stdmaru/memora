<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

const emit = defineEmits<{ continue: [] }>()
const name = ref('')
const email = ref('')
const password = ref('')
const passwordConfirmation = ref('')
const busy = ref(false)
const error = ref('')
const created = ref(false)
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
function applyTheme() {
  const theme = systemTheme.matches ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}
function onSystemThemeChange() { applyTheme() }
systemTheme.addEventListener('change', onSystemThemeChange)
applyTheme()
onBeforeUnmount(() => systemTheme.removeEventListener('change', onSystemThemeChange))
const canSubmit = computed(() => name.value.trim() && email.value.trim() && password.value.length >= 12 && password.value === passwordConfirmation.value && !busy.value)

async function createAdmin() {
  if (!canSubmit.value) return
  busy.value = true
  error.value = ''
  try {
    const response = await fetch('/api/manager/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.value, email: email.value, password: password.value, passwordConfirmation: passwordConfirmation.value }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || `Erro HTTP ${response.status}`)
    created.value = true
    password.value = ''
    passwordConfirmation.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Não foi possível criar a conta de administrador.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="setup-screen">
    <section class="setup-card" aria-labelledby="setup-title">
      <a class="setup-brand" href="#"><span class="setup-mark">m</span><span>memora</span></a>
      <template v-if="!created">
        <p class="setup-kicker">Primeiro acesso · configuração inicial</p>
        <h1 id="setup-title">Vamos preparar seu espaço.</h1>
        <p class="setup-copy">Crie a primeira conta de administrador. Ela será a responsável por gerenciar o painel.</p>
        <form class="setup-form" @submit.prevent="createAdmin">
          <label>Seu nome<input v-model="name" autocomplete="name" maxlength="80" required placeholder="Como devemos chamar você?"></label>
          <label>E-mail<input v-model="email" type="email" autocomplete="email" maxlength="254" required placeholder="voce@exemplo.com"></label>
          <label>Senha<input v-model="password" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required placeholder="Pelo menos 12 caracteres"><small>Use uma senha longa e exclusiva para este painel.</small></label>
          <label>Confirme a senha<input v-model="passwordConfirmation" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required placeholder="Digite a senha novamente"><small v-if="passwordConfirmation && password !== passwordConfirmation" class="setup-mismatch">As senhas não coincidem.</small></label>
          <p v-if="error" class="setup-error" role="alert">{{ error }}</p>
          <button class="setup-submit" type="submit" :disabled="!canSubmit">{{ busy ? 'Criando conta…' : 'Criar conta de administrador' }}</button>
        </form>
        <p class="setup-security">A senha será armazenada como um hash criptográfico no banco local — nunca em texto puro.</p>
      </template>
      <template v-else>
        <p class="setup-kicker">Configuração concluída</p>
        <h1 id="setup-title">Sua conta está pronta.</h1>
        <p class="setup-copy">A conta de administrador foi salva com segurança. O próximo passo do projeto será habilitar o login e proteger o painel.</p>
        <div class="setup-account"><span class="setup-avatar">{{ name.trim().slice(0, 1).toUpperCase() }}</span><span><strong>{{ name }}</strong><small>{{ email }}</small></span><b>ADMIN</b></div>
        <button class="setup-submit" @click="emit('continue')">Continuar para o painel</button>
        <p class="setup-security setup-warning">Até o sistema de autenticação ficar pronto, mantenha o painel acessível somente em ambiente local confiável; não o exponha pela VPN.</p>
      </template>
    </section>
    <footer class="setup-footer">Memora <span>·</span> sua memória compartilhada, organizada.</footer>
  </main>
</template>

<style scoped>
.setup-screen{min-height:100vh;display:grid;place-items:center;padding:35px 20px;background:radial-gradient(ellipse at 50% 0%,#eeedff 0,transparent 50%),#f7f6f2;color:#302d39}.setup-card{width:min(100%,460px);padding:38px 40px 30px;border:1px solid #e8e4df;border-radius:16px;background:#fffefa;box-shadow:0 22px 70px #35304712}.setup-brand{display:flex;align-items:center;gap:9px;margin-bottom:37px;color:#2e2b39;font:600 23px Fraunces,serif;text-decoration:none}.setup-mark{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:#5e58e9;color:#fff;font:18px 'DM Mono';transform:rotate(-7deg)}.setup-kicker{margin:0 0 10px;color:#706bd0;font:10px 'DM Mono';letter-spacing:1px;text-transform:uppercase}.setup-card h1{margin:0;color:#302d39;font:600 31px/1.2 Fraunces,serif;letter-spacing:-.7px}.setup-copy{margin:11px 0 25px;color:#77717d;font-size:13px;line-height:1.65}.setup-form{display:grid;gap:15px}.setup-form label{display:grid;gap:7px;color:#514c59;font-size:11px;font-weight:600}.setup-form input{width:100%;height:42px;padding:0 12px;border:1px solid #e4e0e5;border-radius:7px;outline:none;background:#fff;color:#302d39;font-size:12px}.setup-form input:focus{border-color:#827ce3;box-shadow:0 0 0 3px #756fe31c}.setup-form input::placeholder{color:#aaa5ae;font-weight:400}.setup-form small{color:#948e99;font-size:10px;font-weight:400}.setup-form .setup-mismatch{color:#b54844}.setup-submit{width:100%;min-height:43px;margin-top:3px;border:0;border-radius:7px;background:#5d57dd;color:white;font-size:12px;font-weight:600;box-shadow:0 5px 12px #5d57dd2e}.setup-submit:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}.setup-error{margin:0;padding:10px 12px;border:1px solid #f0d8d5;border-radius:7px;background:#fff5f4;color:#a93e3e;font-size:11px}.setup-security{margin:17px 0 0;color:#938d97;font-size:10px;line-height:1.6}.setup-warning{padding-top:12px;border-top:1px solid #eee9e4;color:#a46145}.setup-account{display:flex;align-items:center;gap:11px;margin:22px 0;padding:13px;border:1px solid #ebe7e2;border-radius:9px;background:#fbfaf7}.setup-avatar{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#e8e6fb;color:#615bd4;font:600 14px Fraunces,serif}.setup-account>span:nth-child(2){display:grid;gap:2px;min-width:0;flex:1}.setup-account strong{overflow:hidden;color:#47424f;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.setup-account small{color:#8f8994;font-size:10px}.setup-account>b{color:#6b65c8;font:9px 'DM Mono';letter-spacing:.4px}.setup-footer{position:fixed;bottom:18px;color:#a49ea8;font-size:10px}.setup-footer span{padding:0 4px;color:#d08c70}:global(:root[data-theme='dark']) .setup-screen{background:radial-gradient(ellipse at 50% 0%,#302c4a 0,transparent 50%),#19181f;color:#eeeaf1}:global(:root[data-theme='dark']) .setup-card{border-color:#393642;background:#24222b;box-shadow:0 22px 70px #0004}:global(:root[data-theme='dark']) .setup-brand,:global(:root[data-theme='dark']) .setup-card h1{color:#eeeaf1}:global(:root[data-theme='dark']) .setup-copy,:global(:root[data-theme='dark']) .setup-form label{color:#c1bbc8}:global(:root[data-theme='dark']) .setup-form input{border-color:#484452;background:#1e1c24;color:#f0ecf2}:global(:root[data-theme='dark']) .setup-form input::placeholder{color:#8e8896}:global(:root[data-theme='dark']) .setup-account{border-color:#3a3743;background:#2b2933}:global(:root[data-theme='dark']) .setup-account strong{color:#eeeaf1}:global(:root[data-theme='dark']) .setup-account small,:global(:root[data-theme='dark']) .setup-security{color:#aaa3b1}:global(:root[data-theme='dark']) .setup-warning{border-color:#423842;color:#e6a18a}@media(max-width:520px){.setup-screen{padding:20px 14px 60px}.setup-card{padding:28px 22px 24px}.setup-brand{margin-bottom:29px}.setup-card h1{font-size:27px}}
</style>
