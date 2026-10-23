<script setup lang="ts">
import type { Memory } from '../../types/domain'

type DateGroup<T> = { label: string; items: T[] }
type CategoryFolder = { name: string; path: string; count: number }

defineProps<{
  memories: Memory[]
  filtered: Memory[]
  groups: DateGroup<Memory>[]
  folders: CategoryFolder[]
  visiblePaths: string[]
  selectedPaths: string[]
  selectedVisibleCount: number
  allVisibleSelected: boolean
  categoryMode: boolean
  currentDirectory: string
  breadcrumbs: string[]
  loading: boolean
  canAdmin: boolean
  hideSessions: boolean
  sessionIndexError: string
  apiError: string
  selectedPath: string
  selected?: Memory
  selectedPage: Memory | null
  detailLoading: boolean
  memorySessionBadge: (memory: Memory) => string
}>()

const emit = defineEmits<{
  setCategory: [value: boolean]
  setDirectory: [path: string]
  toggleHideSessions: [checked: boolean]
  toggleMemorySelection: [path: string, checked: boolean]
  toggleVisibleSelection: [checked: boolean]
  bulkDelete: []
  createCategory: []
  deleteCategory: [path: string]
  selectMemory: [path: string]
  editPage: []
  manageConnections: []
  deletePage: []
}>()
</script>

