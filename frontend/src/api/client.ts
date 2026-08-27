export interface FfmpegSettings {
  executable_path: string;
  timeout_seconds: number;
  prebuilt_installed_path?: string;
  prebuilt_urls: Record<string, string>;
  prebuilt_release_lists?: Record<string, string>;
}

export interface PathSettings {
  output_dir: string;
  tmp_dir: string;
}

export interface TaskSettings {
  max_workers: number;
}

export type AgentProvider = '' | 'deepseek' | 'moonshot' | 'zhipu' | 'qwen' | 'custom';

export interface AgentSettings {
  provider: AgentProvider;
  base_url: string;
  model: string;
  models: AgentModelInfo[];
  reasoning_effort: string;
  thinking: boolean;
  timeout_seconds: number;
  api_key: string;
  api_key_configured?: boolean;
  api_key_source?: 'settings' | 'env' | 'none';
}

export interface Settings {
  ffmpeg: FfmpegSettings;
  paths: PathSettings;
  tasks: TaskSettings;
  agent: AgentSettings;
  config_warning?: string;
}

export type SettingsUpdate = Partial<Omit<Settings, 'agent'>> & {
  agent?: Partial<AgentSettings> | null;
};

export interface FfmpegCheckResult {
  ok: boolean;
  ffmpeg?: string;
  ffprobe?: string;
  bundled_ffmpeg?: string;
  bundled_ffprobe?: string;
  source?: string;
  version?: string;
  error?: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  platform: {
    system: string;
    machine: string;
    python: string;
  };
  config_dir: string;
  settings_path: string;
  ffmpeg: FfmpegCheckResult;
}

export interface SettingsResponse {
  settings: Settings;
  config_dir: string;
  settings_path: string;
  ffmpeg?: FfmpegCheckResult;
}

export interface AgentAccessResponse {
  allowed: boolean;
  reason: 'api_key' | 'history' | 'blocked';
  has_saved_api_key: boolean;
  has_conversations: boolean;
  conversation_count: number;
}

export interface AudioTaskParams {
  inputFile: string;
  steps?: Array<{
    taskType?: string;
    task_type?: string;
    type?: string;
    subtype?: string;
    params?: Partial<AudioTaskParams>;
  }>;
  outputFormat?: string;
  outputFileName?: string;
  volumeGain?: number;
  loudnessTarget?: string;
  truePeakMax?: number | 'source' | '';
  channels?: string;
  sampleRate?: string;
  bitrate?: string;
  audioTrack?: number;
  startTime?: number;
  duration?: number;
  pitchSemitones?: number;
  speed?: number;
  denoiseStrength?: number;
  modelName?: string;
  device?: string;
  useTta?: boolean;
  batchSize?: number;
  overlapSize?: number;
  chunkSize?: number;
  standardize?: boolean;
  normalize?: boolean;
}

export interface TaskOutput {
  path: string;
  size: number;
  step?: number;
  task_type?: string;
  stem?: string;
}

export interface MsstModelInfo {
  name: string;
  aliases?: string[];
  modelType?: string;
  architecture: string;
  sizeBytes: number;
  targetStem: string;
  primaryCategory?: string;
  primaryCategoryCn?: string;
  secondaryCategory?: string;
  secondaryCategoryCn?: string;
  categoryPath?: string;
  /** 模型是否已下载到本地缓存 */
  downloaded?: boolean;
  /** 模型 YAML 的可用信息（仅已下载模型可读） */
  config?: {
    instruments?: string[];
    sampleRate?: number | null;
    inferenceDefaults?: Record<
      'batchSize' | 'overlapSize' | 'numOverlap' | 'chunkSize',
      number
    > | null;
  } | null;
  /** 当前高级推理参数对该架构是否生效 */
  paramCapabilities?: {
    batchSize?: boolean;
    overlapSize?: boolean;
    chunkSize?: boolean;
  };
  /** 模型 YAML 自带的推荐推理参数（仅已下载模型可读），键为 batchSize/overlapSize/chunkSize */
  defaultInferenceParams?: Record<'batchSize' | 'overlapSize' | 'chunkSize', number> | null;
}

