import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

export interface FileAttachment {
  id: string;
  name: string;
  size: number;
  path: string;
  /** 附件来源：人工参数页或 Agent 会话，用于模式切换时换绑 */
  source?: 'manual' | 'agent';
}

interface FileAttachmentsContextValue {
  attachments: FileAttachment[];
  addLocalPaths: (
    paths: Array<{ name: string; path: string; size?: number; source?: 'manual' | 'agent' }>,
  ) => void;
  setLocalPaths: (
    paths: Array<{ name: string; path: string; size?: number; source?: 'manual' | 'agent' }>,
  ) => void;
  removeAttachment: (id: string) => void;
}

const FileAttachmentsContext = createContext<FileAttachmentsContextValue | null>(null);

function sameLocalPaths(
  current: FileAttachment[],
  next: Array<{ name: string; path: string; size?: number; source?: 'manual' | 'agent' }>,
) {
  return (
    current.length === next.length &&
    current.every((item, index) => {
      const candidate = next[index];
      return (
        item.name === candidate.name &&
        item.path === candidate.path &&
        item.size === (candidate.size ?? 0) &&
        item.source === candidate.source
      );
    })
  );
}

export function FileAttachmentsProvider({ children }: { children: ReactNode }) {
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);

  const addLocalPaths = useCallback(
    (
      paths: Array<{
        name: string;
        path: string;
        size?: number;
        source?: 'manual' | 'agent';
      }>,
    ) => {
      setAttachments((prev) => [
        ...prev,
        ...paths.map((item) => ({
          id: crypto.randomUUID(),
          name: item.name,
          size: item.size ?? 0,
          path: item.path,
          source: item.source,
        })),
      ]);
    },
    [],
  );

  const setLocalPaths = useCallback(
    (
      paths: Array<{
        name: string;
        path: string;
        size?: number;
        source?: 'manual' | 'agent';
      }>,
    ) => {
      setAttachments((prev) => {
        if (sameLocalPaths(prev, paths)) {
          return prev;
        }
        return paths.map((item) => ({
          id: crypto.randomUUID(),
          name: item.name,
          size: item.size ?? 0,
          path: item.path,
          source: item.source,
        }));
      });
    },
    [],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  }, []);

  return (
    <FileAttachmentsContext.Provider
      value={{ attachments, addLocalPaths, setLocalPaths, removeAttachment }}
    >
      {children}
    </FileAttachmentsContext.Provider>
  );
}

export function useFileAttachments(): FileAttachmentsContextValue {
  const value = useContext(FileAttachmentsContext);
  if (!value) {
    throw new Error('useFileAttachments 必须在 FileAttachmentsProvider 内使用');
  }
  return value;
}
