import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { sendChat, type ChatResponse } from '../lib/api';

type AnswerBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] };

function structureAnswer(answer: string): AnswerBlock[] {
  const lines = answer.split(/\r?\n/);
  const blocks: AnswerBlock[] = [];
  let paragraphBuffer: string[] = [];
  let currentList: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    const text = paragraphBuffer.join(' ').trim();
    if (text) {
      blocks.push({ type: 'paragraph', text });
    }
    paragraphBuffer = [];
  };

  const flushList = () => {
    if (currentList && currentList.items.length) {
      blocks.push({ type: 'list', ordered: currentList.ordered, items: currentList.items });
    }
    currentList = null;
  };

  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
      return;
    }

    const headingMatch = /^([A-Za-z0-9].{0,96}?)\s*:\s*$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', text: headingMatch[1] });
      return;
    }

    const unorderedMatch = /^[-*•]\s+(.*)$/.exec(line);
    if (unorderedMatch) {
      flushParagraph();
      const item = unorderedMatch[1].trim();
      if (!currentList || currentList.ordered) {
        flushList();
        currentList = { ordered: false, items: [] };
      }
      if (item) currentList.items.push(item);
      return;
    }

    const orderedMatch = /^(\d+)[.)]\s+(.*)$/.exec(line);
    if (orderedMatch) {
      flushParagraph();
      const item = orderedMatch[2].trim();
      if (!currentList || !currentList.ordered) {
        flushList();
        currentList = { ordered: true, items: [] };
      }
      if (item) currentList.items.push(item);
      return;
    }

    flushList();
    paragraphBuffer.push(line);
  });

  flushParagraph();
  flushList();

  return blocks;
}

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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(KNOWLEDGE_STORAGE_KEY);
    if (saved === 'true') setKnowledgeMode(true);
  }, []);

  useEffect(() => {
    localStorage.setItem(KNOWLEDGE_STORAGE_KEY, knowledgeMode ? 'true' : 'false');
  }, [knowledgeMode]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const className = 'chat-fullscreen-active';
    if (isFullscreen) {
      document.body.classList.add(className);
    } else {
      document.body.classList.remove(className);
    }
    return () => {
      document.body.classList.remove(className);
    };
  }, [isFullscreen]);

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
    <section className={`chat-panel${isFullscreen ? ' chat-panel--fullscreen' : ''}`}>
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
        <button
          type="button"
          className="chat-panel__fullscreen-toggle"
          onClick={() => setIsFullscreen((prev) => !prev)}
          aria-label={isFullscreen ? 'Exit fullscreen chat' : 'Enter fullscreen chat'}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? '✕' : '⤢'}
        </button>
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
                <AnswerContent answer={message.answer} />
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

function AnswerContent({ answer }: { answer: string }) {
  const blocks = useMemo(() => structureAnswer(answer), [answer]);

  if (!answer.trim()) {
    return <p>Generating…</p>;
  }

  if (!blocks.length) {
    return <p>{answer}</p>;
  }

  return (
    <div className="chat-answer">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <p key={`heading-${index}`} className="chat-answer__heading">
              {block.text}
            </p>
          );
        }
        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag key={`list-${index}`} className="chat-answer__list">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ListTag>
          );
        }
        return (
          <p key={`paragraph-${index}`} className="chat-answer__paragraph">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}
