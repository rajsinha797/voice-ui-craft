
import { AIVoiceInput } from "@/components/ui/ai-voice-input";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download } from "lucide-react";

export function AIVoiceInputDemo() {
  const [recordings, setRecordings] = useState<{ duration: number; timestamp: Date }[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState("English");

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

  const downloadRecordingHistory = () => {
    const csvContent = "data:text/csv;charset=utf-8," 
      + "Recording Number,Duration,Timestamp\n"
      + recordings.map((recording, index) => 
          `${recordings.length - index},${formatDuration(recording.duration)},${recording.timestamp.toLocaleString()}`
        ).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "recording_history.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Left Side */}
      <div className="space-y-8">
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
                </SelectContent>
              </Select>
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
                Download
              </Button>
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
              onStart={() => console.log('Demo recording started')}
              onStop={(duration) => console.log('Demo recording stopped:', duration)}
            />
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
                </ul>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium">Functional Features</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Start/stop recording callbacks</li>
                  <li>• Configurable demo mode</li>
                  <li>• Customizable visualizer bars</li>
                  <li>• TypeScript support</li>
                  <li>• Multi-language support</li>
                  <li>• Recording history download</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
