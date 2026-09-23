let prompt = ''
for await (const chunk of process.stdin) prompt += chunk
const emit = value => console.log(JSON.stringify(value))
if (!process.argv.includes('gpt-5.6-sol') || !process.argv.includes('model_reasoning_effort="low"')) { emit({ type: 'turn.failed', error: { message: '模型配置未传给 CLI' } }); process.exitCode = 1 }
else if (prompt.includes('TEST_TIMEOUT')) await new Promise(resolve => setTimeout(resolve, 10000))
else if (prompt.includes('TEST_FAILURE')) { emit({ type: 'turn.failed', error: { message: '模拟失败' } }); process.exitCode = 1 }
else {
  emit({ type: 'thread.started', thread_id: 'test-thread-123' })
  emit({ type: 'item.completed', item: { type: 'agent_message', text: process.argv.includes('resume') ? '续接成功' : '分析完成' } })
  emit({ type: 'turn.completed' })
}
