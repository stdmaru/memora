<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LoginView from './components/LoginView.vue'
import SetupView from './components/SetupView.vue'
import OverviewSection from './features/overview/OverviewSection.vue'
import MemoryLibrary from './features/memories/MemoryLibrary.vue'
import SessionsSection from './features/sessions/SessionsSection.vue'
import ProjectsSection from './features/projects/ProjectsSection.vue'
import TrashSection from './features/trash/TrashSection.vue'
import RelationsSection from './features/relations/RelationsSection.vue'
import SettingsSection from './features/settings/SettingsSection.vue'
import { requestManagerApi } from './services/manager-api'
import type {
  AuthUser,
  BulkDeleteDialog,
  CategoryCreateDialog,
  ConnectionStatus,
  Memory,
  Observation,
  OverviewResponse,
  PageLink,
  PageSummary,
  ProjectSummary,
  RelationEntry,
  ScopeCreateDialog,
  ScopeDialog,
  ScopeResponse,
  Session,
  SessionDetail,
  Theme,
  TrashEntry,
  WorkspaceSummary,
} from './types/domain'

const sections = ['Visão geral', 'Memórias', 'Sessões', 'Relações', 'Projetos', 'Lixeira']
const setupChecked = ref(false)
const setupRequired = ref(false)
const setupError = ref('')
const authError = ref('')
const currentUser = ref<AuthUser | null>(null)
const scopeCreationNotice = ref('')
let initializingPanel = false
let observationRequestId = 0
let detailRequestId = 0
let relationRequestId = 0
let sessionIndexRequestId = 0
const relationTypes = ['causes', 'fixes', 'contradicts'] as const
const relationMemories = ref<Memory[]>([])
const relationLoading = ref(false)
const relationError = ref('')
const memories = ref<Memory[]>([])
const sessions = ref<Session[]>([])
const selectedSession = ref<Session | null>(null)
const sessionIndex = ref<Session[]>([])
const sessionIndexError = ref('')
const observations = ref<Observation[]>([])
const sessionTotal = ref(0)
const sessionsLoading = ref(false)
const observationLoading = ref(false)
const workspaces = ref<WorkspaceSummary[]>([])
const projects = ref<ProjectSummary[]>([])
const scopesLoading = ref(true)
const trashEntries = ref<TrashEntry[]>([])
const trashLoading = ref(false)
const trashError = ref('')
const trashMessage = ref('')
const restoreDialog = ref<{ entry: TrashEntry; busy: boolean; error: string } | null>(null)
const pageDeleteDialog = ref<{ path: string; value: string; busy: boolean; error: string } | null>(null)
const bulkDeleteDialog = ref<BulkDeleteDialog | null>(null)
const categoryCreateDialog = ref<CategoryCreateDialog | null>(null)
const selectedMemoryPaths = ref<string[]>([])
const memoryActionNotice = ref('')
const hideSessions = ref(false)
const canAdmin = ref(false)
const scopeDialog = ref<ScopeDialog | null>(null)
const scopeCreateDialog = ref<ScopeCreateDialog | null>(null)
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
const themeError = ref('')
const passwordBusy = ref(false)
const passwordError = ref('')
const passwordMessage = ref('')
const connectionStatus = ref('Conectando…')
const theme = ref<Theme>('system')
const themeMenuOpen = ref(false)
const persistedSettings = ref<{ scope?: { workspace: string; project: string } }>({})
const settingsReady = ref(false)
const connectionConfig = ref<ConnectionStatus>({ configured: false, endpoint: '', hasReadToken: false, hasAdminToken: false })
const nodeConfigBusy = ref(false)
const nodeConfigError = ref('')
const nodeConfigMessage = ref('')
let systemTheme: MediaQueryList | undefined
let searchTimer: ReturnType<typeof setTimeout> | undefined
const workspaceProjects = computed(() => projects.value.filter(project => project.workspace_name === selectedWorkspace.value))
const projectsByWorkspace = computed(() => workspaces.value.map(workspace => ({ ...workspace, projects: projects.value.filter(project => project.workspace_name === workspace.workspace_name) })))
function isSessionMemory(memory: Memory) {
  return memory.kind.toLowerCase() === 'session' || /^sessions\//i.test(memory.path)
}
const selected = computed(() => selectedPage.value
  ?? memories.value.find(memory => memory.path === selectedPath.value && (!hideSessions.value || !isSessionMemory(memory)))
  ?? memories.value.find(memory => !hideSessions.value || !isSessionMemory(memory)))
