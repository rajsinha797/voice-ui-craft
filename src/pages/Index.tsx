
import AuthGuard from '@/components/AuthGuard';
import Header from '@/components/Header';
import AIVoiceInputDemo from '@/components/AIVoiceInputDemo';

const Index = () => {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="py-8">
          <AIVoiceInputDemo />
        </main>
      </div>
    </AuthGuard>
  );
};

export default Index;
