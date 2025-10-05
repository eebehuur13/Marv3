import { HTTPException } from 'hono/http-exception';
import type { FileRecord } from '../types';

type TxtFileLike = Pick<FileRecord, 'file_name' | 'mime_type'> | {
  file_name: string;
  mime_type: string | null;
};

export function assertTxtFile(file: TxtFileLike): void {
  const name = file.file_name.toLowerCase();
  if (!name.endsWith('.txt')) {
    throw new HTTPException(400, { message: 'Only .txt files are supported.' });
  }
  if (file.mime_type && file.mime_type !== 'text/plain') {
    throw new HTTPException(400, { message: 'Unexpected mime type for stored text file.' });
  }
}

export function deriveTxtFileName(originalName: string): string {
  const trimmed = originalName.trim();
  if (!trimmed) {
    return 'untitled.txt';
  }
  const withoutExt = trimmed.replace(/\.[^.]+$/, '');
  const base = withoutExt.trim() || 'untitled';
  return `${base}.txt`;
}