function compareMemoriesByUpdatedAt(a: Memory, b: Memory) {
  const aUpdated = a.updatedAt ? Date.parse(a.updatedAt) : NaN
  const bUpdated = b.updatedAt ? Date.parse(b.updatedAt) : NaN
  if (Number.isFinite(aUpdated) && Number.isFinite(bUpdated) && aUpdated !== bUpdated) return bUpdated - aUpdated
  if (Number.isFinite(aUpdated) !== Number.isFinite(bUpdated)) return Number.isFinite(aUpdated) ? -1 : 1
  return a.path.localeCompare(b.path)
}
const directoryContents = computed(() => {
  const prefix = currentDirectory.value ? `${currentDirectory.value}/` : ''
  const folders = new Map<string, number>()
  const pages: Memory[] = []
  for (const memory of memories.value) {
    if (hideSessions.value && isSessionMemory(memory)) continue
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
    pages: pages.sort(compareMemoriesByUpdatedAt),
  }
})
const filtered = computed(() => categoryMode.value ? directoryContents.value.pages : memories.value.filter(memory => !hideSessions.value || !isSessionMemory(memory)))
const visibleMemoryPaths = computed(() => filtered.value.map(memory => memory.path))
const selectedVisibleMemoryCount = computed(() => selectedMemoryPaths.value.filter(path => visibleMemoryPaths.value.includes(path)).length)
const allVisibleMemoriesSelected = computed(() => visibleMemoryPaths.value.length > 0 && visibleMemoryPaths.value.every(path => selectedMemoryPaths.value.includes(path)))
function toggleMemorySelection(path: string, checked: boolean) {
  selectedMemoryPaths.value = checked
    ? [...new Set([...selectedMemoryPaths.value, path])]
    : selectedMemoryPaths.value.filter(selectedPath => selectedPath !== path)
}
function toggleVisibleMemorySelection(checked: boolean) {
  selectedMemoryPaths.value = checked
    ? [...new Set([...selectedMemoryPaths.value, ...visibleMemoryPaths.value])]
    : selectedMemoryPaths.value.filter(path => !visibleMemoryPaths.value.includes(path))
}
function memorySessionBadge(memory: Memory) {
  if (!isSessionMemory(memory)) return ''
  const metadataSessionId = memory.frontmatter?.session_id
  const pathSessionId = memory.path.match(/(?:^|\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.md$/i)?.[1]
  const sessionId = typeof metadataSessionId === 'string' ? metadataSessionId : pathSessionId
  const session = sessionId ? sessionIndex.value.find(item => item.session_id === sessionId) : undefined
  if (session?.consolidation?.state === 'completed') return 'Sessão consolidada'
  return sessionId ? 'Não consolidada · Sessão' : 'Sessão'
}

function toggleHideSessions(checked: boolean) {
  hideSessions.value = checked
  if (checked && selected.value && isSessionMemory(selected.value)) {
    selectedPage.value = null
    selectedPath.value = memories.value.find(memory => !isSessionMemory(memory))?.path || ''
  }
}

async function loadSessionIndex() {
  const requestId = ++sessionIndexRequestId
  const workspace = selectedWorkspace.value
  const project = selectedProject.value
  if (!selectedWorkspace.value || !selectedProject.value) {
    sessionIndex.value = []
    sessionIndexError.value = ''
    return
  }
  sessionIndexError.value = ''
  try {
    const result = await api<Session[]>(`sessions?workspace=${encodeURIComponent(workspace)}&project=${encodeURIComponent(project)}`)
    if (requestId === sessionIndexRequestId && workspace === selectedWorkspace.value && project === selectedProject.value) sessionIndex.value = result
  } catch (error) {
    if (requestId === sessionIndexRequestId && workspace === selectedWorkspace.value && project === selectedProject.value) {
      sessionIndexError.value = error instanceof Error ? error.message : 'Não foi possível consultar o estado de consolidação das sessões.'
    }
  }
}

function groupByDate<T>(items: T[], getDate: (item: T) => string | undefined) {
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000
  const typedGroups = new Map<string, T[]>()
  for (const item of items) {
    const value = getDate(item)
    const timestamp = value ? new Date(value).getTime() : NaN
    const dayStart = Number.isFinite(timestamp) ? new Date(timestamp).setHours(0, 0, 0, 0) : NaN
    const label = dayStart === startOfToday ? 'Hoje' : dayStart === startOfYesterday ? 'Ontem' : Number.isFinite(dayStart) ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(dayStart) : 'Sem data'
    if (!typedGroups.has(label)) typedGroups.set(label, [])
    typedGroups.get(label)!.push(item)
  }
  return [...typedGroups].map(([label, groupedItems]) => ({ label, items: groupedItems }))
}
const memoryDateGroups = computed(() => groupByDate(filtered.value, memory => memory.updatedAt))
const overviewPageDateGroups = computed(() => groupByDate(overview.value?.briefing.recent_pages || [], page => page.updated_at))
const sessionDateGroups = computed(() => groupByDate(sessions.value, session => session.started_at))
const relationEntries = computed<RelationEntry[]>(() => {
  const pagesByPath = new Map(relationMemories.value.map(page => [page.path, page]))
  const entries: RelationEntry[] = []
  const seen = new Set<string>()
  const add = (source: Memory, targetPath: string, kind: string, fallbackTitle?: string) => {
    if (!targetPath || targetPath === source.path) return
    const key = `${source.path}\0${kind}\0${targetPath}`
    if (seen.has(key)) return
    seen.add(key)
    entries.push({ source, targetPath, targetTitle: pagesByPath.get(targetPath)?.title || fallbackTitle || targetPath, kind })
  }
  for (const page of relationMemories.value) {
    const rawRelations = page.frontmatter?.relations
    if (rawRelations && typeof rawRelations === 'object') {
      for (const kind of relationTypes) {
        const targets = (rawRelations as Record<string, unknown>)[kind]
        if (Array.isArray(targets)) for (const target of targets) add(page, String(target), kind)
        else if (typeof targets === 'string') add(page, targets, kind)
      }
    }
    for (const link of page.links || []) add(page, link.path, 'link', link.title)
  }
  return entries
})
const directoryBreadcrumbs = computed(() => currentDirectory.value ? currentDirectory.value.split('/') : [])

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  return requestManagerApi(path, options, () => {
    if (currentUser.value) {
      currentUser.value = null
      authError.value = 'Sua sessão expirou. Entre novamente.'
    }
  })
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
    memories.value = pages.map(fromSummary).sort(compareMemoriesByUpdatedAt)
    if (!memories.value.some(page => page.path === selectedPath.value)) selectedPath.value = memories.value[0]?.path || ''
  } catch (error) {
    apiError.value = error instanceof Error ? error.message : 'Falha ao carregar memórias.'
    memories.value = []
    selectedPath.value = ''
    selectedPage.value = null
    connectionStatus.value = 'Sem conexão'
  } finally { loading.value = false }
}

async function loadRelations() {
  const workspace = selectedWorkspace.value
  const project = selectedProject.value
  const requestId = ++relationRequestId
  if (!workspace || !project) {
    relationMemories.value = []
    relationLoading.value = false
    relationError.value = ''
    return
  }

  relationLoading.value = true
  relationError.value = ''
  const scope = `workspace=${encodeURIComponent(workspace)}&project=${encodeURIComponent(project)}`
  try {
    const summaries = await api<PageSummary[]>(`pages?${scope}&limit=100`)
    const detailedPages: Memory[] = []
    for (let start = 0; start < summaries.length; start += 8) {
      if (requestId !== relationRequestId) return
      const batch = summaries.slice(start, start + 8)
      const pages = await Promise.all(batch.map(async summary => {
        const path = summary.path.split('/').map(encodeURIComponent).join('/')
        const detail = await api<PageSummary & { body_markdown: string; frontmatter: Record<string, unknown>; links?: PageLink[]; backlinks?: PageLink[]; tier?: string }>(`page?${scope}&path=${path}`)
        return {
          ...fromSummary({ ...summary, ...detail, snippet: summary.snippet }),
          summary: summary.snippet || '',
          bodyMarkdown: detail.body_markdown,
          frontmatter: detail.frontmatter || {},
          links: detail.links || [],
          backlinks: detail.backlinks || [],
        }
      }))
      detailedPages.push(...pages)
    }
    if (requestId === relationRequestId) relationMemories.value = detailedPages
  } catch (error) {
    if (requestId !== relationRequestId) return
    relationMemories.value = []
    relationError.value = error instanceof Error ? error.message : 'Não foi possível carregar as relações deste projeto.'
  } finally {
    if (requestId === relationRequestId) relationLoading.value = false
  }
}

