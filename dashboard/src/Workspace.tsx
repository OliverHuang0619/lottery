import { useEffect, useRef, useState } from 'react'
import { ArrowUp, BarChart3, CirclePlus, LogOut, MessageSquare, Radio, Sparkles, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import App from './App'
import { api, authHeaders } from './api'
import './workspace.css'

type Conversation = { id: string; title: string; thread_id: string | null }
type Message = { id: string; role: string; content: string }
type Task = { id: string; status: string; error: string | null }
type TaskResponse = Task & { conversationTitle?: string }
type Option = { id: string; name: string }
type AppConfig = { version: string; defaultSource: string; defaultModel: string; defaultEffort: string; models: Option[]; efforts: Option[] }
const labels: Record<string, string> = { queued: '排队中', running: '处理中', completed: '已完成', failed: '失败' }
function RenderedMessage({ content }: { content: string }) {
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: props => <a href={props.href} target="_blank" rel="noreferrer">{props.children}</a> }}>{content}</ReactMarkdown></div>
}
export default function Workspace() {
  const [token, setToken] = useState(sessionStorage.getItem('lottery-token') || '')
  const [authenticated, setAuthenticated] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [source, setSource] = useState('https://2026kj.zkclhb.com:2026/hk.html')
  const [draft, setDraft] = useState('')
  const [view, setView] = useState('dashboard')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [model, setModel] = useState(localStorage.getItem('lottery-model') || 'gpt-5.6-sol')
  const [reasoningEffort, setReasoningEffort] = useState(localStorage.getItem('lottery-effort') || 'low')
  const bottom = useRef<HTMLDivElement>(null)
  const active = tasks.find(t => ['queued', 'running'].includes(t.status))
  async function login() {
    sessionStorage.setItem('lottery-token', token.trim())
    try {
      const rows = await api<Conversation[]>('/api/conversations')
      setConversations(rows); setAuthenticated(true); setView('dashboard'); setError('')
      if (rows[0]) setSelected(rows[0].id)
    } catch (e) { setError(String(e)) }
  }
  useEffect(() => {
    if (!sessionStorage.getItem('lottery-token')) return
    api<Conversation[]>('/api/conversations').then(rows => {
      setConversations(rows); setAuthenticated(true); setView('dashboard')
      if (rows[0]) setSelected(rows[0].id)
    }).catch(e => setError(String(e)))
  }, [])
  useEffect(() => {
    if (!authenticated) return
    api<AppConfig>('/api/config').then(value => {
      setConfig(value); setSource(value.defaultSource)
      const savedModel = localStorage.getItem('lottery-model')
      const savedEffort = localStorage.getItem('lottery-effort')
      setModel(value.models.some(option => option.id === savedModel) ? savedModel! : value.defaultModel)
      setReasoningEffort(value.efforts.some(option => option.id === savedEffort) ? savedEffort! : value.defaultEffort)
    }).catch(e => setError(String(e)))
  }, [authenticated])
  useEffect(() => {
    if (!selected || !authenticated) return
    let stale = false
    api<{ messages: Message[]; tasks: Task[] }>(`/api/conversations/${selected}`).then(data => {
      if (!stale) { setMessages(data.messages); setTasks(data.tasks); setProgress([]) }
    }).catch(e => { if (!stale) setError(String(e)) })
    return () => { stale = true }
  }, [selected, authenticated])
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let cursor = 0
    const stream = async () => {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(`/api/tasks/${active.id}/events?after=${cursor}`, { headers: authHeaders(), signal: controller.signal })
          if (!response.ok || !response.body) throw new Error(`进度连接失败：HTTP ${response.status}`)
          const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let terminal = false
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let boundary
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2)
              const id = frame.match(/^id: (\d+)/m); const data = frame.match(/^data: (.+)/m)
              if (id) cursor = Number(id[1])
              if (!data) continue
              const event = JSON.parse(data[1])
              const text = event.text || (event.type === 'status' ? labels[event.status] : event.type === 'item.completed' && event.item?.type === 'agent_message' ? '已生成回答' : event.type === 'item.started' ? 'Codex 正在执行技能…' : '')
              if (text) setProgress(rows => [...rows.slice(-29), text])
              if (event.type === 'status' && ['completed', 'failed'].includes(event.status)) {
                terminal = true
                const detail = await api<{ messages: Message[]; tasks: Task[] }>(`/api/conversations/${selected}`)
                if (!controller.signal.aborted) { setMessages(detail.messages); setTasks(detail.tasks) }
              }
            }
          }
          if (terminal) return
        } catch (e) { if (controller.signal.aborted) return; setError(`进度连接中断，正在重连。${String(e)}`) }
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }
    void stream()
    return () => controller.abort()
  }, [active, selected])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, progress])
  async function newConversation(title = '新对话', select = true) {
    const row = await api<Conversation>('/api/conversations', { method: 'POST', body: JSON.stringify({ title }) })
    setConversations(rows => [row, ...rows]); if (select) { setMessages([]); setTasks([]); setSelected(row.id) }; setView('chat'); return row.id
  }
  async function deleteConversation(row: Conversation) {
    if (!window.confirm(`删除“${row.title}”及其中的全部消息？此操作无法撤销。`)) return
    try {
      await api<{ deleted: boolean }>(`/api/conversations/${row.id}`, { method: 'DELETE' })
      const remaining = conversations.filter(item => item.id !== row.id)
      setConversations(remaining)
      if (selected === row.id) {
        setSelected(remaining[0]?.id || '')
        setMessages([]); setTasks([]); setProgress([])
      }
    } catch (e) { setError(String(e)) }
  }
  async function send(quick = false) {
    const content = quick ? '获取最新一期完整开奖记录，复盘上期预测，更新走势并生成下一期分析与预测。' : draft.trim()
    if (!content || sending || active) return
    setSending(true); setError(''); setProgress([])
    try {
      const id = selected || await newConversation(content.slice(0, 24), false)
      const task = await api<TaskResponse>(`/api/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ content, skill: 'analyze-lottery-history', model, reasoningEffort, ...(quick ? { sourceUrl: source } : {}) }) })
      if (task.conversationTitle) setConversations(rows => rows.map(row => row.id === id ? { ...row, title: task.conversationTitle! } : row))
      const detail = await api<{ messages: Message[]; tasks: Task[] }>(`/api/conversations/${id}`)
      setSelected(id); setMessages(detail.messages); setTasks(detail.tasks.length ? detail.tasks : [task]); setDraft('')
    } catch (e) { setError(String(e)) } finally { setSending(false) }
  }
  if (!authenticated) return <div className="login-screen"><form onSubmit={e => { e.preventDefault(); void login() }}><div className="brand-icon"><Sparkles /></div><small>LOTTERY / CODEX WORKSPACE · v{__APP_VERSION__}</small><h1>让每一期分析，有据可循。</h1><p>连接你的分析工作台，查询历史记录，运行技能并追踪预测。</p><label>访问令牌<input type="password" autoComplete="current-password" value={token} onChange={e => setToken(e.target.value)} placeholder="部署时设置的 APP_TOKEN" required /></label>{error && <p role="alert" className="work-error">{error}</p>}<button className="primary">进入工作台 →</button></form></div>
  return <div className="workspace"><aside className="work-sidebar"><div className="work-brand"><Sparkles size={25} /><span>开奖研究室<small>CODEX WORKSPACE <b>v{config?.version || __APP_VERSION__}</b></small></span></div><button className="new-chat" disabled={sending} onClick={() => void newConversation().catch(e => setError(String(e)))}><CirclePlus size={17} /> 新建对话</button><button className={view === 'dashboard' ? 'nav-selected' : ''} onClick={() => setView(view === 'chat' ? 'dashboard' : 'chat')}><BarChart3 size={17} /> {view === 'chat' ? '数据仪表板' : '返回分析对话'}</button><div className="sidebar-caption">历史对话 <span>{conversations.length}</span></div><nav className="conversation-list" aria-label="历史对话">{conversations.map(row => <div className={`conversation-row ${selected === row.id && view === 'chat' ? 'nav-selected' : ''}`} key={row.id}><button className="conversation-open" title={row.title} aria-current={selected === row.id && view === 'chat' ? 'page' : undefined} disabled={sending} onClick={() => { setSelected(row.id); setView('chat') }}><MessageSquare size={16} /><span>{row.title}</span></button><button className="conversation-delete" aria-label={`删除对话：${row.title}`} title="删除对话" disabled={selected === row.id && !!active} onClick={() => void deleteConversation(row)}><Trash2 size={14} /></button></div>)}</nav><div className="sidebar-bottom"><span><i /> 技能 · analyze-lottery-history</span><button onClick={() => { sessionStorage.removeItem('lottery-token'); setAuthenticated(false); setView('dashboard'); setTasks([]) }}><LogOut size={16} /> 退出</button></div></aside><main className="work-main"><header className="work-header"><div><small>研究工作台</small><h2>{view === 'dashboard' ? '历史数据与预测表现' : '分析对话'}</h2></div><div className="model-config"><label>模型<select aria-label="默认模型" value={model} disabled={!!active} onChange={e => { setModel(e.target.value); localStorage.setItem('lottery-model', e.target.value) }}>{config?.models.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label><label>推理<select aria-label="推理强度" value={reasoningEffort} disabled={!!active} onChange={e => { setReasoningEffort(e.target.value); localStorage.setItem('lottery-effort', e.target.value) }}>{config?.efforts.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label><span className="engine-badge"><Radio size={14} /> Codex CLI</span></div></header>{view === 'dashboard' ? <App /> : <><div className="work-thread">{messages.length === 0 && <section className="welcome"><div className="welcome-eyebrow">从数据出发 · 保留每次判断</div><h1>新的一期，<br />从完整复盘开始。</h1><p>获取最新开奖，让 Codex 调用分析技能，<br />把来源、走势与下一期机械选择保存在同一段对话中。</p></section>}<section className="quick-action"><div><Sparkles size={19} /><strong>最新开奖 · 一键分析</strong><span>抓取 → 校验 → 复盘 → 预测</span></div><label>开奖来源<input type="url" value={source} onChange={e => setSource(e.target.value)} /></label><button className="primary" disabled={sending || !!active} onClick={() => void send(true)}>{sending || active ? '任务处理中…' : '获取并分析 ↗'}</button></section>{messages.map(message => <article key={message.id} className={`work-message ${message.role}`}><small>{message.role === 'user' ? '你' : 'CODEX · 开奖分析技能'}</small><div>{message.role === 'assistant' ? <RenderedMessage content={message.content} /> : message.content}</div></article>)}{tasks.filter(t => t.status === 'failed').map(t => <div className="work-error" role="alert" key={t.id}>任务失败：{t.error}。可重新发送消息或再次点击获取。</div>)}{active && <div className="task-progress"><span className="pulse" /> {labels[active.status]}<small>{progress.at(-1) || '等待执行器…'}</small></div>}{error && <div className="work-error" role="alert">{error}</div>}<div ref={bottom} /></div><form className="work-composer" onSubmit={e => { e.preventDefault(); void send() }}><textarea aria-label="发送消息" placeholder="询问走势、查看复盘，或描述你的分析需求…" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} /><div><span>开奖分析与预测 <small>· Shift + Enter 换行</small></span><button aria-label="发送" className="primary" disabled={sending || !!active || !draft.trim()}><ArrowUp size={19} /></button></div><p>机械选择不代表已证明的预测优势。真实复盘与历史回测分别统计。</p></form></>}</main></div>
}
