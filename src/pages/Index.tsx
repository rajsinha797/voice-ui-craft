
import { AIVoiceInputDemo } from "@/components/AIVoiceInputDemo";
import Header from "@/components/Header";

const Index = () => {
  return (
    <div className="min-h-screen bg-white">
      <Header />
      <div className="container mx-auto px-4 py-12">
        <div className="text-center space-y-4 mb-8">
          <h2 className="text-3xl font-bold">Cold Call Audio Streaming Solution</h2>
          <p className="text-muted-foreground">
            Click the microphone to start recording. Features real-time audio visualization and timer.
          </p>
        </div>
        <AIVoiceInputDemo />
      </div>
    </div>
  );
};

export default Index;