async function loadSessions() {
  if (!selectedWorkspace.value || !selectedProject.value) {
    sessions.value = []
    sessionsLoading.value = false
    return
  }
  sessionsLoading.value = true
  apiError.value = ''
  try {
    sessions.value = await api<Session[]>(`sessions?${scopeQuery()}`)
    sessionIndex.value = sessions.value
    sessionIndexError.value = ''
    if (!sessions.value.some(session => session.session_id === selectedSession.value?.session_id)) {
      selectedSession.value = sessions.value[0] || null
      observations.value = []
      if (selectedSession.value) void loadSessionObservations(selectedSession.value)
    }
  } catch (error) {
    apiError.value = error instanceof Error ? error.message : 'Não foi possível listar as sessões.'
    sessions.value = []
    sessionIndex.value = []
    sessionIndexError.value = error instanceof Error ? error.message : 'Não foi possível consultar o estado de consolidação das sessões.'
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
  const requestId = ++observationRequestId
  selectedSession.value = session
  if (offset === 0) {
    observations.value = []
    sessionTotal.value = 0
  }
  observationLoading.value = true
  try {
    const detail = await api<SessionDetail>(`session-observations?${scopeQuery()}&session_id=${encodeURIComponent(session.session_id)}&offset=${offset}`)
    if (requestId !== observationRequestId) return
    observations.value = offset ? [...observations.value, ...(detail.observations || [])] : (detail.observations || [])
    sessionTotal.value = detail.total || 0
  } catch (error) {
    if (requestId !== observationRequestId) return
    apiError.value = error instanceof Error ? error.message : 'Não foi possível abrir as observações da sessão.'
    observations.value = []
  } finally {
    if (requestId === observationRequestId) observationLoading.value = false
  }
}

async function loadSelectedPage(path: string) {
  const requestId = ++detailRequestId
  if (!path) {
    selectedPage.value = null
    detailLoading.value = false
    return
  }
  detailLoading.value = true
  try {
    const page = await api<PageSummary & { body_markdown: string; frontmatter: Record<string, unknown>; links?: PageLink[]; backlinks?: PageLink[]; tier?: string }>(`page?${scopeQuery()}&path=${encodeURIComponent(path)}`)
    if (requestId !== detailRequestId) return
    selectedPage.value = {
      ...fromSummary(page), summary: page.body_markdown, bodyMarkdown: page.body_markdown,
      tags: Array.isArray(page.frontmatter?.tags) ? page.frontmatter.tags.map(String) : [],
      pinned: Boolean(page.frontmatter?.pinned),
      frontmatter: page.frontmatter, tier: page.tier || String(page.frontmatter?.tier || 'semantic'),
      links: page.links || [], backlinks: page.backlinks || [],
    }
  } catch (error) {
    if (requestId === detailRequestId) apiError.value = error instanceof Error ? error.message : 'Não foi possível abrir a memória.'
  } finally {
    if (requestId === detailRequestId) detailLoading.value = false
  }
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
  scopesLoading.value = true
  try {
    const result = await api<ScopeResponse>('scopes')
    workspaces.value = result.workspaces
    projects.value = result.projects
    canAdmin.value = result.canAdmin
    const saved = localStorage.getItem('memora:scope')
    let savedScope: { workspace?: string; project?: string } = {}
    try { savedScope = saved ? JSON.parse(saved) : {} } catch { localStorage.removeItem('memora:scope') }
    savedScope = persistedSettings.value.scope || savedScope
    localStorage.removeItem('memora:scope')
    const workspaceExists = (name: string) => workspaces.value.some(item => item.workspace_name === name)
    const preferredWorkspace = workspaceExists(savedScope.workspace || '') ? savedScope.workspace! : workspaceExists(result.preferred.workspace) ? result.preferred.workspace : workspaces.value[0]?.workspace_name || ''
    selectedWorkspace.value = preferredWorkspace
    const availableProjects = projects.value.filter(project => project.workspace_name === preferredWorkspace)
    selectedProject.value = availableProjects.some(project => project.project_name === savedScope.project)
      ? savedScope.project!
      : availableProjects.some(project => project.project_name === result.preferred.project) ? result.preferred.project : availableProjects[0]?.project_name || ''
  } finally {
    scopesLoading.value = false
  }
}

async function loadTrash() {
  if (!canAdmin.value) { trashEntries.value = []; trashError.value = 'Configure um bearer root administrativo em Configurações para consultar e restaurar checkpoints.'; return }
  trashLoading.value = true
  trashError.value = ''
  trashMessage.value = ''
  try {
    const result = await api<{ items: TrashEntry[]; checkpoint_limit: number }>('trash')
    trashEntries.value = result.items || []
  } catch (error) {
    trashError.value = error instanceof Error ? error.message : 'Não foi possível consultar os checkpoints de exclusão.'
    trashEntries.value = []
  } finally { trashLoading.value = false }
}

function openBulkDeleteDialog(paths: string[], kind: BulkDeleteDialog['kind'], label: string, workspace = selectedWorkspace.value, project = selectedProject.value) {
  if (!canAdmin.value || paths.length === 0) return
  bulkDeleteDialog.value = { kind, label, workspace, project, paths: [...new Set(paths)], completed: 0, busy: false, error: '', failures: [] }
}

function openSelectedMemoriesDeleteDialog() {
  const visiblePaths = new Set(visibleMemoryPaths.value)
  const paths = selectedMemoryPaths.value.filter(path => visiblePaths.has(path))
  openBulkDeleteDialog(paths, 'memories', `${paths.length} memórias selecionadas`)
}

async function openCategoryDeleteDialog(folderPath: string) {
  if (!canAdmin.value) return
  const workspace = selectedWorkspace.value
  const project = selectedProject.value
  const scope = `workspace=${encodeURIComponent(workspace)}&project=${encodeURIComponent(project)}`
  try {
    const allPages = await api<PageSummary[]>(`pages?${scope}&limit=100`)
    const prefix = `${folderPath}/`
    const paths = allPages.filter(page => page.path === folderPath || page.path.startsWith(prefix)).map(page => page.path)
    if (paths.length === 0) {
      memoryActionNotice.value = `A categoria “${folderPath}” não tem memórias para mover.`
      await loadMemories(query.value)
      return
    }
    openBulkDeleteDialog(paths, 'category', folderPath, workspace, project)
  } catch (error) {
    memoryActionNotice.value = error instanceof Error ? error.message : 'Não foi possível consultar o conteúdo completo da categoria.'
  }
}

async function executeBulkDelete() {
  const dialog = bulkDeleteDialog.value
  if (!dialog || dialog.busy || !canAdmin.value) return
  dialog.busy = true
  dialog.error = ''
  dialog.failures = []
  const failedPaths: string[] = []
  const deletedPaths: string[] = []
  for (const path of dialog.paths) {
    try {
      await admin('delete-page', { workspace: dialog.workspace, project: dialog.project, path })
      deletedPaths.push(path)
      dialog.completed += 1
    } catch (error) {
      failedPaths.push(path)
      dialog.failures.push(`${path}: ${error instanceof Error ? error.message : 'falha desconhecida.'}`)
    }
  }

  const sameScope = selectedWorkspace.value === dialog.workspace && selectedProject.value === dialog.project
  if (sameScope) {
    if (deletedPaths.includes(selectedPath.value)) {
      selectedPage.value = null
      selectedPath.value = ''
    }
    selectedMemoryPaths.value = selectedMemoryPaths.value.filter(path => failedPaths.includes(path))
    await Promise.all([loadMemories(query.value), loadTrash()])
  }
  if (failedPaths.length) {
    dialog.paths = failedPaths
    dialog.completed = 0
    dialog.error = `${deletedPaths.length} memória(s) movida(s) para a Lixeira. ${failedPaths.length} não foi(ram) excluída(s); revise os erros e tente novamente.`
  } else {
    const total = deletedPaths.length
    const label = dialog.kind === 'category' ? `Categoria “${dialog.label}”` : 'Memórias selecionadas'
    memoryActionNotice.value = `${label}: ${total} memória(s) movida(s) para a Lixeira.`
    bulkDeleteDialog.value = null
  }
  if (bulkDeleteDialog.value) bulkDeleteDialog.value.busy = false
}

function openCategoryCreateDialog() {
  if (!canAdmin.value || !categoryMode.value) return
  categoryCreateDialog.value = { name: '', busy: false, error: '' }
}

function closeCategoryCreateDialog() {
  if (!categoryCreateDialog.value?.busy) categoryCreateDialog.value = null
}

async function submitCategoryCreateDialog() {
  const dialog = categoryCreateDialog.value
  if (!dialog || dialog.busy) return
  dialog.error = ''
  const name = dialog.name.trim()
  if (!name || name === '.' || name === '..' || /[\\/#?%]/.test(name)) {
    dialog.error = 'Informe um nome de categoria válido, sem barras ou caracteres de caminho.'
    return
  }
  if (name.length > 120) {
    dialog.error = 'O nome da categoria deve ter até 120 caracteres.'
    return
  }

  dialog.busy = true
  const workspace = selectedWorkspace.value
  const project = selectedProject.value
  const scope = `workspace=${encodeURIComponent(workspace)}&project=${encodeURIComponent(project)}`
  const folderPath = currentDirectory.value ? `${currentDirectory.value}/${name}` : name
  const pagePath = `${folderPath}/overview.md`
  try {
    const allPages = await api<PageSummary[]>(`pages?${scope}&limit=100`)
    if (allPages.some(page => page.path === folderPath || page.path.startsWith(`${folderPath}/`))) {
      dialog.error = 'Já existe uma categoria ou memória com esse caminho.'
      return
    }
    await admin('write-page', {
      workspace, project, path: pagePath, title: name, kind: 'fact', tier: 'semantic',
      body: `# ${name}\n\nEsta memória inicial organiza a categoria “${name}”.\n`,
    })
    categoryCreateDialog.value = null
    selectedMemoryPaths.value = []
    query.value = ''
    memoryActionNotice.value = `A categoria “${folderPath}” foi criada com sua memória inicial.`
    await loadMemories('')
  } catch (error) {
    dialog.error = error instanceof Error ? error.message : 'Não foi possível criar a categoria.'
  } finally {
    if (categoryCreateDialog.value === dialog) dialog.busy = false
  }
}

function openProject(project: ProjectSummary) {
  selectedWorkspace.value = project.workspace_name
  selectedProject.value = project.project_name
  activeSection.value = 'Visão geral'
}

async function loadSectionData(section: string, includeMemory = true) {
  if (!connectionConfig.value.configured) return
  if (section === 'Sessões') await loadSessions()
  else if (section === 'Visão geral') await loadOverview()
  else if (section === 'Lixeira') await loadTrash()
  else if (section === 'Relações') await loadRelations()
  else if (includeMemory && section === 'Memórias') await Promise.all([loadMemories(query.value), loadSessionIndex()])
}

async function initializePanel() {
  initializingPanel = true
  try {
    persistedSettings.value = await api<{ scope?: { workspace: string; project: string } }>('settings')
    try {
      connectionConfig.value = await api<ConnectionStatus>('connection')
    } catch (error) {
      connectionConfig.value = { configured: false, endpoint: '', hasReadToken: false, hasAdminToken: false }
      connectionStatus.value = 'Sem conexão'
      nodeConfigError.value = error instanceof Error ? error.message : 'Não foi possível consultar a configuração do node.'
      activeSection.value = 'Configurações'
      workspaces.value = []
      projects.value = []
      memories.value = []
      selectedWorkspace.value = ''
      selectedProject.value = ''
      scopesLoading.value = false
      loading.value = false
      settingsReady.value = true
      return
    }
    if (!connectionConfig.value.configured) {
      activeSection.value = 'Configurações'
      connectionStatus.value = 'ai-memory desconectado'
      workspaces.value = []
      projects.value = []
      memories.value = []
      sessions.value = []
      relationMemories.value = []
      trashEntries.value = []
      selectedWorkspace.value = ''
      selectedProject.value = ''
      selectedPath.value = ''
      selectedPage.value = null
      scopesLoading.value = false
      loading.value = false
      settingsReady.value = true
      return
    }
    try {
      await api<{ level: string; version: string }>('identity')
      connectionStatus.value = 'ai-memory conectado'
    } catch {
      connectionStatus.value = 'Sem conexão'
    }
    await loadScopes()
    settingsReady.value = true
    await Promise.all([
      loadMemories(query.value),
      ...(activeSection.value === 'Memórias' ? [loadSessionIndex()] : []),
      ...(activeSection.value === 'Visão geral' ? [loadOverview()] : []),
      ...(activeSection.value === 'Sessões' ? [loadSessions()] : []),
      ...(activeSection.value === 'Lixeira' ? [loadTrash()] : []),
    ])
  } finally {
    initializingPanel = false
  }
}

function activateAppTheme(preference: Theme) {
  theme.value = preference
  if (!systemTheme) systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
  systemTheme.removeEventListener('change', onSystemThemeChange)
  systemTheme.addEventListener('change', onSystemThemeChange)
  applyTheme()
}

async function startAuthenticatedSession(user?: AuthUser | null) {
  const authenticatedUser = user === undefined ? (await api<{ user: AuthUser | null }>('auth/session')).user : user
  if (!authenticatedUser) throw new Error('Não foi possível iniciar a sessão. Entre novamente.')
  currentUser.value = authenticatedUser
  setupChecked.value = true
  activateAppTheme(authenticatedUser.theme)
  await initializePanel()
}

async function continueFromSetup() {
  setupRequired.value = false
  try {
    await startAuthenticatedSession()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível iniciar a sessão.'
    if (currentUser.value) apiError.value = message
    else authError.value = message
  }
}

async function completeLogin() {
  authError.value = ''
  try {
    await startAuthenticatedSession()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível abrir o painel.'
    if (currentUser.value) apiError.value = message
    else authError.value = message
  }
}

async function logout() {
  try {
    await api<{ loggedOut: boolean }>('auth/logout', { method: 'POST' })
    currentUser.value = null
    window.location.reload()
  } catch (error) {
    apiError.value = error instanceof Error ? error.message : 'Não foi possível encerrar a sessão.'
  }
}

function openPageDeleteDialog() {
  if (!selectedPage.value || !canAdmin.value) return
  pageDeleteDialog.value = { path: selectedPage.value.path, value: '', busy: false, error: '' }
}

async function deleteSelectedPage() {
  const dialog = pageDeleteDialog.value
  if (!dialog || dialog.busy || dialog.value !== dialog.path) return
  dialog.busy = true
  dialog.error = ''
  try {
    await admin('delete-page', { workspace: selectedWorkspace.value, project: selectedProject.value, path: dialog.path })
    pageDeleteDialog.value = null
    selectedPage.value = null
    selectedPath.value = ''
    await Promise.all([loadMemories(query.value), loadTrash()])
    trashMessage.value = `“${dialog.path}” foi removida e pode ser restaurada pela Lixeira.`
  } catch (error) {
    dialog.error = error instanceof Error ? error.message : 'Não foi possível excluir esta memória.'
  } finally { if (pageDeleteDialog.value) pageDeleteDialog.value.busy = false }
}

async function restoreTrashEntry() {
  const dialog = restoreDialog.value
  if (!dialog || dialog.busy || !dialog.entry.restore_rev) return
  dialog.busy = true
  dialog.error = ''
  try {
    await admin('restore-page', { workspace: dialog.entry.workspace, project: dialog.entry.project, path: dialog.entry.path, rev: dialog.entry.restore_rev })
    const restored = dialog.entry
    restoreDialog.value = null
    await loadTrash()
    if (selectedWorkspace.value === restored.workspace && selectedProject.value === restored.project) await loadMemories(query.value)
    trashMessage.value = `“${restored.path}” foi restaurada em ${restored.workspace} / ${restored.project}.`
  } catch (error) {
    dialog.error = error instanceof Error ? error.message : 'Não foi possível restaurar esta memória.'
  } finally { if (restoreDialog.value) restoreDialog.value.busy = false }
}

function admin(action: string, payload: Record<string, unknown>) {
  return api<Record<string, unknown>>('admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...payload }) })
}

function openScopeCreateDialog(kind: 'project' | 'workspace') {
  if (!canAdmin.value || (kind === 'project' && !selectedWorkspace.value)) return
  scopeCreationNotice.value = ''
  scopeCreateDialog.value = {
    kind,
    workspace: kind === 'workspace' ? '' : selectedWorkspace.value,
    project: '',
    path: 'notes/overview.md',
    title: 'Visão geral',
    body: '# Visão geral\n\nDescreva o propósito e o contexto deste projeto.\n',
    error: '',
    busy: false,
  }
}

function closeScopeCreateDialog() {
  if (!scopeCreateDialog.value?.busy) scopeCreateDialog.value = null
}

async function submitScopeCreateDialog() {
  const dialog = scopeCreateDialog.value
  if (!dialog || dialog.busy) return
  dialog.error = ''
  const workspace = dialog.workspace.trim()
  const project = dialog.project.trim()
  const path = dialog.path.trim()
  const title = dialog.title.trim()
  const body = dialog.body
  if (!workspace || !project) { dialog.error = 'Informe o nome do workspace e do projeto.'; return }
  if (!title) { dialog.error = 'Informe o título da primeira memória.'; return }
  if (!path || path.startsWith('/') || path.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    dialog.error = 'Informe um caminho relativo válido, sem segmentos vazios, "." ou "..".'
    return
  }
  if (!body.trim() || body.length > 1_000_000) { dialog.error = 'O conteúdo da primeira memória deve ter texto e no máximo 1 MB.'; return }

  dialog.busy = true
  let created = false
  try {
    const latest = await api<ScopeResponse>('scopes')
    if (!latest.canAdmin) throw new Error('A criação requer um bearer root configurado em Configurações.')
    if (dialog.kind === 'workspace' && latest.workspaces.some(item => item.workspace_name === workspace)) {
      dialog.error = 'Esse workspace já existe. Escolha outro nome ou crie o projeto dentro dele.'
      return
    }
    if (dialog.kind === 'project' && !latest.workspaces.some(item => item.workspace_name === workspace)) {
      dialog.error = 'Esse workspace não existe mais. Atualize a lista e tente novamente.'
      return
    }
    if (latest.projects.some(item => item.workspace_name === workspace && item.project_name === project)) {
      dialog.error = 'Esse projeto já existe nesse workspace. Escolha outro nome.'
      return
    }

    await admin('write-page', { workspace, project, path, title, body, kind: 'fact', tier: 'semantic' })
    created = true
    scopeCreateDialog.value = null
    const refreshed = await api<ScopeResponse>('scopes')
    workspaces.value = refreshed.workspaces
    projects.value = refreshed.projects
    canAdmin.value = refreshed.canAdmin
    query.value = ''
    selectedPage.value = null
    selectedPath.value = ''
    currentDirectory.value = ''
    selectedWorkspace.value = workspace
    selectedProject.value = project
    activeSection.value = 'Memórias'
  } catch (error) {
    if (created) {
      scopeCreationNotice.value = `O escopo foi criado, mas não foi possível atualizar a lista: ${error instanceof Error ? error.message : 'falha desconhecida.'}`
    } else {
      dialog.error = error instanceof Error ? error.message : 'Não foi possível criar o escopo.'
    }
  } finally {
    if (scopeCreateDialog.value === dialog) dialog.busy = false
  }
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
  if (initializingPanel) return
  if (settingsReady.value) {
    persistedSettings.value.scope = { workspace: selectedWorkspace.value, project: selectedProject.value }
    void api('settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: persistedSettings.value.scope }) }).catch(() => {})
  }
  selectedPage.value = null
  selectedPath.value = ''
  detailRequestId += 1
  detailLoading.value = false
  memories.value = []
  relationRequestId += 1
  relationMemories.value = []
  relationLoading.value = false
  relationError.value = ''
  currentDirectory.value = ''
  sessions.value = []
  sessionIndex.value = []
  sessionIndexError.value = ''
  selectedSession.value = null
  observations.value = []
  sessionTotal.value = 0
  selectedMemoryPaths.value = []
  memoryActionNotice.value = ''
  observationRequestId += 1
  observationLoading.value = false
  void Promise.all([
    loadMemories(query.value),
    loadSectionData(activeSection.value, false),
    ...(activeSection.value === 'Memórias' ? [loadSessionIndex()] : []),
  ])
})

watch(activeSection, section => {
  if (initializingPanel) return
  if (['Sessões', 'Visão geral', 'Lixeira', 'Memórias', 'Relações'].includes(section)) void loadSectionData(section)
})

watch(query, value => {
  clearTimeout(searchTimer)
  selectedMemoryPaths.value = []
  searchTimer = setTimeout(() => void loadMemories(value), 250)
})
watch(selectedPath, path => { selectedPage.value = null; void loadSelectedPage(path) })
watch(currentDirectory, () => { selectedPage.value = null; selectedPath.value = '' })

function applyTheme() {
  const resolved = theme.value === 'system' ? (systemTheme?.matches ? 'dark' : 'light') : theme.value
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
}
function setTheme(next: Theme) {
  theme.value = next
  applyTheme()
  themeMenuOpen.value = false
  void api<{ theme: Theme }>('auth/preferences', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ theme: next }),
  }).then(() => { themeError.value = '' }).catch(error => {
    themeError.value = error instanceof Error ? error.message : 'Não foi possível salvar a aparência.'
  })
}
async function changePassword(passwords: { currentPassword: string; newPassword: string; passwordConfirmation: string }) {
  if (passwordBusy.value) return
  passwordBusy.value = true
  passwordError.value = ''
  passwordMessage.value = ''
  try {
    await api<{ changed: boolean }>('auth/password', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(passwords),
    })
    passwordMessage.value = 'Senha alterada. As outras sessões foram encerradas.'
  } catch (error) {
    passwordError.value = error instanceof Error ? error.message : 'Não foi possível alterar a senha.'
  } finally {
    passwordBusy.value = false
  }
}
async function connectAiMemory(config: {
  endpoint: string
  readToken: string
  adminToken: string
  clearReadToken: boolean
  clearAdminToken: boolean
}) {
  if (nodeConfigBusy.value) return
  nodeConfigBusy.value = true
  nodeConfigError.value = ''
  nodeConfigMessage.value = ''
  try {
    connectionConfig.value = await api<ConnectionStatus>('connection', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    })
    connectionStatus.value = 'ai-memory conectado'
    nodeConfigMessage.value = 'Conexão validada e salva com segurança.'
    apiError.value = ''
    try {
      await initializePanel()
    } catch (error) {
      apiError.value = error instanceof Error ? error.message : 'Conexão salva, mas não foi possível carregar os escopos.'
    }
  } catch (error) {
    nodeConfigError.value = error instanceof Error ? error.message : 'Não foi possível conectar ao node ai-memory.'
  } finally {
    nodeConfigBusy.value = false
  }
}

