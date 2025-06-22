
import { AIVoiceInput } from "@/components/ui/ai-voice-input";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function AIVoiceInputDemo() {
  const [recordings, setRecordings] = useState<{ duration: number; timestamp: Date }[]>([]);

  const handleStart = () => {
    console.log('Recording started');
  };

  const handleStop = (duration: number) => {
    if (duration > 0) {
      setRecordings(prev => [...prev.slice(-4), { duration, timestamp: new Date() }]);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="text-center space-y-4">
        <h2 className="text-3xl font-bold">AI Voice Input Component</h2>
        <p className="text-muted-foreground">
          Click the microphone to start recording. Features real-time audio visualization and timer.
        </p>
      </div>

      <Card className="border-2">
        <CardHeader>
          <CardTitle>Interactive Voice Input</CardTitle>
          <CardDescription>
            Click the microphone button to start/stop recording
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AIVoiceInput 
            onStart={handleStart}
            onStop={handleStop}
          />
        </CardContent>
      </Card>

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
            onStart={() => console.log('Demo recording started')}
            onStop={(duration) => console.log('Demo recording stopped:', duration)}
          />
        </CardContent>
      </Card>

      {recordings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recording History</CardTitle>
            <CardDescription>
              Your recent voice recordings
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recordings.map((recording, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary">#{recordings.length - index}</Badge>
                    <span className="font-medium">Recording</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>Duration: {formatDuration(recording.duration)}</span>
                    <span>{recording.timestamp.toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Component Features</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="font-medium">Visual Features</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Animated audio visualizer bars</li>
                <li>• Real-time recording timer</li>
                <li>• Smooth hover and transition effects</li>
                <li>• Dark mode support</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium">Functional Features</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Start/stop recording callbacks</li>
                <li>• Configurable demo mode</li>
                <li>• Customizable visualizer bars</li>
                <li>• TypeScript support</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
