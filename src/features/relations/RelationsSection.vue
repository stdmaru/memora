<script setup lang="ts">
import type { Memory, RelationEntry } from '../../types/domain'

defineProps<{
  entries: RelationEntry[]
  memories: Memory[]
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  openPage: [path: string]
  openMemories: []
}>()
</script>

<template>
  <div class="relations-page">
    <header class="relations-heading">
      <div>
        <span class="panel-kicker">Mapa do projeto</span>
        <h2><span v-if="loading" class="skeleton skeleton-heading" aria-label="Carregando conexões"></span><template v-else>{{ entries.length }} conexões encontradas</template></h2>
        <p>Relações tipadas e links Markdown entre as memórias deste escopo.</p>
      </div>
      <button class="panel-link" @click="emit('openMemories')">Abrir memórias →</button>
    </header>
    <div v-if="loading" class="relation-list skeleton-relation-list" role="status" aria-label="Carregando relações">
      <article v-for="index in 3" :key="index" class="relation-card skeleton-relation-card">
        <span class="skeleton skeleton-row"></span><span class="skeleton skeleton-caption"></span><span class="skeleton skeleton-row"></span>
      </article>
    </div>
    <div v-else-if="error" class="api-error"><strong>Não foi possível carregar as relações.</strong><span>{{ error }}</span></div>
    <div v-else-if="entries.length" class="relation-list">
      <article v-for="(entry, index) in entries" :key="`${entry.source.path}-${entry.kind}-${entry.targetPath}-${index}`" class="relation-card">
        <button class="relation-node" @click="emit('openPage', entry.source.path)">
          <i class="kind-badge" :class="entry.source.kind.toLowerCase()">{{ entry.source.kind[0] }}</i>
          <span><strong>{{ entry.source.title }}</strong><small>{{ entry.source.path }}</small></span>
        </button>
        <div class="relation-edge">
          <span>{{ entry.kind === 'causes' ? 'Causa' : entry.kind === 'fixes' ? 'Resolve' : entry.kind === 'contradicts' ? 'Contradiz' : 'Link Markdown' }}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>
        </div>
        <button class="relation-node" @click="emit('openPage', entry.targetPath)">
          <i class="kind-badge" :class="(memories.find(page => page.path === entry.targetPath)?.kind || 'fact').toLowerCase()">{{ (memories.find(page => page.path === entry.targetPath)?.kind || 'M')[0] }}</i>
          <span><strong>{{ entry.targetTitle }}</strong><small>{{ entry.targetPath }}</small></span>
        </button>
      </article>
    </div>
    <div v-else class="relations-empty">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.9 7.5-3.7M8.2 13.1l7.5 3.7"/></svg>
      <h3>Nenhuma relação encontrada</h3>
      <p>Adicione conexões tipadas em uma memória ou inclua links Markdown entre páginas. Elas aparecerão aqui para exploração.</p>
      <button class="dialog-primary" @click="emit('openMemories')">Ir para Memórias</button>
    </div>
  </div>
</template>