async function disconnectAiMemory() {
  if (nodeConfigBusy.value) return
  nodeConfigBusy.value = true
  nodeConfigError.value = ''
  nodeConfigMessage.value = ''
  try {
    connectionConfig.value = await api<ConnectionStatus>('connection', { method: 'DELETE' })
    connectionStatus.value = 'ai-memory desconectado'
    nodeConfigMessage.value = 'Node desconectado. As credenciais salvas foram removidas.'
    apiError.value = ''
    canAdmin.value = false
    workspaces.value = []
    projects.value = []
    memories.value = []
    sessions.value = []
    relationMemories.value = []
    trashEntries.value = []
    selectedWorkspace.value = ''
    selectedProject.value = ''
    selectedPath.value = ''
    selectedPage.value = null
    scopesLoading.value = false
    loading.value = false
    activeSection.value = 'Configurações'
  } catch (error) {
    nodeConfigError.value = error instanceof Error ? error.message : 'Não foi possível desconectar o node.'
  } finally {
    nodeConfigBusy.value = false
  }
}
function onSystemThemeChange() { if (theme.value === 'system') applyTheme() }
function retrySetupCheck() { window.location.reload() }
onMounted(() => {
  void (async () => {
    try {
      const setupStatus = await api<{ configured: boolean }>('setup/status')
      setupRequired.value = !setupStatus.configured
      if (!setupRequired.value) {
        const { user } = await api<{ user: AuthUser | null }>('auth/session')
        if (user) await startAuthenticatedSession(user)
      }
      setupChecked.value = true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível verificar a configuração inicial.'
      if (currentUser.value) apiError.value = message
      else setupError.value = message
      setupChecked.value = true
      connectionStatus.value = 'Sem conexão'
      loading.value = false
    }
  })()
})
onBeforeUnmount(() => { systemTheme?.removeEventListener('change', onSystemThemeChange); clearTimeout(searchTimer) })
</script>

