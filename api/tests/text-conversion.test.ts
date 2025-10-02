import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  convertToPlainText,
  deriveTxtFileName,
  TextConversionError,
} from '../src/lib/text-conversion';

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

describe('convertToPlainText', () => {
  it('returns plain text for .txt uploads', async () => {
    const encoder = new TextEncoder();
    const buffer = encoder.encode('Hello world\nThis is plain text');
    const result = await convertToPlainText({
      arrayBuffer: toArrayBuffer(buffer),
      fileName: 'sample.txt',
      mimeType: 'text/plain',
    });

    expect(result.format).toBe('txt');
    expect(result.text).toContain('Hello world');
    expect(result.bytes).toBeGreaterThan(10);
  });

  it('derives .txt filenames from arbitrary extensions', () => {
    expect(deriveTxtFileName('report.pdf')).toBe('report.txt');
    expect(deriveTxtFileName('  Notes  ')).toBe('Notes.txt');
    expect(deriveTxtFileName('')).toBe('untitled.txt');
  });

  it('extracts text from a simple DOCX document', async () => {
    const zip = new JSZip();
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>Hello from DOCX</w:t></w:r></w:p>
          <w:p><w:r><w:t>Second line</w:t></w:r></w:p>
          <w:sectPr/></w:body>
      </w:document>`;
    zip.file('word/document.xml', documentXml);
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="xml" ContentType="application/xml"/>
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="docx" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"/>
      </Types>`);

    const arrayBuffer = await zip.generateAsync({ type: 'arraybuffer' });
    const result = await convertToPlainText({
      arrayBuffer,
      fileName: 'example.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    expect(result.format).toBe('docx');
    expect(result.text).toContain('Hello from DOCX');
    expect(result.text).toContain('Second line');
  });

  it('extracts text from a generated PDF document', async () => {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([400, 200]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    page.setFont(font);
    page.setFontSize(18);
    page.drawText('Hello from PDF', { x: 50, y: 120 });
    page.drawText('Across two lines', { x: 50, y: 90 });

    const pdfBytes = await pdfDoc.save();
    const arrayBuffer = toArrayBuffer(pdfBytes);
    const result = await convertToPlainText({
      arrayBuffer,
      fileName: 'example.pdf',
      mimeType: 'application/pdf',
    });

    expect(result.format).toBe('pdf');
    expect(result.text).toContain('Hello from PDF');
    expect(result.text).toContain('Across two lines');
  });

  it('rejects unsupported file extensions', async () => {
    const encoder = new TextEncoder();
    const buffer = encoder.encode('some content');
    await expect(
      convertToPlainText({ arrayBuffer: toArrayBuffer(buffer), fileName: 'image.png' }),
    ).rejects.toThrow(TextConversionError);
  });
});

