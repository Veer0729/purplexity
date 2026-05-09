import { createClient } from "@/lib/client";
import type { User } from "@supabase/supabase-js";
import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import axios from "axios";
import { BACKEND_URL } from "@/lib/config";
import { cn } from "@/lib/utils";
import {
  Home, BookOpen, Plus, LogOut, Send, Globe,
  ChevronRight, AlignLeft, Sparkles, Search,
  Share2, Download, Copy, RefreshCw, ThumbsUp, ThumbsDown, MoreHorizontal, Mic
} from "lucide-react";


const supabase = createClient();

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface Message {
  id?: number;
  role: "User" | "Assistant";
  content: string;
  sources?: Source[];
  followUps?: string[];
}
interface Source { url: string; title: string; content?: string; }
interface Conversation { id: string; title: string | null; slug: string; }

/* ─── Parsers ────────────────────────────────────────────────────────────── */
function parseLLMText(text: string): { answer: string; followUps: string[] } {
  const answerMatch = text.match(/<ANSWER>([\s\S]*?)<\/ANSWER>/);
  const answer = answerMatch ? answerMatch[1].trim() : text.trim();
  const fuMatches = [...text.matchAll(/<question>([\s\S]*?)<\/question>/g)];
  return { answer, followUps: fuMatches.map(m => m[1].trim()) };
}

function parseFullResponse(raw: string) {
  const SRC = "~~~~~~~~~~~~~~~SOURCES~~~~~~~~~~~~~~~~~~~";
  const CID = "~~~~~~~~~~~~~~~CONVERSATION_ID~~~~~~~~~~~~~~~~~~~";
  const [llmPart, rest = ""] = raw.split(SRC);
  const [sourcesRaw, cidPart = ""] = rest.split(CID);
  const { answer, followUps } = parseLLMText(llmPart);
  const sources: Source[] = sourcesRaw.trim().split("\n\n").filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line.trim())]; } catch { return []; }
  });
  return { answer, followUps, sources, conversationId: cidPart.trim() || null };
}

