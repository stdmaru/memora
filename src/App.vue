<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

type Theme = 'light' | 'dark' | 'system'
type PageLink = { path: string; title?: string; kind?: string }
type Memory = { path: string; title: string; summary: string; kind: string; updated: string; updatedAt?: string; tags: string[]; pinned: boolean; bodyMarkdown?: string; tier?: string; frontmatter?: Record<string, unknown>; links?: PageLink[]; backlinks?: PageLink[] }
type PageSummary = { path: string; title: string; kind?: string; tier?: string; updated_at?: string; snippet?: string; frontmatter?: Record<string, unknown> }
type WorkspaceSummary = { workspace_name: string; project_count: number; page_count: number; last_updated: string | null }
type ProjectSummary = { workspace_name: string; project_name: string; project_id: string; page_count: number; last_updated: string | null }
type ScopeResponse = { workspaces: WorkspaceSummary[]; projects: ProjectSummary[]; preferred: { workspace: string; project: string }; canAdmin: boolean }
type Session = { session_id: string; cwd?: string; agent_kind?: string; started_at: string; ended_at?: string | null; observation_count: number; consolidation?: { state: string; attempts: number } | null }
type Observation = { id: string; kind: string; title?: string; body?: string; importance?: number; created_at: string }
type SessionDetail = { session: Session; observations: Observation[]; total: number; offset: number; elided_other_scope: number }
type OverviewActivity = { days: number; sessions: number; observations: number; pages_updated: number }
type OverviewResponse = {
  handoff: { agent?: string; at?: string; project?: string; summary?: string; open_questions?: string[]; next_steps?: string[] } | null
  briefing: { counts: { pages_latest?: number; pages_all?: number; sessions?: number; observations?: number }; activity_7d?: OverviewActivity; activity_30d?: OverviewActivity; last_observation_at?: string | null; pending_handoff_count?: number; recent_pages?: PageSummary[]; rules?: PageSummary[]; slots?: PageSummary[] }
  health: { stale?: number; duplicates?: number; contradictions?: number; orphans?: number; audited_at?: string | null }
}

