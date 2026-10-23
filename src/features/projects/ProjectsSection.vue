<script setup lang="ts">
import type { ProjectSummary, WorkspaceSummary } from '../../types/domain'

type ProjectWorkspace = WorkspaceSummary & { projects: ProjectSummary[] }

defineProps<{
  projects: ProjectSummary[]
  workspaces: ProjectWorkspace[]
  loading: boolean
  selectedWorkspace: string
  selectedProject: string
  canAdmin: boolean
  formatDate: (value?: string | null) => string
}>()

const emit = defineEmits<{
  openProject: [project: ProjectSummary]
  manageProject: [action: 'rename' | 'delete', project: ProjectSummary]
}>()
</script>

<template>
  <div class="projects-page">
    <header class="projects-intro">
      <div>
        <span class="panel-kicker">Escopos disponíveis</span>
        <h2 v-if="loading" class="skeleton skeleton-project-title" aria-label="Carregando projetos"></h2>
        <h2 v-else>{{ projects.length }} projetos em {{ workspaces.length }} workspaces</h2>
        <p>Escolha um projeto para abrir sua visão geral. Renomeação e exclusão ficam disponíveis para quem tem acesso administrativo.</p>
      </div>
      <span v-if="loading" class="skeleton skeleton-label" aria-label="Carregando memórias"></span>
      <span v-else class="projects-total">{{ projects.reduce((total, project) => total + project.page_count, 0) }} memórias</span>
    </header>
    <div v-if="loading" class="project-grid skeleton-project-grid" role="status" aria-label="Carregando projetos">
      <article v-for="index in 4" :key="index" class="project-card skeleton-project-card">
        <span class="skeleton skeleton-icon"></span><span class="skeleton skeleton-row"></span><span class="skeleton skeleton-line"></span>
      </article>
    </div>
    <section v-for="workspace in workspaces" v-else :key="workspace.workspace_name" class="project-workspace">
      <header>
        <div><span class="workspace-dot"></span><h3>{{ workspace.workspace_name }}</h3></div>
        <span>{{ workspace.project_count }} {{ workspace.project_count === 1 ? 'projeto' : 'projetos' }} · {{ workspace.page_count }} memórias</span>
      </header>
      <div v-if="workspace.projects.length" class="project-grid">
        <article
          v-for="project in workspace.projects"
          :key="project.project_id"
          class="project-card"
          :class="{ current: selectedWorkspace === project.workspace_name && selectedProject === project.project_name }"
        >
          <button class="project-open" @click="emit('openProject', project)">
            <span class="project-folder"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l2 2h9v9h-17zM3.5 7.5v-2h6l2 2"/></svg></span>
            <span class="project-card-copy">
              <strong>{{ project.project_name }}</strong>
              <small>{{ project.page_count }} {{ project.page_count === 1 ? 'memória' : 'memórias' }}</small>
              <small>Atualizado {{ formatDate(project.last_updated) }}</small>
            </span>
            <b class="project-chevron">›</b>
          </button>
          <div v-if="canAdmin" class="project-actions">
            <button title="Renomear projeto" @click="emit('manageProject', 'rename', project)">Renomear</button>
            <button class="danger" title="Excluir projeto" @click="emit('manageProject', 'delete', project)">Excluir</button>
          </div>
        </article>
      </div>
      <p v-else class="subtle-empty">Este workspace ainda não tem projetos.</p>
    </section>
  </div>
</template>