<template>
  <main v-if="setupChecked && setupError" class="setup-screen"><section class="setup-card"><a class="setup-brand" href="#"><span class="setup-mark">m</span><span>memora</span></a><p class="setup-kicker">Inicialização</p><h1>Não foi possível verificar o painel.</h1><p class="setup-copy">{{ setupError }}</p><button class="setup-submit" @click="retrySetupCheck">Tentar novamente</button></section></main>
  <SetupView v-else-if="setupChecked && setupRequired" @continue="continueFromSetup" />
  <LoginView v-else-if="setupChecked && !currentUser" :message="authError" @login="completeLogin" />
  <main v-else-if="setupChecked" class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#"><span class="brand-mark">m</span><span>memora</span></a>
      <div class="scope-switcher">
        <label for="workspace-select">Workspace</label>
        <div class="scope-control"><select id="workspace-select" v-model="selectedWorkspace" :disabled="workspaces.length === 0" aria-label="Selecionar workspace" @change="changeWorkspace"><option v-for="workspace in workspaces" :key="workspace.workspace_name" :value="workspace.workspace_name">{{ workspace.workspace_name }}</option></select><button v-if="canAdmin" class="icon-action" title="Renomear workspace" aria-label="Renomear workspace" :disabled="!selectedWorkspace" @click="manageScope('rename', 'workspace')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-.8L19.5 7.7a2.1 2.1 0 0 0-3-3L5 16.2 4 20Z"/></svg></button><button v-if="canAdmin" class="icon-action danger" title="Excluir workspace" aria-label="Excluir workspace" :disabled="!selectedWorkspace" @click="manageScope('delete', 'workspace')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button><button v-if="canAdmin" class="icon-action add" title="Criar workspace e projeto inicial" aria-label="Criar workspace" @click="openScopeCreateDialog('workspace')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>
        <label for="project-select">Projeto</label>
        <div class="scope-control"><select id="project-select" v-model="selectedProject" :disabled="workspaceProjects.length === 0" aria-label="Selecionar projeto"><option v-for="project in workspaceProjects" :key="project.project_id" :value="project.project_name">{{ project.project_name }}</option></select><button v-if="canAdmin" class="icon-action" title="Renomear projeto" aria-label="Renomear projeto" :disabled="!selectedProject" @click="manageScope('rename', 'project')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-.8L19.5 7.7a2.1 2.1 0 0 0-3-3L5 16.2 4 20Z"/></svg></button><button v-if="canAdmin" class="icon-action danger" title="Excluir projeto" aria-label="Excluir projeto" :disabled="!selectedProject" @click="manageScope('delete', 'project')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button><button v-if="canAdmin" class="icon-action add" title="Criar projeto neste workspace" aria-label="Criar projeto" :disabled="!selectedWorkspace" @click="openScopeCreateDialog('project')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>
        <small v-if="!canAdmin" class="admin-hint">Ações administrativas indisponíveis: cadastre o bearer root em Configurações.</small>
      </div>
      <nav><button v-for="section in sections" :key="section" class="nav-item" :class="{ active: activeSection === section }" @click="activeSection = section"><span class="nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><template v-if="section === 'Visão geral'"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></template><template v-else-if="section === 'Memórias'"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></template><template v-else-if="section === 'Sessões'"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></template><template v-else-if="section === 'Relações'"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.9 7.5-3.7M8.2 13.1l7.5 3.7"/></template><template v-else-if="section === 'Projetos'"><path d="M4 7h6l2 2h8v10H4zM4 7V5h6l2 2"/></template><template v-else><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></template></svg></span><span class="nav-label">{{ section }}</span><b v-if="section === 'Memórias'">{{ memories.length }}</b></button></nav>
      <div class="sidebar-bottom"><div class="security-note"><span>●</span><div><strong>{{ connectionStatus }}</strong><small>API do ai-memory</small></div></div><button class="nav-item" :class="{ active: activeSection === 'Configurações' }" :aria-current="activeSection === 'Configurações' ? 'page' : undefined" @click="activeSection = 'Configurações'"><span>⚙</span>Configurações</button><div class="user"><i>{{ currentUser?.name.trim().slice(0, 2).toUpperCase() }}</i><div><strong>{{ currentUser?.name }}</strong><small>Administrador</small></div><button>···</button></div></div>
    </aside>

    <section class="content">
      <header class="topbar"><label class="search"><span>⌕</span><input v-model="query" type="search" placeholder="Buscar neste projeto…"><kbd>⌘ K</kbd></label><div class="topbar-actions"><div class="theme-control"><button class="theme-button" :aria-expanded="themeMenuOpen" aria-label="Escolher aparência" @click="themeMenuOpen = !themeMenuOpen">◐ <span>{{ theme === 'system' ? 'Sistema' : theme === 'dark' ? 'Escuro' : 'Claro' }}</span></button><div v-if="themeMenuOpen" class="theme-menu"><p>Aparência</p><button :class="{ selected: theme === 'light' }" @click="setTheme('light')">☼ Claro</button><button :class="{ selected: theme === 'dark' }" @click="setTheme('dark')">◐ Escuro</button><button :class="{ selected: theme === 'system' }" @click="setTheme('system')">◒ Sistema <small>automático</small></button></div></div><button class="help-button">?</button><button class="logout-button" @click="logout">Sair</button></div></header>
      <div class="compact-scope"><label>Workspace<select v-model="selectedWorkspace" aria-label="Selecionar workspace" @change="changeWorkspace"><option v-for="workspace in workspaces" :key="workspace.workspace_name" :value="workspace.workspace_name">{{ workspace.workspace_name }}</option></select></label><label>Projeto<select v-model="selectedProject" aria-label="Selecionar projeto"><option v-for="project in workspaceProjects" :key="project.project_id" :value="project.project_name">{{ project.project_name }}</option></select></label></div>
      <div class="page-heading"><div><p class="eyebrow"><span v-if="scopesLoading" class="skeleton skeleton-scope" aria-label="Carregando escopo"></span><template v-else>{{ selectedWorkspace }} / {{ selectedProject }}</template></p><h1>{{ activeSection === 'Sessões' ? 'Sessões do projeto' : activeSection === 'Visão geral' ? 'Visão geral' : activeSection === 'Memórias' ? 'Suas memórias' : activeSection }}</h1><p>{{ activeSection === 'Sessões' ? 'Revise conversas e observações capturadas pelas suas IAs.' : activeSection === 'Visão geral' ? 'Um resumo da atividade e da saúde da memória deste projeto.' : activeSection === 'Memórias' ? 'Navegue e explore o conteúdo persistente das suas IAs.' : activeSection === 'Configurações' ? 'Gerencie sua conta, aparência e preferências do painel.' : 'Explore este espaço do ai-memory.' }}</p></div><span v-if="activeSection !== 'Configurações'" class="scope-label"><span v-if="scopesLoading || (activeSection === 'Sessões' && sessionsLoading) || (activeSection !== 'Sessões' && activeSection !== 'Visão geral' && loading)" class="skeleton skeleton-label" aria-label="Carregando total"></span><template v-else>{{ activeSection === 'Sessões' ? `${sessions.length} sessões` : activeSection === 'Visão geral' ? 'resumo do escopo' : `${memories.length} páginas` }}</template></span></div>
      <p v-if="scopeCreationNotice" class="scope-creation-notice" role="status">{{ scopeCreationNotice }}</p>
      <p v-if="memoryActionNotice" class="memory-action-notice" role="status">{{ memoryActionNotice }}</p>
      <div v-if="themeError && activeSection !== 'Configurações'" class="api-error" role="alert"><strong>Não foi possível salvar a aparência.</strong><span>{{ themeError }}</span></div>
      <div v-if="apiError && activeSection !== 'Visão geral' && activeSection !== 'Configurações'" class="api-error"><strong>Não foi possível carregar o ai-memory.</strong><span>{{ apiError }}</span><small>Confira o endpoint e o bearer cadastrados em Configurações. A API de leitura deve estar habilitada no servidor ai-memory.</small></div>
      <div v-if="activeSection !== 'Visão geral' && activeSection !== 'Configurações'" class="overview-cards"><article><i class="violet">◫</i><div><strong v-if="scopesLoading || (activeSection === 'Sessões' ? sessionsLoading : loading)" class="skeleton skeleton-value" aria-label="Carregando total"></strong><strong v-else>{{ activeSection === 'Sessões' ? sessions.length : memories.length }}</strong><span>{{ activeSection === 'Sessões' ? 'sessões listadas' : 'páginas carregadas' }}</span></div><small>{{ scopesLoading || (activeSection === 'Sessões' ? sessionsLoading : loading) ? 'Carregando…' : 'escopo selecionado' }}</small></article><article><i class="orange">⌘</i><div><strong v-if="scopesLoading" class="skeleton skeleton-value" aria-label="Carregando projeto"></strong><strong v-else>{{ selectedProject || '—' }}</strong><span>projeto atual</span></div><small>{{ scopesLoading ? 'Carregando…' : selectedWorkspace || 'selecione um escopo' }}</small></article><article><i class="green">✓</i><div><strong>{{ connectionStatus.startsWith('ai-memory') ? 'Conectado' : 'Pendente' }}</strong><span>servidor ai-memory</span></div><small>{{ connectionStatus }}</small></article></div>
      <OverviewSection
        v-if="activeSection === 'Visão geral'"
        :overview="overview"
        :loading="overviewLoading"
        :error="overviewError"
        :page-groups="overviewPageDateGroups"
        :format-date="formatDate"
        @open-page="openOverviewPage"
        @open-memories="activeSection = 'Memórias'"
      />
      <SettingsSection
        v-else-if="activeSection === 'Configurações' && currentUser"
        :user="currentUser"
        :theme="theme"
        :theme-error="themeError"
        :connection-status="connectionStatus"
        :connection="connectionConfig"
        :connection-busy="nodeConfigBusy"
        :connection-error="nodeConfigError"
        :connection-message="nodeConfigMessage"
        :workspace="selectedWorkspace"
        :project="selectedProject"
        :password-busy="passwordBusy"
        :password-error="passwordError"
        :password-message="passwordMessage"
        @theme-change="setTheme"
        @connect-node="connectAiMemory"
        @disconnect-node="disconnectAiMemory"
        @change-password="changePassword"
        @logout="logout"
        @open-projects="activeSection = 'Projetos'"
      />
      <ProjectsSection
        v-else-if="activeSection === 'Projetos'"
        :projects="projects"
        :workspaces="projectsByWorkspace"
        :loading="scopesLoading"
        :selected-workspace="selectedWorkspace"
        :selected-project="selectedProject"
        :can-admin="canAdmin"
        :format-date="formatDate"
        @open-project="openProject"
        @manage-project="(action, project) => { selectedWorkspace = project.workspace_name; selectedProject = project.project_name; manageScope(action, 'project') }"
      />
      <TrashSection
        v-else-if="activeSection === 'Lixeira'"
        :entries="trashEntries"
        :loading="trashLoading"
        :error="trashError"
        :message="trashMessage"
        :format-date="formatDate"
        @refresh="loadTrash"
        @restore="entry => { restoreDialog = { entry, busy: false, error: '' } }"
      />
      <RelationsSection
        v-else-if="activeSection === 'Relações'"
        :entries="relationEntries"
        :memories="memories"
        :loading="relationLoading"
        :error="relationError"
        @open-page="openOverviewPage"
        @open-memories="activeSection = 'Memórias'"
      />
      <SessionsSection
        v-else-if="activeSection === 'Sessões'"
        :sessions="sessions"
        :groups="sessionDateGroups"
        :loading="sessionsLoading"
        :api-error="apiError"
        :selected-session="selectedSession"
        :observations="observations"
        :observation-loading="observationLoading"
        :session-total="sessionTotal"
        :format-date="formatDate"
        @select-session="loadSessionObservations"
        @load-more="loadSessionObservations"
      />
      <MemoryLibrary
        v-else
        :memories="memories"
        :filtered="filtered"
        :groups="memoryDateGroups"
        :folders="directoryContents.folders"
        :visible-paths="visibleMemoryPaths"
        :selected-paths="selectedMemoryPaths"
        :selected-visible-count="selectedVisibleMemoryCount"
        :all-visible-selected="allVisibleMemoriesSelected"
        :category-mode="categoryMode"
        :current-directory="currentDirectory"
        :breadcrumbs="directoryBreadcrumbs"
        :loading="loading"
        :can-admin="canAdmin"
        :hide-sessions="hideSessions"
        :session-index-error="sessionIndexError"
        :api-error="apiError"
        :selected-path="selectedPath"
        :selected="selected"
        :selected-page="selectedPage"
        :detail-loading="detailLoading"
        :memory-session-badge="memorySessionBadge"
        @set-category="categoryMode = $event; currentDirectory = ''; selectedMemoryPaths = []"
        @set-directory="currentDirectory = $event; selectedMemoryPaths = []"
        @toggle-hide-sessions="toggleHideSessions"
        @toggle-memory-selection="toggleMemorySelection"
        @toggle-visible-selection="toggleVisibleMemorySelection"
        @bulk-delete="openSelectedMemoriesDeleteDialog"
        @create-category="openCategoryCreateDialog"
        @delete-category="openCategoryDeleteDialog"
        @select-memory="selectedPath = $event"
        @edit-page="openPageEditor"
        @manage-connections="openConnections"
        @delete-page="openPageDeleteDialog"
      />
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
    <div v-if="pageDeleteDialog" class="dialog-backdrop" @click.self="!pageDeleteDialog.busy && (pageDeleteDialog = null)" @keydown.esc="!pageDeleteDialog.busy && (pageDeleteDialog = null)">
      <section class="scope-dialog" role="dialog" aria-modal="true" aria-labelledby="page-delete-title"><button class="dialog-close" aria-label="Fechar" :disabled="pageDeleteDialog.busy" @click="pageDeleteDialog = null"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><div class="dialog-symbol destructive"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></div><p class="dialog-eyebrow">{{ selectedWorkspace }} / {{ selectedProject }}</p><h2 id="page-delete-title">Mover memória para a Lixeira</h2><p class="dialog-description">A memória <strong>{{ pageDeleteDialog.path }}</strong> será removida do projeto. Ela poderá ser restaurada a partir dos checkpoints recentes.</p><label class="dialog-field">Digite o caminho para confirmar<input v-model="pageDeleteDialog.value" autocomplete="off" spellcheck="false" :placeholder="pageDeleteDialog.path" @keydown.enter="deleteSelectedPage"></label><p v-if="pageDeleteDialog.error" class="dialog-error" role="alert">{{ pageDeleteDialog.error }}</p><footer class="dialog-actions"><button class="dialog-secondary" :disabled="pageDeleteDialog.busy" @click="pageDeleteDialog = null">Cancelar</button><button class="dialog-primary danger-button" :disabled="pageDeleteDialog.busy || pageDeleteDialog.value !== pageDeleteDialog.path" @click="deleteSelectedPage">{{ pageDeleteDialog.busy ? 'Excluindo…' : 'Mover para Lixeira' }}</button></footer></section>
    </div>
    <div v-if="categoryCreateDialog" class="dialog-backdrop" @click.self="closeCategoryCreateDialog" @keydown.esc="closeCategoryCreateDialog">
      <section class="scope-dialog memory-action-dialog" role="dialog" aria-modal="true" aria-labelledby="category-create-title">
        <button class="dialog-close" aria-label="Fechar criação de categoria" :disabled="categoryCreateDialog.busy" @click="closeCategoryCreateDialog"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        <div class="dialog-symbol"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l2 2h9v9h-17zM3.5 7.5v-2h6l2 2"/></svg></div>
        <p class="dialog-eyebrow">Nova categoria{{ currentDirectory ? ` · ${currentDirectory}` : '' }}</p>
        <h2 id="category-create-title">Criar categoria</h2>
        <p class="dialog-description">Categorias são organizadas por caminho. Para manter a nova categoria disponível, uma memória inicial <strong>overview.md</strong> será criada nela.</p>
        <label class="dialog-field">Nome da categoria<input v-model="categoryCreateDialog.name" maxlength="120" autocomplete="off" spellcheck="false" placeholder="ex.: decisões" @keydown.enter="submitCategoryCreateDialog"></label>
        <p v-if="categoryCreateDialog.error" class="dialog-error" role="alert">{{ categoryCreateDialog.error }}</p>
        <footer class="dialog-actions"><button class="dialog-secondary" :disabled="categoryCreateDialog.busy" @click="closeCategoryCreateDialog">Cancelar</button><button class="dialog-primary" :disabled="categoryCreateDialog.busy || !categoryCreateDialog.name.trim()" @click="submitCategoryCreateDialog">{{ categoryCreateDialog.busy ? 'Criando…' : 'Criar categoria' }}</button></footer>
      </section>
    </div>
    <div v-if="bulkDeleteDialog" class="dialog-backdrop" @click.self="!bulkDeleteDialog.busy && (bulkDeleteDialog = null)" @keydown.esc="!bulkDeleteDialog.busy && (bulkDeleteDialog = null)">
      <section class="scope-dialog memory-action-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-delete-title">
        <button class="dialog-close" aria-label="Fechar confirmação de exclusão" :disabled="bulkDeleteDialog.busy" @click="bulkDeleteDialog = null"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        <div class="dialog-symbol destructive"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></div>
        <p class="dialog-eyebrow">{{ bulkDeleteDialog.workspace }} / {{ bulkDeleteDialog.project }}</p>
        <h2 id="bulk-delete-title">{{ bulkDeleteDialog.kind === 'category' ? 'Excluir categoria?' : 'Mover memórias para a Lixeira?' }}</h2>
        <p class="dialog-description" v-if="bulkDeleteDialog.kind === 'category'">Todas as {{ bulkDeleteDialog.paths.length }} memórias de <strong>{{ bulkDeleteDialog.label }}/</strong> e de suas subcategorias serão movidas para a Lixeira.</p>
        <p class="dialog-description" v-else>{{ bulkDeleteDialog.paths.length }} memórias selecionadas serão movidas para a Lixeira.</p>
        <p class="memory-delete-warning">Esta ação pode ser recuperada pela Lixeira. A exclusão permanente de checkpoints não é oferecida pelo serviço.</p>
        <div v-if="bulkDeleteDialog.busy" class="memory-delete-progress" role="status">Processadas {{ bulkDeleteDialog.completed }} de {{ bulkDeleteDialog.paths.length }} memórias…</div>
        <p v-if="bulkDeleteDialog.error" class="dialog-error" role="alert">{{ bulkDeleteDialog.error }}</p>
        <ul v-if="bulkDeleteDialog.failures.length" class="memory-delete-failures"><li v-for="failure in bulkDeleteDialog.failures" :key="failure">{{ failure }}</li></ul>
        <footer class="dialog-actions"><button class="dialog-secondary" :disabled="bulkDeleteDialog.busy" @click="bulkDeleteDialog = null">Cancelar</button><button class="dialog-primary danger-button" :disabled="bulkDeleteDialog.busy || !bulkDeleteDialog.paths.length" @click="executeBulkDelete">{{ bulkDeleteDialog.busy ? 'Movendo…' : bulkDeleteDialog.failures.length ? 'Tentar novamente' : bulkDeleteDialog.kind === 'category' ? 'Excluir categoria' : 'Mover para Lixeira' }}</button></footer>
      </section>
    </div>
    <div v-if="restoreDialog" class="dialog-backdrop" @click.self="!restoreDialog.busy && (restoreDialog = null)" @keydown.esc="!restoreDialog.busy && (restoreDialog = null)">
      <section class="scope-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-title"><button class="dialog-close" aria-label="Fechar" :disabled="restoreDialog.busy" @click="restoreDialog = null"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><div class="dialog-symbol"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5M4 4v4.5h4.5M12 8v4l3 2"/></svg></div><p class="dialog-eyebrow">{{ restoreDialog.entry.workspace }} / {{ restoreDialog.entry.project }}</p><h2 id="restore-title">Restaurar memória?</h2><p class="dialog-description">O conteúdo de <strong>{{ restoreDialog.entry.path }}</strong> será restaurado do checkpoint anterior à exclusão e voltará a aparecer nas memórias. Se essa página foi recriada depois, a restauração substituirá o conteúdo atual.</p><p v-if="restoreDialog.error" class="dialog-error" role="alert">{{ restoreDialog.error }}</p><footer class="dialog-actions"><button class="dialog-secondary" :disabled="restoreDialog.busy" @click="restoreDialog = null">Cancelar</button><button class="dialog-primary" :disabled="restoreDialog.busy" @click="restoreTrashEntry">{{ restoreDialog.busy ? 'Restaurando…' : 'Restaurar memória' }}</button></footer></section>
    </div>
    <div v-if="scopeCreateDialog" class="dialog-backdrop" @click.self="closeScopeCreateDialog" @keydown.esc="closeScopeCreateDialog">
      <section class="scope-dialog editor-dialog scope-creation-dialog" role="dialog" aria-modal="true" aria-labelledby="scope-create-title">
        <button class="dialog-close" aria-label="Fechar criação de escopo" :disabled="scopeCreateDialog.busy" @click="closeScopeCreateDialog"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        <div class="dialog-symbol"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h6l2 2h8v10H4zM4 7V5h6l2 2M12 12v4m-2-2h4"/></svg></div>
        <p class="dialog-eyebrow">Novo {{ scopeCreateDialog.kind === 'workspace' ? 'workspace' : 'projeto' }}</p>
        <h2 id="scope-create-title">{{ scopeCreateDialog.kind === 'workspace' ? 'Criar workspace' : 'Criar projeto' }}</h2>
        <p class="dialog-description">O ai-memory inicializa o escopo ao salvar uma memória. Essa primeira memória será gravada como <strong>{{ scopeCreateDialog.path }}</strong>.</p>
        <label v-if="scopeCreateDialog.kind === 'workspace'" class="dialog-field">Nome do workspace<input v-model="scopeCreateDialog.workspace" maxlength="200" autocomplete="off" spellcheck="false" placeholder="ex.: minha-equipe"></label>
        <p v-else class="scope-creation-current">Workspace: <strong>{{ scopeCreateDialog.workspace }}</strong></p>
        <label class="dialog-field">Nome do projeto<input v-model="scopeCreateDialog.project" maxlength="200" autocomplete="off" spellcheck="false" placeholder="ex.: meu-projeto"></label>
        <label class="dialog-field">Caminho da primeira memória<input v-model="scopeCreateDialog.path" maxlength="500" autocomplete="off" spellcheck="false" placeholder="notes/overview.md"></label>
        <label class="dialog-field">Título<input v-model="scopeCreateDialog.title" maxlength="200" autocomplete="off" placeholder="Visão geral"></label>
        <label class="dialog-field">Conteúdo em Markdown<textarea v-model="scopeCreateDialog.body" class="markdown-editor scope-creation-body" maxlength="1000000" spellcheck="false" placeholder="# Visão geral"></textarea></label>
        <p v-if="scopeCreateDialog.error" class="dialog-error" role="alert">{{ scopeCreateDialog.error }}</p>
        <footer class="dialog-actions"><button class="dialog-secondary" :disabled="scopeCreateDialog.busy" @click="closeScopeCreateDialog">Cancelar</button><button class="dialog-primary" :disabled="scopeCreateDialog.busy" @click="submitScopeCreateDialog">{{ scopeCreateDialog.busy ? 'Criando…' : 'Criar escopo e memória' }}</button></footer>
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
