import JSZip from 'jszip';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

// Force pdfjs to execute in-process inside the Worker runtime.
(GlobalWorkerOptions as any).disableWorker = true;
(GlobalWorkerOptions as any).workerPort = null;
// pdfjs checks for an embedded worker before falling back to dynamic imports.
(globalThis as any).pdfjsWorker = pdfjsWorker;

export type SupportedFileKind = 'txt' | 'pdf' | 'docx';

export class TextConversionError extends Error {
  code: 'unsupported-type' | 'empty-text' | 'conversion-failed';

  constructor(code: TextConversionError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: false });

const MIME_ALIASES: Record<string, SupportedFileKind> = {
  'text/plain': 'txt',
  'text/markdown': 'txt',
  'application/pdf': 'pdf',
  'application/x-pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

export function detectFileKind(fileName: string, mimeType?: string): SupportedFileKind | null {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.txt')) {
    return 'txt';
  }
  if (lowerName.endsWith('.pdf')) {
    return 'pdf';
  }
  if (lowerName.endsWith('.docx')) {
    return 'docx';
  }
  if (mimeType) {
    const normalized = mimeType.split(';', 1)[0]?.toLowerCase();
    if (normalized && MIME_ALIASES[normalized]) {
      return MIME_ALIASES[normalized];
    }
  }
  return null;
}

export interface ConvertToPlainTextOptions {
  arrayBuffer: ArrayBuffer;
  fileName: string;
  mimeType?: string;
}

export interface ConvertToPlainTextResult {
  text: string;
  bytes: number;
  format: SupportedFileKind;
}

export async function convertToPlainText(options: ConvertToPlainTextOptions): Promise<ConvertToPlainTextResult> {
  const kind = detectFileKind(options.fileName, options.mimeType);
  if (!kind) {
    throw new TextConversionError(
      'unsupported-type',
      'Only .txt, .pdf, or .docx uploads are supported.',
    );
  }

  let text: string;
  if (kind === 'txt') {
    text = decodeText(options.arrayBuffer);
  } else if (kind === 'pdf') {
    text = await extractPdfText(options.arrayBuffer);
  } else {
    text = await extractDocxText(options.arrayBuffer);
  }

  const normalized = normalizeExtractedText(text);
  if (!normalized) {
    throw new TextConversionError('empty-text', 'The uploaded file did not contain extractable text.');
  }

  const bytes = TEXT_ENCODER.encode(normalized).length;
  return { text: normalized, bytes, format: kind };
}

function decodeText(buffer: ArrayBuffer): string {
  return TEXT_DECODER.decode(buffer);
}

async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  try {
    const pdfTask = getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
      verbosity: 0,
      disableWorker: true,
    });
    const doc = await pdfTask.promise;
    const pages: string[] = [];

    for (let pageIndex = 1; pageIndex <= doc.numPages; pageIndex += 1) {
      const page = await doc.getPage(pageIndex);
      const content = await page.getTextContent();

      const lines: string[] = [];
      let currentLine = '';
      for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
        if (!item || typeof item.str !== 'string') {
          continue;
        }
        const value = item.str;
        if (!value.trim()) {
          if (item.hasEOL && currentLine.trim()) {
            lines.push(cleanWhitespace(currentLine));
            currentLine = '';
          }
          continue;
        }
        currentLine += value;
        if (item.hasEOL) {
          lines.push(cleanWhitespace(currentLine));
          currentLine = '';
        }
      }
      if (currentLine.trim()) {
        lines.push(cleanWhitespace(currentLine));
      }

      page.cleanup();
      const pageText = lines.join('\n').trim();
      if (pageText) {
        pages.push(pageText);
      }
    }

    if ((doc as any).cleanup) {
      (doc as any).cleanup();
    }

    return pages.join('\n\n');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('PDF text extraction failed', reason);
    throw new TextConversionError('conversion-failed', `Failed to extract text from PDF: ${reason}`);
  }
}

async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const documentFile = zip.file('word/document.xml');
    if (!documentFile) {
      throw new TextConversionError('conversion-failed', 'DOCX missing document.xml');
    }

    let xml = await documentFile.async('text');
    xml = xml
      .replace(/\r/g, '')
      .replace(/<w:tab[^>]*\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<w:p[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/w:tr>/g, '\n')
      .replace(/<\/w:tc>/g, '\t');

    const stripped = xml.replace(/<[^>]+>/g, '');
    return decodeXmlEntities(stripped);
  } catch (error) {
    if (error instanceof TextConversionError) {
      throw error;
    }
    console.error('DOCX text extraction failed', error);
    throw new TextConversionError('conversion-failed', 'Failed to extract text from DOCX.');
  }
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (match, entity) => {
    if (!entity) {
      return match;
    }
    const lower = entity.toLowerCase();
    const named: Record<string, string> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: '\'',
      nbsp: ' ',
    };
    if (named[lower] !== undefined) {
      return named[lower];
    }
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

function cleanWhitespace(value: string): string {
  return value.replace(/[\s\u00A0]+/g, ' ').trim();
}

function normalizeExtractedText(raw: string): string {
  const normalized = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
  return normalized;
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