const sections = ['Visão geral', 'Memórias', 'Sessões', 'Relações', 'Projetos', 'Lixeira']
const relationTypes = ['causes', 'fixes', 'contradicts'] as const
const memories = ref<Memory[]>([])
const sessions = ref<Session[]>([])
const selectedSession = ref<Session | null>(null)
const observations = ref<Observation[]>([])
const sessionTotal = ref(0)
const sessionsLoading = ref(false)
const observationLoading = ref(false)
const workspaces = ref<WorkspaceSummary[]>([])
const projects = ref<ProjectSummary[]>([])
const canAdmin = ref(false)
type ScopeDialog = { action: 'rename' | 'delete'; kind: 'project' | 'workspace'; current: string; value: string; step: 'form' | 'preview' | 'confirm'; preview: Record<string, unknown> | null; error: string; busy: boolean }
const scopeDialog = ref<ScopeDialog | null>(null)
const pageEditorOpen = ref(false)
const pageEditorBody = ref('')
const pageEditorMode = ref<'code' | 'markdown'>('code')
const pageEditorBusy = ref(false)
const pageEditorError = ref('')
const connectionsOpen = ref(false)
const connectionType = ref<'causes' | 'fixes' | 'contradicts'>('fixes')
const connectionTarget = ref('')
const connectionBusy = ref(false)
const connectionError = ref('')
const relationDraft = ref<Record<string, string[]>>({ causes: [], fixes: [], contradicts: [] })
const overview = ref<OverviewResponse | null>(null)
const overviewLoading = ref(false)
const overviewError = ref('')
const selectedWorkspace = ref('')
const selectedProject = ref('')
const activeSection = ref('Memórias')
const categoryMode = ref(false)
const currentDirectory = ref('')
const query = ref('')
const selectedPath = ref('')
const selectedPage = ref<Memory | null>(null)
const loading = ref(true)
const detailLoading = ref(false)
const apiError = ref('')
const connectionStatus = ref('Conectando…')
const theme = ref<Theme>('system')
const themeMenuOpen = ref(false)
let systemTheme: MediaQueryList | undefined
let searchTimer: ReturnType<typeof setTimeout> | undefined
const workspaceProjects = computed(() => projects.value.filter(project => project.workspace_name === selectedWorkspace.value))
const selected = computed(() => selectedPage.value ?? memories.value.find(m => m.path === selectedPath.value) ?? memories.value[0])
const directoryContents = computed(() => {
  const prefix = currentDirectory.value ? `${currentDirectory.value}/` : ''
  const folders = new Map<string, number>()
  const pages: Memory[] = []
  for (const memory of memories.value) {
    if (!memory.path.startsWith(prefix)) continue
    const remainder = memory.path.slice(prefix.length)
    const slash = remainder.indexOf('/')
    if (slash >= 0) {
      const folder = remainder.slice(0, slash)
      folders.set(folder, (folders.get(folder) || 0) + 1)
    } else pages.push(memory)
  }
  return {
    folders: [...folders].map(([name, count]) => ({ name, path: prefix ? `${currentDirectory.value}/${name}` : name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    pages: pages.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
  }
})
const filtered = computed(() => categoryMode.value ? directoryContents.value.pages : memories.value)
const memoryDateGroups = computed(() => {
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000
  const groups = new Map<string, Memory[]>()
  for (const memory of filtered.value) {
    const timestamp = memory.updatedAt ? new Date(memory.updatedAt).getTime() : NaN
    const dayStart = Number.isFinite(timestamp) ? new Date(timestamp).setHours(0, 0, 0, 0) : NaN
    const label = dayStart === startOfToday ? 'Hoje' : dayStart === startOfYesterday ? 'Ontem' : Number.isFinite(dayStart) ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(dayStart) : 'Sem data'
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(memory)
  }
  return [...groups].map(([label, items]) => ({ label, items }))
})
const directoryBreadcrumbs = computed(() => currentDirectory.value ? currentDirectory.value.split('/') : [])

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/manager/${path}`, options)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || `Erro HTTP ${response.status}`)
  return payload as T
}

function scopeQuery() {
  return `workspace=${encodeURIComponent(selectedWorkspace.value)}&project=${encodeURIComponent(selectedProject.value)}`
}

function formatDate(value?: string | null) {
  if (!value) return 'Em andamento'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function fromSummary(page: PageSummary): Memory {
  const frontmatter = page.frontmatter ?? {}
  return {
    path: page.path,
    title: page.title || page.path,
    summary: page.snippet || 'Abra para ler o conteúdo completo.',
    kind: page.kind || 'fact',
    updated: page.updated_at ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(page.updated_at)) : '',
    updatedAt: page.updated_at,
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [],
    pinned: Boolean(frontmatter.pinned),
    frontmatter,
    tier: page.tier || String(frontmatter.tier || 'semantic'),
    links: (page as PageSummary & { links?: PageLink[] }).links || [],
    backlinks: (page as PageSummary & { backlinks?: PageLink[] }).backlinks || [],
  }
}

async function loadMemories(search = '') {
  if (!selectedWorkspace.value || !selectedProject.value) {
    memories.value = []
    selectedPath.value = ''
    selectedPage.value = null
    loading.value = false
    return
  }
  loading.value = true
  apiError.value = ''
  try {
    const query = search.trim()
    const pages = await api<PageSummary[]>(`pages?${scopeQuery()}&limit=100${query ? `&q=${encodeURIComponent(query)}` : ''}`)
    memories.value = pages.map(fromSummary)
    if (!memories.value.some(page => page.path === selectedPath.value)) selectedPath.value = memories.value[0]?.path || ''
  } catch (error) {
    apiError.value = error instanceof Error ? error.message : 'Falha ao carregar memórias.'
    memories.value = []
    selectedPath.value = ''
    selectedPage.value = null
    connectionStatus.value = 'Sem conexão'
  } finally { loading.value = false }
}

async function loadSessions() {
  if (!selectedWorkspace.value || !selectedProject.value) return
  sessionsLoading.value = true
  apiError.value = ''
  try {
    sessions.value = await api<Session[]>(`sessions?${scopeQuery()}`)
    if (!sessions.value.some(session => session.session_id === selectedSession.value?.session_id)) {
      selectedSession.value = sessions.value[0] || null
      observations.value = []
      if (selectedSession.value) await loadSessionObservations(selectedSession.value)
    }
  } catch (error) {
    apiError.value = error instanceof Error ? error.message : 'Não foi possível listar as sessões.'
    sessions.value = []
  } finally { sessionsLoading.value = false }
}

async function loadOverview() {
  if (!selectedWorkspace.value || !selectedProject.value) { overview.value = null; overviewLoading.value = false; return }
  overviewLoading.value = true
  overviewError.value = ''
  try { overview.value = await api<OverviewResponse>(`overview?${scopeQuery()}`) }
  catch (error) { overviewError.value = error instanceof Error ? error.message : 'Não foi possível carregar a visão geral.'; overview.value = null }
  finally { overviewLoading.value = false }
}

function openOverviewPage(path: string) {
  activeSection.value = 'Memórias'
  categoryMode.value = false
  currentDirectory.value = ''
  selectedPath.value = path
}

async function loadSessionObservations(session: Session, offset = 0) {
  selectedSession.value = session
  observationLoading.value = true
  try {
    const detail = await api<SessionDetail>(`session-observations?${scopeQuery()}&session_id=${encodeURIComponent(session.session_id)}&offset=${offset}`)
    observations.value = offset ? [...observations.value, ...(detail.observations || [])] : (detail.observations || [])
    sessionTotal.value = detail.total || 0
  } catch (error) {
    apiError.value = error instanceof Error ? error.message : 'Não foi possível abrir as observações da sessão.'
    observations.value = []
  } finally { observationLoading.value = false }
}

async function loadSelectedPage(path: string) {
  if (!path) { selectedPage.value = null; return }
  detailLoading.value = true
  try {
    const page = await api<PageSummary & { body_markdown: string; frontmatter: Record<string, unknown>; links?: PageLink[]; backlinks?: PageLink[]; tier?: string }>(`page?${scopeQuery()}&path=${encodeURIComponent(path)}`)
    selectedPage.value = {
      ...fromSummary(page), summary: page.body_markdown, bodyMarkdown: page.body_markdown,
      tags: Array.isArray(page.frontmatter?.tags) ? page.frontmatter.tags.map(String) : [],
      pinned: Boolean(page.frontmatter?.pinned),
      frontmatter: page.frontmatter, tier: page.tier || String(page.frontmatter?.tier || 'semantic'),
      links: page.links || [], backlinks: page.backlinks || [],
    }
  } catch (error) { apiError.value = error instanceof Error ? error.message : 'Não foi possível abrir a memória.' }
  finally { detailLoading.value = false }
}

function openPageEditor() {
  if (!selectedPage.value || !canAdmin.value) return
  pageEditorBody.value = selectedPage.value.bodyMarkdown || ''
  pageEditorError.value = ''
  pageEditorMode.value = 'code'
  pageEditorOpen.value = true
}

function renderMarkdownPreview(source: string) {
  const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const inline = (value: string) => {
    let text = escapeHtml(value)
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>')
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(.+?)__/g, '<strong>$1</strong>')
    text = text.replace(/~~(.+?)~~/g, '<del>$1</del>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    return text
  }
  const lines = source.split(/\r?\n/)
  const blocks: string[] = []
  let paragraph: string[] = []
  let list: string[] = []
  let code: string[] | null = null
  const flushParagraph = () => { if (paragraph.length) blocks.push(`<p>${paragraph.map(inline).join('<br>')}</p>`); paragraph = [] }
  const flushList = () => { if (list.length) blocks.push(`<ul>${list.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`); list = [] }
  for (const line of lines) {
    if (code) {
      if (/^\s*```/.test(line)) { blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = null }
      else code.push(line)
      continue
    }
    if (/^\s*```/.test(line)) { flushParagraph(); flushList(); code = []; continue }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/)
    if (heading) { flushParagraph(); flushList(); const level = heading[1].length; blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue }
    if (/^\s*[-*_]{3,}\s*$/.test(line)) { flushParagraph(); flushList(); blocks.push('<hr>'); continue }
    const item = line.match(/^\s*[-*+]\s+(.+)$/)
    if (item) { flushParagraph(); list.push(item[1]); continue }
    if (!line.trim()) { flushParagraph(); flushList(); continue }
    flushList(); paragraph.push(line)
  }
  if (code) blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
  flushParagraph(); flushList()
  return blocks.join('') || '<p class="preview-empty">Nada para pré-visualizar.</p>'
}

function pageWritePayload(relations?: Record<string, string[]>) {
  const page = selectedPage.value!
  const metadata = page.frontmatter || {}
  return {
    workspace: selectedWorkspace.value, project: selectedProject.value, path: page.path,
    body: pageEditorBody.value, title: page.title, kind: page.kind, tier: page.tier || 'semantic',
    tags: page.tags, pinned: page.pinned,
    ...(Array.isArray(metadata.entities) ? { entities: metadata.entities } : {}),
    ...(typeof metadata.abstract === 'string' ? { abstract: metadata.abstract } : {}),
    relations: relations || (metadata.relations && typeof metadata.relations === 'object' ? metadata.relations as Record<string, string[]> : {}),
  }
}

async function savePageMarkdown() {
  if (!selectedPage.value || !canAdmin.value || pageEditorBusy.value) return
  pageEditorBusy.value = true
  pageEditorError.value = ''
  try {
    await admin('write-page', pageWritePayload())
    pageEditorOpen.value = false
    await loadSelectedPage(selectedPage.value.path)
    await loadMemories(query.value)
  } catch (error) {
    pageEditorError.value = error instanceof Error ? error.message : 'Não foi possível salvar o Markdown.'
  } finally { pageEditorBusy.value = false }
}

function openConnections() {
  if (!selectedPage.value || !canAdmin.value) return
  const relations = selectedPage.value.frontmatter?.relations
  relationDraft.value = {
    causes: Array.isArray((relations as Record<string, unknown> | undefined)?.causes) ? ((relations as Record<string, unknown>).causes as string[]).map(String) : [],
    fixes: Array.isArray((relations as Record<string, unknown> | undefined)?.fixes) ? ((relations as Record<string, unknown>).fixes as string[]).map(String) : [],
    contradicts: Array.isArray((relations as Record<string, unknown> | undefined)?.contradicts) ? ((relations as Record<string, unknown>).contradicts as string[]).map(String) : [],
  }
  connectionTarget.value = ''
  connectionError.value = ''
  connectionsOpen.value = true
}

function addConnection() {
  if (!connectionTarget.value) return
  const targets = relationDraft.value[connectionType.value]
  if (!targets.includes(connectionTarget.value)) relationDraft.value[connectionType.value] = [...targets, connectionTarget.value]
  connectionTarget.value = ''
}

function removeConnection(type: typeof relationTypes[number], target: string) {
  relationDraft.value[type] = (relationDraft.value[type] || []).filter(item => item !== target)
}

async function saveConnections() {
  if (!selectedPage.value || !canAdmin.value || connectionBusy.value) return
  connectionBusy.value = true
  connectionError.value = ''
  try {
    await admin('write-page', pageWritePayload(relationDraft.value))
    connectionsOpen.value = false
    await loadSelectedPage(selectedPage.value.path)
    await loadMemories(query.value)
  } catch (error) {
    connectionError.value = error instanceof Error ? error.message : 'Não foi possível salvar as conexões.'
  } finally { connectionBusy.value = false }
}

async function loadScopes() {
  const result = await api<ScopeResponse>('scopes')
  workspaces.value = result.workspaces
  projects.value = result.projects
  canAdmin.value = result.canAdmin
  const saved = localStorage.getItem('memora:scope')
  let savedScope: { workspace?: string; project?: string } = {}
  try { savedScope = saved ? JSON.parse(saved) : {} } catch { localStorage.removeItem('memora:scope') }
  const workspaceExists = (name: string) => workspaces.value.some(item => item.workspace_name === name)
  const preferredWorkspace = workspaceExists(savedScope.workspace || '') ? savedScope.workspace! : workspaceExists(result.preferred.workspace) ? result.preferred.workspace : workspaces.value[0]?.workspace_name || ''
  selectedWorkspace.value = preferredWorkspace
  const availableProjects = projects.value.filter(project => project.workspace_name === preferredWorkspace)
  selectedProject.value = availableProjects.some(project => project.project_name === savedScope.project)
    ? savedScope.project!
    : availableProjects.some(project => project.project_name === result.preferred.project) ? result.preferred.project : availableProjects[0]?.project_name || ''
}

function admin(action: string, payload: Record<string, unknown>) {
  return api<Record<string, unknown>>('admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...payload }) })
}

function explainScopeCreationLimit() {
  window.alert('A API REST atual do ai-memory não oferece uma rota administrativa dedicada para criar workspaces ou projetos. Para evitar criar escopos por meio de efeitos colaterais, esta ação ficará indisponível até haver suporte explícito no serviço.')
}

function summaryCounts(preview: Record<string, unknown>) {
  const labels: Record<string, string> = {
    pages_deleted: 'Memórias', sessions_deleted: 'Sessões', observations_deleted: 'Observações', handoffs_deleted: 'Handoffs',
    embeddings_deleted: 'Embeddings', workstreams_deleted: 'Workstreams', managed_runs_deleted: 'Execuções gerenciadas',
    projects_deleted: 'Projetos', collateral_observations_deleted: 'Observações afetadas em outros escopos',
    collateral_handoffs_denulled: 'Handoffs com referência removida em outros escopos',
  }
  return Object.entries(labels).filter(([key]) => typeof preview[key] === 'number').map(([key, label]) => `${label}: ${preview[key]}`).join('\n') || 'Nenhum registro dependente foi contabilizado.'
}

function manageScope(action: 'rename' | 'delete', kind: 'project' | 'workspace') {
  if (!canAdmin.value) return
  const current = kind === 'project' ? selectedProject.value : selectedWorkspace.value
  if (!current) return
  scopeDialog.value = { action, kind, current, value: current, step: 'form', preview: null, error: '', busy: false }
  if (action === 'delete') void loadDeletePreview()
}

function closeScopeDialog() {
  if (!scopeDialog.value?.busy) scopeDialog.value = null
}

async function loadDeletePreview() {
  const dialog = scopeDialog.value
  if (!dialog || dialog.action !== 'delete') return
  dialog.busy = true
  dialog.error = ''
  try {
    dialog.preview = dialog.kind === 'project'
      ? await admin('purge-project', { workspace: selectedWorkspace.value, project: dialog.current, confirm: true, dry_run: true })
      : await admin('delete-workspace', { workspace: dialog.current, force: true, dry_run: true })
    dialog.step = 'preview'
  } catch (error) {
    dialog.error = error instanceof Error ? error.message : 'Não foi possível carregar a prévia.'
  } finally { dialog.busy = false }
}

async function submitScopeDialog() {
  const dialog = scopeDialog.value
  if (!dialog || dialog.busy) return
  dialog.error = ''
  dialog.busy = true
  try {
    if (dialog.action === 'rename') {
      const next = dialog.value.trim()
      if (!next || next === dialog.current) { dialog.error = 'Informe um nome diferente do atual.'; return }
      const workspace = selectedWorkspace.value
      await admin(dialog.kind === 'project' ? 'rename-project' : 'rename-workspace', dialog.kind === 'project' ? { workspace, from: dialog.current, to: next } : { from: dialog.current, to: next })
      await loadScopes()
      if (dialog.kind === 'project') selectedProject.value = next
      else selectedWorkspace.value = next
      scopeDialog.value = null
      return
    }
    if (dialog.step === 'preview') {
      dialog.step = 'confirm'
      dialog.value = ''
      return
    }
    if (dialog.value !== dialog.current) { dialog.error = 'O texto digitado não corresponde ao nome do escopo.'; return }
    await admin(dialog.kind === 'project' ? 'purge-project' : 'delete-workspace', dialog.kind === 'project'
      ? { workspace: selectedWorkspace.value, project: dialog.current, confirm: true }
      : { workspace: dialog.current, force: true })
    await loadScopes()
    scopeDialog.value = null
  } catch (error) {
    dialog.error = error instanceof Error ? error.message : 'Falha na operação administrativa.'
  } finally { if (scopeDialog.value) scopeDialog.value.busy = false }
}

function changeWorkspace() {
  selectedProject.value = workspaceProjects.value[0]?.project_name || ''
}

watch([selectedWorkspace, selectedProject], () => {
  if (!selectedWorkspace.value || !selectedProject.value) return
  localStorage.setItem('memora:scope', JSON.stringify({ workspace: selectedWorkspace.value, project: selectedProject.value }))
  selectedPage.value = null
  selectedPath.value = ''
  currentDirectory.value = ''
  void loadMemories(query.value)
  if (activeSection.value === 'Sessões') {
    selectedSession.value = null
    observations.value = []
    void loadSessions()
  }
  if (activeSection.value === 'Visão geral') void loadOverview()
})

watch(activeSection, section => {
  if (section === 'Sessões') void loadSessions()
  if (section === 'Visão geral') void loadOverview()
})

watch(query, value => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void loadMemories(value), 250)
})
watch(selectedPath, path => { selectedPage.value = null; void loadSelectedPage(path) })
watch(currentDirectory, () => { selectedPage.value = null; selectedPath.value = '' })

function applyTheme() {
  const resolved = theme.value === 'system' ? (systemTheme?.matches ? 'dark' : 'light') : theme.value
  document.documentElement.dataset.theme = resolved
}
function setTheme(next: Theme) { theme.value = next; localStorage.setItem('memora:theme', next); applyTheme(); themeMenuOpen.value = false }
function onSystemThemeChange() { if (theme.value === 'system') applyTheme() }
onMounted(() => {
  const saved = localStorage.getItem('memora:theme')
  if (saved === 'light' || saved === 'dark' || saved === 'system') theme.value = saved
  systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
  systemTheme.addEventListener('change', onSystemThemeChange)
  applyTheme()
  void api<{ level: string; version: string }>('identity')
    .then(() => { connectionStatus.value = 'ai-memory conectado' })
    .catch(() => { connectionStatus.value = 'Sem conexão' })
  void loadScopes().catch(error => {
    apiError.value = error instanceof Error ? error.message : 'Não foi possível listar workspaces e projetos.'
    connectionStatus.value = 'Sem conexão'
    loading.value = false
  })
})
onBeforeUnmount(() => { systemTheme?.removeEventListener('change', onSystemThemeChange); clearTimeout(searchTimer) })
</script>

<template>
  <main class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#"><span class="brand-mark">m</span><span>memora</span></a>
      <div class="scope-switcher">
        <label for="workspace-select">Workspace</label>
        <div class="scope-control"><select id="workspace-select" v-model="selectedWorkspace" :disabled="workspaces.length === 0" aria-label="Selecionar workspace" @change="changeWorkspace"><option v-for="workspace in workspaces" :key="workspace.workspace_name" :value="workspace.workspace_name">{{ workspace.workspace_name }}</option></select><button v-if="canAdmin" class="icon-action" title="Renomear workspace" aria-label="Renomear workspace" :disabled="!selectedWorkspace" @click="manageScope('rename', 'workspace')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-.8L19.5 7.7a2.1 2.1 0 0 0-3-3L5 16.2 4 20Z"/></svg></button><button v-if="canAdmin" class="icon-action danger" title="Excluir workspace" aria-label="Excluir workspace" :disabled="!selectedWorkspace" @click="manageScope('delete', 'workspace')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button><button v-if="canAdmin" class="icon-action add" title="Criar workspace" aria-label="Criar workspace" @click="explainScopeCreationLimit"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>
        <label for="project-select">Projeto</label>
        <div class="scope-control"><select id="project-select" v-model="selectedProject" :disabled="workspaceProjects.length === 0" aria-label="Selecionar projeto"><option v-for="project in workspaceProjects" :key="project.project_id" :value="project.project_name">{{ project.project_name }}</option></select><button v-if="canAdmin" class="icon-action" title="Renomear projeto" aria-label="Renomear projeto" :disabled="!selectedProject" @click="manageScope('rename', 'project')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-.8L19.5 7.7a2.1 2.1 0 0 0-3-3L5 16.2 4 20Z"/></svg></button><button v-if="canAdmin" class="icon-action danger" title="Excluir projeto" aria-label="Excluir projeto" :disabled="!selectedProject" @click="manageScope('delete', 'project')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button><button v-if="canAdmin" class="icon-action add" title="Criar projeto" aria-label="Criar projeto" @click="explainScopeCreationLimit"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>
        <small v-if="!canAdmin" class="admin-hint">Ações administrativas indisponíveis: configure um bearer root separado.</small>
      </div>
      <nav><button v-for="section in sections" :key="section" class="nav-item" :class="{ active: activeSection === section }" @click="activeSection = section"><span class="nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><template v-if="section === 'Visão geral'"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></template><template v-else-if="section === 'Memórias'"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></template><template v-else-if="section === 'Sessões'"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></template><template v-else-if="section === 'Relações'"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.9 7.5-3.7M8.2 13.1l7.5 3.7"/></template><template v-else-if="section === 'Projetos'"><path d="M4 7h6l2 2h8v10H4zM4 7V5h6l2 2"/></template><template v-else><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></template></svg></span><span class="nav-label">{{ section }}</span><b v-if="section === 'Memórias'">{{ memories.length }}</b></button></nav>
      <div class="sidebar-bottom"><div class="security-note"><span>●</span><div><strong>{{ connectionStatus }}</strong><small>API do ai-memory</small></div></div><button class="nav-item"><span>⚙</span>Configurações</button><div class="user"><i>MR</i><div><strong>Marcio Russo</strong><small>Administrador</small></div><button>···</button></div></div>
    </aside>

    <section class="content">
      <header class="topbar"><label class="search"><span>⌕</span><input v-model="query" type="search" placeholder="Buscar neste projeto…"><kbd>⌘ K</kbd></label><div class="topbar-actions"><div class="theme-control"><button class="theme-button" :aria-expanded="themeMenuOpen" aria-label="Escolher aparência" @click="themeMenuOpen = !themeMenuOpen">◐ <span>{{ theme === 'system' ? 'Sistema' : theme === 'dark' ? 'Escuro' : 'Claro' }}</span></button><div v-if="themeMenuOpen" class="theme-menu"><p>Aparência</p><button :class="{ selected: theme === 'light' }" @click="setTheme('light')">☼ Claro</button><button :class="{ selected: theme === 'dark' }" @click="setTheme('dark')">◐ Escuro</button><button :class="{ selected: theme === 'system' }" @click="setTheme('system')">◒ Sistema <small>automático</small></button></div></div><button class="help-button">?</button></div></header>
      <div class="compact-scope"><label>Workspace<select v-model="selectedWorkspace" aria-label="Selecionar workspace" @change="changeWorkspace"><option v-for="workspace in workspaces" :key="workspace.workspace_name" :value="workspace.workspace_name">{{ workspace.workspace_name }}</option></select></label><label>Projeto<select v-model="selectedProject" aria-label="Selecionar projeto"><option v-for="project in workspaceProjects" :key="project.project_id" :value="project.project_name">{{ project.project_name }}</option></select></label></div>
      <div class="page-heading"><div><p class="eyebrow">{{ selectedWorkspace }} / {{ selectedProject }}</p><h1>{{ activeSection === 'Sessões' ? 'Sessões do projeto' : activeSection === 'Visão geral' ? 'Visão geral' : activeSection === 'Memórias' ? 'Suas memórias' : activeSection }}</h1><p>{{ activeSection === 'Sessões' ? 'Revise conversas e observações capturadas pelas suas IAs.' : activeSection === 'Visão geral' ? 'Um resumo da atividade e da saúde da memória deste projeto.' : activeSection === 'Memórias' ? 'Navegue e explore o conteúdo persistente das suas IAs.' : 'Explore este espaço do ai-memory.' }}</p></div><span class="scope-label">{{ activeSection === 'Sessões' ? `${sessions.length} sessões` : activeSection === 'Visão geral' ? 'resumo do escopo' : `${memories.length} páginas` }}</span></div>
      <div v-if="apiError && activeSection !== 'Visão geral'" class="api-error"><strong>Não foi possível carregar o ai-memory.</strong><span>{{ apiError }}</span><small>Confira AI_MEMORY_MCP_URL e AI_MEMORY_AUTH_TOKEN. Para listar todos os escopos, habilite AI_MEMORY_ENABLE_WEB=true no servidor ai-memory.</small></div>
      <div v-if="activeSection !== 'Visão geral'" class="overview-cards"><article><i class="violet">◫</i><div><strong>{{ activeSection === 'Sessões' ? sessions.length : memories.length }}</strong><span>{{ activeSection === 'Sessões' ? 'sessões listadas' : 'páginas carregadas' }}</span></div><small>{{ activeSection === 'Sessões' ? (sessionsLoading ? 'Carregando…' : 'escopo selecionado') : (loading ? 'Carregando…' : 'escopo selecionado') }}</small></article><article><i class="orange">⌘</i><div><strong>{{ selectedProject || '—' }}</strong><span>projeto atual</span></div><small>{{ selectedWorkspace || 'selecione um escopo' }}</small></article><article><i class="green">✓</i><div><strong>{{ connectionStatus.startsWith('ai-memory') ? 'Conectado' : 'Pendente' }}</strong><span>servidor ai-memory</span></div><small>{{ connectionStatus }}</small></article></div>
      <div v-if="activeSection === 'Visão geral'" class="overview-page">
        <div v-if="overviewError" class="api-error"><strong>Não foi possível carregar o resumo do projeto.</strong><span>{{ overviewError }}</span></div>
        <div v-else-if="overviewLoading" class="overview-loading"><span class="loading-spinner"></span>Carregando atividade do projeto…</div>
        <template v-else-if="overview">
          <div class="overview-metrics"><article><span class="metric-icon purple">▤</span><div><strong>{{ overview.briefing.counts.pages_latest ?? 0 }}</strong><small>memórias atuais</small></div></article><article><span class="metric-icon coral">◷</span><div><strong>{{ overview.briefing.counts.sessions ?? 0 }}</strong><small>sessões registradas</small></div></article><article><span class="metric-icon green">≋</span><div><strong>{{ overview.briefing.counts.observations ?? 0 }}</strong><small>observações capturadas</small></div></article><article><span class="metric-icon amber">↗</span><div><strong>{{ overview.briefing.pending_handoff_count ?? 0 }}</strong><small>handoffs abertos</small></div></article></div>
          <div class="overview-grid"><div class="overview-main">
            <section class="overview-panel"><header><div><span class="panel-kicker">Últimos 7 dias</span><h2>Atividade recente</h2></div><span class="activity-total">{{ overview.briefing.activity_7d?.sessions ?? 0 }} sessões</span></header><div class="activity-stats"><div><strong>{{ overview.briefing.activity_7d?.observations ?? 0 }}</strong><span>observações</span></div><div><strong>{{ overview.briefing.activity_7d?.pages_updated ?? 0 }}</strong><span>memórias atualizadas</span></div><div><strong>{{ overview.briefing.activity_30d?.sessions ?? 0 }}</strong><span>sessões em 30 dias</span></div></div><div class="activity-comparison"><span>30 dias</span><div><i :style="{ width: `${Math.min(100, ((overview.briefing.activity_7d?.observations || 0) / Math.max(1, overview.briefing.activity_30d?.observations || 0)) * 100)}%` }"></i></div><strong>{{ overview.briefing.activity_30d?.observations ?? 0 }} observações</strong></div></section>
            <section class="overview-panel"><header><div><span class="panel-kicker">Conteúdo</span><h2>Memórias recentes</h2></div><button class="panel-link" @click="activeSection = 'Memórias'">Ver todas →</button></header><div class="recent-pages"><button v-for="page in overview.briefing.recent_pages || []" :key="page.path" @click="openOverviewPage(page.path)"><i class="kind-badge" :class="(page.kind || 'fact').toLowerCase()">{{ (page.kind || 'M')[0] }}</i><span><strong>{{ page.title || page.path }}</strong><small>{{ page.path }}</small></span><time>{{ formatDate(page.updated_at) }}</time></button><p v-if="!overview.briefing.recent_pages?.length" class="empty-state">Ainda não há memórias neste projeto.</p></div></section>
          </div><aside class="overview-side">
            <section class="overview-panel health-panel"><header><div><span class="panel-kicker">Qualidade</span><h2>Saúde da memória</h2></div><span class="health-dot"></span></header><div class="health-list"><div><span>Memórias desatualizadas</span><strong>{{ overview.health.stale ?? 0 }}</strong></div><div><span>Possíveis duplicatas</span><strong>{{ overview.health.duplicates ?? 0 }}</strong></div><div><span>Contradições</span><strong>{{ overview.health.contradictions ?? 0 }}</strong></div><div><span>Memórias órfãs</span><strong>{{ overview.health.orphans ?? 0 }}</strong></div></div><small v-if="overview.health.audited_at" class="health-audit">Auditoria {{ formatDate(overview.health.audited_at) }}</small></section>
            <section v-if="overview.handoff" class="overview-panel handoff-panel"><header><div><span class="panel-kicker">Continuidade</span><h2>Handoff aberto</h2></div><span class="handoff-mark">↗</span></header><p>{{ overview.handoff.summary || 'Há contexto aguardando a próxima sessão.' }}</p><small>{{ overview.handoff.agent || 'Agente' }} · {{ formatDate(overview.handoff.at) }}</small><ul v-if="overview.handoff.next_steps?.length"><li v-for="step in overview.handoff.next_steps.slice(0, 3)" :key="step">{{ step }}</li></ul></section>
            <section class="overview-panel rules-panel"><header><div><span class="panel-kicker">Referência</span><h2>Regras do projeto</h2></div></header><button v-for="rule in overview.briefing.rules || []" :key="rule.path" @click="openOverviewPage(rule.path)"><span>◇</span><strong>{{ rule.title || rule.path }}</strong></button><p v-if="!overview.briefing.rules?.length" class="subtle-empty">Nenhuma regra registrada.</p></section>
          </aside></div>
        </template>
      </div>
      <div v-else-if="activeSection === 'Sessões'" class="sessions-layout">
        <section class="session-list"><div class="list-toolbar"><div><strong>Sessões capturadas</strong><span>{{ sessions.length }} resultados</span></div></div><div class="session-rows"><button v-for="session in sessions" :key="session.session_id" class="session-row" :class="{ selected: selectedSession?.session_id === session.session_id }" @click="loadSessionObservations(session)"><span class="session-agent">{{ session.agent_kind || 'Agente' }}</span><strong>{{ formatDate(session.started_at) }}</strong><small>{{ session.cwd || 'Diretório não informado' }}</small><span class="session-count">{{ session.observation_count }} observações</span></button><p v-if="sessionsLoading" class="empty-state">Carregando sessões…</p><p v-else-if="sessions.length === 0 && !apiError" class="empty-state">Nenhuma sessão visível neste projeto.</p></div></section>
        <section class="session-detail"><template v-if="selectedSession"><header><span class="session-agent">{{ selectedSession.agent_kind || 'Agente' }}</span><h2>{{ formatDate(selectedSession.started_at) }}</h2><p>{{ selectedSession.cwd || 'Diretório não informado' }}</p><div class="session-meta"><span>{{ selectedSession.ended_at ? `Encerrada ${formatDate(selectedSession.ended_at)}` : 'Sessão em andamento' }}</span><span>{{ sessionTotal }} observações</span><span v-if="selectedSession.consolidation">Consolidação: {{ selectedSession.consolidation.state }}</span></div></header><div class="observation-list"><article v-for="observation in observations" :key="observation.id" class="observation-card"><div><strong>{{ observation.title || observation.kind }}</strong><time>{{ formatDate(observation.created_at) }}</time></div><pre>{{ observation.body || 'Sem conteúdo registrado.' }}</pre></article><p v-if="observationLoading" class="empty-state">Carregando observações…</p><p v-else-if="observations.length === 0 && !apiError" class="empty-state">Esta sessão não possui observações visíveis no projeto.</p><button v-if="observations.length < sessionTotal" class="load-more" :disabled="observationLoading" @click="loadSessionObservations(selectedSession!, observations.length)">Carregar mais observações</button></div></template><p v-else class="empty-state">Selecione uma sessão para revisar as observações.</p></section>
      </div>
      <div v-else class="workspace">
        <section class="memory-list"><div class="list-toolbar"><div class="list-view-controls"><button class="view-mode" :class="{ active: !categoryMode }" @click="categoryMode = false">Todas</button><button class="view-mode" :class="{ active: categoryMode }" @click="categoryMode = true; currentDirectory = ''">Categorias</button><span>{{ categoryMode ? `${filtered.length} memórias` : `${memories.length} resultados` }}</span></div><button v-if="!categoryMode" class="sort-label">Atualizadas recentemente ↓</button><div v-else class="folder-breadcrumb"><button @click="currentDirectory = ''">Todas as categorias</button><template v-for="(part, index) in directoryBreadcrumbs" :key="`${part}-${index}`"><span>/</span><button :class="{ current: index === directoryBreadcrumbs.length - 1 }" @click="currentDirectory = directoryBreadcrumbs.slice(0, index + 1).join('/')">{{ part }}</button></template></div></div><div v-if="categoryMode && directoryContents.folders.length" class="folder-grid"><button v-for="folder in directoryContents.folders" :key="folder.path" class="folder-card" @click="currentDirectory = folder.path"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l2 2h9v9h-17zM3.5 7.5v-2h6l2 2"/></svg><span><strong>{{ folder.name }}</strong><small>{{ folder.count }} {{ folder.count === 1 ? 'memória' : 'memórias' }}</small></span><b>›</b></button></div><div class="memory-rows"><section v-for="group in memoryDateGroups" :key="group.label" class="memory-date-group"><h3>{{ group.label }}</h3><button v-for="memory in group.items" :key="memory.path" class="memory-row" :class="{ selected: selectedPath === memory.path }" @click="selectedPath = memory.path"><i class="kind-badge" :class="memory.kind.toLowerCase()">{{ memory.kind[0] }}</i><span class="memory-copy"><strong>{{ memory.title }} <em v-if="memory.pinned">⌖</em></strong><small>{{ memory.summary }}</small><span class="tag-row"><b v-for="tag in memory.tags" :key="tag">{{ tag }}</b></span></span><time>{{ memory.updated }}</time></button></section><p v-if="loading" class="empty-state">Carregando páginas…</p><p v-else-if="filtered.length === 0 && directoryContents.folders.length === 0 && !apiError" class="empty-state">{{ categoryMode ? 'Esta categoria não contém memórias.' : 'Nenhuma memória encontrada.' }}</p></div></section>
        <aside v-if="selected" class="detail-panel"><div class="detail-actions"><span class="status-chip">● {{ detailLoading ? 'Carregando' : 'Página' }}</span><button>···</button></div><span class="detail-type">{{ selected.kind }}</span><h2>{{ selected.title }}</h2><p class="detail-path">{{ selected.path }}</p><pre class="markdown-body">{{ selectedPage?.bodyMarkdown || selected.summary }}</pre><div class="detail-section"><h3>Etiquetas</h3><span class="tag-row detail-tags"><b v-for="tag in selected.tags" :key="tag"># {{ tag }}</b><span v-if="selected.tags.length === 0">Sem etiquetas</span></span></div><div class="detail-section metadata"><h3>Informações</h3><p><span>Atualizada</span><strong>{{ selected.updated || '—' }}</strong></p><p><span>Origem</span><strong>ai-memory</strong></p></div><div class="detail-footer"><button :disabled="!canAdmin || !selectedPage || detailLoading" :title="canAdmin ? 'Editar Markdown' : 'Configure um bearer root para escrever'" @click="openPageEditor">Editar Markdown</button><button :disabled="!canAdmin || !selectedPage || detailLoading" :title="canAdmin ? 'Gerenciar conexões' : 'Configure um bearer root para escrever'" @click="openConnections">Conexões</button></div></aside>
      </div>
    </section>
    <div v-if="scopeDialog" class="dialog-backdrop" @click.self="closeScopeDialog" @keydown.esc="closeScopeDialog">
      <section class="scope-dialog" role="dialog" aria-modal="true" aria-labelledby="scope-dialog-title">
        <button class="dialog-close" aria-label="Fechar" :disabled="scopeDialog.busy" @click="closeScopeDialog"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        <div class="dialog-symbol" :class="{ destructive: scopeDialog.action === 'delete' }"><svg viewBox="0 0 24 24" aria-hidden="true"><template v-if="scopeDialog.action === 'rename'"><path d="m15 5 4 4M4 20l4-.8L19.5 7.7a2.1 2.1 0 0 0-3-3L5 16.2 4 20Z"/></template><template v-else><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></template></svg></div>
        <p class="dialog-eyebrow">{{ scopeDialog.kind === 'project' ? 'Projeto' : 'Workspace' }} · {{ scopeDialog.action === 'rename' ? 'Organização' : 'Ação irreversível' }}</p>
        <h2 id="scope-dialog-title">{{ scopeDialog.action === 'rename' ? `Renomear ${scopeDialog.kind === 'project' ? 'projeto' : 'workspace'}` : scopeDialog.step === 'confirm' ? 'Confirme a exclusão' : 'Excluir com segurança' }}</h2>
        <template v-if="scopeDialog.action === 'rename'">
          <p class="dialog-description">O nome novo será aplicado ao escopo <strong>{{ scopeDialog.current }}</strong>.</p>
          <label class="dialog-field">Novo nome<input v-model="scopeDialog.value" autofocus maxlength="200" @keydown.enter="submitScopeDialog"></label>
        </template>
        <template v-else>
          <p v-if="scopeDialog.step === 'form' || scopeDialog.step === 'preview'" class="dialog-description">Vamos consultar o impacto antes de remover <strong>{{ scopeDialog.current }}</strong>. Nenhum dado é apagado durante a prévia.</p>
          <p v-else class="dialog-description">Esta ação não pode ser desfeita. Para confirmar, digite exatamente o nome do {{ scopeDialog.kind }} abaixo: <strong>{{ scopeDialog.current }}</strong></p>
          <div v-if="scopeDialog.busy" class="dialog-loading"><span class="loading-spinner"></span><span>Consultando o ai-memory…</span></div>
          <div v-if="scopeDialog.preview && scopeDialog.step !== 'form'" class="impact-card"><h3><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4m0 3h.01"/></svg>Impacto estimado</h3><ul><li v-for="line in summaryCounts(scopeDialog.preview).split('\n')" :key="line">{{ line }}</li></ul><small>A prévia não contabiliza todos os possíveis efeitos indiretos do serviço.</small></div>
          <label v-if="scopeDialog.step === 'confirm'" class="dialog-field">{{ scopeDialog.current }}<input v-model="scopeDialog.value" autocomplete="off" spellcheck="false" placeholder="Digite o nome exatamente como aparece acima" @keydown.enter="submitScopeDialog"></label>
        </template>
        <p v-if="scopeDialog.error" class="dialog-error" role="alert"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5m0 3h.01"/></svg>{{ scopeDialog.error }}</p>
        <footer class="dialog-actions"><button class="dialog-secondary" :disabled="scopeDialog.busy" @click="closeScopeDialog">Cancelar</button><button v-if="scopeDialog.action === 'rename'" class="dialog-primary" :disabled="scopeDialog.busy || !scopeDialog.value.trim() || scopeDialog.value.trim() === scopeDialog.current" @click="submitScopeDialog">{{ scopeDialog.busy ? 'Salvando…' : 'Salvar nome' }}</button><button v-else-if="scopeDialog.step === 'preview'" class="dialog-primary danger-button" :disabled="scopeDialog.busy" @click="submitScopeDialog">Continuar para confirmação</button><button v-else-if="scopeDialog.step === 'confirm'" class="dialog-primary danger-button" :disabled="scopeDialog.busy || scopeDialog.value !== scopeDialog.current" @click="submitScopeDialog">{{ scopeDialog.busy ? 'Excluindo…' : 'Excluir permanentemente' }}</button></footer>
      </section>
    </div>
    <div v-if="pageEditorOpen" class="dialog-backdrop" @click.self="pageEditorOpen = false" @keydown.esc="pageEditorOpen = false">
      <section class="scope-dialog editor-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-title"><button class="dialog-close" aria-label="Fechar editor" :disabled="pageEditorBusy" @click="pageEditorOpen = false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><div class="dialog-symbol"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-.8L19.5 7.7a2.1 2.1 0 0 0-3-3L5 16.2 4 20Z"/></svg></div><p class="dialog-eyebrow">{{ selectedPage?.path }}</p><h2 id="editor-title">Editar Markdown</h2><p class="dialog-description">As alterações serão gravadas no ai-memory e versionadas pelo serviço.</p><div class="editor-tabs" role="tablist" aria-label="Modo do editor"><button role="tab" :aria-selected="pageEditorMode === 'code'" :class="{ active: pageEditorMode === 'code' }" @click="pageEditorMode = 'code'">Código</button><button role="tab" :aria-selected="pageEditorMode === 'markdown'" :class="{ active: pageEditorMode === 'markdown' }" @click="pageEditorMode = 'markdown'">Prévia Markdown</button></div><textarea v-if="pageEditorMode === 'code'" v-model="pageEditorBody" class="markdown-editor" spellcheck="false" aria-label="Código Markdown"></textarea><div v-else class="markdown-preview" role="tabpanel" v-html="renderMarkdownPreview(pageEditorBody)"></div><p v-if="pageEditorError" class="dialog-error" role="alert">{{ pageEditorError }}</p><footer class="dialog-actions"><button class="dialog-secondary" :disabled="pageEditorBusy" @click="pageEditorOpen = false">Cancelar</button><button class="dialog-primary" :disabled="pageEditorBusy" @click="savePageMarkdown">{{ pageEditorBusy ? 'Salvando…' : 'Salvar Markdown' }}</button></footer></section>
    </div>
    <div v-if="connectionsOpen" class="dialog-backdrop" @click.self="connectionsOpen = false" @keydown.esc="connectionsOpen = false">
      <section class="scope-dialog connections-dialog" role="dialog" aria-modal="true" aria-labelledby="connections-title"><button class="dialog-close" aria-label="Fechar conexões" :disabled="connectionBusy" @click="connectionsOpen = false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><div class="dialog-symbol"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.9 7.5-3.7M8.2 13.1l7.5 3.7"/></svg></div><p class="dialog-eyebrow">{{ selectedPage?.path }}</p><h2 id="connections-title">Conexões da memória</h2><p class="dialog-description">Defina relações tipadas entre esta página e outras memórias do projeto.</p><div class="connection-adder"><select v-model="connectionType" aria-label="Tipo de relação"><option value="causes">Causa</option><option value="fixes">Resolve</option><option value="contradicts">Contradiz</option></select><select v-model="connectionTarget" aria-label="Memória relacionada"><option value="">Escolha uma memória…</option><option v-for="memory in memories.filter(item => item.path !== selectedPage?.path)" :key="memory.path" :value="memory.path">{{ memory.title }} — {{ memory.path }}</option></select><button class="dialog-primary" :disabled="!connectionTarget" @click="addConnection">Adicionar</button></div><div class="connection-groups"><section v-for="kind in relationTypes" :key="kind"><h3>{{ kind === 'causes' ? 'Causa' : kind === 'fixes' ? 'Resolve' : 'Contradiz' }}</h3><div v-if="relationDraft[kind].length" class="connection-chips"><span v-for="target in relationDraft[kind]" :key="target">{{ target }}<button :aria-label="`Remover relação ${target}`" @click="removeConnection(kind, target)">×</button></span></div><small v-else>Nenhuma conexão</small></section></div><div v-if="selectedPage?.links?.length || selectedPage?.backlinks?.length" class="resolved-links"><h3>Links já encontrados no Markdown</h3><button v-for="link in selectedPage?.links" :key="`out-${link.path}`" @click="selectedPath = link.path; connectionsOpen = false">↗ {{ link.title || link.path }}<small>link de saída</small></button><button v-for="link in selectedPage?.backlinks" :key="`in-${link.path}`" @click="selectedPath = link.path; connectionsOpen = false">↙ {{ link.title || link.path }}<small>referencia esta página</small></button></div><p v-if="connectionError" class="dialog-error" role="alert">{{ connectionError }}</p><footer class="dialog-actions"><button class="dialog-secondary" :disabled="connectionBusy" @click="connectionsOpen = false">Cancelar</button><button class="dialog-primary" :disabled="connectionBusy" @click="saveConnections">{{ connectionBusy ? 'Salvando…' : 'Salvar conexões' }}</button></footer></section>
    </div>
  </main>
</template>
