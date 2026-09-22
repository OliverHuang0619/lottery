export function authHeaders() { return { Authorization: `Bearer ${sessionStorage.getItem('lottery-token') || ''}` } }
export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...authHeaders(), 'Content-Type': 'application/json', ...init.headers } })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}
