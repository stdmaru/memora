<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AuthUser, Theme } from '../../types/domain'

const props = defineProps<{
  user: AuthUser
  theme: Theme
  themeError: string
  connectionStatus: string
  workspace: string
  project: string
  passwordBusy: boolean
  passwordError: string
  passwordMessage: string
}>()

const emit = defineEmits<{
  themeChange: [theme: Theme]
  changePassword: [passwords: { currentPassword: string; newPassword: string; passwordConfirmation: string }]
  logout: []
  openProjects: []
}>()

const currentPassword = ref('')
const newPassword = ref('')
const passwordConfirmation = ref('')
const canSubmitPassword = computed(() =>
  currentPassword.value.length > 0
  && newPassword.value.length >= 12
  && newPassword.value === passwordConfirmation.value
  && !props.passwordBusy,
)

watch(() => props.passwordMessage, message => {
  if (!message) return
  currentPassword.value = ''
  newPassword.value = ''
  passwordConfirmation.value = ''
})

function submitPassword() {
  if (!canSubmitPassword.value) return
  emit('changePassword', {
    currentPassword: currentPassword.value,
    newPassword: newPassword.value,
    passwordConfirmation: passwordConfirmation.value,
  })
}
</script>

<template>
  <section class="settings-page">
    <div class="settings-grid">
      <article class="settings-card appearance-card">
        <header>
          <span class="settings-icon violet">◐</span>
          <div><h2>Aparência</h2><p>Escolha como o Memora deve ser exibido.</p></div>
        </header>
        <fieldset class="theme-options">
          <legend>Tema</legend>
          <label :class="{ selected: theme === 'system' }">
            <input type="radio" name="theme" :checked="theme === 'system'" @change="emit('themeChange', 'system')">
            <span class="theme-option-icon">◒</span><span><strong>Sistema</strong><small>Usar a preferência do dispositivo</small></span>
          </label>
          <label :class="{ selected: theme === 'light' }">
            <input type="radio" name="theme" :checked="theme === 'light'" @change="emit('themeChange', 'light')">
            <span class="theme-option-icon">☼</span><span><strong>Claro</strong><small>Manter a interface clara</small></span>
          </label>
          <label :class="{ selected: theme === 'dark' }">
            <input type="radio" name="theme" :checked="theme === 'dark'" @change="emit('themeChange', 'dark')">
            <span class="theme-option-icon">◐</span><span><strong>Escuro</strong><small>Manter a interface escura</small></span>
          </label>
        </fieldset>
        <p v-if="themeError" class="settings-error" role="alert">{{ themeError }}</p>
      </article>

      <article class="settings-card account-card">
        <header>
          <span class="settings-icon orange">{{ user.name.trim().slice(0, 1).toUpperCase() }}</span>
          <div><h2>Conta</h2><p>Informações da conta autenticada neste painel.</p></div>
        </header>
        <dl class="account-details">
          <div><dt>Nome</dt><dd>{{ user.name }}</dd></div>
          <div><dt>E-mail</dt><dd>{{ user.email }}</dd></div>
          <div><dt>Perfil</dt><dd>Administrador</dd></div>
        </dl>
        <button class="settings-secondary" @click="emit('logout')">Sair da conta</button>
      </article>

      <article class="settings-card password-card">
        <header>
          <span class="settings-icon green">⌑</span>
          <div><h2>Segurança</h2><p>Atualize a senha usada para entrar no painel.</p></div>
        </header>
        <form class="password-form" @submit.prevent="submitPassword">
          <label>Senha atual
            <input v-model="currentPassword" type="password" autocomplete="current-password" maxlength="1024" required>
          </label>
          <label>Nova senha
            <input v-model="newPassword" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required>
            <small>Use pelo menos 12 caracteres.</small>
          </label>
          <label>Confirme a nova senha
            <input v-model="passwordConfirmation" type="password" autocomplete="new-password" maxlength="1024" required>
          </label>
          <p v-if="passwordError" class="settings-error" role="alert">{{ passwordError }}</p>
          <p v-if="passwordMessage" class="settings-success" role="status">{{ passwordMessage }}</p>
          <button class="settings-primary" type="submit" :disabled="!canSubmitPassword">
            {{ passwordBusy ? 'Atualizando…' : 'Alterar senha' }}
          </button>
        </form>
        <p class="security-help">Após a alteração, outras sessões da conta serão encerradas.</p>
      </article>

      <article class="settings-card connection-card">
        <header>
          <span class="settings-icon blue">⌘</span>
          <div><h2>Conexão e escopo</h2><p>Estado do serviço e projeto que será retomado.</p></div>
        </header>
        <dl class="account-details">
          <div><dt>Serviço ai-memory</dt><dd><span class="connection-dot" :class="{ connected: connectionStatus.startsWith('ai-memory') }"></span>{{ connectionStatus }}</dd></div>
          <div><dt>Workspace</dt><dd>{{ workspace || 'Nenhum selecionado' }}</dd></div>
          <div><dt>Projeto</dt><dd>{{ project || 'Nenhum selecionado' }}</dd></div>
        </dl>
        <p class="scope-help">O escopo atual é salvo automaticamente e selecionado na próxima vez que você entrar.</p>
        <button class="settings-secondary" @click="emit('openProjects')">Ver projetos</button>
        <p class="connection-help">Credenciais e endereço do serviço são configurados no servidor e não são expostos nesta interface.</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.settings-page { padding-bottom: 24px; }