export interface MsstModelsResponse {
  available: boolean;
  models: MsstModelInfo[];
  defaultModel: string;
  modelDir: string;
  source?: string;
  fetchedAt?: string;
  error?: string;
}

export interface MsstCatalogCategory {
  primaryCategory: string;
  primaryCategoryCn: string;
  secondaryCategories: Array<{
    primaryCategory: string;
    primaryCategoryCn: string;
    secondaryCategory: string;
    secondaryCategoryCn: string;
    models: MsstModelInfo[];
  }>;
}

export interface MsstCatalogResponse {
  available: boolean;
  source: string;
  fetchedAt: string;
  modelCount: number;
  models: MsstModelInfo[];
  categories: MsstCatalogCategory[];
  modelDir: string;
  error?: string;
}

export interface TaskRecord {
  id: string;
  type: string;
  conversation_id?: string | null;
  intent?: string | null;
  creation_mode?: 'new' | 'rebuild';
  status: 'pending' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  /** 当前执行阶段（瞬态，如“下载模型（120/448 MB）”“分离推理（12/180 秒）”）；仅运行中的任务有值 */
  stage?: string | null;
  tmp_dir: string;
  params: AudioTaskParams;
  input_params?: Record<string, unknown>;
  output_params?: Record<string, unknown>;
  config?: Record<string, unknown>;
  target_path?: string | null;
  command: string[] | null;
  logs: string[];
  outputs: TaskOutput[];
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskMessage {
  id: string;
  task_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  files: Array<{ id: string; name: string; path: string; size: number }>;
  tool_calls: Array<{ name: string; args: Record<string, unknown>; result?: unknown }>;
  created_at: string;
  updated_at: string;
}

export interface BrowseEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size: number | null;
  modified: number;
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  is_file: boolean;
  entries: BrowseEntry[];
}

export interface AudioStreamInfo {
  index: number;
  codec_name: string;
  codec_type: string;
  sample_rate: string;
  channels: number;
  channel_layout: string;
  bit_rate: string;
}

export interface AudioAnalysis {
  peak_dB: number | null;
  rms_dB: number | null;
  dynamic_range_dB: number | null;
  integrated_loudness_lufs: number | null;
  loudness_range_lu: number | null;
  true_peak_dbtp: number | null;
}

export interface FileStat {
  path: string;
  name: string;
  size: number;
  mtime: number;
}

export interface AudioInfo {
  path: string;
  name: string;
  size: number;
  container: string;
  duration: number;
  bit_rate: number;
  has_video: boolean;
  streams: AudioStreamInfo[];
  analysis: AudioAnalysis;
}

const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) {
        message = body.error;
      }
    } catch {
      // 保留默认错误信息
    }
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return (await response.json()) as T;
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}

export function getSettings(): Promise<SettingsResponse> {
  return request<SettingsResponse>('/settings');
}

export function saveSettings(settings: Settings | SettingsUpdate): Promise<SettingsResponse> {
  return request<SettingsResponse>('/settings', {
    method: 'POST',
    body: JSON.stringify(settings),
  });
}

export function saveFfmpegExecutablePath(
  executablePath: string,
): Promise<SettingsResponse> {
  return request<SettingsResponse>('/settings/ffmpeg/executable-path', {
    method: 'POST',
    body: JSON.stringify({ executable_path: executablePath }),
  });
}

export function checkFfmpeg(patch: Partial<Settings>): Promise<{ ffmpeg: FfmpegCheckResult }> {
  return request<{ ffmpeg: FfmpegCheckResult }>('/settings/check-ffmpeg', {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}

export function createAudioTask(
  params: AudioTaskParams,
  taskType = 'audio',
  options: {
    mode?: 'new' | 'rebuild';
    taskId?: string;
    timestamp?: number;
    conversationId?: string;
  } = {},
): Promise<TaskRecord> {
  return request<TaskRecord>('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      task_type: taskType,
      params,
      mode: options.mode ?? 'new',
      task_id: options.taskId,
      timestamp: options.timestamp,
      conversation_id: options.conversationId,
    }),
  });
}

