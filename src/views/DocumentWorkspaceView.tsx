import { FileManager } from '../components/FileManager';

interface DocumentWorkspaceViewProps {
  currentUserId: string;
}

export function DocumentWorkspaceView({ currentUserId }: DocumentWorkspaceViewProps) {
  return (
    <div className="view-shell">
      <FileManager currentUserId={currentUserId} storageKey="marble-documents-visibility" />
    </div>
  );
}
