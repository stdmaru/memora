export type Theme = 'light' | 'dark' | 'system'
export type AuthUser = { id: string; name: string; email: string; role: 'admin'; theme: Theme }
export type PageLink = { path: string; title?: string; kind?: string }
export type Memory = {
  path: string
  title: string
  summary: string
  kind: string
  updated: string
  updatedAt?: string
  tags: string[]
  pinned: boolean
  bodyMarkdown?: string
  tier?: string
  frontmatter?: Record<string, unknown>
  links?: PageLink[]
  backlinks?: PageLink[]
}
export type PageSummary = { path: string; title: string; kind?: string; tier?: string; updated_at?: string; snippet?: string; frontmatter?: Record<string, unknown> }
export type WorkspaceSummary = { workspace_name: string; project_count: number; page_count: number; last_updated: string | null }
export type ProjectSummary = { workspace_name: string; project_name: string; project_id: string; page_count: number; last_updated: string | null }
export type TrashEntry = { workspace: string; project: string; path: string; deleted_at: string | null; restore_rev: string | null }
export type ScopeResponse = { workspaces: WorkspaceSummary[]; projects: ProjectSummary[]; preferred: { workspace: string; project: string }; canAdmin: boolean }
export type Session = { session_id: string; cwd?: string; agent_kind?: string; started_at: string; ended_at?: string | null; observation_count: number; consolidation?: { state: string; attempts: number } | null }
export type Observation = { id: string; kind: string; title?: string; body?: string; importance?: number; created_at: string }
export type SessionDetail = { session: Session; observations: Observation[]; total: number; offset: number; elided_other_scope: number }
export type BulkDeleteDialog = { kind: 'memories' | 'category'; label: string; workspace: string; project: string; paths: string[]; completed: number; busy: boolean; error: string; failures: string[] }
export type CategoryCreateDialog = { name: string; busy: boolean; error: string }
export type ScopeDialog = { action: 'rename' | 'delete'; kind: 'project' | 'workspace'; current: string; value: string; step: 'form' | 'preview' | 'confirm'; preview: Record<string, unknown> | null; error: string; busy: boolean }
export type ScopeCreateDialog = { kind: 'project' | 'workspace'; workspace: string; project: string; path: string; title: string; body: string; error: string; busy: boolean }
export type OverviewActivity = { days: number; sessions: number; observations: number; pages_updated: number }
export type OverviewResponse = {
  handoff: { agent?: string; at?: string; project?: string; summary?: string; open_questions?: string[]; next_steps?: string[] } | null
  briefing: {
    counts: { pages_latest?: number; pages_all?: number; sessions?: number; observations?: number }
    activity_7d?: OverviewActivity
    activity_30d?: OverviewActivity
    last_observation_at?: string | null
    pending_handoff_count?: number
    recent_pages?: PageSummary[]
    rules?: PageSummary[]
    slots?: PageSummary[]
  }
  health: { stale?: number; duplicates?: number; contradictions?: number; orphans?: number; audited_at?: string | null }
}
export type RelationEntry = { source: Memory; targetPath: string; targetTitle: string; kind: string }
