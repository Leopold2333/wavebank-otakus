import { useEffect } from 'react';
import { useModelLibraryStore } from './modelLibraryStore';

export function useMsstModelLibrary(enabled = true) {
  const catalog = useModelLibraryStore((state) => state.catalog);
  const catalogError = useModelLibraryStore((state) => state.catalogError);
  const catalogLoading = useModelLibraryStore((state) => state.catalogLoading);
  const downloads = useModelLibraryStore((state) => state.downloads);
  const loadCatalog = useModelLibraryStore((state) => state.loadCatalog);
  const refreshDownloads = useModelLibraryStore(
    (state) => state.refreshDownloads,
  );
  const startDownload = useModelLibraryStore((state) => state.startDownload);
  const cancelDownload = useModelLibraryStore((state) => state.cancelDownload);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void loadCatalog();
    void refreshDownloads();
  }, [enabled, loadCatalog, refreshDownloads]);

  return {
    catalog,
    catalogError,
    catalogLoading,
    downloads,
    loadCatalog,
    refreshDownloads,
    startDownload,
    cancelDownload,
  };
}
