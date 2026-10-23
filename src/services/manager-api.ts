export async function requestManagerApi<T>(
  path: string,
  options: RequestInit = {},
  onUnauthorized?: () => void,
): Promise<T> {
  const response = await fetch(`/api/manager/${path}`, options)
  const payload: unknown = await response.json()
  if (response.status === 401) onUnauthorized?.()
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : `Erro HTTP ${response.status}`
    throw new Error(message)
  }
  return payload as T
}
