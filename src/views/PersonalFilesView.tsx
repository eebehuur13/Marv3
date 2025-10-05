import { FileManager } from '../components/FileManager';

interface PersonalFilesViewProps {
  currentUserId: string;
}

export function PersonalFilesView({ currentUserId }: PersonalFilesViewProps) {
  return (
    <div className="view-shell">
      <FileManager currentUserId={currentUserId} mode="personal" storageKey="marble-personal-visibility" />
    </div>
  );
}