/* ─── Simple Markdown renderer ───────────────────────────────────────────── */
function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br/>")
    .replace(/^(?!<[hupblorc])(.+)$/gm, "<p>$1</p>")
    .replace(/<p><\/p>/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

/* ─── Suggestion prompts ─────────────────────────────────────────────────── */
const SUGGESTIONS = [
  { icon: "🌐", text: "What's happening in AI research this week?" },
  { icon: "💡", text: "Explain quantum computing in simple terms" },
  { icon: "📈", text: "What are the best long-term investment strategies?" },
  { icon: "🔬", text: "Latest breakthroughs in gene therapy" },
];

/* ════════════════════════════════════════════════════════════════════════════
   DASHBOARD
   ════════════════════════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasChat = messages.length > 0;

  /* auth */
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUser(data.user);
      else navigate("/auth");
    });
  }, []);

  async function getJwt(): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  /* fetch sidebar convs */
  async function fetchConversations(jwt: string) {
    try {
      const res = await axios.get(`${BACKEND_URL}/conversations`, { headers: { Authorization: jwt } });
      setConversations(res.data);
    } catch {}
  }

  useEffect(() => {
    if (!user) return;
    getJwt().then(jwt => { if (jwt) fetchConversations(jwt); });
  }, [user]);

  /* scroll to bottom */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  /* auto-resize textarea */
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  /* load existing conversation */
  async function loadConversation(id: string) {
    setActiveConversationId(id);
    const jwt = await getJwt();
    if (!jwt) return;
    const res = await axios.get(`${BACKEND_URL}/conversations/${id}`, { headers: { Authorization: jwt } });
    setMessages(res.data.messages ?? []);
  }

  /* send */
  async function sendMessage(query: string) {
    if (!query.trim() || isLoading) return;
    setInput("");
    setIsLoading(true);
    setMessages(prev => [...prev, { role: "User", content: query }]);
    const jwt = await getJwt();
    if (!jwt) { setIsLoading(false); return; }

    try {
      if (activeConversationId) {
        const res = await axios.post(
          `${BACKEND_URL}/asking_purplexity/follow_up`,
          { conversationId: activeConversationId, query },
          { headers: { Authorization: jwt }, responseType: "text" }
        );
        const { answer, followUps } = parseLLMText(res.data);
        setMessages(prev => [...prev, { role: "Assistant", content: answer, followUps }]);
      } else {
        const res = await axios.post(
          `${BACKEND_URL}/asking_purplexity`,
          { query },
          { headers: { Authorization: jwt }, responseType: "text" }
        );
        const { answer, followUps, sources, conversationId } = parseFullResponse(res.data);
        setMessages(prev => [...prev, { role: "Assistant", content: answer, sources, followUps }]);
        if (conversationId) {
          setActiveConversationId(conversationId);
          fetchConversations(jwt);
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: "Assistant", content: "Something went wrong. Please try again." }]);
    }
    setIsLoading(false);
  }

  function startNewChat() {
    setActiveConversationId(null);
    setMessages([]);
    setInput("");
  }

  async function logout() {
    await supabase.auth.signOut();
    navigate("/auth");
  }

  /* ── render ── */
  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg)", overflow: "hidden", fontFamily: "var(--font-sans)" }}>

      {/* ── SIDEBAR ── */}
      <aside style={{
        width: sidebarOpen ? 240 : 0,
        minWidth: sidebarOpen ? 240 : 0,
        flexShrink: 0,
        background: "var(--sidebar-bg)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        transition: "width 0.25s ease, min-width 0.25s ease",
      }}>
        {/* Logo */}
        <div style={{ padding: "20px 16px 12px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg, #20b2aa, #0d8a82)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Sparkles size={16} color="#fff" />
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
            Purplexity
          </span>
        </div>

        {/* New Thread */}
        <div style={{ padding: "8px 12px 12px" }}>
          <button
            onClick={startNewChat}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 8,
              padding: "9px 12px", borderRadius: 8,
              background: "rgba(32,178,170,0.12)", border: "1px solid rgba(32,178,170,0.25)",
              color: "#20b2aa", fontSize: 14, fontWeight: 500, cursor: "pointer",
              transition: "background 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(32,178,170,0.2)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(32,178,170,0.12)")}
          >
            <Plus size={16} />
            New Thread
          </button>
        </div>

        {/* Nav */}
        <nav style={{ padding: "4px 12px" }}>
          <button className={cn("sidebar-item", !hasChat && "active")} onClick={startNewChat}>
            <Home size={17} /> Home
          </button>
          <button className="sidebar-item" onClick={() => {}}>
            <Search size={17} /> Discover
          </button>
          <button className="sidebar-item" onClick={() => {}}>
            <BookOpen size={17} /> Library
          </button>
        </nav>

        {/* History */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", marginTop: 16 }}>
          {conversations.length > 0 && (
            <>
              <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 16px 8px" }}>
                Recent
              </p>
              <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
                {conversations.slice(0, 20).map(conv => (
                  <button
                    key={conv.id}
                    onClick={() => loadConversation(conv.id)}
                    className={cn("conv-item", activeConversationId === conv.id && "active")}
                  >
                    {conv.title || "Untitled"}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* User */}
        {user && (
          <div style={{ padding: "12px 8px", borderTop: "1px solid var(--border)" }}>
            <button
              onClick={logout}
              className="sidebar-item"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#ef4444"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
            >
              <LogOut size={16} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left" }}>
                {user.email}
              </span>
            </button>
          </div>
        )}
      </aside>

      {/* ── MAIN ── */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>

        {/* Topbar */}
        <div style={{
          height: 52, display: "flex", alignItems: "center", padding: "0 16px",
          borderBottom: "1px solid var(--border)", gap: 12, flexShrink: 0,
        }}>
          <button
            onClick={() => setSidebarOpen(v => !v)}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 6, borderRadius: 6, display: "flex", alignItems: "center" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}
          >
            <AlignLeft size={18} />
          </button>
          {hasChat && activeConversationId && (
            <span style={{ fontSize: 14, color: "var(--text-secondary)", fontWeight: 500 }}>
              {conversations.find(c => c.id === activeConversationId)?.title || "Thread"}
            </span>
          )}
        </div>

        {/* Content */}
        {!hasChat ? (
          /* ── HOME ── */
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 24px 80px" }}>
            <div style={{ width: "100%", maxWidth: 680 }}>
              <h1 style={{ fontSize: 32, fontWeight: 700, color: "var(--text-primary)", marginBottom: 32, textAlign: "center", letterSpacing: "-0.5px" }}>
                Where knowledge begins
              </h1>
              <SearchBar input={input} setInput={setInput} isLoading={isLoading} textareaRef={textareaRef} onSend={() => sendMessage(input)} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 20 }}>
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} onClick={() => sendMessage(s.text)} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
                    background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: 10, cursor: "pointer", transition: "border-color 0.15s, background 0.15s",
                    fontSize: 13, color: "var(--text-secondary)", textAlign: "left",
                  }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-hover)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}
                  >
                    <span style={{ fontSize: 18 }}>{s.icon}</span>
                    {s.text}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* ── CHAT ── */
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, overflowY: "auto" }}>
              <div style={{ maxWidth: 768, margin: "0 auto", padding: "32px 24px 24px" }}>
                {messages.map((msg, i) => (
                  <MessageBlock
                    key={i}
                    msg={msg}
                    onFollowUp={sendMessage}
                    animate={i === messages.length - 1 && msg.role === "Assistant"}
                    onRetry={i >= 1 && msg.role === "Assistant" ? () => sendMessage(messages[i - 1]?.content ?? "") : undefined}
                  />
                ))}

                {isLoading && (
                  <div className="fade-in-up" style={{ padding: "24px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#20b2aa,#0d8a82)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Sparkles size={14} color="#fff" />
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Purplexity</span>
                    </div>
                    <div className="dot-pulse" style={{ paddingLeft: 38, display: "flex", gap: 6 }}>
                      <span /><span /><span />
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Pinned input */}
            <div style={{ padding: "16px 24px 20px", borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
              <div style={{ maxWidth: 768, margin: "0 auto" }}>
                <SearchBar input={input} setInput={setInput} isLoading={isLoading} textareaRef={textareaRef} onSend={() => sendMessage(input)} followUp />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ─── Typewriter hook ────────────────────────────────────────────────────── */
function useTypewriter(text: string, speed = 6) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const idxRef = useRef(0);
  const rafRef = useRef<number>(0);
  useEffect(() => {
    idxRef.current = 0;
    setDisplayed("");
    setDone(false);
    let last = 0;
    const step = (ts: number) => {
      if (ts - last > speed) {
        last = ts;
        const chunk = Math.min(6, text.length - idxRef.current);
        idxRef.current += chunk;
        setDisplayed(text.slice(0, idxRef.current));
        if (idxRef.current >= text.length) { setDone(true); return; }
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [text]);
  return { displayed, done };
}

/* ─── Toast helper ─────────────────────────────────────────────────────────── */
function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const show = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(null), 2000);
  };
  return { msg, show };
}

/* ─── Action Bar ─────────────────────────────────────────────────────────── */
function ActionBar({ sources, content, onRetry }: { sources?: Source[]; content: string; onRetry?: () => void }) {
  const [liked, setLiked] = useState<null | boolean>(null);
  const [showSources, setShowSources] = useState(false);
  const [copied, setCopied] = useState(false);
  const { msg: toast, show: showToast } = useToast();
  const count = sources?.length ?? 0;

  function handleCopy() {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleDownload() {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `purplexity-answer-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleShare() {
    const text = content.slice(0, 300) + (content.length > 300 ? "..." : "");
    if (navigator.share) {
      navigator.share({ title: "Purplexity Answer", text, url: window.location.href }).catch(() => {});
    } else {
      navigator.clipboard.writeText(window.location.href);
      showToast("Link copied!");
    }
  }

  function handleThumb(val: boolean) {
    setLiked(prev => prev === val ? null : val);
    showToast(val ? "Thanks for the feedback!" : "We'll improve this.");
  }

  return (
    <div style={{ position: "relative" }}>
      {/* Toast */}
      {toast && (
        <div className="action-toast fade-in-up">{toast}</div>
      )}
      <div className="action-bar">
        <div className="action-left">
          <button className="action-btn" title="Share" onClick={handleShare}><Share2 size={15} /></button>
          <button className="action-btn" title="Download as markdown" onClick={handleDownload}><Download size={15} /></button>
          <button className={`action-btn${copied ? " active" : ""}`} title={copied ? "Copied!" : "Copy"} onClick={handleCopy}>
            {copied ? <span style={{ fontSize: 13 }}>✓</span> : <Copy size={15} />}
          </button>
          {onRetry && (
            <button className="action-btn" title="Retry" onClick={onRetry}><RefreshCw size={15} /></button>
          )}
          {count > 0 && (
            <button
              className={`sources-count-btn${showSources ? " active" : ""}`}
              onClick={() => setShowSources(v => !v)}
            >
              <div className="favicon-stack">
                {(sources ?? []).slice(0, 3).map((src, i) => {
                  let host = src.url;
                  try { host = new URL(src.url).hostname; } catch {}
                  return <img key={i} src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`} alt="" className="favicon-stack-img" style={{ zIndex: 3 - i, marginLeft: i === 0 ? 0 : -6 }} />;
                })}
              </div>
              <span>{count} source{count !== 1 ? "s" : ""}</span>
            </button>
          )}
        </div>
        <div className="action-right">
          <button className={`action-btn${liked === true ? " active" : ""}`} onClick={() => handleThumb(true)} title="Good response"><ThumbsUp size={15} /></button>
          <button className={`action-btn${liked === false ? " active-bad" : ""}`} onClick={() => handleThumb(false)} title="Bad response"><ThumbsDown size={15} /></button>
          <button className="action-btn" title="More" onClick={() => showToast("More options coming soon")}><MoreHorizontal size={15} /></button>
        </div>
      </div>

      {/* Expandable sources panel */}
      {showSources && sources && sources.length > 0 && (
        <div className="sources-panel fade-in-up">
          <p className="sources-panel-label"><Globe size={12} /> {count} Sources</p>
          <div className="sources-panel-list">
            {sources.map((src, i) => {
              let host = src.url;
              try { host = new URL(src.url).hostname.replace(/^www\./, ""); } catch {}
              return (
                <a key={i} href={src.url} target="_blank" rel="noopener noreferrer" className="sources-panel-item">
                  <span className="source-num-small">{i + 1}</span>
                  <img src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`} alt="" style={{ width: 14, height: 14, borderRadius: 2, flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="sp-title">{src.title || host}</div>
                    <div className="sp-domain">{host}</div>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Message Block ──────────────────────────────────────────────────────── */
function MessageBlock({ msg, onFollowUp, animate, onRetry }: {
  msg: Message; onFollowUp: (q: string) => void; animate?: boolean; onRetry?: () => void;
}) {
  const isUser = msg.role === "User";
  const { displayed, done } = useTypewriter(animate ? msg.content : "", 6);
  const renderedContent = animate && !done ? displayed : msg.content;

  if (isUser) {
    return (
      <div className="msg-user fade-in-up">
        <div className="user-bubble">{msg.content}</div>
      </div>
    );
  }

  return (
    <div className="msg-assistant fade-in-up">
      <div
        className={`prose-answer${animate && !done ? " typing" : ""}`}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(renderedContent) }}
      />
      {animate && !done && <span className="cursor-blink" />}

      {(!animate || done) && (
        <>
          <ActionBar sources={msg.sources} content={msg.content} onRetry={onRetry} />
          {msg.followUps && msg.followUps.length > 0 && (
            <div className="followups-section fade-in-up">
              <p className="followups-heading">Follow-ups</p>
              {msg.followUps.map((q, i) => (
                <button key={i} className="followup-row" onClick={() => onFollowUp(q)}>
                  <span className="fu-arrow">↳</span>
                  <span className="fu-text">{q}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Search Bar ─────────────────────────────────────────────────────────── */
function SearchBar({
  input, setInput, isLoading, textareaRef, onSend, followUp
}: {
  input: string; setInput: (v: string) => void; isLoading: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>; onSend: () => void; followUp?: boolean;
}) {
  return (
    <div className={`search-box input-glow${followUp ? " followup-box" : ""}`}>
      <textarea
        ref={textareaRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
        placeholder={followUp ? "Ask a follow-up" : "Ask anything..."}
        rows={1}
        disabled={isLoading}
        className="search-textarea"
      />
      <div className="search-toolbar">
        <div className="toolbar-left">
          <button className="tool-pill">
            <Plus size={14} />
          </button>
          <button className="tool-pill">
            <Search size={13} />
            <span>Search</span>
            <ChevronRight size={12} style={{ transform: "rotate(90deg)", opacity: 0.5 }} />
          </button>
        </div>
        <div className="toolbar-right">
          {followUp && <span className="model-pill">Model <ChevronRight size={12} style={{ transform: "rotate(90deg)", opacity: 0.5 }} /></span>}
          <button className="tool-icon-btn" title="Voice">
            <Mic size={15} />
          </button>
          <button
            onClick={onSend}
            disabled={isLoading || !input.trim()}
            className={`send-btn${input.trim() && !isLoading ? " active" : ""}`}
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}