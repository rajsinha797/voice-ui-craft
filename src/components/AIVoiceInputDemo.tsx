
import { AIVoiceInput } from "@/components/ui/ai-voice-input";
import { useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, AlertCircle, CheckCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Recording {
  id: string;
  duration: number;
  timestamp: Date;
  status: 'success' | 'error' | 'processing';
  audioData?: Blob;
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
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  
  // WebSocket and audio refs
  const webSocketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamIdRef = useRef<string>('');
  const currentRecordingRef = useRef<Recording | null>(null);

  const WEBSOCKET_URL = 'ws://localhost:6543/voice/ws/browser/stream';
  const CHUNK_DURATION_MS = 1000;

  const appendLog = (message: string, type: 'info' | 'error' | 'warning' = 'info') => {
    const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);
    setLogs(prev => [...prev, { timestamp, type, message }]);
    console.log(`[${type.toUpperCase()}] ${message}`);
  };

  const handleStart = async () => {
    appendLog('Starting audio recording...');
    setError(null);
    setConnectionStatus('connecting');
    
    try {
      // Generate new recording ID
      const recordingId = crypto.randomUUID();
      streamIdRef.current = crypto.randomUUID();
      
      // Create new recording entry
      const newRecording: Recording = {
        id: recordingId,
        duration: 0,
        timestamp: new Date(),
        status: 'processing'
      };
      
      currentRecordingRef.current = newRecording;
      setRecordings(prev => [newRecording, ...prev.slice(0, 4)]);
      
      await initWebSocket();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      appendLog(`Failed to start recording: ${errorMessage}`, 'error');
      setError(errorMessage);
      setConnectionStatus('error');
      
      if (currentRecordingRef.current) {
        setRecordings(prev => prev.map(r => 
          r.id === currentRecordingRef.current?.id 
            ? { ...r, status: 'error', error: errorMessage }
            : r
        ));
      }
    }
  };

  const handleStop = (duration: number) => {
    appendLog(`Stopping recording after ${duration} seconds`);
    stopListening();
    
    if (currentRecordingRef.current) {
      setRecordings(prev => prev.map(r => 
        r.id === currentRecordingRef.current?.id 
          ? { ...r, duration, status: 'success' }
          : r
      ));
      currentRecordingRef.current = null;
    }
  };

  const initWebSocket = async () => {
    return new Promise<void>((resolve, reject) => {
      appendLog('Connecting to WebSocket...');
      
      const wsUrlWithStreamId = `${WEBSOCKET_URL}?streamSid=${streamIdRef.current}&language=${selectedLanguage}`;
      const webSocket = new WebSocket(wsUrlWithStreamId);
      webSocketRef.current = webSocket;

      webSocket.onopen = () => {
        appendLog('WebSocket connected. Requesting microphone access...');
        setConnectionStatus('connected');
        initAudioCapture().then(resolve).catch(reject);
      };

      webSocket.onclose = (event) => {
        appendLog(`WebSocket closed: ${event.reason || 'No reason given'} (Code: ${event.code})`, 'warning');
        setConnectionStatus('idle');
      };

      webSocket.onerror = (error) => {
        appendLog('WebSocket connection failed', 'error');
        setConnectionStatus('error');
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

        if (message.type === 'log') {
          appendLog(`[Server]: ${message.message}`);
        } else if (message.event === 'media' && message.media?.payload) {
          const seq = message.media.seq;
          appendLog(`Received audio chunk, seq=${seq}`);
        }
      };
    });
  };

  const initAudioCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      appendLog('Microphone access granted. Starting stream...');

      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
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
            appendLog('Audio chunk sent to server');
          };
          reader.readAsDataURL(event.data);
        }
      };

      mediaRecorder.onstart = () => {
        appendLog('MediaRecorder started, streaming audio...');
      };

      mediaRecorder.onstop = () => {
        appendLog('MediaRecorder stopped');
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.onerror = (event) => {
        appendLog(`MediaRecorder error: ${(event as any).error.name}`, 'error');
        stopListening();
      };

      mediaRecorder.start(CHUNK_DURATION_MS);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Microphone access denied';
      appendLog(`Error accessing microphone: ${errorMessage}`, 'error');
      throw err;
    }
  };

  const stopListening = () => {
    appendLog('Cleaning up audio resources...');
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }

    if (webSocketRef.current && (webSocketRef.current.readyState === WebSocket.OPEN || webSocketRef.current.readyState === WebSocket.CONNECTING)) {
      webSocketRef.current.close(1000, "Client initiated stop");
    }

    setConnectionStatus('idle');
    mediaRecorderRef.current = null;
    audioContextRef.current = null;
    webSocketRef.current = null;
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
            <CardTitle>Interactive Voice Input</CardTitle>
            <CardDescription>
              Click the microphone button to start/stop recording
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col space-y-2">
              <label className="text-sm font-medium">Language</label>
              <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
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
            
            <div className="flex flex-col space-y-2">
              <label className="text-sm font-medium">Connection Status</label>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${
                  connectionStatus === 'connected' ? 'bg-green-500' :
                  connectionStatus === 'connecting' ? 'bg-yellow-500' :
                  connectionStatus === 'error' ? 'bg-red-500' : 'bg-gray-400'
                }`} />
                <span className="text-sm capitalize">{connectionStatus}</span>
              </div>
            </div>

            <AIVoiceInput 
              onStart={handleStart}
              onStop={handleStop}
            />
          </CardContent>
        </Card>

        {recordings.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recording History</CardTitle>
                <CardDescription>
                  Your recent voice recordings
                </CardDescription>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={downloadRecordingHistory}
                className="flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download All
              </Button>
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
                      <span className="font-medium">Recording</span>
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
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right Side */}
      <div className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Demo Mode</CardTitle>
            <CardDescription>
              Automatic demonstration of the component functionality
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AIVoiceInput 
              demoMode={true}
              demoInterval={2500}
              onStart={() => appendLog('Demo recording started')}
              onStop={(duration) => appendLog(`Demo recording stopped: ${duration}s`)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Live Logs</CardTitle>
              <CardDescription>Real-time system logs</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={clearLogs}>
              Clear Logs
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-96 overflow-y-auto font-mono text-sm">
              {logs.length === 0 ? (
                <div className="text-muted-foreground italic">No logs yet...</div>
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

        <Card>
          <CardHeader>
            <CardTitle>Component Features</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div className="space-y-2">
                <h4 className="font-medium">Visual Features</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Animated audio visualizer bars</li>
                  <li>• Real-time recording timer</li>
                  <li>• Smooth hover and transition effects</li>
                  <li>• Dark mode support</li>
                  <li>• Connection status indicator</li>
                </ul>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium">Functional Features</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• WebSocket audio streaming</li>
                  <li>• Multi-language support</li>
                  <li>• Individual recording download</li>
                  <li>• Real-time error handling</li>
                  <li>• Recording status tracking</li>
                  <li>• Live system logs</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
