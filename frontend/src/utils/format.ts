export function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function pathBasename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'mkv',
  'mov',
  'avi',
  'webm',
  'ts',
  'mts',
  'm2ts',
  'flv',
  'wmv',
  '3gp',
  'ogv',
  'mpg',
  'mpeg',
]);

export function isVideoPath(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return VIDEO_EXTENSIONS.has(extension);
}
