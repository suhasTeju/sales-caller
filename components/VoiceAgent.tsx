'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Activity, AlertCircle, Phone, PhoneOff, MessageSquare, Edit3, Save, X, Eye, EyeOff, Copy, Check, Trash2 } from 'lucide-react';
import { SALES_AGENT_SYSTEM_PROMPT } from '@/lib/agent-prompt';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

type DGEvent =
  | { type: 'Welcome'; request_id: string }
  | { type: 'SettingsApplied' }
  | { type: 'ConversationText'; from: 'user' | 'assistant'; text: string }
  | { type: 'UserStartedSpeaking' }
  | { type: 'AgentStartedSpeaking'; request_id?: string }
  | { type: 'AgentAudioDone' }
  | { type: 'AgentThinking' }
  | { type: 'Error'; message?: string; description?: string }
  | { type: 'Warning'; description: string; code: string };

interface ConversationMessage {
  id: number;
  speaker: 'user' | 'assistant';
  message: string;
  timestamp: number;
  isNew?: boolean;
}

export default function VoiceAgent() {
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [currentPrompt, setCurrentPrompt] = useState(SALES_AGENT_SYSTEM_PROMPT);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const [copiedConversation, setCopiedConversation] = useState(false);

  const websocketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const zeroGainRef = useRef<GainNode | null>(null);
  const keepAliveRef = useRef<NodeJS.Timeout | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const nextPlayTimeRef = useRef(0);
  const isAgentCurrentlySpeakingRef = useRef(false);
  const conversationIdRef = useRef(0);
  const conversationScrollRef = useRef<HTMLDivElement>(null);

  // Load prompt from localStorage on mount
  useEffect(() => {
    const savedPrompt = localStorage.getItem('sales_agent_prompt');
    if (savedPrompt) {
      setCurrentPrompt(savedPrompt);
    }
  }, []);

  // Save prompt to localStorage when it changes
  const savePrompt = (prompt: string) => {
    setCurrentPrompt(prompt);
    localStorage.setItem('sales_agent_prompt', prompt);
  };

  const handleEditPrompt = () => {
    setEditedPrompt(currentPrompt);
    setIsEditingPrompt(true);
  };

  const handleSavePrompt = () => {
    savePrompt(editedPrompt);
    setIsEditingPrompt(false);
  };

  const handleCancelEdit = () => {
    setIsEditingPrompt(false);
    setEditedPrompt('');
  };

  const handleResetPrompt = () => {
    savePrompt(SALES_AGENT_SYSTEM_PROMPT);
    setEditedPrompt('');
    setIsEditingPrompt(false);
  };

  const handleCopyConversation = async () => {
    if (conversationHistory.length === 0) {
      return;
    }

    // Format conversation as text
    const conversationText = conversationHistory
      .map((msg) => {
        const timestamp = new Date(msg.timestamp).toLocaleTimeString();
        const speaker = msg.speaker === 'user' ? 'Client' : 'AI Assistant';
        return `[${timestamp}] ${speaker}: ${msg.message}`;
      })
      .join('\n\n');

    const fullText = `=== Off Peak Break Sales Call Transcript ===\nDate: ${new Date().toLocaleDateString()}\nTotal Messages: ${conversationHistory.length}\n\n${conversationText}\n\n=== End of Transcript ===`;

    try {
      await navigator.clipboard.writeText(fullText);
      setCopiedConversation(true);
      setTimeout(() => setCopiedConversation(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleClearConversation = () => {
    if (conversationHistory.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      'Are you sure you want to clear the conversation history? This action cannot be undone.'
    );

    if (confirmed) {
      setConversationHistory([]);
      conversationIdRef.current = 0;
    }
  };

  const addConversationMessage = (message: string, speaker: 'user' | 'assistant') => {
    if (!message.trim()) return;

    const messageId = conversationIdRef.current++;
    const newMessage: ConversationMessage = {
      id: messageId,
      speaker,
      message: message.trim(),
      timestamp: Date.now(),
      isNew: true,
    };

    setConversationHistory((prev) => [...prev, newMessage]);

    // Remove highlight after 3 seconds
    setTimeout(() => {
      setConversationHistory((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, isNew: false } : msg
        )
      );
    }, 3000);

    setTimeout(() => {
      if (conversationScrollRef.current) {
        conversationScrollRef.current.scrollTop = conversationScrollRef.current.scrollHeight;
      }
    }, 100);
  };

  async function getToken() {
    const response = await fetch('/api/deepgram-token');
    if (!response.ok) {
      throw new Error('Failed to get Deepgram token');
    }
    const { token } = await response.json();
    return token as string;
  }

  async function connect() {
    try {
      setConnectionStatus('connecting');
      setError(null);

      const token = await getToken();
      console.log('Got token, connecting to Deepgram Agent API...');

      // Use the exact format from Deepgram SDK: /:version/agent/converse
      const ws = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', ['token', token]);
      ws.binaryType = 'arraybuffer';
      websocketRef.current = ws;

      const connectionTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.close();
          setError('Connection timeout - please try again');
          setConnectionStatus('error');
        }
      }, 15000);

      ws.onopen = async () => {
        clearTimeout(connectionTimeout);
        setIsConnected(true);
        setConnectionStatus('connected');

        const settings = {
          type: 'Settings',
          audio: {
            input: { encoding: 'linear16', sample_rate: 16000 },
            output: { encoding: 'linear16', sample_rate: 16000, container: 'none' },
          },
          agent: {
            listen: { provider: { type: 'deepgram', model: 'nova-3' } },
            think: {
              provider: { type: 'google', model: 'gemini-2.5-flash-lite' },
              prompt: currentPrompt,
            },
            speak: { provider: { type: 'deepgram', model: 'aura-2-thalia-en' } },
          },
        };

        console.log('Sending Deepgram settings:', JSON.stringify(settings, null, 2));
        ws.send(JSON.stringify(settings));

        keepAliveRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'KeepAlive' }));
          }
        }, 30000);

        await startListening();
      };

      ws.onmessage = async (evt: MessageEvent) => {
        try {
          if (typeof evt.data !== 'string') {
            const bytes = evt.data instanceof ArrayBuffer
              ? evt.data
              : await (evt.data as Blob).arrayBuffer();
            await playAudio(bytes);
            return;
          }

          const msg = JSON.parse(evt.data) as DGEvent;
          console.log('[Deepgram Message]', msg.type, msg);

          switch (msg.type) {
            case 'UserStartedSpeaking':
              console.log('User started speaking');
              if (isSpeaking && isAgentCurrentlySpeakingRef.current) {
                currentAudioSourceRef.current?.stop();
                audioQueueRef.current = [];
                nextPlayTimeRef.current = 0;
                isAgentCurrentlySpeakingRef.current = false;
                setIsSpeaking(false);
                setTranscript('');
              }
              setIsListening(true);
              break;

            case 'AgentStartedSpeaking':
              console.log('Agent started speaking');
              setIsListening(false);
              currentAudioSourceRef.current?.stop();
              audioQueueRef.current = [];
              nextPlayTimeRef.current = 0;
              isAgentCurrentlySpeakingRef.current = true;
              setIsSpeaking(true);
              break;

            case 'AgentAudioDone':
              console.log('Agent audio done');
              isAgentCurrentlySpeakingRef.current = false;
              setTimeout(() => {
                if (!isAgentCurrentlySpeakingRef.current) {
                  setIsSpeaking(false);
                  // Keep transcript visible - don't clear it
                  // New messages will replace it naturally
                }
              }, 100);
              break;

            case 'ConversationText': {
              // Handle either {from,text} or {role,content}
              const content = (msg as any).content ?? (msg as any).text ?? "";
              const role: "user" | "assistant" = ((msg as any).role ?? (msg as any).from ?? "assistant") as any;

              console.log('[ConversationText]', { role, content });

              if (content.trim()) {
                addConversationMessage(content, role === "user" ? "user" : "assistant");

                // Route messages to correct display areas
                if (role === "user") {
                  // User messages go to conversation history only
                  console.log('User message added to history');
                } else {
                  // Assistant messages go to main transcript (large screen area)
                  console.log('Setting AI transcript:', content);
                  setTranscript(content);
                }
              }
              break;
            }

            case 'Welcome':
            case 'SettingsApplied':
              console.log('Deepgram ready:', msg.type);
              break;

            case 'Error':
              const errorMessage = msg.message || msg.description || 'Unknown error';
              console.error('Deepgram agent error:', msg);
              setError(`Voice agent error: ${errorMessage}`);
              break;

            default:
              console.log('[Unhandled message type]', msg.type, msg);
              break;
          }
        } catch (err) {
          console.error('Error handling message:', err);
        }
      };

      ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        setIsConnected(false);
        setIsListening(false);
        setIsSpeaking(false);
        setConnectionStatus('disconnected');
        isAgentCurrentlySpeakingRef.current = false;
        cleanupAudio();

        if (event.code !== 1000 && event.code !== 1001 && event.code !== 1005) {
          console.error('WebSocket closed unexpectedly', { code: event.code, reason: event.reason });
          setError(`Connection lost (${event.code}). Please try again.`);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error', error);
        clearTimeout(connectionTimeout);
        setConnectionStatus('error');
        setError('Connection failed. Please check your internet connection.');
      };
    } catch (err) {
      console.error('Failed to connect:', err);
      setError('Failed to connect to voice agent');
      setConnectionStatus('error');
    }
  }

  function cleanupAudio() {
    try { scriptNodeRef.current?.disconnect(); } catch {}
    try { audioWorkletNodeRef.current?.disconnect(); } catch {}
    try { zeroGainRef.current?.disconnect(); } catch {}
    try { currentAudioSourceRef.current?.stop(); } catch {}

    scriptNodeRef.current = null;
    audioWorkletNodeRef.current = null;
    zeroGainRef.current = null;
    currentAudioSourceRef.current = null;
    audioQueueRef.current = [];
    nextPlayTimeRef.current = 0;

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.suspend().then(() => {
        audioContextRef.current?.close();
        audioContextRef.current = null;
      }).catch(() => {
        audioContextRef.current = null;
      });
    }

    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
  }

  async function disconnect() {
    try {
      if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
        websocketRef.current.close();
      }
    } catch {}
    websocketRef.current = null;
    cleanupAudio();
    setIsConnected(false);
    setIsListening(false);
    setIsSpeaking(false);
    setConnectionStatus('disconnected');
    setTranscript('');
    isAgentCurrentlySpeakingRef.current = false;
  }

  async function startListening() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      micStreamRef.current = stream;
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!audioContextRef.current) {
        audioContextRef.current = new AC({ sampleRate: 16000 });
      }
      const ac = audioContextRef.current;
      if (!ac) {
        throw new Error('Failed to create AudioContext');
      }
      if (ac.state === 'suspended') await ac.resume();

      const source = ac.createMediaStreamSource(stream);
      const zeroGain = ac.createGain();
      zeroGain.gain.value = 0;
      zeroGainRef.current = zeroGain;

      const script = ac.createScriptProcessor(1024, 1, 1);
      scriptNodeRef.current = script;

      script.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          int16[i] = s * 0x7fff;
        }
        if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
          websocketRef.current.send(int16.buffer);
        }
      };

      source.connect(script);
      script.connect(zeroGain);
      zeroGain.connect(ac.destination);

      setIsListening(true);
    } catch (err) {
      console.error('Microphone error:', err);
      setError('Failed to access microphone. Please check permissions.');
    }
  }

  async function playAudio(bytes: ArrayBuffer) {
    try {
      if (bytes.byteLength === 0) return;
      if (isListening && !isAgentCurrentlySpeakingRef.current) return;

      const int16Array = new Int16Array(bytes);
      await playAudioChunk(int16Array);
    } catch (err) {
      console.error('Audio playback error', err);
    }
  }

  async function playAudioChunk(int16Array: Int16Array) {
    try {
      if (isListening && !isAgentCurrentlySpeakingRef.current) return;

      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!audioContextRef.current) {
        audioContextRef.current = new AC();
      }
      const ac = audioContextRef.current;
      if (!ac) {
        throw new Error('Failed to create AudioContext');
      }
      if (ac.state === 'suspended') await ac.resume();

      const sampleRate = 16000;
      const audioBuffer = ac.createBuffer(1, int16Array.length, sampleRate);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < int16Array.length; i++) {
        channelData[i] = int16Array[i] / 32768.0;
      }

      const src = ac.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(ac.destination);

      const startTime = Math.max(ac.currentTime, nextPlayTimeRef.current);

      src.onended = () => {
        if (currentAudioSourceRef.current === src) {
          currentAudioSourceRef.current = null;
        }
      };

      if (isListening) return;

      src.start(startTime);
      nextPlayTimeRef.current = startTime + audioBuffer.duration;
      if (!isSpeaking) setIsSpeaking(true);
      currentAudioSourceRef.current = src;
    } catch (err) {
      console.error('Audio chunk playback error', err);
      setIsSpeaking(false);
    }
  }

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  const visualState: 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' =
    !isConnected
      ? 'idle'
      : isSpeaking
      ? 'speaking'
      : isListening
      ? 'listening'
      : connectionStatus === 'connecting'
      ? 'connecting'
      : 'thinking';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-300">
            Off Peak Break Sales Assistant
          </h1>
          <p className="text-slate-300">AI-powered real-time response suggestions to book more 15-minute calls</p>
        </div>

        {/* Prompt Management Section */}
        <div className="mb-8 max-w-5xl mx-auto">
          <div className="bg-slate-800/50 backdrop-blur rounded-lg p-6 border border-slate-700">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-purple-400" />
                AI Agent Prompt
                <span className="text-xs font-normal text-slate-400 ml-2">
                  (Currently Active)
                </span>
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowPrompt(!showPrompt)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all bg-slate-700 hover:bg-slate-600"
                  disabled={isConnected}
                >
                  {showPrompt ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  {showPrompt ? 'Hide' : 'Show'} Prompt
                </button>
                {!isEditingPrompt ? (
                  <button
                    onClick={handleEditPrompt}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isConnected}
                  >
                    <Edit3 className="w-4 h-4" />
                    Edit Prompt
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleSavePrompt}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all bg-green-600 hover:bg-green-700"
                    >
                      <Save className="w-4 h-4" />
                      Save
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all bg-slate-600 hover:bg-slate-700"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>

            {isConnected && (
              <div className="mb-4 bg-yellow-600/20 border border-yellow-600/40 rounded-lg p-3 text-sm text-yellow-300">
                <AlertCircle className="w-4 h-4 inline mr-2" />
                End the call to edit the prompt. Changes will apply to your next call.
              </div>
            )}

            {showPrompt && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
              >
                {isEditingPrompt ? (
                  <div>
                    <textarea
                      value={editedPrompt}
                      onChange={(e) => setEditedPrompt(e.target.value)}
                      className="w-full h-96 bg-slate-900/50 border border-slate-600 rounded-lg p-4 text-sm text-slate-100 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Enter your agent prompt..."
                    />
                    <div className="mt-4 flex justify-between items-center">
                      <button
                        onClick={handleResetPrompt}
                        className="text-sm text-red-400 hover:text-red-300 underline"
                      >
                        Reset to Default Prompt
                      </button>
                      <div className="text-xs text-slate-400">
                        {editedPrompt.length} characters
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4 max-h-96 overflow-y-auto">
                    <pre className="text-sm text-slate-300 whitespace-pre-wrap font-mono">
                      {currentPrompt}
                    </pre>
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </div>

        {/* Main Controls */}
        <div className="flex justify-center gap-4 mb-8">
          {!isConnected ? (
            <button
              onClick={connect}
              disabled={connectionStatus === 'connecting'}
              className="flex items-center gap-2 px-8 py-4 rounded-lg font-semibold transition-all bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Phone className="w-5 h-5" />
              {connectionStatus === 'connecting' ? 'Connecting...' : 'Start Call'}
            </button>
          ) : (
            <button
              onClick={disconnect}
              className="flex items-center gap-2 px-8 py-4 rounded-lg font-semibold transition-all bg-red-600 hover:bg-red-700"
            >
              <PhoneOff className="w-5 h-5" />
              End Call
            </button>
          )}
        </div>

        {/* Status Indicators */}
        {isConnected && (
          <div className="flex justify-center gap-4 mb-8">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
              visualState === 'listening'
                ? 'bg-green-600/20 text-green-400'
                : visualState === 'speaking'
                ? 'bg-blue-600/20 text-blue-400'
                : visualState === 'thinking'
                ? 'bg-yellow-600/20 text-yellow-400'
                : 'bg-gray-600/20 text-gray-400'
            }`}>
              <Activity className="w-4 h-4 animate-pulse" />
              {visualState === 'listening' && 'Listening...'}
              {visualState === 'speaking' && 'Agent Speaking...'}
              {visualState === 'thinking' && 'Thinking...'}
              {visualState === 'connecting' && 'Connecting...'}
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center gap-2 bg-red-600/20 text-red-400 px-4 py-3 rounded-lg mb-8 max-w-2xl mx-auto">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Suggested Response */}
          <div className="bg-slate-800/50 backdrop-blur rounded-lg p-6 shadow-xl border border-slate-700">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-cyan-400" />
              Suggested Response
              <span className="ml-auto text-xs font-normal text-slate-400">Read this to your client</span>
            </h2>
            <div className="min-h-[400px] max-h-[600px] overflow-y-auto">
              {transcript ? (
                <motion.div
                  key="transcript-display"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="bg-gradient-to-br from-blue-600/20 to-cyan-600/20 border-2 border-cyan-500/50 p-6 rounded-lg"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></div>
                    <div className="text-xs font-semibold text-cyan-300 uppercase tracking-wide">What to say now:</div>
                  </div>
                  <p className="text-2xl text-white leading-relaxed font-medium">{transcript}</p>
                </motion.div>
              ) : (
                <div className="text-center py-12 text-slate-400">
                  {isConnected ? 'Listening to client... suggestions will appear here' : 'Connect to start'}
                </div>
              )}
            </div>
          </div>

          {/* Conversation History */}
          <div className="bg-slate-800/50 backdrop-blur rounded-lg p-6 shadow-xl border border-slate-700">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-400" />
                Conversation History
              </h2>
              {conversationHistory.length > 0 && (
                <div className="flex gap-2">
                  <button
                    onClick={handleCopyConversation}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
                    title="Copy conversation transcript"
                  >
                    {copiedConversation ? (
                      <>
                        <Check className="w-4 h-4 text-green-400" />
                        <span className="text-green-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleClearConversation}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all bg-red-600/20 hover:bg-red-600/30 text-red-400 hover:text-red-300 border border-red-600/30"
                    title="Clear conversation history"
                  >
                    <Trash2 className="w-4 h-4" />
                    Clear
                  </button>
                </div>
              )}
            </div>
            <div
              ref={conversationScrollRef}
              className="space-y-3 max-h-[600px] overflow-y-auto pr-2"
            >
              {conversationHistory.length === 0 ? (
                <p className="text-slate-400 text-center py-8">
                  Messages will appear here during the conversation...
                </p>
              ) : (
                conversationHistory.map((message) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, x: message.speaker === 'user' ? -20 : 20 }}
                    animate={{
                      opacity: 1,
                      x: 0,
                      scale: message.isNew ? [1, 1.02, 1] : 1,
                    }}
                    transition={{ duration: 0.3 }}
                    className={`p-4 rounded-lg transition-all duration-300 ${
                      message.speaker === 'user'
                        ? message.isNew
                          ? 'bg-green-600/40 border-2 border-green-400 shadow-lg shadow-green-500/50'
                          : 'bg-green-600/20 border border-green-600/30'
                        : message.isNew
                          ? 'bg-blue-600/40 border-2 border-blue-400 shadow-lg shadow-blue-500/50'
                          : 'bg-blue-600/20 border border-blue-600/30'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-semibold text-sm flex items-center gap-2">
                        {message.speaker === 'user' ? 'You' : 'Assistant'}
                        {message.isNew && (
                          <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></span>
                        )}
                      </span>
                      <span className="text-xs text-slate-400">
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-slate-100">{message.message}</p>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Instructions */}
        {!isConnected && (
          <div className="mt-8 max-w-2xl mx-auto bg-slate-800/30 backdrop-blur rounded-lg p-6 border border-slate-700">
            <h3 className="text-lg font-semibold mb-3 text-cyan-400">How to Use:</h3>
            <ul className="space-y-2 text-slate-300">
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">•</span>
                <span>Click "Start Call" to begin - have your client on speakerphone</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">•</span>
                <span>When your client asks a question, the AI will provide a quick response suggestion</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">•</span>
                <span>Read the suggested response out loud to your client (or adapt it)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">•</span>
                <span>Use headphones to prevent echo - responses appear in real-time</span>
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
