import { create } from 'zustand';
import {
  cancelMsstDownload,
  getMsstCatalog,
  getMsstDownloads,
  startMsstDownload,
  type MsstCatalogResponse,
  type MsstDownloadState,
  type MsstModelInfo,
} from '../../api/client';

interface ModelLibraryState {
  catalog: MsstCatalogResponse | null;
  catalogError: string;
  catalogLoading: boolean;
  downloads: Record<string, MsstDownloadState>;
  loadCatalog: () => Promise<MsstCatalogResponse | null>;
  refreshDownloads: () => Promise<MsstDownloadState[]>;
  startDownload: (model: MsstModelInfo) => Promise<void>;
  cancelDownload: (model: MsstModelInfo) => Promise<MsstDownloadState>;
}

let pollingTimer: ReturnType<typeof setInterval> | null = null;

function stopPolling() {
  if (pollingTimer !== null) {
    window.clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

function startPolling() {
  if (pollingTimer !== null) {
    return;
  }
  pollingTimer = window.setInterval(() => {
    void useModelLibraryStore.getState().refreshDownloads();
  }, 2000);
}

export const useModelLibraryStore = create<ModelLibraryState>((set, get) => ({
  catalog: null,
  catalogError: '',
  catalogLoading: true,
  downloads: {},

  loadCatalog: async () => {
    try {
      const response = await getMsstCatalog();
      set({ catalog: response, catalogError: '', catalogLoading: false });
      return response;
    } catch (error) {
      set({
        catalogError:
          error instanceof Error ? error.message : '加载模型库失败',
        catalogLoading: false,
      });
      return null;
    }
  },

  refreshDownloads: async () => {
    try {
      const response = await getMsstDownloads();
      const downloads = Object.fromEntries(
        response.downloads.map((item) => [item.modelName, item]),
      );
      set({ downloads });
      const list = response.downloads;
      if (list.some((item) => item.status === 'done')) {
        void get().loadCatalog();
      }
      if (!list.some((item) => item.status === 'downloading')) {
        stopPolling();
      }
      return list;
    } catch {
      return [];
    }
  },

  startDownload: async (model) => {
    const state = await startMsstDownload(model.name);
    set((previous) => ({
      downloads: {
        ...previous.downloads,
        [state.modelName || model.name]: state,
      },
    }));
    startPolling();
    await get().refreshDownloads();
  },

  cancelDownload: async (model) => {
    const result = await cancelMsstDownload(model.name);
    set((previous) => ({
      downloads: {
        ...previous.downloads,
        [result.modelName || model.name]: result,
      },
    }));
    await get().refreshDownloads();
    await get().loadCatalog();
    return result;
  },
}));
