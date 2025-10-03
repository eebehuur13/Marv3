import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { sendChat, type ChatResponse } from '../lib/api';

interface ChatMessage {
  id: string;
  prompt: string;
  answer: string;
  knowledgeMode: boolean;
  status: 'pending' | 'ready' | 'error';
  citations: ChatResponse['citations'];
  sources: ChatResponse['sources'];
  error?: string;
}

const KNOWLEDGE_STORAGE_KEY = 'marble-knowledge-mode';

export function ChatPanel() {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [knowledgeMode, setKnowledgeMode] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(KNOWLEDGE_STORAGE_KEY);
    if (saved === 'true') setKnowledgeMode(true);
  }, []);

  useEffect(() => {
    localStorage.setItem(KNOWLEDGE_STORAGE_KEY, knowledgeMode ? 'true' : 'false');
  }, [knowledgeMode]);

  const mutation = useMutation({
    mutationFn: async ({ id, question, knowledge }: { id: string; question: string; knowledge: boolean }) => {
      const response = await sendChat(question, knowledge);
      return { id, response };
    },
    onSuccess: ({ id, response }) => {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === id
            ? {
                ...message,
                answer: response.answer,
                citations: response.citations,
                sources: response.sources,
                status: 'ready',
              }
            : message,
        ),
      );
      setStatus(null);
    },
    onError: (error: unknown, variables) => {
      const message = error instanceof Error ? error.message : 'Chat failed';
      setMessages((prev) =>
        prev.map((entry) =>
          entry.id === variables.id
            ? {
                ...entry,
                status: 'error',
                error: message,
              }
            : entry,
        ),
      );
      setStatus(message);
    },
  });

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const hasMessages = useMemo(() => messages.length > 0, [messages.length]);

  const clearChat = () => {
    setMessages([]);
    setStatus(null);
  };

  const submitPrompt = () => {
    if (!prompt.trim()) return;
    const id = crypto.randomUUID();
    const question = prompt.trim();
    setPrompt('');
    setStatus('Thinking…');
    setMessages((prev) => [
      ...prev,
      {
        id,
        prompt: question,
        answer: '',
        knowledgeMode,
        status: 'pending',
        citations: [],
        sources: [],
      },
    ]);
    mutation.mutate({ id, question, knowledge: knowledgeMode });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitPrompt();
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitPrompt();
    }
  };

  return (
    <section className="chat-panel">
      <header className="chat-panel__header">
        <div>
          <h2>Your Knowledge Assistant</h2>
          <p className="chat-panel__subtitle">Toggle between pure model insights and answers grounded in your documents.</p>
        </div>
        <div className="chat-panel__mode">
          <div className="chat-panel__mode-toggle" role="tablist" aria-label="Response mode">
            <button
              type="button"
              role="tab"
              className={!knowledgeMode ? 'active' : ''}
              aria-selected={!knowledgeMode}
              onClick={() => setKnowledgeMode(false)}
            >
              AI only
            </button>
            <button
              type="button"
              role="tab"
              className={knowledgeMode ? 'active' : ''}
              aria-selected={knowledgeMode}
              onClick={() => setKnowledgeMode(true)}
            >
              With My Files
            </button>
          </div>
          <small className="chat-panel__hint-text">
            {knowledgeMode
              ? 'Answers grounded in your private & shared documents.'
              : 'Pure model answers.'}
          </small>
          {hasMessages && (
            <button type="button" className="link chat-panel__clear" onClick={clearChat}>
              Clear chat
            </button>
          )}
        </div>
      </header>

      {status && <div className="chat-panel__banner">{status}</div>}

      <div className={`chat-panel__messages${hasMessages ? '' : ' chat-panel__messages--empty'}`} ref={messagesRef}>
        {hasMessages ? (
          messages.map((message) => (
            <div key={message.id} className="chat-thread">
              <div className="chat-bubble chat-bubble--user">
                <header className="chat-bubble__meta">
                  <span className="chat-bubble__role">You</span>
                </header>
                <p>{message.prompt}</p>
              </div>

              <div
                className={`chat-bubble chat-bubble--assistant chat-bubble--${message.status}${
                  message.knowledgeMode ? ' chat-bubble--knowledge' : ''
                }`}
              >
                <header className="chat-bubble__meta">
                  <span className="chat-bubble__role">Marble</span>
                  {message.knowledgeMode && <span className="chat-bubble__badge">With My Files</span>}
                </header>
                {message.status === 'error' ? (
                  <p className="chat-bubble__error">{message.error}</p>
                ) : (
                  <p>{message.answer || 'Generating…'}</p>
                )}
                {message.citations.length > 0 && (
                  <ul className="chat-bubble__citations">
                    {message.citations.map((citation, index) => (
                      <li key={`${message.id}-${index}`}>
                        <strong>#{index + 1}</strong> {citation.folder} / {citation.file} · lines {citation.lines[0]}–
                        {citation.lines[1]}
                      </li>
                    ))}
                  </ul>
                )}
                {message.sources.length > 0 && (
                  <details className="chat-bubble__sources">
                    <summary>Supporting chunks</summary>
                    <ul>
                      {message.sources.map((source) => (
                        <li key={source.chunkId}>
                          <strong>
                            {source.folderName} / {source.fileName} · lines {source.startLine}–{source.endLine}
                          </strong>
                          <pre>{source.content}</pre>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          ))
        ) : (
          <p className="chat-panel__placeholder">
            {knowledgeMode ? 'Ask Marble about your documents.' : 'Start chatting with Marble.'}
          </p>
        )}
      </div>

      <form className="chat-panel__composer" onSubmit={handleSubmit}>
        <div className="chat-panel__composer-inner">
          <textarea
            rows={1}
            placeholder="Ask something…"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            disabled={mutation.isPending}
          />
          <button type="submit" disabled={mutation.isPending || !prompt.trim()}>
            Send
          </button>
        </div>
        <div className="chat-panel__composer-hint">Enter to send · Shift+Enter for a new line</div>
      </form>
    </section>
  );
}
