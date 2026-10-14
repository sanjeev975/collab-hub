'use client';

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { marked } from 'marked';
import {
  Send,
  Users,
  Edit3,
  MessageSquare,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Bold,
  Italic,
  Heading2,
  List,
  CheckSquare,
  Code,
  Download,
  Eye,
  Edit2,
  FileText,
  Plus,
  Pin,
  Smile,
  X,
  FileBox,
  Zap,
  Trash2
} from 'lucide-react';

interface NoteDoc {
  id: string;
  title: string;
  content: string;
  updated_by: string;
  updated_at: string;
}

interface Message {
  id: string;
  sender_name: string;
  message: string;
  created_at: string;
  is_pinned?: boolean;
  reactions?: Record<string, string[]>;
}

interface OnlineUser {
  user: string;
  onlineAt: string;
}

const EMOJIS = ['👍', '❤️', '🚀', '🔥', '👀'];

const getAvatarColor = (name: string) => {
  const colors = [
    'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
    'bg-purple-500/10 text-purple-400 border-purple-500/30',
    'bg-amber-500/10 text-amber-400 border-amber-500/30',
    'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
    'bg-rose-500/10 text-rose-400 border-rose-500/30',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

export default function Workspace() {
  const [username, setUsername] = useState<string>('');
  const [isNameSet, setIsNameSet] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<'CONNECTING' | 'SUBSCRIBED' | 'ERROR'>('CONNECTING');

  // Active view for mobile screens
  const [activeTab, setActiveTab] = useState<'docs' | 'notes' | 'chat'>('notes');

  // Multi-Document State
  const [docs, setDocs] = useState<NoteDoc[]>([]);
  const [activeDocId, setActiveDocId] = useState<string>('00000000-0000-0000-0000-000000000001');
  const [isCreatingDoc, setIsCreatingDoc] = useState<boolean>(false);
  const [newDocTitle, setNewDocTitle] = useState<string>('');

  // Note State
  const [noteContent, setNoteContent] = useState<string>('');
  const [noteTitle, setNoteTitle] = useState<string>('Shared Scratchpad');
  const [lastEditedBy, setLastEditedBy] = useState<string>('System');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [previewMode, setPreviewMode] = useState<boolean>(false);

  // Chat State
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState<string>('');
  const [showEmojiPickerFor, setShowEmojiPickerFor] = useState<string | null>(null);

  // Presence & Typing State
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [chatTypingUsers, setChatTypingUsers] = useState<string[]>([]);
  const [noteTypingUsers, setNoteTypingUsers] = useState<string[]>([]);

  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const dbSaveTimer = useRef<NodeJS.Timeout | null>(null);
  const chatTypingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeDocIdRef = useRef(activeDocId);

  useEffect(() => {
    activeDocIdRef.current = activeDocId;
  }, [activeDocId]);

  useEffect(() => {
    const savedName = localStorage.getItem('collab_username');
    if (savedName) {
      setUsername(savedName);
      setIsNameSet(true);
    }
  }, []);

  const handleSaveUsername = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    localStorage.setItem('collab_username', username.trim());
    setIsNameSet(true);
  };

  useEffect(() => {
    if (!isNameSet || !username) return;

    const fetchDocuments = async () => {
      const { data } = await supabase
        .from('shared_notes')
        .select('*')
        .order('updated_at', { ascending: false });

      if (data && data.length > 0) {
        setDocs(data);
        const current = data.find((d) => d.id === activeDocId) || data[0];
        setActiveDocId(current.id);
        setNoteContent(current.content || '');
        setNoteTitle(current.title || 'Untitled');
        setLastEditedBy(current.updated_by || 'System');
      }
    };

    const fetchMessages = async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(100);

      if (data) {
        setMessages(data);
      }
    };

    fetchDocuments();
    fetchMessages();

    const channel = supabase.channel('collab_global_workspace', {
      config: {
        presence: { key: username },
        broadcast: { ack: false },
      },
    });

    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'instant_text_edit' }, ({ payload }) => {
        if (payload.docId === activeDocIdRef.current && payload.user !== username) {
          setNoteContent(payload.content);
          setLastEditedBy(payload.user);

          setNoteTypingUsers((prev) => Array.from(new Set([...prev, payload.user])));
          setTimeout(() => {
            setNoteTypingUsers((prev) => prev.filter((u) => u !== payload.user));
          }, 1500);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_notes' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setDocs((prev) => [payload.new as NoteDoc, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          const updated = payload.new as NoteDoc;
          setDocs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
          if (updated.id === activeDocIdRef.current && updated.updated_by !== username) {
            setNoteTitle(updated.title || 'Untitled');
            setLastEditedBy(updated.updated_by || 'Someone');
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) return prev;
            return [...prev, payload.new as Message];
          });
        } else if (payload.eventType === 'UPDATE') {
          const updated = payload.new as Message;
          setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        } else if (payload.eventType === 'DELETE') {
          const deletedId = (payload.old as { id: string }).id;
          setMessages((prev) => prev.filter((m) => m.id !== deletedId));
        }
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const active: OnlineUser[] = [];
        Object.keys(state).forEach((key) => {
          const presenceList = state[key] as unknown as { user: string; onlineAt: string }[];
          if (presenceList?.[0]) active.push(presenceList[0]);
        });
        setOnlineUsers(active);
      })
      .on('broadcast', { event: 'chat_typing' }, ({ payload }) => {
        if (payload.user && payload.user !== username) {
          setChatTypingUsers((prev) => Array.from(new Set([...prev, payload.user])));
          setTimeout(() => setChatTypingUsers((prev) => prev.filter((u) => u !== payload.user)), 2000);
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('SUBSCRIBED');
          await channel.track({ user: username, onlineAt: new Date().toISOString() });
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setConnectionStatus('ERROR');
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isNameSet, username]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatTypingUsers]);

  const handleSelectDoc = (doc: NoteDoc) => {
    setActiveDocId(doc.id);
    activeDocIdRef.current = doc.id;
    setNoteTitle(doc.title);
    setNoteContent(doc.content || '');
    setLastEditedBy(doc.updated_by || 'System');
    setActiveTab('notes');
  };

  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDocTitle.trim()) return;

    const { data, error } = await supabase
      .from('shared_notes')
      .insert([
        {
          title: newDocTitle.trim(),
          content: `# ${newDocTitle.trim()}\n\nStart typing...`,
          updated_by: username,
        },
      ])
      .select()
      .single();

    if (data && !error) {
      setNewDocTitle('');
      setIsCreatingDoc(false);
      handleSelectDoc(data);
    }
  };

  const handleContentChange = (val: string) => {
    setNoteContent(val);
    setLastEditedBy(username);

    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'instant_text_edit',
        payload: {
          docId: activeDocId,
          user: username,
          content: val,
        },
      });
    }

    setIsSaving(true);
    if (dbSaveTimer.current) clearTimeout(dbSaveTimer.current);

    dbSaveTimer.current = setTimeout(async () => {
      await supabase
        .from('shared_notes')
        .update({
          content: val,
          updated_by: username,
          updated_at: new Date().toISOString(),
        })
        .eq('id', activeDocId);

      setIsSaving(false);
    }, 800);
  };

  const handleChatInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    if (channelRef.current && e.target.value.trim().length > 0) {
      if (!chatTypingTimeoutRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'chat_typing',
          payload: { user: username },
        });
        chatTypingTimeoutRef.current = setTimeout(() => {
          chatTypingTimeoutRef.current = null;
        }, 1500);
      }
    }
  };

  const insertFormatting = (prefix: string, suffix: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = noteContent.substring(start, end);
    const replacement = prefix + (selectedText || 'text') + suffix;

    const newContent = noteContent.substring(0, start) + replacement + noteContent.substring(end);
    handleContentChange(newContent);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + (selectedText ? selectedText.length : 4));
    }, 50);
  };

  const handleExportNote = () => {
    const blob = new Blob([noteContent], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${noteTitle.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const text = newMessage.trim();
    setNewMessage('');

    await supabase.from('chat_messages').insert([
      {
        sender_name: username || 'Guest',
        message: text,
      },
    ]);
  };

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) return;

    const currentReactions = { ...(msg.reactions || {}) };
    const usersForEmoji = currentReactions[emoji] || [];

    if (usersForEmoji.includes(username)) {
      currentReactions[emoji] = usersForEmoji.filter((u) => u !== username);
      if (currentReactions[emoji].length === 0) delete currentReactions[emoji];
    } else {
      currentReactions[emoji] = [...usersForEmoji, username];
    }

    setShowEmojiPickerFor(null);

    await supabase
      .from('chat_messages')
      .update({ reactions: currentReactions })
      .eq('id', messageId);
  };

  const handleTogglePin = async (messageId: string, currentPinStatus: boolean) => {
    await supabase
      .from('chat_messages')
      .update({ is_pinned: !currentPinStatus })
      .eq('id', messageId);
  };

  const handleDeleteMessage = async (messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));

    const { error } = await supabase
      .from('chat_messages')
      .delete()
      .eq('id', messageId);

    if (error) {
      console.error('Failed to delete message:', error);
      alert('Could not delete message: ' + error.message);
    }
  };

  const pinnedMessages = messages.filter((m) => m.is_pinned);
  const wordCount = noteContent.trim() ? noteContent.trim().split(/\s+/).length : 0;
  const charCount = noteContent.length;

  if (!isNameSet) {
    return (
      <div className="h-[100dvh] w-screen bg-[#09090b] flex items-center justify-center p-4 selection:bg-indigo-500 selection:text-white">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl relative overflow-hidden">
          <div className="absolute -top-16 -right-16 w-36 h-36 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-zinc-100">Welcome to CollabHub</h1>
              <p className="text-xs text-zinc-400">Zero-latency live docs & room chat</p>
            </div>
          </div>
          <form onSubmit={handleSaveUsername} className="space-y-4 mt-6">
            <div>
              <label className="text-xs font-medium text-zinc-400 block mb-1.5">Your Display Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Sanjeev"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] font-medium text-sm text-white rounded-xl shadow-lg shadow-indigo-600/20 transition cursor-pointer"
            >
              Enter Workspace
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] w-screen max-w-full bg-[#09090b] text-zinc-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white overflow-hidden">
      {/* Top Header Bar */}
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md px-3 sm:px-6 py-2 sm:py-2.5 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-indigo-500 shadow-[0_0_8px_#6366f1]" />
            <h1 className="font-semibold text-sm sm:text-base tracking-tight text-zinc-100">CollabHub</h1>
          </div>

          <div className="hidden lg:flex items-center gap-1.5 pl-1">
            {connectionStatus === 'SUBSCRIBED' && (
              <>
                <span className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded-md">
                  <CheckCircle2 className="w-3 h-3" /> Live
                </span>
                <span className="flex items-center gap-1 text-[11px] text-cyan-400 bg-cyan-950/40 border border-cyan-800/40 px-2 py-0.5 rounded-md">
                  <Zap className="w-3 h-3" /> Zero Latency
                </span>
              </>
            )}
            {connectionStatus === 'CONNECTING' && (
              <span className="flex items-center gap-1 text-[11px] text-amber-400 bg-amber-950/40 border border-amber-800/40 px-2 py-0.5 rounded-md animate-pulse">
                Syncing...
              </span>
            )}
          </div>
        </div>

        {/* Mobile View Toggles on Top Bar */}
        <div className="flex lg:hidden items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setActiveTab('docs')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition ${
              activeTab === 'docs'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileBox className="w-3.5 h-3.5" />
            <span>Docs</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('notes')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition ${
              activeTab === 'notes'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Notes</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md relative transition ${
              activeTab === 'chat'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Chat</span>
            {pinnedMessages.length > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            )}
          </button>
        </div>

        {/* Presence Avatars & Username */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden sm:flex items-center -space-x-1.5 overflow-hidden">
            {onlineUsers.slice(0, 3).map((u, i) => (
              <div
                key={i}
                title={`${u.user} is active now`}
                className={`h-6 w-6 rounded-full border border-zinc-950 flex items-center justify-center text-[10px] font-bold uppercase shadow-sm ${getAvatarColor(
                  u.user
                )}`}
              >
                {u.user.charAt(0)}
              </div>
            ))}
          </div>

          <div className={`flex items-center gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg border text-xs font-medium ${getAvatarColor(username)}`}>
            <Users className="w-3 h-3" />
            <span className="truncate max-w-[70px] sm:max-w-none">{username}</span>
          </div>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden w-full relative">
        {/* Left Sidebar: Documents */}
        <aside
          className={`
            w-full lg:w-60 bg-zinc-950 border-r border-zinc-800/80 flex flex-col shrink-0
            ${activeTab === 'docs' ? 'flex' : 'hidden lg:flex'}
          `}
        >
          <div className="p-3 border-b border-zinc-800/80 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
              <FileBox className="w-4 h-4 text-indigo-400" />
              <span>Documents ({docs.length})</span>
            </div>
            <button
              type="button"
              onClick={() => setIsCreatingDoc(!isCreatingDoc)}
              title="New Document"
              className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-md transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {isCreatingDoc && (
            <form onSubmit={handleCreateDocument} className="p-3 bg-zinc-900/60 border-b border-zinc-800 space-y-2 shrink-0">
              <input
                type="text"
                required
                autoFocus
                placeholder="Document title..."
                value={newDocTitle}
                onChange={(e) => setNewDocTitle(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsCreatingDoc(false)}
                  className="px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-2.5 py-1 text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded"
                >
                  Create
                </button>
              </div>
            </form>
          )}

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {docs.map((doc) => {
              const isActive = doc.id === activeDocId;
              return (
                <button
                  key={doc.id}
                  onClick={() => handleSelectDoc(doc)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left transition cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600/20 text-indigo-300 font-medium border border-indigo-500/30'
                      : 'text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-200 border border-transparent'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5 shrink-0 text-indigo-400/80" />
                  <span className="truncate flex-1">{doc.title}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Center: Live Note Canvas */}
        <section
          className={`
            flex-1 flex flex-col bg-zinc-950/30 overflow-hidden min-w-0
            ${activeTab === 'notes' ? 'flex' : 'hidden lg:flex'}
          `}
        >
          {/* Markdown Formatting & Quick Tools Bar */}
          <div className="flex items-center justify-between gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 border-b border-zinc-800/80 bg-zinc-900/40 shrink-0">
            <div className="flex items-center gap-0.5 text-zinc-400 overflow-x-auto py-0.5 max-w-full">
              <button
                type="button"
                onClick={() => insertFormatting('**', '**')}
                title="Bold"
                className="p-1.5 hover:bg-zinc-800 hover:text-zinc-200 rounded transition cursor-pointer"
              >
                <Bold className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => insertFormatting('*', '*')}
                title="Italic"
                className="p-1.5 hover:bg-zinc-800 hover:text-zinc-200 rounded transition cursor-pointer"
              >
                <Italic className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => insertFormatting('## ')}
                title="Heading"
                className="p-1.5 hover:bg-zinc-800 hover:text-zinc-200 rounded transition cursor-pointer"
              >
                <Heading2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => insertFormatting('- ')}
                title="List"
                className="p-1.5 hover:bg-zinc-800 hover:text-zinc-200 rounded transition cursor-pointer"
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => insertFormatting('- [ ] ')}
                title="Checklist"
                className="p-1.5 hover:bg-zinc-800 hover:text-zinc-200 rounded transition cursor-pointer"
              >
                <CheckSquare className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => insertFormatting('```\n', '\n```')}
                title="Code Block"
                className="p-1.5 hover:bg-zinc-800 hover:text-zinc-200 rounded transition cursor-pointer"
              >
                <Code className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {noteTypingUsers.length > 0 && (
                <span className="text-[10px] text-cyan-400 bg-cyan-950/40 border border-cyan-800/40 px-2 py-0.5 rounded-md animate-pulse hidden sm:inline">
                  {noteTypingUsers.join(', ')} typing...
                </span>
              )}
              <button
                type="button"
                onClick={() => setPreviewMode(!previewMode)}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition cursor-pointer ${
                  previewMode
                    ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/30'
                    : 'bg-zinc-800/60 text-zinc-400 border-zinc-700/60 hover:text-zinc-200'
                }`}
              >
                {previewMode ? <Edit2 className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                <span className="hidden sm:inline">{previewMode ? 'Edit' : 'Preview'}</span>
              </button>
              <button
                type="button"
                onClick={handleExportNote}
                title="Download as Markdown"
                className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/60 rounded-md transition cursor-pointer"
              >
                <Download className="w-3 h-3" />
                <span className="hidden sm:inline">Export</span>
              </button>
            </div>
          </div>

          {/* Subheader: Active Title & Save Status */}
          <div className="px-4 py-1.5 bg-zinc-900/20 border-b border-zinc-800/40 flex items-center justify-between text-xs text-zinc-400 shrink-0">
            <span className="font-semibold text-zinc-200 truncate pr-2">{noteTitle}</span>
            <div className="text-[11px] text-zinc-500 shrink-0">
              {isSaving ? (
                <span className="text-amber-400 animate-pulse">Saving...</span>
              ) : (
                <span>Edited by {lastEditedBy}</span>
              )}
            </div>
          </div>

          {/* Editor Canvas Area */}
          <div className="flex-1 p-3 sm:p-5 overflow-y-auto w-full">
            {previewMode ? (
              <div
                className="prose prose-invert max-w-none text-zinc-300 leading-relaxed space-y-2 [&>h1]:text-2xl [&>h1]:font-bold [&>h2]:text-xl [&>h2]:font-semibold [&>ul]:list-disc [&>ul]:pl-5 [&>pre]:bg-zinc-900 [&>pre]:p-3 [&>pre]:rounded-lg text-sm sm:text-base"
                dangerouslySetInnerHTML={{ __html: marked.parse(noteContent || '*No content to preview*') }}
              />
            ) : (
              <textarea
                ref={textareaRef}
                value={noteContent}
                onChange={(e) => handleContentChange(e.target.value)}
                placeholder="Type anything here... Keystrokes broadcast instantly across screens!"
                className="w-full h-full bg-transparent resize-none focus:outline-none text-zinc-200 text-sm sm:text-base leading-relaxed placeholder-zinc-700 font-mono"
              />
            )}
          </div>

          {/* Canvas Footer */}
          <div className="px-4 py-1.5 border-t border-zinc-800/60 bg-zinc-950/60 flex items-center justify-between text-[11px] text-zinc-500 shrink-0">
            <div className="flex items-center gap-2">
              <span>{wordCount} words</span>
              <span>•</span>
              <span>{charCount} chars</span>
            </div>
          </div>
        </section>

        {/* Right: Room Chat */}
        <section
          className={`
            w-full lg:w-80 xl:w-96 border-l border-zinc-800/80 flex flex-col bg-zinc-950/60 overflow-hidden shrink-0
            ${activeTab === 'chat' ? 'flex' : 'hidden lg:flex'}
          `}
        >
          <div className="px-3.5 py-2 sm:py-2.5 border-b border-zinc-800/80 bg-zinc-900/40 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-indigo-400" />
              <h2 className="font-medium text-xs sm:text-sm text-zinc-200">Room Chat</h2>
            </div>
            <span className="text-[11px] text-zinc-500">{messages.length} messages</span>
          </div>

          {/* Pinned Announcements */}
          {pinnedMessages.length > 0 && (
            <div className="bg-indigo-950/30 border-b border-indigo-900/50 p-2 space-y-1 shrink-0">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-300">
                <Pin className="w-3 h-3 rotate-45" />
                <span>Pinned ({pinnedMessages.length})</span>
              </div>
              <div className="max-h-20 overflow-y-auto space-y-1">
                {pinnedMessages.map((pin) => (
                  <div key={pin.id} className="text-xs bg-zinc-900/70 border border-indigo-500/20 rounded p-1 text-zinc-200 flex items-start justify-between gap-1">
                    <div className="truncate">
                      <strong className="text-indigo-300 mr-1">{pin.sender_name}:</strong>
                      <span>{pin.message}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTogglePin(pin.id, true)}
                      title="Unpin"
                      className="text-zinc-500 hover:text-zinc-300 shrink-0 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chat Message List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-zinc-600 space-y-1.5">
                <MessageSquare className="w-7 h-7 opacity-30" />
                <p className="text-xs">No messages yet. Say hello!</p>
              </div>
            ) : (
              messages.map((msg) => {
                const isMe = msg.sender_name === username;
                const isPinned = msg.is_pinned;
                const reactions = msg.reactions || {};

                return (
                  <div key={msg.id} className={`group relative flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                    <div className="flex items-center gap-1 mb-0.5 px-1">
                      <span className="text-[10px] text-zinc-500 font-mono">{msg.sender_name}</span>
                      {isPinned && <Pin className="w-2.5 h-2.5 text-amber-400 rotate-45" />}
                    </div>

                    <div className="relative max-w-[85%]">
                      <div
                        className={`rounded-2xl px-3 py-1.5 text-xs sm:text-sm leading-relaxed shadow-sm ${
                          isMe
                            ? 'bg-indigo-600 text-white rounded-br-xs'
                            : 'bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-bl-xs'
                        }`}
                      >
                        {msg.message}
                      </div>

                      {/* Floating Actions on Hover / Touch */}
                      <div
                        className={`absolute -top-3 ${
                          isMe ? 'left-0 -translate-x-full pr-1.5' : 'right-0 translate-x-full pl-1.5'
                        } hidden group-hover:flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-full px-1.5 py-0.5 shadow-lg z-10`}
                      >
                        <button
                          type="button"
                          onClick={() => setShowEmojiPickerFor(showEmojiPickerFor === msg.id ? null : msg.id)}
                          className="p-1 hover:text-indigo-400 text-zinc-400 transition cursor-pointer"
                          title="React"
                        >
                          <Smile className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleTogglePin(msg.id, !!isPinned)}
                          className={`p-1 hover:text-amber-400 transition cursor-pointer ${isPinned ? 'text-amber-400' : 'text-zinc-400'}`}
                          title={isPinned ? 'Unpin message' : 'Pin message'}
                        >
                          <Pin className="w-3 h-3 rotate-45" />
                        </button>
                        {isMe && (
                          <button
                            type="button"
                            onClick={() => handleDeleteMessage(msg.id)}
                            className="p-1 hover:text-rose-400 text-zinc-400 transition cursor-pointer"
                            title="Delete message"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>

                      {showEmojiPickerFor === msg.id && (
                        <div className="absolute bottom-full mb-1 z-20 flex gap-1 bg-zinc-900 border border-zinc-700 p-1.5 rounded-full shadow-2xl">
                          {EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => handleToggleReaction(msg.id, emoji)}
                              className="hover:scale-125 transition text-sm p-1 cursor-pointer"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {Object.keys(reactions).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1 px-1">
                        {Object.entries(reactions).map(([emoji, users]) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => handleToggleReaction(msg.id, emoji)}
                            title={users.join(', ')}
                            className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border transition cursor-pointer ${
                              users.includes(username)
                                ? 'bg-indigo-600/30 border-indigo-500/40 text-indigo-200'
                                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                            }`}
                          >
                            <span>{emoji}</span>
                            <span>{users.length}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {chatTypingUsers.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-zinc-400 italic py-0.5 px-1">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" />
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.2s]" />
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.4s]" />
                </div>
                <span>{chatTypingUsers.join(', ')} is typing...</span>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Chat Message Input Bar */}
          <form onSubmit={handleSendMessage} className="p-2 sm:p-2.5 border-t border-zinc-800/80 bg-zinc-900/30 flex gap-1.5 shrink-0">
            <input
              type="text"
              value={newMessage}
              onChange={handleChatInputChange}
              placeholder="Send message..."
              className="flex-1 bg-zinc-900/90 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs sm:text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 focus:border-indigo-500/80 transition"
            />
            <button
              type="submit"
              disabled={!newMessage.trim()}
              className="p-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white rounded-lg transition cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