.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
.settings-card { min-width: 0; border: 1px solid #e7e4df; border-radius: 10px; background: #fffefa; padding: 20px; }
.settings-card > header { display: flex; align-items: center; gap: 12px; margin-bottom: 19px; }
.settings-icon { display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 auto; border-radius: 10px; font: 16px 'DM Mono'; }
.settings-icon.violet { color: #635ddd; background: #edecfb; }
.settings-icon.orange { color: #c86a49; background: #fbece5; font: 600 14px 'DM Sans'; }
.settings-icon.green { color: #4e8c62; background: #e9f5e8; }
.settings-icon.blue { color: #5575b8; background: #eaf0fb; }
.settings-card h2 { margin: 0 0 4px; color: #37333e; font: 600 19px Fraunces, serif; }
.settings-card header p { margin: 0; color: #85808a; font-size: 11px; line-height: 1.5; }
.theme-options { display: grid; gap: 8px; border: 0; margin: 0; padding: 0; }
.theme-options legend { margin-bottom: 8px; color: #77717c; font-size: 11px; font-weight: 600; }
.theme-options label { display: flex; align-items: center; gap: 11px; min-width: 0; border: 1px solid #e9e6e2; border-radius: 7px; padding: 10px; cursor: pointer; }
.theme-options label.selected { border-color: #b7b3ed; background: #f5f4fc; }
.theme-options input { accent-color: #5d57dd; }
.theme-option-icon { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px; background: #f0eeea; color: #686271; font: 14px 'DM Mono'; }
.theme-options label > span:last-child { min-width: 0; }
.theme-options strong,.theme-options small { display: block; }
.theme-options strong { color: #45414b; font-size: 11px; }
.theme-options small { margin-top: 2px; color: #8b8690; font-size: 10px; }
.account-details { display: grid; gap: 0; margin: 0 0 17px; }
.account-details > div { display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px solid #eeece8; padding: 11px 0; font-size: 11px; }
.account-details > div:first-child { padding-top: 0; }
.account-details > div:last-child { border-bottom: 0; }
.account-details dt { color: #87818c; }
.account-details dd { min-width: 0; margin: 0; color: #4b4652; font-weight: 600; text-align: right; overflow-wrap: anywhere; }
.password-form { display: grid; gap: 12px; }
.password-form label { display: grid; gap: 6px; color: #68626f; font-size: 11px; font-weight: 600; }
.password-form input { width: 100%; border: 1px solid #dedbd8; border-radius: 6px; background: #fff; padding: 9px 10px; color: #393642; font-size: 12px; }
.password-form input:focus { border-color: #817be6; outline: 2px solid #817be633; }
.password-form label small { color: #8b8690; font-size: 10px; font-weight: 400; }
.settings-primary,.settings-secondary { width: fit-content; border-radius: 6px; padding: 8px 11px; font-size: 11px; font-weight: 600; }
.settings-primary { border: 0; background: #5d57dd; color: #fff; }
.settings-primary:disabled { cursor: not-allowed; opacity: .55; }
.settings-secondary { border: 1px solid #e2dfdb; background: #fff; color: #625d69; }
.settings-secondary:hover { background: #f5f3f0; }
.settings-error,.settings-success { margin: 0; border-radius: 6px; padding: 9px 10px; font-size: 11px; line-height: 1.45; }
.settings-error { border: 1px solid #f0d4cf; background: #fff5f3; color: #a34436; }
.settings-success { border: 1px solid #d7ead8; background: #f1f8f0; color: #43734b; }
.security-help,.scope-help,.connection-help { color: #89838d; font-size: 10px; line-height: 1.55; }
.security-help { margin: 12px 0 0; }
.scope-help { margin: -2px 0 13px; }
.connection-help { border-top: 1px solid #eeece8; margin: 14px 0 0; padding-top: 11px; }
.connection-dot { display: inline-block; width: 7px; height: 7px; margin-right: 7px; border-radius: 50%; background: #cc795f; vertical-align: 1px; }
.connection-dot.connected { background: #65a16b; }
@media (max-width: 760px) { .settings-grid { grid-template-columns: minmax(0, 1fr); } .settings-card { padding: 16px; } }
</style>
