<script setup lang="ts">
import type { TrashEntry } from '../../types/domain'

defineProps<{
  entries: TrashEntry[]
  loading: boolean
  error: string
  message: string
  formatDate: (value?: string | null) => string
}>()

const emit = defineEmits<{
  refresh: []
  restore: [entry: TrashEntry]
}>()
</script>

<template>
  <div class="trash-page">
    <header class="trash-intro">
      <div>
        <span class="panel-kicker">Recuperação</span>
        <h2>Lixeira de memórias</h2>
        <p>Exclusões recentes registradas nos checkpoints Git do ai-memory. A consulta cobre até os 100 checkpoints mais recentes e não é uma lixeira permanente.</p>
      </div>
      <button class="panel-link" :disabled="loading" @click="emit('refresh')">{{ loading ? 'Atualizando…' : 'Atualizar' }}</button>
    </header>
    <p class="trash-retention-note">A API atual permite restaurar itens, mas não apagar checkpoints individuais nem esvaziar o histórico. A exclusão permanente ficará indisponível até o serviço oferecer suporte.</p>
    <p v-if="error" class="api-error"><strong>Não foi possível abrir a lixeira.</strong><span>{{ error }}</span></p>
    <p v-if="message" class="trash-success" role="status">{{ message }}</p>
    <div v-if="loading" class="trash-list skeleton-trash-list" role="status" aria-label="Carregando lixeira">
      <article v-for="index in 3" :key="index" class="trash-card skeleton-trash-card">
        <span class="skeleton skeleton-icon"></span>
        <div class="trash-copy"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-caption"></span><span class="skeleton skeleton-caption"></span></div>
        <span class="skeleton skeleton-button"></span>
      </article>
    </div>
    <div v-else-if="entries.length" class="trash-list">
      <article v-for="entry in entries" :key="`${entry.workspace}/${entry.project}:${entry.path}`" class="trash-card">
        <span class="trash-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></span>
        <div class="trash-copy"><strong>{{ entry.path }}</strong><small>{{ entry.workspace }} / {{ entry.project }}</small><time>Removida {{ formatDate(entry.deleted_at) }}</time></div>
        <button class="dialog-primary" :disabled="!entry.restore_rev" :title="entry.restore_rev ? 'Restaurar do checkpoint anterior à exclusão' : 'Checkpoint anterior não encontrado entre os 100 mais recentes'" @click="emit('restore', entry)">Restaurar</button>
      </article>
    </div>
    <div v-else-if="!error" class="relations-empty">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
      <h3>A lixeira está vazia</h3>
      <p>Não foram encontradas exclusões nos checkpoints recentes. As memórias apagadas não são removidas daqui automaticamente se a exclusão não gerou um checkpoint.</p>
    </div>
  </div>
</template>
