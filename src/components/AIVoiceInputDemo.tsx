import { AIVoiceInput } from "@/components/ui/ai-voice-input";
import { useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, AlertCircle, CheckCircle, Trash2, Play, Pause, FileText } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface Recording {
  id: string;
  duration: number;
  timestamp: Date;
  status: 'success' | 'error' | 'processing';
  audioBlob?: Blob;
  error?: string;
  logs?: LogEntry[];
}

interface LogEntry {
  timestamp: string;
  type: 'info' | 'error' | 'warning';
  source: 'server' | 'browser';
  message: string;
}

export function AIVoiceInputDemo() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState("English");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [playingRecording, setPlayingRecording] = useState<string | null>(null);
  
  // WebSocket and audio refs
  const webSocketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamIdRef = useRef<string>('');
  const currentRecordingRef = useRef<Recording | null>(null);
  const connectionAttemptInProgress = useRef<boolean>(false);
  const audioChunksRef = useRef<Blob[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  
  // Duration tracking refs
  const conversationStartTimeRef = useRef<number | null>(null);
  const conversationDurationRef = useRef<number>(0);
  const cleanupInProgress = useRef<boolean>(false);
  const durationUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Full conversation recording refs
  const playbackQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const nextSeqToPlayRef = useRef<number>(0);
  const audioBufferMapRef = useRef<{[key: number]: AudioBuffer}>({});
  const mixerNodeRef = useRef<GainNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const destinationStreamRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const fullConversationRecorderRef = useRef<MediaRecorder | null>(null);
  
  // Playback control refs
  const currentPlaybackSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const WEBSOCKET_URL = 'ws://localhost:6543/voice/ws/browser/stream';
  const CHUNK_DURATION_MS = 1000;

  // Store logs for current recording
  const currentRecordingLogsRef = useRef<LogEntry[]>([]);

  const appendLog = (message: string, type: 'info' | 'error' | 'warning' = 'info', source: 'server' | 'browser' = 'browser') => {
    const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);
    
    const prefixedMessage = source === 'server' ? `[Server]: ${message}` : `[Browser]: ${message}`;
    
    const logEntry: LogEntry = { timestamp, type, source, message: prefixedMessage };
    
    setTimeout(() => {
      setLogs(prev => [...prev, logEntry]);
      currentRecordingLogsRef.current.push(logEntry);
    }, 0);
    
    console.log(`[${type.toUpperCase()}] ${prefixedMessage}`);
  };

  const startDurationTracking = () => {
    if (durationUpdateIntervalRef.current) {
      clearInterval(durationUpdateIntervalRef.current);
    }
    
    conversationStartTimeRef.current = Date.now();
    conversationDurationRef.current = 0;
    
    durationUpdateIntervalRef.current = setInterval(() => {
      if (conversationStartTimeRef.current) {
        conversationDurationRef.current = Math.floor((Date.now() - conversationStartTimeRef.current) / 1000);
      }
    }, 1000);
  };

  const stopDurationTracking = () => {
    if (durationUpdateIntervalRef.current) {
      clearInterval(durationUpdateIntervalRef.current);
      durationUpdateIntervalRef.current = null;
    }
    
    if (conversationStartTimeRef.current) {
      conversationDurationRef.current = Math.floor((Date.now() - conversationStartTimeRef.current) / 1000);
    }
  };

  const resetAllStates = () => {
    // Reset all UI states
    setIsConnecting(false);
    setIsListening(false);
    setIsConnected(false);
    setError(null);
    
    // Reset refs
    connectionAttemptInProgress.current = false;
    cleanupInProgress.current = false;
    audioChunksRef.current = [];
    nextSeqToPlayRef.current = 0;
    audioBufferMapRef.current = {};
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
    
    // Stop duration tracking and reset duration
    stopDurationTracking();
    conversationStartTimeRef.current = null;
    conversationDurationRef.current = 0;
    
    appendLog('All states reset - ready for new connection', 'info', 'browser');
  };

  const handleConnectionFailure = (errorMessage: string) => {
    appendLog(`Connection failed: ${errorMessage}`, 'error', 'browser');
    
    // Update current recording to error state if exists
    if (currentRecordingRef.current) {
      const recordingLogs = [...currentRecordingLogsRef.current];
      setRecordings(prev => prev.map(r => 
        r.id === currentRecordingRef.current?.id 
          ? { ...r, status: 'error', error: errorMessage, duration: conversationDurationRef.current, logs: recordingLogs }
          : r
      ));
      currentRecordingRef.current = null;
    }
    
    // Clean up all resources
    cleanupResources();
    
    // Reset all states
    resetAllStates();
  };

  const handleStart = async () => {
    if (isConnecting || isListening || connectionAttemptInProgress.current) {
      console.log('[INFO] Connection attempt blocked - already connecting or listening');
      return;
    }

    connectionAttemptInProgress.current = true;
    cleanupInProgress.current = false;
    setLogs([]);
    currentRecordingLogsRef.current = [];
    setError(null);
    setIsConnecting(true);
    setIsConnected(false);
    audioChunksRef.current = [];
    nextSeqToPlayRef.current = 0;
    audioBufferMapRef.current = {};
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
    
    startDurationTracking();
    
    appendLog('Starting new audio recording...', 'info', 'browser');
    
    try {
      const recordingId = crypto.randomUUID();
      streamIdRef.current = crypto.randomUUID();
      
      const newRecording: Recording = {
        id: recordingId,
        duration: 0,
        timestamp: new Date(),
        status: 'processing',
        logs: []
      };
      
      currentRecordingRef.current = newRecording;
      setRecordings(prev => [newRecording, ...prev.slice(0, 9)]);
      
      await initWebSocket();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'WebSocket connection failed';
      handleConnectionFailure(errorMessage);
    }
  };

  const handleStop = (duration: number) => {
    if (cleanupInProgress.current) {
      return;
    }
    
    appendLog(`Stopping recording after ${conversationDurationRef.current} seconds`, 'info', 'browser');
    
    stopDurationTracking();
    
    if (fullConversationRecorderRef.current && fullConversationRecorderRef.current.state !== "inactive") {
      fullConversationRecorderRef.current.stop();
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    
    if (currentRecordingRef.current) {
      const recordingId = currentRecordingRef.current.id;
      const finalDuration = conversationDurationRef.current;
      const recordingLogs = [...currentRecordingLogsRef.current];
      
      setTimeout(() => {
        if (audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          
          setRecordings(prev => prev.map(r => 
            r.id === recordingId 
              ? { ...r, duration: finalDuration, status: 'success', audioBlob, logs: recordingLogs }
              : r
          ));
        } else {
          setRecordings(prev => prev.map(r => 
            r.id === recordingId 
              ? { ...r, duration: finalDuration, status: 'success', logs: recordingLogs }
              : r
          ));
        }
      }, 100);
    }
    
    currentRecordingRef.current = null;
    stopListening();
  };

  const handleWebSocketError = (error: string) => {
    appendLog(`WebSocket error: ${error}`, 'error', 'browser');
    
    // Safely close WebSocket connection
    if (webSocketRef.current) {
      try {
        if (webSocketRef.current.readyState === WebSocket.OPEN || 
            webSocketRef.current.readyState === WebSocket.CONNECTING) {
          webSocketRef.current.close(1000, "Error occurred");
        }
      } catch (e) {
        appendLog('Error closing WebSocket connection after error', 'error', 'browser');
      }
      webSocketRef.current = null;
    }
    
    handleConnectionFailure(error);
  };

  const safelyCloseWebSocket = (reason: string = "Connection closed") => {
    if (webSocketRef.current) {
      try {
        const currentState = webSocketRef.current.readyState;
        appendLog(`Closing WebSocket connection. Current state: ${currentState}`, 'info', 'browser');
        
        if (currentState === WebSocket.OPEN || currentState === WebSocket.CONNECTING) {
          webSocketRef.current.close(1000, reason);
        }
      } catch (error) {
        appendLog(`Error during WebSocket close: ${error}`, 'error', 'browser');
      } finally {
        webSocketRef.current = null;
      }
    }
  };

  const initWebSocket = async () => {
    return new Promise<void>((resolve, reject) => {
      if (webSocketRef.current) {
        safelyCloseWebSocket("Reinitializing connection");
      }

      appendLog('Connecting to WebSocket...', 'info', 'browser');
      
      const wsUrlWithStreamId = `${WEBSOCKET_URL}?streamSid=${streamIdRef.current}&language=${selectedLanguage}`;
      
      try {
        const webSocket = new WebSocket(wsUrlWithStreamId);
        webSocketRef.current = webSocket;
      } catch (error) {
        const errorMessage = `Failed to create WebSocket: ${error}`;
        handleWebSocketError(errorMessage);
        reject(new Error(errorMessage));
        return;
      }

      const connectionTimeout = setTimeout(() => {
        if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.CONNECTING) {
          appendLog('WebSocket connection timeout', 'error', 'browser');
          safelyCloseWebSocket("Connection timeout");
          handleWebSocketError('WebSocket connection timeout');
          reject(new Error('WebSocket connection timeout'));
        }
      }, 10000);

      webSocketRef.current.onopen = () => {
        clearTimeout(connectionTimeout);
        appendLog('WebSocket connected. Requesting microphone access...', 'info', 'browser');
        setIsConnecting(false);
        setIsListening(true);
        setIsConnected(true);
        connectionAttemptInProgress.current = false;
        appendLog('✅ Connection established! Ready to speak - your voice will be sent to the server.', 'info', 'browser');
        initFullConversationRecording().then(resolve).catch((error) => {
          handleWebSocketError(`Failed to initialize audio recording: ${error.message}`);
          reject(error);
        });
      };

      webSocketRef.current.onclose = (event) => {
        clearTimeout(connectionTimeout);
        const reason = event.reason || 'No reason given';
        const wasClean = event.wasClean ? 'clean' : 'unclean';
        appendLog(`WebSocket closed: ${reason} (Code: ${event.code}, ${wasClean})`, 'warning', 'browser');
        
        webSocketRef.current = null;
        
        // If connection was not clean or unexpected, treat as error and reset all states
        if (!event.wasClean && event.code !== 1000) {
          handleConnectionFailure(`Connection lost unexpectedly: ${reason}`);
        } else {
          // Even for clean closes, reset states to ensure UI is consistent
          resetAllStates();
        }
      };

      webSocketRef.current.onerror = (error) => {
        clearTimeout(connectionTimeout);
        appendLog('WebSocket connection error occurred', 'error', 'browser');
        handleWebSocketError('WebSocket connection failed due to network error');
        reject(new Error('WebSocket connection failed'));
      };

      webSocketRef.current.onmessage = async (event) => {
        try {
          let message;
          try {
            message = JSON.parse(event.data);
          } catch (e) {
            appendLog(event.data, 'info', 'server');
            return;
          }

          console.log("[LOG] Message received from server:", message);

          if (message.type === 'log') {
            appendLog(message.message, 'info', 'server');
          } else if (message.type === 'playback' && message.play === false) {
            // Stop current playback immediately when server requests
            appendLog('Received playback stop command from server', 'info', 'server');
            if (currentPlaybackSourceRef.current) {
              currentPlaybackSourceRef.current.stop();
              currentPlaybackSourceRef.current = null;
            }
            isPlayingRef.current = false;
            playbackQueueRef.current = []; // Clear queue
          } else if (message.type === 'end_call' && message.play === false) {
            // Close WebSocket connection when end_call is received
            appendLog('Received end_call command from server - closing connection', 'info', 'server');
            safelyCloseWebSocket("Server requested end call");
            handleStop(conversationDurationRef.current);
          } else if (message.event === 'media' && message.media?.payload) {
            const seq = message.media.seq;
            appendLog(`Received audio chunk, seq=${seq}`, 'info', 'server');
            
            const base64 = message.media.payload;
            const audioBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            
            if (audioContextRef.current) {
              try {
                const audioBuffer = await audioContextRef.current.decodeAudioData(audioBytes.buffer);
                audioBufferMapRef.current[seq] = audioBuffer;
                tryPlayInOrder();
              } catch (error) {
                console.error('Error decoding audio:', error);
                appendLog('Error decoding audio from server', 'error', 'browser');
              }
            }
          } else {
            appendLog(`[Unhandled]: ${JSON.stringify(message)}`, 'warning', 'server');
          }
        } catch (error) {
          appendLog(`Error processing WebSocket message: ${error}`, 'error', 'browser');
          // Don't close connection for message processing errors, just log them
        }
      };
    });
  };

  const tryPlayInOrder = () => {
    while (audioBufferMapRef.current[nextSeqToPlayRef.current]) {
      enqueueAudioBuffer(audioBufferMapRef.current[nextSeqToPlayRef.current]);
      delete audioBufferMapRef.current[nextSeqToPlayRef.current];
      nextSeqToPlayRef.current++;
    }
  };

  const enqueueAudioBuffer = (audioBuffer: AudioBuffer) => {
    playbackQueueRef.current.push(audioBuffer);
    if (!isPlayingRef.current) {
      playNextFromQueue();
    }
  };

  const playNextFromQueue = async () => {
    if (playbackQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      currentPlaybackSourceRef.current = null;
      return;
    }

    const buffer = playbackQueueRef.current.shift();
    if (!buffer || !audioContextRef.current || !mixerNodeRef.current) return;

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    currentPlaybackSourceRef.current = source;
    
    source.connect(mixerNodeRef.current);
    source.connect(audioContextRef.current.destination);

    isPlayingRef.current = true;
    appendLog('Starting TTS playback - microphone continues listening', 'info', 'browser');

    source.onended = () => {
      appendLog('TTS playback ended', 'info', 'browser');
      currentPlaybackSourceRef.current = null;
      isPlayingRef.current = false;
      playNextFromQueue();
    };

    source.start(0);
  };

  const initFullConversationRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      appendLog('Microphone access granted. Setting up full conversation recording...', 'info', 'browser');

      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      mixerNodeRef.current = audioContextRef.current.createGain();
      
      destinationStreamRef.current = audioContextRef.current.createMediaStreamDestination();
      mixerNodeRef.current.connect(destinationStreamRef.current);
      
      micSourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
      micSourceRef.current.connect(mixerNodeRef.current);
      
      fullConversationRecorderRef.current = new MediaRecorder(destinationStreamRef.current.stream);
      
      fullConversationRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          appendLog(`Full conversation chunk recorded: ${event.data.size} bytes`, 'info', 'browser');
        }
      };

      fullConversationRecorderRef.current.onstart = () => {
        appendLog('Full conversation recording started', 'info', 'browser');
      };

      fullConversationRecorderRef.current.onstop = () => {
        appendLog('Full conversation recording stopped', 'info', 'browser');
      };

      fullConversationRecorderRef.current.onerror = (event) => {
        const errorMessage = `Full conversation recorder error: ${(event as any).error.name}`;
        appendLog(errorMessage, 'error', 'browser');
        handleWebSocketError(errorMessage);
      };

      fullConversationRecorderRef.current.start(CHUNK_DURATION_MS);
      
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
            try {
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64Audio = (reader.result as string).split(',')[1];
                const message = {
                  start: {
                    streamSid: streamIdRef.current
                  },
                  media: {
                    payload: base64Audio
                  }
                };
                
                if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
                  webSocketRef.current.send(JSON.stringify(message));
                  appendLog('Audio chunk sent to server using websocket', 'info', 'browser');
                } else {
                  appendLog('WebSocket not ready, skipping audio chunk', 'warning', 'browser');
                }
              };
              reader.onerror = () => {
                appendLog('Error reading audio data for WebSocket transmission', 'error', 'browser');
              };
              reader.readAsDataURL(event.data);
            } catch (error) {
              appendLog(`Error processing audio data: ${error}`, 'error', 'browser');
            }
          } else {
            appendLog('WebSocket connection lost, cannot send audio chunk', 'warning', 'browser');
          }
        }
      };

      mediaRecorder.onstart = () => {
        appendLog('WebSocket streaming started', 'info', 'browser');
      };

      mediaRecorder.onstop = () => {
        appendLog('WebSocket streaming stopped', 'info', 'browser');
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.onerror = (event) => {
        const errorMessage = `WebSocket streaming error: ${(event as any).error.name}`;
        appendLog(errorMessage, 'error', 'browser');
        handleWebSocketError(errorMessage);
      };

      mediaRecorder.start(CHUNK_DURATION_MS);
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Microphone access denied';
      appendLog(`Error accessing microphone: ${errorMessage}`, 'error', 'browser');
      throw err;
    }
  };

  const cleanupResources = () => {
    if (cleanupInProgress.current) {
      return;
    }
    
    cleanupInProgress.current = true;
    appendLog('Cleaning up audio resources...', 'info', 'browser');
    
    stopDurationTracking();
    
    // Stop current playback
    if (currentPlaybackSourceRef.current) {
      try {
        currentPlaybackSourceRef.current.stop();
      } catch (error) {
        appendLog(`Error stopping audio playback: ${error}`, 'warning', 'browser');
      }
      currentPlaybackSourceRef.current = null;
    }
    
    if (fullConversationRecorderRef.current && fullConversationRecorderRef.current.state !== "inactive") {
      try {
        fullConversationRecorderRef.current.stop();
      } catch (error) {
        appendLog(`Error stopping full conversation recorder: ${error}`, 'warning', 'browser');
      }
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch (error) {
        appendLog(`Error stopping media recorder: ${error}`, 'warning', 'browser');
      }
    }

    if (micSourceRef.current) {
      try {
        micSourceRef.current.disconnect();
      } catch (error) {
        appendLog(`Error disconnecting mic source: ${error}`, 'warning', 'browser');
      }
      micSourceRef.current = null;
    }
    
    if (mixerNodeRef.current) {
      try {
        mixerNodeRef.current.disconnect();
      } catch (error) {
        appendLog(`Error disconnecting mixer node: ${error}`, 'warning', 'browser');
      }
      mixerNodeRef.current = null;
    }
    
    if (destinationStreamRef.current) {
      try {
        destinationStreamRef.current.disconnect();
      } catch (error) {
        appendLog(`Error disconnecting destination stream: ${error}`, 'warning', 'browser');
      }
      destinationStreamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close();
      } catch (error) {
        appendLog(`Error closing audio context: ${error}`, 'warning', 'browser');
      }
    }

    // Safely close WebSocket connection
    safelyCloseWebSocket("Client initiated cleanup");

    fullConversationRecorderRef.current = null;
    mediaRecorderRef.current = null;
    audioContextRef.current = null;
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
  };

  const stopListening = () => {
    cleanupResources();
    resetAllStates();
  };

  const clearAllRecordings = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    setPlayingRecording(null);
    setRecordings([]);
    setLogs([]);
    setError(null);
  };

  const deleteRecording = (recordingId: string) => {
    // Stop playing if this recording is currently playing
    if (playingRecording === recordingId) {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      setPlayingRecording(null);
    }
    
    // Remove the recording from the list
    setRecordings(prev => prev.filter(r => r.id !== recordingId));
    appendLog(`Recording ${recordingId.slice(0, 8)} deleted`, 'info', 'browser');
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const downloadRecordingHistory = () => {
    const csvContent = "data:text/csv;charset=utf-8," 
      + "Recording Number,Duration,Status,Timestamp,Error\n"
      + recordings.map((recording, index) => 
          `${recordings.length - index},${formatDuration(recording.duration)},${recording.status},${recording.timestamp.toLocaleString()},${recording.error || ''}`
        ).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "recording_history.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadIndividualRecording = (recording: Recording) => {
    if (recording.audioBlob) {
      const url = URL.createObjectURL(recording.audioBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `full_conversation_${recording.id.slice(0, 8)}.webm`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else {
      const csvContent = "data:text/csv;charset=utf-8," 
        + "Property,Value\n"
        + `ID,${recording.id}\n`
        + `Duration,${formatDuration(recording.duration)}\n`
        + `Status,${recording.status}\n`
        + `Timestamp,${recording.timestamp.toLocaleString()}\n`
        + `Error,${recording.error || 'None'}`;
      
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `recording_${recording.id.slice(0, 8)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const downloadLogs = (recording: Recording) => {
    if (!recording.logs || recording.logs.length === 0) {
      return;
    }

    const logsText = recording.logs
      .map(log => `[${log.timestamp}] [${log.type.toUpperCase()}] ${log.message}`)
      .join('\n');
    
    const blob = new Blob([logsText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `logs_${recording.id.slice(0, 8)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const playRecording = (recording: Recording) => {
    if (!recording.audioBlob) return;

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
    }

    if (playingRecording === recording.id) {
      setPlayingRecording(null);
      currentAudioRef.current = null;
      return;
    }

    const audio = new Audio(URL.createObjectURL(recording.audioBlob));
    currentAudioRef.current = audio;
    setPlayingRecording(recording.id);

    audio.onended = () => {
      setPlayingRecording(null);
      currentAudioRef.current = null;
    };

    audio.onerror = () => {
      setPlayingRecording(null);
      currentAudioRef.current = null;
    };

    audio.play();
  };

  const getStatusIcon = (status: Recording['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'processing':
        return <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />;
      default:
        return null;
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const getLogItemStyle = (log: LogEntry) => {
    if (log.source === 'server') {
      return log.type === 'error' ? 'border-red-500 bg-red-50 text-red-700' :
             log.type === 'warning' ? 'border-yellow-500 bg-yellow-50 text-yellow-700' :
             'border-blue-500 bg-blue-50 text-blue-700';
    } else {
      return log.type === 'error' ? 'border-red-500 bg-red-50 text-red-700' :
             log.type === 'warning' ? 'border-orange-500 bg-orange-50 text-orange-700' :
             'border-yellow-500 bg-yellow-50 text-yellow-700';
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Left Side */}
      <div className="space-y-8">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card className="border-2">
          <CardHeader>
            <CardTitle>Cold Call Audio Streaming Solution</CardTitle>
            <CardDescription>
              {isConnecting 
                ? "Connecting to server..." 
                : isConnected && isListening 
                  ? `✅ Connected! Ready to speak in ${selectedLanguage}. Recording full conversation...` 
                  : "Click the microphone button to start/stop recording full conversation"
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col space-y-2">
              <label className="text-sm font-medium">Language</label>
              <Select value={selectedLanguage} onValueChange={setSelectedLanguage} disabled={isListening || isConnecting}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="English">English</SelectItem>
                  <SelectItem value="Hindi">Hindi</SelectItem>
                  <SelectItem value="Spanish">Spanish</SelectItem>
                  <SelectItem value="French">French</SelectItem>
                  <SelectItem value="German">German</SelectItem>
                  <SelectItem value="Urdu">Urdu</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <AIVoiceInput 
              onStart={handleStart}
              onStop={handleStop}
              actualDuration={conversationDurationRef.current}
              isRecording={isListening || isConnecting}
            />
          </CardContent>
        </Card>

        {recordings.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Full Conversation History</CardTitle>
                <CardDescription>
                  Your recent full conversation recordings (last 10) - includes both voice and TTS playback
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={clearAllRecordings}
                  className="flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear All
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={downloadRecordingHistory}
                  className="flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download All
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {recordings.map((recording, index) => (
                  <div key={recording.id} className={`flex items-center justify-between p-3 border rounded-lg ${
                    recording.status === 'error' ? 'border-red-200 bg-red-50' : 
                    recording.status === 'success' ? 'border-green-200 bg-green-50' :
                    'border-yellow-200 bg-yellow-50'
                  }`}>
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary">#{recordings.length - index}</Badge>
                      <span className="font-medium">Full Conversation</span>
                      {getStatusIcon(recording.status)}
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-sm text-muted-foreground">
                        <span>Duration: {formatDuration(recording.duration)}</span>
                        <span className="ml-4">{recording.timestamp.toLocaleTimeString()}</span>
                        {recording.error && (
                          <div className="text-red-500 text-xs mt-1">
                            Error: {recording.error}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {recording.audioBlob && recording.status === 'success' && (
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => playRecording(recording)}
                            className="flex items-center gap-1"
                          >
                            {playingRecording === recording.id ? (
                              <Pause className="w-3 h-3" />
                            ) : (
                              <Play className="w-3 h-3" />
                            )}
                          </Button>
                        )}
                        {recording.logs && recording.logs.length > 0 && (
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="flex items-center gap-1"
                              >
                                <FileText className="w-3 h-3" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-4xl max-h-[80vh]">
                              <DialogHeader>
                                <DialogTitle>Recording Logs</DialogTitle>
                                <DialogDescription>
                                  Logs for recording #{recordings.length - index} - {recording.timestamp.toLocaleString()}
                                </DialogDescription>
                              </DialogHeader>
                              <div className="flex justify-between items-center mb-4">
                                <span className="text-sm text-muted-foreground">
                                  {recording.logs.length} log entries
                                </span>
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  onClick={() => downloadLogs(recording)}
                                  className="flex items-center gap-2"
                                >
                                  <Download className="w-4 h-4" />
                                  Download Logs
                                </Button>
                              </div>
                              <div className="space-y-1 max-h-96 overflow-y-auto font-mono text-sm border rounded-lg p-4">
                                {recording.logs.map((log, logIndex) => (
                                  <div key={logIndex} className={`p-2 rounded text-xs border-l-2 ${getLogItemStyle(log)}`}>
                                    <span className="text-gray-500">[{log.timestamp}]</span> {log.message}
                                  </div>
                                ))}
                              </div>
                            </DialogContent>
                          </Dialog>
                        )}
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => downloadIndividualRecording(recording)}
                          className="flex items-center gap-1"
                        >
                          <Download className="w-3 h-3" />
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => deleteRecording(recording.id)}
                          className="flex items-center gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right Side - Live Logs */}
      <div className="space-y-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Live Logs</CardTitle>
              <CardDescription>Real-time system logs (Blue: Server, Yellow: Browser)</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={clearLogs}>
              Clear Logs
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-96 overflow-y-auto font-mono text-sm">
              {logs.length === 0 ? (
                <div className="text-muted-foreground italic">
                  {isListening || isConnecting ? "Waiting for logs..." : "Click 'Click to speak' to see logs..."}
                </div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className={`p-2 rounded text-xs border-l-2 ${getLogItemStyle(log)}`}>
                    <span className="text-gray-500">[{log.timestamp}]</span> {log.message}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
