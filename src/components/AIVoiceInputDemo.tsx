import { useState, useRef, useEffect } from 'react';
import { AIVoiceInput } from '@/components/ui/ai-voice-input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Mic, MicOff, Volume2 } from 'lucide-react';

// Extend Window interface to include webkitAudioContext
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const AIVoiceInputDemo = () => {
  const [isListening, setIsListening] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('en-US');
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamIdRef = useRef<string>('');
  const playbackQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const nextSeqToPlayRef = useRef(0);
  const audioBufferMapRef = useRef<{[key: number]: AudioBuffer}>({});
  
  const WEBSOCKET_URL = 'ws://localhost:6543/voice/ws/browser/stream';
  const CHUNK_DURATION_MS = 1000;

  const addLog = (message: string) => {
    const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);
    const logMessage = `${timestamp} - ${message}`;
    setLogs(prev => [...prev, logMessage]);
  };

  const handleStart = () => {
    setIsListening(true);
    setLogs([]);
    startListening();
  };

  const handleStop = () => {
    setIsListening(false);
    stopListening();
  };

  const startListening = async () => {
    try {
      // Close existing WebSocket if still open
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        wsRef.current.close(1000, "Restarting WebSocket connection");
        addLog("[Browser] Previous WebSocket connection closed");
      }

      // Create new AudioContext with proper fallback
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioContextRef.current = new AudioContextClass();
      } else {
        throw new Error('AudioContext not supported in this browser');
      }
      
      // Generate random stream ID
      streamIdRef.current = crypto.randomUUID();
      nextSeqToPlayRef.current = 0;
      audioBufferMapRef.current = {};

      const wsUrlWithStreamId = `${WEBSOCKET_URL}?streamSid=${streamIdRef.current}&language=${selectedLanguage}`;
      wsRef.current = new WebSocket(wsUrlWithStreamId);

      wsRef.current.onopen = () => {
        addLog("[Browser] WebSocket connection established");
        initAudioCapture();
      };

      wsRef.current.onclose = (event) => {
        addLog(`[Browser] WebSocket connection closed: ${event.reason || 'No reason given'} (Code: ${event.code})`);
        console.log(`[LOG] WebSocket connection closed: ${event.reason}, code: ${event.code}`);
      };

      wsRef.current.onerror = (error) => {
        addLog("[Browser] WebSocket error occurred");
        console.error("[LOG] WebSocket error:", error);
      };

      wsRef.current.onmessage = async (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (e) {
          // Handle raw log strings from server
          addLog(`[Server] ${event.data}`);
          console.log("[LOG] Non-JSON message received from server:", event.data);
          return;
        }

        console.log("[LOG] Message received from server:", message);

        if (message.type === 'log') {
          addLog(`[Server] ${message.message}`);
          console.log("[LOG] Log message from server:", message);
        } else if (message.event === 'media' && message.media?.payload) {
          const seq = message.media.seq;
          addLog(`[Browser] Received audio chunk, seq=${seq}`);

          const base64 = message.media.payload;
          const audioBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
          const audioBuffer = await decodeAudioDataSafe(audioBytes.buffer);
          if (audioBuffer) {
            audioBufferMapRef.current[seq] = audioBuffer;
            tryPlayInOrder();
          }
        } else {
          addLog(`[Browser] Unhandled message: ${JSON.stringify(message)}`);
        }
      };

    } catch (error) {
      addLog(`[Browser] Error starting listening: ${error}`);
      console.error("[LOG] Error starting listening:", error);
    }
  };

  const initAudioCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      addLog("[Browser] Microphone access granted, starting stream");

      mediaRecorderRef.current = new MediaRecorder(stream);

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0 && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
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
            wsRef.current?.send(JSON.stringify(message));
            addLog(`[Browser] Audio sent to server via WebSocket`);
            console.log(`[LOG] Sent audio chunk, size: ${event.data.size} bytes, streamId: ${streamIdRef.current}`);
          };
          reader.readAsDataURL(event.data);
        }
      };

      mediaRecorderRef.current.onstart = () => {
        addLog("[Browser] MediaRecorder started, streaming audio");
        console.log("[LOG] MediaRecorder started, streaming audio...");
      };

      mediaRecorderRef.current.onstop = () => {
        addLog("[Browser] MediaRecorder stopped");
        console.log("[LOG] MediaRecorder stopped.");
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current.onerror = (event) => {
        addLog(`[Browser] MediaRecorder error: ${(event as any).error.name}`);
        console.error("[LOG] MediaRecorder error:", (event as any).error);
      };

      mediaRecorderRef.current.start(CHUNK_DURATION_MS);
    } catch (err) {
      addLog(`[Browser] Error accessing microphone: ${err}`);
      console.error('[LOG] Error accessing microphone or setting up audio:', err);
    }
  };

  const decodeAudioDataSafe = async (arrayBuffer: ArrayBuffer): Promise<AudioBuffer | null> => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      console.warn("AudioContext is not available or closed.");
      return null;
    }

    try {
      return await audioContextRef.current.decodeAudioData(arrayBuffer);
    } catch (e) {
      console.error("decodeAudioData error:", e);
      return null;
    }
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

    const buffer = playbackQueueRef.current.shift()!;
    const source = audioContextRef.current!.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current!.destination);

    isPlayingRef.current = true;

    // Pause MediaRecorder during playback
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      console.log('📡 Mic paused during TTS playback');
    }

    source.onended = () => {
      console.log('✅ TTS playback ended');

      // Resume mic after playback
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
        mediaRecorderRef.current.resume();
        console.log('🎙️ Mic resumed after TTS');
      }

      isPlayingRef.current = false;
      playNextFromQueue();
    };

    source.start(0);
  };

  const stopListening = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      addLog("[Browser] MediaRecorder stopping");
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().then(() => {
        addLog("[Browser] AudioContext closed");
        console.log("[LOG] AudioContext closed.");
        audioContextRef.current = null;
      });
    } else {
      audioContextRef.current = null;
    }

    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      wsRef.current.close(1000, "Client initiated stop");
      addLog("[Browser] WebSocket connection closing");
      console.log("[LOG] WebSocket connection closing...");
    }

    // Reset playback state
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
    wsRef.current = null;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold text-gray-900">AI Voice Interface</h1>
        <p className="text-gray-600">Click the microphone to start your voice conversation</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Voice Input Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Volume2 className="h-5 w-5" />
              Voice Input
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Language</label>
              <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en-US">English (US)</SelectItem>
                  <SelectItem value="es-ES">Spanish (Spain)</SelectItem>
                  <SelectItem value="fr-FR">French (France)</SelectItem>
                  <SelectItem value="de-DE">German (Germany)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-center">
              <AIVoiceInput 
                onStart={handleStart}
                onStop={handleStop}
                className="w-full"
              />
            </div>

            <div className="flex gap-2 justify-center">
              <Button
                onClick={isListening ? handleStop : handleStart}
                variant={isListening ? "destructive" : "default"}
                className="flex items-center gap-2"
              >
                {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {isListening ? "Stop Listening" : "Start Listening"}
              </Button>
            </div>

            <div className="text-center">
              <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
                isListening 
                  ? "bg-green-100 text-green-800" 
                  : "bg-gray-100 text-gray-800"
              }`}>
                <div className={`w-2 h-2 rounded-full ${isListening ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
                {isListening ? "Listening..." : "Idle"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Live Logs Card */}
        <Card>
          <CardHeader>
            <CardTitle>Live Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-gray-50 rounded-lg p-4 h-96 overflow-y-auto font-mono text-xs">
              {logs.length === 0 ? (
                <div className="text-gray-400 text-center">
                  No logs yet. Start listening to see activity...
                </div>
              ) : (
                <div className="space-y-1">
                  {logs.map((log, index) => (
                    <div key={index} className="text-gray-700">
                      {log}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AIVoiceInputDemo;
