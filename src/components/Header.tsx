
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';

const Header = () => {
  const { user, signOut } = useAuth();

  return (
    <header className="bg-white border-b border-gray-200 px-4 py-3">
      <div className="container mx-auto flex justify-between items-center">
        <h1 className="text-xl font-semibold text-gray-900">
          Cold Call Audio Streaming
        </h1>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-600">
            {user?.email}
          </span>
          <Button 
            variant="outline" 
            size="sm"
            onClick={signOut}
          >
            Sign Out
          </Button>
        </div>
      </div>
    </header>
  );
};

export default Header;