export interface AgentChatFile {
  id: string;
  name: string;
  path: string;
  size: number;
}

export interface AgentChatRequest {
  conversation_id?: string;
  content: string;
  intent?: string | null;
  subtype?: string | null;
  params?: Record<string, unknown>;
  files?: AgentChatFile[];
  model?: string;
  reasoning_effort?: string;
  thinking?: boolean;
}

export interface AgentMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  files: Array<{ id: string; name: string; path: string; size: number }>;
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: string | Record<string, unknown>;
    result?: unknown;
  }>;
  tool_call_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentConversationSummary {
  id: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message: string | null;
}

export interface AgentChatHandlers {
  onMeta?: (conversationId: string, userMessageId?: string) => void;
  onMessageStart?: (message: { id: string }) => void;
  onDelta?: (messageId: string, text: string) => void;
  onToolCall?: (toolCall: {
    message_id?: string;
    id?: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
  }) => void;
  onDone?: (message: AgentMessage) => void;
  onError?: (error: string) => void;
}

function dispatchAgentEvent(raw: string, handlers: AgentChatHandlers) {
  let event = 'message';
  let data = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data += line.slice(5).trim();
    }
  }
  if (!data) {
    return;
  }
  let parsed: {
    conversation_id?: string;
    user_message_id?: string;
    message_id?: string;
    text?: string;
    message_start?: { id: string };
    message?: AgentMessage | { id: string };
    tool_call?: {
      message_id?: string;
      id?: string;
      name: string;
      arguments: Record<string, unknown>;
      result?: unknown;
    };
    error?: string;
  };
  try {
    parsed = JSON.parse(data) as typeof parsed;
  } catch {
    return;
  }
  if (event === 'agent.meta') {
    handlers.onMeta?.(parsed.conversation_id ?? '', parsed.user_message_id);
  } else if (event === 'chat.message_start') {
    const message = parsed.message;
    if (message?.id) {
      handlers.onMessageStart?.({ id: message.id });
    }
  } else if (event === 'chat.delta') {
    if (parsed.message_id) {
      handlers.onDelta?.(parsed.message_id, parsed.text ?? '');
    }
  } else if (event === 'chat.tool_call') {
    if (parsed.tool_call) {
      handlers.onToolCall?.(parsed.tool_call);
    }
  } else if (event === 'chat.done') {
    if (parsed.message && 'conversation_id' in parsed.message) {
      handlers.onDone?.(parsed.message);
    }
  } else if (event === 'chat.error') {
    handlers.onError?.(parsed.error ?? '未知错误');
  }
}

export function getAgentConversationMessages(
  conversationId: string,
): Promise<{ messages: AgentMessage[] }> {
  return request<{ messages: AgentMessage[] }>(
    `/agents/conversations/${conversationId}/messages`,
  );
}

