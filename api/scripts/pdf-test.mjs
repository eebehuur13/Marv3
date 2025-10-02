import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';

GlobalWorkerOptions.disableWorker = true;
GlobalWorkerOptions.workerPort = null;
GlobalWorkerOptions.workerSrc = undefined;

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const pdfPath = path.resolve(__dirname, '../tests/fixtures/sample.pdf');
  const data = fs.readFileSync(pdfPath);
  const pdfTask = getDocument({
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
    disableWorker: true,
  });
  const doc = await pdfTask.promise;
  console.log('pages', doc.numPages);
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  console.log('items', content.items.length);
}

main().catch((error) => {
  console.error('error', error);
});
