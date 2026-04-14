'use client';

import { useState } from 'react';

type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_input_delta'; partialJson: string }
  | { type: 'tool_use_end' }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; message: string };

type DisplayMessage =
  | { kind: 'text'; content: string }
  | { kind: 'tool'; name: string; input: string; closed: boolean }
  | { kind: 'status'; content: string }
  | { kind: 'error'; content: string };

export default function Home() {
  const [userMessage, setUserMessage] = useState(
    'Say hello to the Plansync agent and call the greet tool with a friendly greeting.'
  );
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const agentUrl = process.env.NEXT_PUBLIC_AGENT_URL ?? 'http://localhost:3001';

  async function sendMessage() {
    if (isStreaming) return;
    setIsStreaming(true);
    setMessages([]);

    try {
      const res = await fetch(`${agentUrl}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessage }),
      });

      if (!res.ok || !res.body) {
        setMessages((prev) => [
          ...prev,
          { kind: 'error', content: `HTTP ${res.status}: ${res.statusText}` },
        ]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          let event: AgentEvent;
          try {
            event = JSON.parse(part.slice(6));
          } catch {
            continue;
          }
          setMessages((prev) => applyEvent(prev, event));
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { kind: 'error', content: err instanceof Error ? err.message : String(err) },
      ]);
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-1">Plansync</h1>
        <p className="text-sm text-gray-600 mb-6">
          Hour 0 streaming test · agent:{' '}
          <code className="bg-gray-200 px-1 rounded">{agentUrl}</code>
        </p>

        <textarea
          value={userMessage}
          onChange={(e) => setUserMessage(e.target.value)}
          className="w-full p-3 border border-gray-300 rounded mb-3 min-h-[80px] font-mono text-sm"
          disabled={isStreaming}
        />

        <button
          onClick={sendMessage}
          disabled={isStreaming}
          className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-400 transition-colors"
        >
          {isStreaming ? 'Streaming…' : 'Send'}
        </button>

        <div className="mt-6 space-y-2">
          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}
        </div>
      </div>
    </main>
  );
}

function applyEvent(prev: DisplayMessage[], event: AgentEvent): DisplayMessage[] {
  const last = prev[prev.length - 1];

  if (event.type === 'text_delta') {
    if (last?.kind === 'text') {
      return [...prev.slice(0, -1), { kind: 'text', content: last.content + event.text }];
    }
    return [...prev, { kind: 'text', content: event.text }];
  }

  if (event.type === 'tool_use_start') {
    return [...prev, { kind: 'tool', name: event.name, input: '', closed: false }];
  }

  if (event.type === 'tool_input_delta') {
    if (last?.kind === 'tool' && !last.closed) {
      return [
        ...prev.slice(0, -1),
        { ...last, input: last.input + event.partialJson },
      ];
    }
    return prev;
  }

  if (event.type === 'tool_use_end') {
    if (last?.kind === 'tool' && !last.closed) {
      return [...prev.slice(0, -1), { ...last, closed: true }];
    }
    return prev;
  }

  if (event.type === 'done') {
    return [...prev, { kind: 'status', content: `✓ done (${event.stopReason})` }];
  }

  if (event.type === 'error') {
    return [...prev, { kind: 'error', content: event.message }];
  }

  return prev;
}

function MessageBubble({ msg }: { msg: DisplayMessage }) {
  if (msg.kind === 'text') {
    return (
      <div className="p-3 bg-white border border-gray-200 rounded whitespace-pre-wrap">
        {msg.content}
      </div>
    );
  }
  if (msg.kind === 'tool') {
    return (
      <div className="p-3 bg-teal-50 border border-teal-200 rounded font-mono text-sm">
        <span className="font-bold text-teal-800">🔧 {msg.name}(</span>
        <span className="text-teal-700">{msg.input}</span>
        <span className="font-bold text-teal-800">{msg.closed ? ')' : '…'}</span>
      </div>
    );
  }
  if (msg.kind === 'status') {
    return (
      <div className="p-2 bg-green-50 border border-green-200 rounded text-sm text-green-800">
        {msg.content}
      </div>
    );
  }
  return (
    <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
      ❌ {msg.content}
    </div>
  );
}
