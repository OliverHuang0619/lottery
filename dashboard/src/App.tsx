import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, BarChart3, ChevronLeft, ChevronRight, Clock3, Database, RefreshCw, Search, ShieldCheck, Sparkles, Target, X } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import './App.css'
import './dashboard.css'
import './forecast.css'
import './roi.css'
import { authHeaders } from './api'

type Ball = { position: string; number: number; zodiac: string }
type RecordRow = { issue: string; date: string; numbers: Ball[] }
type Review = { actual_issue: string; predicted_special_number: number; predicted_special_zodiac: string; predicted_flat_zodiac?: string; flat_zodiac_hit?: boolean | null; actual_all_zodiacs?: string[]; actual_special_number: number; actual_special_zodiac: string; special_number_hit: boolean; special_zodiac_hit: boolean; special_pick_regular_hit: boolean; regular_hits: number[]; regular_hit_count: number; regular_three_exact_hit?: boolean; regular_three_hits?: number[]; predicted_regular: Ball[]; predicted_regular_three: Ball[]; actual_numbers: Ball[]; method_version?: string; seed?: number }
type ModelRow = { method_version: string; no_repeat_enabled: boolean; folds: number; special_zodiac_accuracy: number; special_zodiac_top3_accuracy: number; special_number_accuracy: number; average_regular_hits: number; regular_three_exact_accuracy: number }
type Prediction = { target_issue: string; created_at: string; special: Ball; flat_zodiac?: { zodiac: string }; regular: Ball[]; regular_three: Ball[]; forecast_assessment: { status: string; strong_pick: boolean; walk_forward: { folds: number; accuracy: number }; saved_reviews: { count: number; accuracy: number | null }; flat_zodiac?: { walk_forward_folds: number; walk_forward_hits: number; walk_forward_accuracy: number; saved_review_count: number; saved_review_hits: number; saved_review_accuracy: number | null } } }
type DashboardData = { generatedAt: string; records: RecordRow[]; prediction: Prediction; reviews: Review[]; analysis: { issues: number; special_zodiac_frequency: Record<string, number> }; evaluation: { models: ModelRow[] } }
type RoiView = 'all' | 'regular' | 'special' | 'flat'
const pad = (n: number) => String(n).padStart(2, '0')
const pct = (n: number | null | undefined) => n == null ? '—' : `${(n * 100).toFixed(1)}%`
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(0)}`
const modelNames: Record<string, string> = { 'random-uniform': '随机基线', 'trend-v3': '现行趋势', 'trend-short': '短窗口', 'trend-long': '长窗口', 'stable-candidate': '稳健候选' }

function BallBadge({ ball, special = false, compact = false, hit = false }: { ball: Ball; special?: boolean; compact?: boolean; hit?: boolean }) {
  return <div className={`ball ${special ? 'ball-special' : ''} ${compact ? 'ball-compact' : ''} ${hit ? `ball-hit match-${ball.number % 12}` : ''}`}><strong>{pad(ball.number)}</strong><span>{ball.zodiac}</span></div>
}
function Metric({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return <article className="metric"><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div></article>
}

function App() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [selectedReview, setSelectedReview] = useState<Review | null>(null)
  const [roiView, setRoiView] = useState<RoiView>('all')
  const load = useCallback(async () => {
    setLoading(true)
    try { const response = await fetch(import.meta.env.VITE_STATIC_DASHBOARD === 'true' ? `${import.meta.env.BASE_URL}dashboard.json` : '/api/dashboard', { cache: 'no-store', headers: import.meta.env.VITE_STATIC_DASHBOARD === 'true' ? {} : authHeaders() }); if (!response.ok) throw new Error(`数据接口返回 ${response.status}`); setData(await response.json()); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法加载数据') }
    finally { setLoading(false) }
  }, [])
  // Data fetching is the external synchronization managed by this effect.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load(); const timer = window.setInterval(load, 60_000); return () => window.clearInterval(timer) }, [load])
  useEffect(() => {
    if (!selectedReview) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedReview(null) }
    document.body.classList.add('modal-open'); window.addEventListener('keydown', close)
    return () => { document.body.classList.remove('modal-open'); window.removeEventListener('keydown', close) }
  }, [selectedReview])

  const latest = data?.records[0]
  const prediction = data?.prediction
  const genuine = useMemo(() => { const reviews = data?.reviews ?? []; const flatZodiac = reviews.filter(x => x.flat_zodiac_hit != null); return { count: reviews.length, zodiac: reviews.filter(x => x.special_zodiac_hit).length, number: reviews.filter(x => x.special_number_hit).length, flatSpecial: reviews.filter(x => x.special_pick_regular_hit).length, flatZodiacCount: flatZodiac.length, flatZodiacHits: flatZodiac.filter(x => x.flat_zodiac_hit).length, triple: reviews.filter(x => x.regular_three_exact_hit).length } }, [data])
  const flatZodiacReviews = useMemo(() => (data?.reviews ?? []).filter(row => row.flat_zodiac_hit != null), [data])
  const roiRows = useMemo(() => (data?.reviews ?? []).map(row => {
    const stake = 8
    const flatReturn = row.flat_zodiac_hit ? 2 : 0
    const regularReturn = row.regular_hit_count * 7
    const specialReturn = row.special_number_hit ? 47 : 0
    const returns = flatReturn + regularReturn + specialReturn
    const profit = returns - stake
    return { ...row, stake, flatReturn, regularReturn, specialReturn, returns, profit, roi: stake ? profit / stake : 0 }
  }), [data])
  const roiSummary = useMemo(() => {
    const stake = roiRows.reduce((sum, row) => sum + (roiView === 'regular' ? 6 : roiView === 'all' ? row.stake : 1), 0)
    const returns = roiRows.reduce((sum, row) => sum + (roiView === 'regular' ? row.regularReturn : roiView === 'special' ? row.specialReturn : roiView === 'flat' ? row.flatReturn : row.returns), 0)
    return { stake, returns, profit: returns - stake, roi: stake ? (returns - stake) / stake : null }
  }, [roiRows, roiView])
  const roiLabels: Record<RoiView, string> = { all: '全部投注', regular: '平码', special: '特码', flat: '平特一肖' }
  const selectedStake = (row: (typeof roiRows)[number]) => roiView === 'regular' ? 6 : roiView === 'all' ? row.stake : 1
  const selectedReturn = (row: (typeof roiRows)[number]) => roiView === 'regular' ? row.regularReturn : roiView === 'special' ? row.specialReturn : roiView === 'flat' ? row.flatReturn : row.returns
  const returnDetail = (row: (typeof roiRows)[number]) => roiView === 'regular'
    ? `六码中${row.regular_hit_count}个 · 返${row.regularReturn}`
    : roiView === 'special'
      ? `${row.special_number_hit ? '命中' : '未中'} · 返${row.specialReturn}`
      : roiView === 'flat'
        ? `${row.predicted_flat_zodiac ?? '未记录'} · ${row.flat_zodiac_hit ? '命中' : '未中'} · 返${row.flatReturn}`
        : `平特一肖 ${row.flatReturn || '—'} · 平码 ${row.regularReturn || '—'} · 特码 ${row.specialReturn || '—'}`
  const trend = useMemo(() => (data?.records ?? []).slice(0, 24).reverse().map(row => ({ issue: row.issue, number: row.numbers[6].number, zodiac: row.numbers[6].zodiac })), [data])
  const zodiacBars = useMemo(() => Object.entries(data?.analysis.special_zodiac_frequency ?? {}).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value), [data])
  const filtered = useMemo(() => (data?.records ?? []).filter(row => !query || row.issue.includes(query) || row.date.includes(query) || row.numbers.some(ball => String(ball.number).padStart(2, '0').includes(query) || ball.zodiac.includes(query))), [data, query])
  const visibleRows = filtered.slice(page * 8, page * 8 + 8)
  const pageCount = Math.max(1, Math.ceil(filtered.length / 8))

  return <main>
    <header className="topbar"><div className="brand-mark"><Activity size={19}/></div><div className="brand-copy"><strong>财富自由 <small>v{__APP_VERSION__}</small></strong><span>开奖记录 · 趋势 · 预测复盘</span></div><nav><a href="#overview">总览</a><a href="#trends">走势</a><a href="#roi">投资回报</a><a href="#flat-zodiac">平特一肖</a><a href="#flat-special">平特码</a><a href="#history">开奖记录</a></nav><div className="sync-state"><span className="live-dot"/><span>动态数据</span><button onClick={load} disabled={loading} aria-label="刷新数据"><RefreshCw size={16} className={loading?'spin':''}/>刷新</button></div></header>
    {error && <div className="error-banner">{error}，请确认本地数据服务正在运行。</div>}
    <section className="intro" id="overview"><div><p className="eyebrow"><span/> LIVE ANALYTICS</p><h1>把每一期，放回数据里看。</h1><p className="lede">自动读取最新开奖记录、锁定预测与真实复盘。数据每60秒刷新，所有预测与回测口径分开呈现。</p></div><div className="updated"><Clock3 size={15}/>{data?new Date(data.generatedAt).toLocaleString('zh-CN'):'正在连接数据…'}</div></section>
    <section className="headline-grid">
      <article className="panel result-panel"><div className="panel-heading"><div><span className="kicker">LATEST DRAW</span><h2>第 {latest?.issue??'—'} 期开奖结果</h2></div><span className="date-pill">{latest?.date??'等待数据'}</span></div><div className="balls-row">{latest?.numbers.map((ball,index)=><BallBadge key={`${ball.position}-${ball.number}`} ball={ball} special={index===6}/>)}</div><p className="caption">前六位为平码，金色标记为特码</p></article>
      <article className="panel prediction-panel"><div className="panel-heading"><div><span className="kicker">LOCKED FORECAST</span><h2>第 {prediction?.target_issue??'—'} 期锁定预测</h2></div><Sparkles size={19}/></div><div className="special-pick">{prediction&&<BallBadge ball={prediction.special} special/>}<div><span>特码机械首选</span><strong>{prediction?`${pad(prediction.special.number)} · ${prediction.special.zodiac}`:'等待数据'}</strong></div></div><div className="regular-picks"><span>平码六码</span><div>{prediction?.regular.map(ball=><BallBadge key={`forecast-${ball.number}`} ball={ball} compact/>)}</div></div><div className="mini-row"><span>平特一肖</span><strong>{prediction?.flat_zodiac?.zodiac||'—'}</strong></div><div className="mini-row compact-row"><span>3中3</span><strong>{prediction?.regular_three.map(x=>pad(x.number)).join(' · ')||'—'}</strong></div><div className="assessment">{prediction?.forecast_assessment.strong_pick?'已达到优势门槛':'尚无已证明优势 · 仅作统计观察'}</div></article>
    </section>
    <section className="metrics-grid">
      <Metric icon={<Database size={19}/>} label="历史期数" value={`${data?.analysis.issues??'—'} 期`} hint={`最新至第 ${latest?.issue??'—'} 期`}/>
      <Metric icon={<Target size={19}/>} label="真实生肖命中" value={`${genuine.zodiac}/${genuine.count||'—'}`} hint={pct(genuine.count?genuine.zodiac/genuine.count:null)}/>
      <Metric icon={<ShieldCheck size={19}/>} label="真实号码命中" value={`${genuine.number}/${genuine.count||'—'}`} hint="仅统计开奖前锁定预测"/>
      <Metric icon={<Activity size={19}/>} label="平特码命中" value={`${genuine.flatSpecial}/${genuine.count||'—'}`} hint={pct(genuine.count?genuine.flatSpecial/genuine.count:null)}/>
      <Metric icon={<Target size={19}/>} label="平特肖命中" value={`${genuine.flatZodiacHits}/${genuine.flatZodiacCount||'—'}`} hint={genuine.flatZodiacCount?pct(genuine.flatZodiacHits/genuine.flatZodiacCount):'等待首期复盘'}/>
      <Metric icon={<BarChart3 size={19}/>} label="3中3命中" value={`${genuine.triple}/${data?.reviews.filter(x=>x.regular_three_exact_hit!==undefined).length||'—'}`} hint="特码不计入平码组合"/>
    </section>
    <section className="section-block" id="roi">
      <div className="section-title"><div><span className="kicker">RETURN LEDGER</span><h2>投资回报率</h2></div><p>每注投入1单位；页面所列返还均已包含本金。</p></div>
      <div className="roi-tabs" role="tablist" aria-label="投资回报分类">{(Object.keys(roiLabels) as RoiView[]).map(view => <button key={view} role="tab" aria-selected={roiView === view} className={roiView === view ? 'active' : ''} onClick={() => setRoiView(view)}>{roiLabels[view]}</button>)}</div>
      <div className="roi-summary">
        <article className="panel"><span>{roiLabels[roiView]}累计投入</span><strong>{roiSummary.stake}</strong><small>单位</small></article>
        <article className="panel"><span>{roiLabels[roiView]}累计返还</span><strong>{roiSummary.returns}</strong><small>含中奖注本金</small></article>
        <article className={`panel ${roiSummary.profit >= 0 ? 'roi-positive' : 'roi-negative'}`}><span>累计净收益</span><strong>{signed(roiSummary.profit)}</strong><small>返还－投入</small></article>
        <article className={`panel ${roiSummary.profit >= 0 ? 'roi-positive' : 'roi-negative'}`}><span>累计 ROI</span><strong>{pct(roiSummary.roi)}</strong><small>净收益 ÷ 投入</small></article>
      </div>
      <div className="panel roi-rule"><div><strong>平特一肖</strong><span>1注 · 中返2</span></div><div><strong>平码六码</strong><span>每号1注 · 每中1号返7</span></div><div><strong>特码</strong><span>1注 · 中返47</span></div><div><strong>下一期计划投入</strong><span>{1 + (prediction?.regular.length ?? 6) + (prediction?.flat_zodiac ? 1 : 0)} 单位</span></div></div>
      <div className="panel table-wrap roi-table"><table><thead><tr><th>开奖期号</th><th>投入</th><th>{roiLabels[roiView]}返还明细</th><th>总返还</th><th>净收益</th><th>回报率 ROI</th></tr></thead><tbody>{roiRows.map(row => { const stake = selectedStake(row); const returns = selectedReturn(row); const profit = returns - stake; const roi = profit / stake; return <tr key={`roi-${row.actual_issue}`}><td><strong>第 {row.actual_issue} 期</strong></td><td>{stake}</td><td><span className="return-detail">{returnDetail(row)}</span></td><td>{returns}</td><td className={profit >= 0 ? 'value-positive' : 'value-negative'}>{signed(profit)}</td><td><span className={roi >= 0 ? 'roi-pill positive' : 'roi-pill negative'}>{pct(roi)}</span></td></tr> })}</tbody></table></div>
      <p className="roi-note">每期固定投入8单位：六码6、平特一肖1、特码1。旧期未保存的平特一肖不回填预测，返还显示为“—”。该表仅按用户设定赔率复盘，不代表未来收益。</p>
    </section>
    <section className="section-block" id="trends"><div className="section-title"><div><span className="kicker">TREND DESK</span><h2>特码走势与生肖分布</h2></div><p>趋势是历史描述，不等同于下一期开奖概率。</p></div><div className="charts-grid">
      <article className="panel chart-card"><h3>近24期 · 特码轨迹</h3><ResponsiveContainer width="100%" height={270}><LineChart data={trend} margin={{top:18,right:14,left:-18,bottom:0}}><CartesianGrid stroke="#e7e7df" vertical={false}/><XAxis dataKey="issue" tick={{fontSize:10,fill:'#7a8985'}} interval={3}/><YAxis domain={[1,49]} ticks={[1,12,24,36,49]} tick={{fontSize:10,fill:'#7a8985'}}/><Tooltip contentStyle={{borderRadius:10,border:'1px solid #dfe2d8',fontSize:12}} formatter={(value,_,entry)=>[`${pad(Number(value))} · ${entry.payload.zodiac}`,'特码']}/><Line type="monotone" dataKey="number" stroke="#0d6559" strokeWidth={2.5} dot={{r:3,fill:'#f3f1e9',strokeWidth:2}} activeDot={{r:5}}/></LineChart></ResponsiveContainer></article>
      <article className="panel chart-card"><h3>全部特码 · 生肖频次</h3><ResponsiveContainer width="100%" height={270}><BarChart data={zodiacBars} margin={{top:18,right:8,left:-22,bottom:0}}><CartesianGrid stroke="#e7e7df" vertical={false}/><XAxis dataKey="name" tick={{fontSize:11,fill:'#5d716c'}}/><YAxis tick={{fontSize:10,fill:'#7a8985'}}/><Tooltip cursor={{fill:'#eef1ea'}} contentStyle={{borderRadius:10,border:'1px solid #dfe2d8',fontSize:12}}/><Bar dataKey="value" fill="#d0a03a" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></article>
    </div></section>
    <section className="section-block" id="flat-zodiac">
      <div className="section-title"><div><span className="kicker">FLAT ZODIAC</span><h2>平特一肖统计</h2></div><p>预测生肖只要在当期任意平码或特码出现，即计一次命中。</p></div>
      <div className="flat-zodiac-grid">
        <article className="panel flat-current"><span>第 {prediction?.target_issue ?? '—'} 期预测</span><strong>{prediction?.flat_zodiac?.zodiac || '等待生成'}</strong><small>独立固定随机流 · 开奖前锁定</small></article>
        <article className="panel flat-evidence">
          <div><span>真实复盘</span><strong>{genuine.flatZodiacHits} / {genuine.flatZodiacCount || '—'}</strong><small>{genuine.flatZodiacCount ? pct(genuine.flatZodiacHits / genuine.flatZodiacCount) : '等待第98期结果'}</small></div>
          <div><span>滚动回测</span><strong>{prediction?.forecast_assessment.flat_zodiac?.walk_forward_hits ?? '—'} / {prediction?.forecast_assessment.flat_zodiac?.walk_forward_folds ?? '—'}</strong><small>{pct(prediction?.forecast_assessment.flat_zodiac?.walk_forward_accuracy)}</small></div>
        </article>
      </div>
      <div className="panel table-wrap flat-zodiac-table"><table><thead><tr><th>开奖期号</th><th>预测平特肖</th><th>当期出现生肖</th><th>结果</th></tr></thead><tbody>
        {flatZodiacReviews.map(row => <tr key={row.actual_issue}><td><strong>第 {row.actual_issue} 期</strong></td><td>{row.predicted_flat_zodiac}</td><td>{row.actual_all_zodiacs?.join('、')}</td><td><span className={row.flat_zodiac_hit ? 'hit-pill' : 'miss-pill'}>{row.flat_zodiac_hit ? '命中' : '未中'}</span></td></tr>)}
        {flatZodiacReviews.length === 0 && <tr><td colSpan={4}><div className="empty">从第98期开始记录，等待首期开奖结果</div></td></tr>}
      </tbody></table></div>
    </section>
    <section className="section-block" id="flat-special">
      <div className="section-title"><div><span className="kicker">FLAT SPECIAL REVIEW</span><h2>平特码命中明细</h2></div><p>点击任意一期查看完整预测与开奖对照。</p></div>
      <div className="panel table-wrap review-table"><table><thead><tr><th>开奖期号</th><th>预测特码</th><th>实际特码</th><th>预测特码落入平码</th><th>六码预测命中</th></tr></thead><tbody>
        {data?.reviews.map(row => <tr className="clickable-row" key={row.actual_issue} tabIndex={0} onClick={() => setSelectedReview(row)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedReview(row) } }}><td><strong>第 {row.actual_issue} 期</strong></td><td>{pad(row.predicted_special_number)} · {row.predicted_special_zodiac}</td><td>{pad(row.actual_special_number)} · {row.actual_special_zodiac}</td><td><span className={row.special_pick_regular_hit ? 'hit-pill' : 'miss-pill'}>{row.special_pick_regular_hit ? `命中 · ${pad(row.predicted_special_number)}` : '未落入平码'}</span></td><td><span className="inline-result"><strong>6中{row.regular_hit_count}</strong><small className="hit-numbers">{row.regular_hits.length ? `命中 ${row.regular_hits.map(pad).join('、')}` : '无命中号码'}</small></span></td></tr>)}
      </tbody></table></div>
    </section>
    <section className="section-block"><div className="section-title"><div><span className="kicker">MODEL LAB</span><h2>模型样本外对比</h2></div><p>同一期次、同一随机种子；“排除”表示启用错后不重复规则。</p></div><div className="panel table-wrap"><table><thead><tr><th>模型</th><th>规则</th><th>生肖Top‑1</th><th>生肖Top‑3</th><th>号码Top‑1</th><th>平码均中</th></tr></thead><tbody>{data?.evaluation.models.map((row,index)=><tr key={`${row.method_version}-${index}`}><td><strong>{modelNames[row.method_version]??row.method_version}</strong></td><td><span className={row.no_repeat_enabled?'tag tag-on':'tag'}>{row.no_repeat_enabled?'排除':'不排除'}</span></td><td>{pct(row.special_zodiac_accuracy)}</td><td>{pct(row.special_zodiac_top3_accuracy)}</td><td>{pct(row.special_number_accuracy)}</td><td>{row.average_regular_hits.toFixed(2)}</td></tr>)}</tbody></table></div></section>
    <section className="section-block" id="history"><div className="section-title history-head"><div><span className="kicker">DRAW ARCHIVE</span><h2>开奖记录</h2></div><label className="search"><Search size={16}/><input value={query} onChange={e=>{setQuery(e.target.value);setPage(0)}} placeholder="搜索期号、日期、号码或生肖" aria-label="搜索开奖记录"/></label></div><div className="panel records-list">{visibleRows.map(row=><div className="record-row" key={row.issue}><div className="record-meta"><strong>第 {row.issue} 期</strong><span>{row.date}</span></div><div className="record-balls">{row.numbers.map((ball,index)=><BallBadge key={`${row.issue}-${ball.position}`} ball={ball} special={index===6} compact/>)}</div></div>)}{visibleRows.length===0&&<div className="empty">没有找到匹配的开奖记录</div>}<div className="pager"><span>共 {filtered.length} 期</span><div><button disabled={page===0} onClick={()=>setPage(p=>p-1)} aria-label="上一页"><ChevronLeft size={16}/></button><span>{page+1} / {pageCount}</span><button disabled={page>=pageCount-1} onClick={()=>setPage(p=>p+1)} aria-label="下一页"><ChevronRight size={16}/></button></div></div></div></section>
    <footer><span>财富自由</span><p>本页仅作历史统计与模型评估。随机开奖结果无法被可靠预测。</p></footer>
    {selectedReview && <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setSelectedReview(null)}}><section className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="review-title"><header><div><span className="kicker">REVIEW DETAIL</span><h2 id="review-title">第 {selectedReview.actual_issue} 期复盘详情</h2></div><button onClick={()=>setSelectedReview(null)} aria-label="关闭详情"><X size={19}/></button></header><div className="hit-legend"><span>✓</span> 绿色号码为本期实际命中</div><div className="modal-summary"><div className={selectedReview.special_number_hit||selectedReview.special_pick_regular_hit?'summary-hit':''}><span>预测特码</span><strong>{pad(selectedReview.predicted_special_number)} · {selectedReview.predicted_special_zodiac}</strong></div><div className={selectedReview.special_number_hit?'summary-hit':''}><span>实际特码</span><strong>{pad(selectedReview.actual_special_number)} · {selectedReview.actual_special_zodiac}</strong></div><div><span>平特码</span><strong className={selectedReview.special_pick_regular_hit?'success-text':''}>{selectedReview.special_pick_regular_hit?'命中平码':'未命中'}</strong></div><div><span>平码六码</span><strong className={selectedReview.regular_hit_count?'success-text':''}>6中{selectedReview.regular_hit_count}</strong></div></div><div className="detail-group"><span>预测平码六码</span><div className="modal-balls">{selectedReview.predicted_regular.length?selectedReview.predicted_regular.map(ball=><BallBadge key={`p-${ball.number}`} ball={ball} compact hit={selectedReview.regular_hits.includes(ball.number)}/>):<small>该期预测文件未记录六码</small>}</div></div><div className="detail-group"><span>实际平码与特码</span><div className="modal-balls">{selectedReview.actual_numbers.map((ball,index)=><BallBadge key={`a-${ball.position}`} ball={ball} special={index===6} compact hit={index===6?selectedReview.special_number_hit:selectedReview.regular_hits.includes(ball.number)||(selectedReview.special_pick_regular_hit&&ball.number===selectedReview.predicted_special_number)}/>)}</div></div><div className="detail-grid"><div className="detail-group"><span>六码命中号码</span><strong className={selectedReview.regular_hits.length?'success-text':''}>{selectedReview.regular_hits.length?selectedReview.regular_hits.map(pad).join('、'):'无'}</strong></div><div className="detail-group"><span>预测3中3</span><div className="triple-balls">{selectedReview.predicted_regular_three.length?selectedReview.predicted_regular_three.map(ball=><BallBadge key={`t-${ball.number}`} ball={ball} compact hit={selectedReview.actual_numbers.slice(0,6).some(actual=>actual.number===ball.number)}/>):<small>该期未记录</small>}</div></div></div><div className="modal-meta"><span>模型：{selectedReview.method_version??'未记录'}</span><span>种子：{selectedReview.seed??'未记录'}</span></div></section></div>}
  </main>
}
export default App
