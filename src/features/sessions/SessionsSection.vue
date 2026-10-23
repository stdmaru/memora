<script setup lang="ts">
import type { Observation, Session } from '../../types/domain'

type DateGroup<T> = { label: string; items: T[] }

defineProps<{
  sessions: Session[]
  groups: DateGroup<Session>[]
  loading: boolean
  apiError: string
  selectedSession: Session | null
  observations: Observation[]
  observationLoading: boolean
  sessionTotal: number
  formatDate: (value?: string | null) => string
}>()

const emit = defineEmits<{
  selectSession: [session: Session]
  loadMore: [session: Session, offset: number]
}>()
</script>

<template>
  <div class="sessions-layout">
    <section class="session-list">
      <div class="list-toolbar">
        <div>
          <strong>Sessões capturadas</strong>
          <span v-if="loading && sessions.length === 0" class="skeleton skeleton-caption" aria-label="Carregando sessões"></span>
          <span v-else>{{ sessions.length }} resultados</span>
        </div>
      </div>
      <div class="session-rows">
        <div v-if="loading && sessions.length === 0" class="session-skeletons" role="status" aria-label="Carregando sessões">
          <div v-for="index in 5" :key="index" class="session-skeleton">
            <span class="skeleton skeleton-caption"></span><span class="skeleton skeleton-row"></span><span class="skeleton skeleton-line"></span>
          </div>
        </div>
        <template v-else>
          <section v-for="group in groups" :key="group.label" class="memory-date-group">
            <h3>{{ group.label }}</h3>
            <button
              v-for="session in group.items"
              :key="session.session_id"
              class="session-row"
              :class="{ selected: selectedSession?.session_id === session.session_id }"
              @click="emit('selectSession', session)"
            >
              <span class="session-agent">{{ session.agent_kind || 'Agente' }}</span>
              <strong>{{ formatDate(session.started_at) }}</strong>
              <small>{{ session.cwd || 'Diretório não informado' }}</small>
              <span class="session-count">{{ session.observation_count }} observações</span>
            </button>
          </section>
          <p v-if="sessions.length === 0 && !apiError" class="empty-state">Nenhuma sessão visível neste projeto.</p>
        </template>
      </div>
    </section>
    <section class="session-detail">
      <template v-if="selectedSession">
        <header>
          <span class="session-agent">{{ selectedSession.agent_kind || 'Agente' }}</span>
          <h2>{{ formatDate(selectedSession.started_at) }}</h2>
          <p>{{ selectedSession.cwd || 'Diretório não informado' }}</p>
          <div class="session-meta">
            <span>{{ selectedSession.ended_at ? `Encerrada ${formatDate(selectedSession.ended_at)}` : 'Sessão em andamento' }}</span>
            <span v-if="observationLoading && sessionTotal === 0" class="skeleton skeleton-caption" aria-label="Carregando total"></span>
            <span v-else>{{ sessionTotal }} observações</span>
            <span v-if="selectedSession.consolidation">Consolidação: {{ selectedSession.consolidation.state }}</span>
          </div>
        </header>
        <div class="observation-list">
          <div v-if="observationLoading && observations.length === 0" class="observation-skeletons" role="status" aria-label="Carregando observações">
            <article v-for="index in 3" :key="index" class="observation-card skeleton-observation">
              <span class="skeleton skeleton-line"></span><span class="skeleton skeleton-caption"></span>
              <span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span>
            </article>
          </div>
          <template v-else>
            <article v-for="observation in observations" :key="observation.id" class="observation-card">
              <div><strong>{{ observation.title || observation.kind }}</strong><time>{{ formatDate(observation.created_at) }}</time></div>
              <pre>{{ observation.body || 'Sem conteúdo registrado.' }}</pre>
            </article>
            <div v-if="observationLoading" class="observation-skeletons" role="status" aria-label="Carregando mais observações">
              <article v-for="index in 2" :key="index" class="observation-card skeleton-observation">
                <span class="skeleton skeleton-line"></span><span class="skeleton skeleton-caption"></span><span class="skeleton skeleton-line"></span>
              </article>
            </div>
            <p v-if="!observationLoading && observations.length === 0 && !apiError" class="empty-state">Esta sessão não possui observações visíveis no projeto.</p>
            <button v-if="observations.length < sessionTotal" class="load-more" :disabled="observationLoading" @click="emit('loadMore', selectedSession!, observations.length)">Carregar mais observações</button>
          </template>
        </div>
      </template>
      <div v-else-if="loading" class="session-detail-skeleton" role="status" aria-label="Carregando sessão">
        <span class="skeleton skeleton-caption"></span><span class="skeleton skeleton-heading"></span>
        <span class="skeleton skeleton-line"></span><span class="skeleton skeleton-caption"></span>
        <span v-for="index in 3" :key="index" class="skeleton skeleton-row"></span>
      </div>
      <p v-else class="empty-state">Selecione uma sessão para revisar as observações.</p>
    </section>
  </div>
</template>
