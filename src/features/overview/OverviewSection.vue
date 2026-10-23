<script setup lang="ts">
import { computed } from 'vue'
import type { OverviewResponse, PageSummary } from '../../types/domain'

type DateGroup<T> = { label: string; items: T[] }

const props = defineProps<{
  overview: OverviewResponse | null
  loading: boolean
  error: string
  pageGroups: DateGroup<PageSummary>[]
  formatDate: (value?: string | null) => string
}>()

const overviewData = computed<OverviewResponse>(() => props.overview ?? ({
  handoff: null,
  briefing: {
    counts: { pages_latest: 0, sessions: 0, observations: 0 },
    activity_7d: { days: 7, sessions: 0, observations: 0, pages_updated: 0 },
    activity_30d: { days: 30, sessions: 0, observations: 0, pages_updated: 0 },
    pending_handoff_count: 0,
    recent_pages: [],
    rules: [],
    slots: [],
  },
  health: { stale: 0, duplicates: 0, contradictions: 0, orphans: 0, audited_at: null },
}))

const emit = defineEmits<{
  openPage: [path: string]
  openMemories: []
}>()
</script>

<template>
  <div class="overview-page">
    <div v-if="error" class="api-error">
      <strong>Não foi possível carregar o resumo do projeto.</strong>
      <span>{{ error }}</span>
    </div>
    <div v-else-if="loading" class="overview-skeleton" role="status" aria-label="Carregando visão geral">
      <div class="overview-metrics">
        <article v-for="index in 4" :key="index" class="skeleton-card">
          <span class="skeleton skeleton-icon"></span>
          <span class="skeleton skeleton-metric"></span>
          <span class="skeleton skeleton-caption"></span>
        </article>
      </div>
      <div class="overview-grid">
        <div class="overview-main">
          <section class="overview-panel skeleton-panel">
            <span class="skeleton skeleton-heading"></span>
            <span v-for="index in 3" :key="index" class="skeleton skeleton-line"></span>
          </section>
          <section class="overview-panel skeleton-panel">
            <span class="skeleton skeleton-heading"></span>
            <span v-for="index in 3" :key="index" class="skeleton skeleton-row"></span>
          </section>
        </div>
        <aside class="overview-side">
          <section class="overview-panel skeleton-panel">
            <span class="skeleton skeleton-heading"></span>
            <span v-for="index in 4" :key="index" class="skeleton skeleton-line"></span>
          </section>
        </aside>
      </div>
    </div>
    <template v-else>
      <div class="overview-metrics">
        <article><span class="metric-icon purple">▤</span><div><strong>{{ overviewData.briefing.counts.pages_latest ?? 0 }}</strong><small>memórias atuais</small></div></article>
        <article><span class="metric-icon coral">◷</span><div><strong>{{ overviewData.briefing.counts.sessions ?? 0 }}</strong><small>sessões registradas</small></div></article>
        <article><span class="metric-icon green">≋</span><div><strong>{{ overviewData.briefing.counts.observations ?? 0 }}</strong><small>observações capturadas</small></div></article>
        <article><span class="metric-icon amber">↗</span><div><strong>{{ overviewData.briefing.pending_handoff_count ?? 0 }}</strong><small>handoffs abertos</small></div></article>
      </div>
      <div class="overview-grid">
        <div class="overview-main">
          <section class="overview-panel">
            <header>
              <div><span class="panel-kicker">Últimos 7 dias</span><h2>Atividade recente</h2></div>
              <span class="activity-total">{{ overviewData.briefing.activity_7d?.sessions ?? 0 }} sessões</span>
            </header>
            <div class="activity-stats">
              <div><strong>{{ overviewData.briefing.activity_7d?.observations ?? 0 }}</strong><span>observações</span></div>
              <div><strong>{{ overviewData.briefing.activity_7d?.pages_updated ?? 0 }}</strong><span>memórias atualizadas</span></div>
              <div><strong>{{ overviewData.briefing.activity_30d?.sessions ?? 0 }}</strong><span>sessões em 30 dias</span></div>
            </div>
            <div class="activity-comparison">
              <span>30 dias</span>
              <div><i :style="{ width: `${Math.min(100, ((overviewData.briefing.activity_7d?.observations || 0) / Math.max(1, overviewData.briefing.activity_30d?.observations || 0)) * 100)}%` }"></i></div>
              <strong>{{ overviewData.briefing.activity_30d?.observations ?? 0 }} observações</strong>
            </div>
          </section>
          <section class="overview-panel">
            <header>
              <div><span class="panel-kicker">Conteúdo</span><h2>Memórias recentes</h2></div>
              <button class="panel-link" @click="emit('openMemories')">Ver todas →</button>
            </header>
            <div class="recent-pages">
              <section v-for="group in pageGroups" :key="group.label" class="memory-date-group">
                <h3>{{ group.label }}</h3>
                <button v-for="page in group.items" :key="page.path" @click="emit('openPage', page.path)">
                  <i class="kind-badge" :class="(page.kind || 'fact').toLowerCase()">{{ (page.kind || 'M')[0] }}</i>
                  <span><strong>{{ page.title || page.path }}</strong><small>{{ page.path }}</small></span>
                  <time>{{ formatDate(page.updated_at) }}</time>
                </button>
              </section>
              <p v-if="!overviewData.briefing.recent_pages?.length" class="empty-state">Ainda não há memórias neste projeto.</p>
            </div>
          </section>
        </div>
        <aside class="overview-side">
          <section class="overview-panel health-panel">
            <header><div><span class="panel-kicker">Qualidade</span><h2>Saúde da memória</h2></div><span class="health-dot"></span></header>
            <div class="health-list">
              <div><span>Memórias desatualizadas</span><strong>{{ overviewData.health.stale ?? 0 }}</strong></div>
              <div><span>Possíveis duplicatas</span><strong>{{ overviewData.health.duplicates ?? 0 }}</strong></div>
              <div><span>Contradições</span><strong>{{ overviewData.health.contradictions ?? 0 }}</strong></div>
              <div><span>Memórias órfãs</span><strong>{{ overviewData.health.orphans ?? 0 }}</strong></div>
            </div>
            <small v-if="overviewData.health.audited_at" class="health-audit">Auditoria {{ formatDate(overviewData.health.audited_at) }}</small>
          </section>
          <section v-if="overviewData.handoff" class="overview-panel handoff-panel">
            <header><div><span class="panel-kicker">Continuidade</span><h2>Handoff aberto</h2></div><span class="handoff-mark">↗</span></header>
            <p>{{ overviewData.handoff.summary || 'Há contexto aguardando a próxima sessão.' }}</p>
            <small>{{ overviewData.handoff.agent || 'Agente' }} · {{ formatDate(overviewData.handoff.at) }}</small>
            <ul v-if="overviewData.handoff.next_steps?.length"><li v-for="step in overviewData.handoff.next_steps.slice(0, 3)" :key="step">{{ step }}</li></ul>
          </section>
          <section class="overview-panel rules-panel">
            <header><div><span class="panel-kicker">Referência</span><h2>Regras do projeto</h2></div></header>
            <button v-for="rule in overviewData.briefing.rules || []" :key="rule.path" @click="emit('openPage', rule.path)">
              <span>◇</span><strong>{{ rule.title || rule.path }}</strong>
            </button>
            <p v-if="!overviewData.briefing.rules?.length" class="subtle-empty">Nenhuma regra registrada.</p>
          </section>
        </aside>
      </div>
    </template>
  </div>
</template>
