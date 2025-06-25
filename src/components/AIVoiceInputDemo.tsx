import { AIVoiceInput } from "@/components/ui/ai-voice-input";
import { useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, AlertCircle, CheckCircle, Trash2, Play, Pause } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Recording {
  id: string;
  duration: number;
  timestamp: Date;
  status: 'success' | 'error' | 'processing';
  audioBlob?: Blob;
  error?: string;
}

interface LogEntry {
  timestamp: string;
  type: 'info' | 'error' | 'warning';
  message: string;
}

export function AIVoiceInputDemo() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState("English");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
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

  const WEBSOCKET_URL = 'ws://localhost:6543/voice/ws/browser/stream';
  const CHUNK_DURATION_MS = 1000;

  // Fixed appendLog function - removed restrictive guard clause
  const appendLog = (message: string, type: 'info' | 'error' | 'warning' = 'info') => {
    const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);
    
    // Use async state update to prevent blocking
    setTimeout(() => {
      setLogs(prev => [...prev, { timestamp, type, message }]);
    }, 0);
    
    console.log(`[${type.toUpperCase()}] ${message}`);
  };

  // Start continuous duration update
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

  // Stop duration tracking
  const stopDurationTracking = () => {
    if (durationUpdateIntervalRef.current) {
      clearInterval(durationUpdateIntervalRef.current);
      durationUpdateIntervalRef.current = null;
    }
    
    if (conversationStartTimeRef.current) {
      conversationDurationRef.current = Math.floor((Date.now() - conversationStartTimeRef.current) / 1000);
    }
  };

  const handleStart = async () => {
    if (isConnecting || isListening || connectionAttemptInProgress.current) {
      console.log('[INFO] Connection attempt blocked - already connecting or listening');
      return;
    }

    // Reset all state for new recording
    connectionAttemptInProgress.current = true;
    cleanupInProgress.current = false;
    setLogs([]); // Clear logs for new recording
    setError(null);
    setIsConnecting(true);
    audioChunksRef.current = [];
    nextSeqToPlayRef.current = 0;
    audioBufferMapRef.current = {};
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
    
    // Start duration tracking
    startDurationTracking();
    
    appendLog('Starting new audio recording...');
    
    try {
      const recordingId = crypto.randomUUID();
      streamIdRef.current = crypto.randomUUID();
      
      const newRecording: Recording = {
        id: recordingId,
        duration: 0,
        timestamp: new Date(),
        status: 'processing'
      };
      
      currentRecordingRef.current = newRecording;
      setRecordings(prev => [newRecording, ...prev.slice(0, 9)]);
      
      await initWebSocket();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'WebSocket connection failed';
      appendLog(`Failed to start recording: ${errorMessage}`, 'error');
      setError(errorMessage);
      handleConnectionFailure(errorMessage);
    }
  };

  const handleConnectionFailure = (errorMessage: string) => {
    setIsConnecting(false);
    setIsListening(false);
    connectionAttemptInProgress.current = false;
    
    // Stop duration tracking and get final duration
    stopDurationTracking();
    
    if (currentRecordingRef.current) {
      setRecordings(prev => prev.map(r => 
        r.id === currentRecordingRef.current?.id 
          ? { ...r, status: 'error', error: errorMessage, duration: conversationDurationRef.current }
          : r
      ));
      currentRecordingRef.current = null;
    }
    
    cleanupResources();
  };

  const handleStop = (duration: number) => {
    // Prevent multiple stop calls
    if (cleanupInProgress.current) {
      return;
    }
    
    appendLog(`Stopping recording after ${conversationDurationRef.current} seconds`);
    
    // Stop duration tracking
    stopDurationTracking();
    
    setIsConnecting(false);
    setIsListening(false);
    connectionAttemptInProgress.current = false;
    
    // Stop full conversation recorder first
    if (fullConversationRecorderRef.current && fullConversationRecorderRef.current.state !== "inactive") {
      fullConversationRecorderRef.current.stop();
    }
    
    // Stop MediaRecorder for WebSocket streaming
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    
    // Update recording status when full conversation recording completes
    if (currentRecordingRef.current) {
      const recordingId = currentRecordingRef.current.id;
      const finalDuration = conversationDurationRef.current;
      
      setTimeout(() => {
        if (audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          
          setRecordings(prev => prev.map(r => 
            r.id === recordingId 
              ? { ...r, duration: finalDuration, status: 'success', audioBlob }
              : r
          ));
        } else {
          setRecordings(prev => prev.map(r => 
            r.id === recordingId 
              ? { ...r, duration: finalDuration, status: 'success' }
              : r
          ));
        }
      }, 100);
    }
    
    currentRecordingRef.current = null;
    stopListening();
  };

  const initWebSocket = async () => {
    return new Promise<void>((resolve, reject) => {
      if (webSocketRef.current) {
        webSocketRef.current.close();
        webSocketRef.current = null;
      }

      appendLog('Connecting to WebSocket...');
      
      const wsUrlWithStreamId = `${WEBSOCKET_URL}?streamSid=${streamIdRef.current}&language=${selectedLanguage}`;
      const webSocket = new WebSocket(wsUrlWithStreamId);
      webSocketRef.current = webSocket;

      const connectionTimeout = setTimeout(() => {
        if (webSocket.readyState === WebSocket.CONNECTING) {
          webSocket.close();
          reject(new Error('WebSocket connection timeout'));
        }
      }, 10000);

      webSocket.onopen = () => {
        clearTimeout(connectionTimeout);
        appendLog('WebSocket connected. Requesting microphone access...');
        setIsConnecting(false);
        setIsListening(true);
        connectionAttemptInProgress.current = false;
        initFullConversationRecording().then(resolve).catch(reject);
      };

      webSocket.onclose = (event) => {
        clearTimeout(connectionTimeout);
        appendLog(`WebSocket closed: ${event.reason || 'No reason given'} (Code: ${event.code})`, 'warning');
        setIsConnecting(false);
        setIsListening(false);
        connectionAttemptInProgress.current = false;
        webSocketRef.current = null;
      };

      webSocket.onerror = (error) => {
        clearTimeout(connectionTimeout);
        appendLog('WebSocket connection failed', 'error');
        setIsConnecting(false);
        setIsListening(false);
        connectionAttemptInProgress.current = false;
        webSocketRef.current = null;
        reject(new Error('WebSocket connection failed'));
      };

      webSocket.onmessage = async (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (e) {
          appendLog(`[Server]: ${event.data}`);
          return;
        }

        console.log("[LOG] Message received from server:", message);

        if (message.type === 'log') {
          appendLog(`[Server]: ${message.message}`);
        } else if (message.event === 'media' && message.media?.payload) {
          const seq = message.media.seq;
          appendLog(`Received audio chunk, seq=${seq}`);
          
          const base64 = message.media.payload;
          const audioBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
          
          if (audioContextRef.current) {
            try {
              const audioBuffer = await audioContextRef.current.decodeAudioData(audioBytes.buffer);
              audioBufferMapRef.current[seq] = audioBuffer;
              tryPlayInOrder();
            } catch (error) {
              console.error('Error decoding audio:', error);
              appendLog('Error decoding audio from server', 'error');
            }
          }
        } else {
          appendLog(`[Unhandled]: ${JSON.stringify(message)}`, 'warning');
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
      return;
    }

    const buffer = playbackQueueRef.current.shift();
    if (!buffer || !audioContextRef.current || !mixerNodeRef.current) return;

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    
    source.connect(mixerNodeRef.current);
    source.connect(audioContextRef.current.destination);

    isPlayingRef.current = true;
    appendLog('Starting TTS playback - recording continues');

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      appendLog('Mic paused during TTS playback');
    }

    source.onended = () => {
      appendLog('TTS playback ended');
      
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
        mediaRecorderRef.current.resume();
        appendLog('Mic resumed after TTS');
      }
      
      isPlayingRef.current = false;
      playNextFromQueue();
    };

    source.start(0);
  };

  const initFullConversationRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      appendLog('Microphone access granted. Setting up full conversation recording...');

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
          appendLog(`Full conversation chunk recorded: ${event.data.size} bytes`);
        }
      };

      fullConversationRecorderRef.current.onstart = () => {
        appendLog('Full conversation recording started');
      };

      fullConversationRecorderRef.current.onstop = () => {
        appendLog('Full conversation recording stopped');
      };

      fullConversationRecorderRef.current.onerror = (event) => {
        appendLog(`Full conversation recorder error: ${(event as any).error.name}`, 'error');
      };

      fullConversationRecorderRef.current.start(CHUNK_DURATION_MS);
      
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
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
              webSocketRef.current?.send(JSON.stringify(message));
              appendLog('Audio chunk sent to server using websocket');
            };
            reader.readAsDataURL(event.data);
          }
        }
      };

      mediaRecorder.onstart = () => {
        appendLog('WebSocket streaming started');
      };

      mediaRecorder.onstop = () => {
        appendLog('WebSocket streaming stopped');
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.onerror = (event) => {
        appendLog(`WebSocket streaming error: ${(event as any).error.name}`, 'error');
        handleConnectionFailure(`MediaRecorder error: ${(event as any).error.name}`);
      };

      mediaRecorder.start(CHUNK_DURATION_MS);
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Microphone access denied';
      appendLog(`Error accessing microphone: ${errorMessage}`, 'error');
      throw err;
    }
  };

  const cleanupResources = () => {
    if (cleanupInProgress.current) {
      return;
    }
    
    cleanupInProgress.current = true;
    appendLog('Cleaning up audio resources...');
    
    // Stop duration tracking
    stopDurationTracking();
    
    if (fullConversationRecorderRef.current && fullConversationRecorderRef.current.state !== "inactive") {
      fullConversationRecorderRef.current.stop();
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }

    if (micSourceRef.current) {
      micSourceRef.current.disconnect();
      micSourceRef.current = null;
    }
    
    if (mixerNodeRef.current) {
      mixerNodeRef.current.disconnect();
      mixerNodeRef.current = null;
    }
    
    if (destinationStreamRef.current) {
      destinationStreamRef.current.disconnect();
      destinationStreamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }

    if (webSocketRef.current && (webSocketRef.current.readyState === WebSocket.OPEN || webSocketRef.current.readyState === WebSocket.CONNECTING)) {
      webSocketRef.current.close(1000, "Client initiated stop");
    }

    fullConversationRecorderRef.current = null;
    mediaRecorderRef.current = null;
    audioContextRef.current = null;
    webSocketRef.current = null;
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
  };

  const stopListening = () => {
    cleanupResources();
    setIsConnecting(false);
    setIsListening(false);
    connectionAttemptInProgress.current = false;
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
                ? "Connecting..." 
                : isListening 
                  ? `Recording full conversation in ${selectedLanguage}...` 
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
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => downloadIndividualRecording(recording)}
                          className="flex items-center gap-1"
                        >
                          <Download className="w-3 h-3" />
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
              <CardDescription>Real-time system logs (both browser and server logs)</CardDescription>
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
                logs.slice(-50).map((log, index) => (
                  <div key={index} className={`p-2 rounded text-xs border-l-2 ${
                    log.type === 'error' ? 'border-red-500 bg-red-50 text-red-700' :
                    log.type === 'warning' ? 'border-yellow-500 bg-yellow-50 text-yellow-700' :
                    'border-blue-500 bg-blue-50 text-blue-700'
                  }`}>
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
