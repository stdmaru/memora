<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{ login: [] }>()
defineProps<{ message?: string }>()
const email = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')

async function login() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const response = await fetch('/api/manager/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.value, password: password.value }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || `Erro HTTP ${response.status}`)
    password.value = ''
    emit('login')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Não foi possível entrar.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="login-screen">
    <section class="login-card" aria-labelledby="login-title">
      <a class="login-brand" href="#"><span class="login-mark">m</span><span>memora</span></a>
      <p class="login-kicker">Acesso seguro</p>
      <h1 id="login-title">Entre na sua conta.</h1>
      <p class="login-copy">Use as credenciais de administrador configuradas neste painel.</p>
      <form class="login-form" @submit.prevent="login">
        <label>E-mail<input v-model="email" type="email" autocomplete="username" maxlength="254" required autofocus placeholder="voce@exemplo.com"></label>
        <label>Senha<input v-model="password" type="password" autocomplete="current-password" maxlength="1024" required placeholder="Sua senha"></label>
        <p v-if="error || message" class="login-error" role="alert">{{ error || message }}</p>
        <button class="login-submit" type="submit" :disabled="busy">{{ busy ? 'Entrando…' : 'Entrar' }}</button>
      </form>
    </section>
    <footer class="login-footer">Memora <span>·</span> sua memória compartilhada, organizada.</footer>
  </main>
</template>

<style>
.login-screen{min-height:100vh;display:grid;place-items:center;padding:35px 20px;background:radial-gradient(ellipse at 50% 0%,#eeedff 0,transparent 50%),#f7f6f2;color:#302d39}
.login-card{width:min(100%,420px);padding:38px 40px 34px;border:1px solid #e8e4df;border-radius:16px;background:#fffefa;box-shadow:0 22px 70px #35304712}
.login-brand{display:flex;align-items:center;gap:9px;margin-bottom:37px;color:#2e2b39;font:600 23px Fraunces,serif;text-decoration:none}
.login-mark{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:#5e58e9;color:#fff;font:18px 'DM Mono';transform:rotate(-7deg)}
.login-kicker{margin:0 0 10px;color:#706bd0;font:10px 'DM Mono';letter-spacing:1px;text-transform:uppercase}
.login-card h1{margin:0;color:#302d39;font:600 31px/1.2 Fraunces,serif;letter-spacing:-.7px}
.login-copy{margin:11px 0 25px;color:#77717d;font-size:13px;line-height:1.65}
.login-form{display:grid;gap:15px}
.login-form label{display:grid;gap:7px;color:#514c59;font-size:11px;font-weight:600}
.login-form input{width:100%;height:42px;padding:0 12px;border:1px solid #e4e0e5;border-radius:7px;outline:none;background:#fff;color:#302d39;font-size:12px}
.login-form input:focus{border-color:#827ce3;box-shadow:0 0 0 3px #756fe31c}
.login-form input::placeholder{color:#aaa5ae;font-weight:400}
.login-submit{width:100%;min-height:43px;margin-top:3px;border:0;border-radius:7px;background:#5d57dd;color:white;font-size:12px;font-weight:600;box-shadow:0 5px 12px #5d57dd2e}
.login-submit:disabled{opacity:.55;cursor:wait}
.login-error{margin:0;padding:10px 12px;border:1px solid #f0d8d5;border-radius:7px;background:#fff5f4;color:#a93e3e;font-size:11px}
.login-footer{position:fixed;bottom:18px;color:#a49ea8;font-size:10px}
.login-footer span{padding:0 4px;color:#d08c70}
:root[data-theme='dark'] .login-screen{background:radial-gradient(ellipse at 50% 0%,#302c4a 0,transparent 50%),#19181f;color:#eeeaf1}
:root[data-theme='dark'] .login-card{border-color:#393642;background:#24222b;box-shadow:0 22px 70px #0004}
:root[data-theme='dark'] .login-brand,:root[data-theme='dark'] .login-card h1{color:#eeeaf1}
:root[data-theme='dark'] .login-copy,:root[data-theme='dark'] .login-form label{color:#c1bbc8}
:root[data-theme='dark'] .login-form input{border-color:#484452;background:#1e1c24;color:#f0ecf2}
:root[data-theme='dark'] .login-form input::placeholder{color:#8e8896}
@media(max-width:520px){.login-screen{padding:20px 14px 60px}.login-card{padding:28px 22px 24px}.login-brand{margin-bottom:29px}.login-card h1{font-size:27px}}
</style>
