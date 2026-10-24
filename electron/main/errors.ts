import type { AppErrorCode, SerializedError } from '../../src/shared/types';

/**
 * Business error with a stable machine-readable code.
 * Messages are user-facing Chinese strings; details are logged, never shown raw.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }

  toSerialized(): SerializedError {
    return { code: this.code, message: this.message };
  }
}

export function toSerializedError(error: unknown): SerializedError {
  if (error instanceof AppError) return error.toSerialized();
  if (error instanceof Error) {
    return { code: 'INTERNAL', message: friendlyMessage(error) };
  }
  return { code: 'INTERNAL', message: '发生了未知错误。' };
}

function friendlyMessage(error: Error): string {
  const message = error.message ?? '';
  if (/UNIQUE constraint failed: collections\.name/i.test(message)) {
    return '已经存在同名专题。';
  }
  if (/UNIQUE constraint failed: collection_entries\.film_id/i.test(message)) {
    return '这部作品已经在收藏库中。';
  }
  if (/UNIQUE constraint failed: films\.metadata_source/i.test(message)) {
    return '这部作品已经导入过。';
  }
  if (/SQLITE_CORRUPT/i.test(message)) {
    return '数据库文件损坏，应用已停止写入。请从备份恢复。';
  }
  if (/SQLITE_FULL/i.test(message)) {
    return '磁盘空间不足，无法写入数据。';
  }
  if (/SQLITE_READONLY/i.test(message)) {
    return '数据库文件为只读，无法写入。';
  }
  return '操作失败，请稍后重试。';
}
