import { describe, expect, it } from 'vitest';
import { assertTxtFile, deriveTxtFileName } from '../src/lib/text-conversion';
import { HTTPException } from 'hono/http-exception';

describe('text conversion helpers', () => {
  it('derives .txt filenames from arbitrary extensions', () => {
    expect(deriveTxtFileName('report.pdf')).toBe('report.txt');
    expect(deriveTxtFileName('  Notes  ')).toBe('Notes.txt');
    expect(deriveTxtFileName('')).toBe('untitled.txt');
  });

  it('accepts known text files', () => {
    expect(() => assertTxtFile({ file_name: 'notes.txt', mime_type: 'text/plain' })).not.toThrow();
    expect(() => assertTxtFile({ file_name: 'README.TXT', mime_type: null })).not.toThrow();
  });

  it('rejects unsupported extensions', () => {
    expect(() => assertTxtFile({ file_name: 'diagram.pdf', mime_type: 'application/pdf' })).toThrow(HTTPException);
  });

  it('rejects unexpected mime types even for .txt extension', () => {
    expect(() => assertTxtFile({ file_name: 'notes.txt', mime_type: 'application/octet-stream' })).toThrow(HTTPException);
  });
});