export function deleteAgentConversation(
  conversationId: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/agents/conversations/${conversationId}`, {
    method: 'DELETE',
  });
}

export function rollbackAgentConversation(
  conversationId: string,
  messageId: string,
): Promise<{ messages: AgentMessage[]; deleted_task_ids?: string[] }> {
  return request<{ messages: AgentMessage[]; deleted_task_ids?: string[] }>(
    `/agents/conversations/${conversationId}/rollback`,
    {
      method: 'POST',
      body: JSON.stringify({ message_id: messageId }),
    },
  );
}

export function getAgentConversations(): Promise<{
  conversations: AgentConversationSummary[];
}> {
  return request<{ conversations: AgentConversationSummary[] }>(
    '/agents/conversations',
  );
}

export function getAgentAccess(): Promise<AgentAccessResponse> {
  return request<AgentAccessResponse>('/agents/access');
}

export async function streamAgentChat(
  req: AgentChatRequest,
  handlers: AgentChatHandlers,
): Promise<void> {
  const response = await fetch(`${API_BASE}/agents/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!response.ok) {
    let errorMessage = `请求失败（${response.status}）`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) {
        errorMessage = body.error;
      }
    } catch {
      // 保留默认错误信息
    }
    handlers.onError?.(errorMessage);
    return;
  }
  const reader = response.body?.getReader();
  if (!reader) {
    handlers.onError?.('当前浏览器不支持流式响应');
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    // 兼容 SSE 的 CRLF 分隔，避免事件长期停留在缓冲区不被解析
    buffer = buffer.replace(/\r\n?/g, '\n');
    let separator = buffer.indexOf('\n\n');
    while (separator >= 0) {
      const raw = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      dispatchAgentEvent(raw, handlers);
      separator = buffer.indexOf('\n\n');
    }
  }
  // 流结束后仍可能有未带 \n\n 的尾部事件，统一在此兜底处理
  buffer += decoder.decode();
  buffer = buffer.replace(/\r\n?/g, '\n');
  if (buffer.trim()) {
    dispatchAgentEvent(buffer, handlers);
  }
}

export interface AgentTestResult {
  ok: boolean;
  reply?: string;
  model?: string;
  latency_ms?: number;
  error?: string;
}

export function testAgentConnection(agent: AgentSettings): Promise<AgentTestResult> {
  return request<AgentTestResult>('/agents/test', {
    method: 'POST',
    body: JSON.stringify({ agent }),
  });
}

export interface AgentModelInfo {
  id: string;
  owned_by?: string;
}

export interface AgentModelsResponse {
  models: AgentModelInfo[];
  base_url?: string;
  default_model?: string;
  error?: string;
}

export function getAgentModels(): Promise<AgentModelsResponse> {
  return request<AgentModelsResponse>('/agents/models');
}

export function getTasks(): Promise<{ tasks: TaskRecord[] }> {
  return request<{ tasks: TaskRecord[] }>('/tasks');
}

export function getMsstModels(): Promise<MsstModelsResponse> {
  return request<MsstModelsResponse>('/msst/models');
}

export function getMsstCatalog(): Promise<MsstCatalogResponse> {
  return request<MsstCatalogResponse>('/msst/catalog');
}

export function getTask(taskId: string): Promise<TaskRecord> {
  return request<TaskRecord>(`/tasks/${taskId}`);
}

export function cancelTask(taskId: string): Promise<TaskRecord> {
  return request<TaskRecord>(`/tasks/${taskId}/cancel`, { method: 'POST' });
}

export function deleteTask(taskId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/tasks/${taskId}`, { method: 'DELETE' });
}

export function getTaskMessages(taskId: string): Promise<{ messages: TaskMessage[] }> {
  return request<{ messages: TaskMessage[] }>(`/tasks/${taskId}/messages`);
}

export function postTaskMessage(
  taskId: string,
  message: Pick<TaskMessage, 'role' | 'content' | 'files' | 'tool_calls'>,
): Promise<TaskMessage> {
  return request<TaskMessage>(`/tasks/${taskId}/messages`, {
    method: 'POST',
    body: JSON.stringify(message),
  });
}

export function browseLocalFiles(path?: string): Promise<BrowseResult> {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  return request<BrowseResult>(`/files/browse${query}`);
}

export function getAudioInfo(path: string): Promise<AudioInfo> {
  return request<AudioInfo>(`/audio/info?path=${encodeURIComponent(path)}`);
}

export function getFileStat(path: string): Promise<FileStat> {
  return request<FileStat>(`/files/stat?path=${encodeURIComponent(path)}`);
}

export function getFileContentUrl(path: string): string {
  return `/api/files/content?path=${encodeURIComponent(path)}`;
}
