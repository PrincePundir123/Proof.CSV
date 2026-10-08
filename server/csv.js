import { HttpError } from './config.js';

// Bounded RFC-4180-style parser. It rejects malformed rows rather than silently shifting columns.
export function parseCsv(input, maxRows = 25_000) {
  if (typeof input !== 'string' || !input.trim()) throw new HttpError(400, 'Upload a CSV containing a header and data.');
  const text = input.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  function finishField() {
    if (field.length > 20_000) throw new HttpError(400, 'A CSV cell exceeds 20,000 characters.');
    row.push(field); field = ''; closed = false;
    if (row.length > 100) throw new HttpError(400, 'Use a CSV with at most 100 columns.');
  }
  function finishRow() {
    finishField();
    if (row.some(cell => cell.trim())) rows.push(row);
    row = [];
    if (rows.length > maxRows + 1) throw new HttpError(400, `Use a CSV with at most ${maxRows.toLocaleString()} data rows.`);
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\0') throw new HttpError(400, 'CSV files cannot contain null bytes.');
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === ',' || char === '\n' || char === '\r') {
      if (char === ',') finishField();
      else { if (char === '\r' && text[i + 1] === '\n') i++; finishRow(); }
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed) throw new HttpError(400, 'Unexpected characters after a quoted CSV cell.');
      if (char === '"') throw new HttpError(400, 'Put cells containing quotes inside double quotes.');
      field += char;
    }
  }
  if (quoted) throw new HttpError(400, 'A quoted CSV cell is missing its closing quote.');
  if (field || row.length || closed) finishRow();
  if (rows.length < 2) throw new HttpError(400, 'Your CSV needs a header and at least one data row.');
  const headers = rows.shift().map(cell => cell.trim());
  if (headers.some(header => !header) || new Set(headers).size !== headers.length) {
    throw new HttpError(400, 'Give every column a unique, nonempty name.');
  }
  if (rows.some(row => row.length !== headers.length)) throw new HttpError(400, 'Every CSV row must have the same number of columns as the header.');
  return { headers, rows };
}

export function profileCsv(csv) {
  const { headers, rows } = parseCsv(csv);
  const columns = headers.map((name, index) => {
    const values = rows.map(row => row[index]);
    const nonempty = values.filter(value => value.trim());
    const numeric = nonempty.length > 0 && nonempty.every(value => Number.isFinite(Number(value)));
    return { name, type: numeric ? 'number' : 'text', missing: values.length - nonempty.length };
  });
  return { rowCount: rows.length, columnCount: headers.length, columns, preview: rows.slice(0, 5), sample: rows.slice(0, 8) };
}