<template>
  <div class="workspace">
    <section class="memory-list">
      <div class="list-toolbar">
        <div class="list-view-controls">
          <button class="view-mode" :class="{ active: !categoryMode }" @click="emit('setCategory', false)">Todas</button>
          <button class="view-mode" :class="{ active: categoryMode }" @click="emit('setCategory', true)">Categorias</button>
          <span v-if="loading && memories.length === 0" class="skeleton skeleton-caption" aria-label="Carregando total"></span>
          <span v-else>{{ categoryMode ? `${filtered.length} memórias` : `${filtered.length} resultados` }}</span>
          <label class="memory-select-visible hide-sessions-control">
            <input type="checkbox" :checked="hideSessions" aria-label="Ocultar sessões" @change="emit('toggleHideSessions', ($event.target as HTMLInputElement).checked)">
            Ocultar sessões
          </label>
          <label v-if="canAdmin" class="memory-select-visible">
            <input type="checkbox" :checked="allVisibleSelected" :disabled="visiblePaths.length === 0" aria-label="Selecionar todas as memórias visíveis" @change="emit('toggleVisibleSelection', ($event.target as HTMLInputElement).checked)">
            Selecionar visíveis
          </label>
        </div>
        <div class="memory-toolbar-actions">
          <button v-if="selectedVisibleCount" class="memory-bulk-delete" @click="emit('bulkDelete')">Excluir selecionadas ({{ selectedVisibleCount }})</button>
          <button v-if="categoryMode && canAdmin" class="memory-add-category" @click="emit('createCategory')">+ Categoria</button>
          <button v-if="!categoryMode" class="sort-label">Atualizadas recentemente ↓</button>
          <div v-else class="folder-breadcrumb">
            <button @click="emit('setDirectory', '')">Todas as categorias</button>
            <template v-for="(part, index) in breadcrumbs" :key="`${part}-${index}`">
              <span>/</span>
              <button :class="{ current: index === breadcrumbs.length - 1 }" @click="emit('setDirectory', breadcrumbs.slice(0, index + 1).join('/'))">{{ part }}</button>
            </template>
          </div>
        </div>
      </div>
      <p v-if="sessionIndexError" class="session-index-notice" role="status">Não foi possível consultar o estado de consolidação das sessões: {{ sessionIndexError }}</p>
      <div v-if="categoryMode && folders.length" class="folder-grid">
        <article v-for="folder in folders" :key="folder.path" class="folder-card-wrapper">
          <button class="folder-card" @click="emit('setDirectory', folder.path)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l2 2h9v9h-17zM3.5 7.5v-2h6l2 2"/></svg>
            <span><strong>{{ folder.name }}</strong><small>{{ folder.count }} {{ folder.count === 1 ? 'memória' : 'memórias' }}</small></span><b>›</b>
          </button>
          <button v-if="canAdmin" class="category-delete" :disabled="loading" :aria-label="`Excluir categoria ${folder.path}`" @click="emit('deleteCategory', folder.path)">Excluir categoria</button>
        </article>
      </div>
      <div class="memory-rows">
        <div v-if="loading && memories.length === 0" class="memory-skeletons" role="status" aria-label="Carregando memórias">
          <div v-for="index in 6" :key="index" class="memory-skeleton">
            <span class="skeleton skeleton-icon"></span><span class="skeleton skeleton-row"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-caption"></span>
          </div>
        </div>
        <template v-else>
          <section v-for="group in groups" :key="group.label" class="memory-date-group">
            <h3>{{ group.label }}</h3>
            <div v-for="memory in group.items" :key="memory.path" class="memory-row-item">
              <input v-if="canAdmin" type="checkbox" :checked="selectedPaths.includes(memory.path)" :aria-label="`Selecionar ${memory.title}`" @change="emit('toggleMemorySelection', memory.path, ($event.target as HTMLInputElement).checked)">
              <button class="memory-row" :class="{ selected: selectedPath === memory.path }" @click="emit('selectMemory', memory.path)">
                <i class="kind-badge" :class="memory.kind.toLowerCase()">{{ memory.kind[0] }}</i>
                <span class="memory-copy">
                  <strong>{{ memory.title }} <em v-if="memory.pinned">⌖</em></strong>
                  <small>{{ memory.path }}</small>
                  <span class="tag-row"><b v-for="tag in memory.tags" :key="tag">{{ tag }}</b><b v-if="memorySessionBadge(memory)" class="session-memory-badge">{{ memorySessionBadge(memory) }}</b></span>
                </span>
                <time>{{ memory.updated }}</time>
              </button>
            </div>
          </section>
          <p v-if="filtered.length === 0 && folders.length === 0 && !apiError && !loading" class="empty-state">{{ categoryMode ? 'Esta categoria não contém memórias.' : 'Nenhuma memória encontrada.' }}</p>
        </template>
      </div>
    </section>
    <aside v-if="(selected && detailLoading) || (loading && !selected)" class="detail-panel detail-skeleton" role="status" aria-label="Carregando detalhe da memória">
      <div class="detail-actions"><span class="skeleton skeleton-caption"></span></div>
      <span class="skeleton skeleton-heading"></span><span class="skeleton skeleton-line"></span>
      <span v-for="index in 7" :key="index" class="skeleton skeleton-line"></span>
      <span class="skeleton skeleton-caption"></span>
      <div class="detail-skeleton-footer"><span v-for="index in 3" :key="index" class="skeleton skeleton-button"></span></div>
    </aside>
    <aside v-else-if="selected" class="detail-panel">
      <div class="detail-actions"><span class="status-chip">● Página</span><button>···</button></div>
      <span class="detail-type">{{ selected.kind }}</span><span v-if="memorySessionBadge(selected)" class="session-memory-badge detail-session-badge">{{ memorySessionBadge(selected) }}</span>
      <h2>{{ selected.title }}</h2><p class="detail-path">{{ selected.path }}</p><pre class="markdown-body">{{ selectedPage?.bodyMarkdown || selected.summary }}</pre>
      <div class="detail-section">
        <h3>Etiquetas</h3>
        <span class="tag-row detail-tags"><b v-for="tag in selected.tags" :key="tag"># {{ tag }}</b><span v-if="selected.tags.length === 0">Sem etiquetas</span></span>
      </div>
      <div class="detail-section metadata">
        <h3>Informações</h3>
        <p><span>Atualizada</span><strong>{{ selected.updated || '—' }}</strong></p>
        <p><span>Origem</span><strong>ai-memory</strong></p>
      </div>
      <div class="detail-footer">
        <button :disabled="!canAdmin || !selectedPage || detailLoading" :title="canAdmin ? 'Editar Markdown' : 'Configure um bearer root para escrever'" @click="emit('editPage')">Editar Markdown</button>
        <button :disabled="!canAdmin || !selectedPage || detailLoading" :title="canAdmin ? 'Gerenciar conexões' : 'Configure um bearer root para escrever'" @click="emit('manageConnections')">Conexões</button>
        <button class="danger" :disabled="!canAdmin || !selectedPage || detailLoading" :title="canAdmin ? 'Mover para Lixeira' : 'Configure um bearer root para excluir'" @click="emit('deletePage')">Excluir</button>
      </div>
    </aside>
    <aside v-else class="detail-panel detail-empty">
      <span class="detail-empty-icon" aria-hidden="true">⌕</span>
      <h2>Nenhuma memória selecionada</h2>
      <p>Selecione uma memória na lista para inspecionar seu conteúdo e detalhes.</p>
    </aside>
  </div>
</template>
