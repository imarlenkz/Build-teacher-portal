import { Global, Injectable, Module } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Response } from 'express';

export type Cell = string | number | null | undefined;

export interface SheetSpec {
  name: string;
  title?: string;
  subtitle?: string;
  headers: string[];
  rows: Cell[][];
  widths?: number[];
}

/** CSV формуласы арқылы шабуылдан (CSV injection) қорғау. */
function csvSafe(v: Cell): string {
  if (v == null) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

@Injectable()
export class ExportService {
  csv(headers: string[], rows: Cell[][]): Buffer {
    const lines = [headers, ...rows].map((r) => r.map(csvSafe).join(','));
    // BOM — Excel кириллицаны дұрыс ашуы үшін.
    return Buffer.from('﻿' + lines.join('\r\n'), 'utf8');
  }

  async xlsx(sheets: SheetSpec[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Ұстаз';
    wb.created = new Date();
    for (const s of sheets) {
      const ws = wb.addWorksheet(s.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: s.title ? (s.subtitle ? 4 : 3) : 1 }] });
      let r = 1;
      if (s.title) {
        ws.getCell(r, 1).value = s.title;
        ws.getCell(r, 1).font = { bold: true, size: 14 };
        r++;
        if (s.subtitle) {
          ws.getCell(r, 1).value = s.subtitle;
          ws.getCell(r, 1).font = { color: { argb: 'FF5B626B' } };
          r++;
        }
        r++;
      }
      const header = ws.getRow(r);
      s.headers.forEach((h, i) => {
        const c = header.getCell(i + 1);
        c.value = h;
        c.font = { bold: true };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF1F3' } };
        c.border = { bottom: { style: 'thin', color: { argb: 'FFC9CDD2' } } };
        c.alignment = { vertical: 'middle', wrapText: true };
      });
      s.rows.forEach((row) => {
        r++;
        const xr = ws.getRow(r);
        row.forEach((v, i) => (xr.getCell(i + 1).value = v ?? null));
      });
      s.headers.forEach((h, i) => {
        const w = s.widths?.[i] ?? Math.min(48, Math.max(h.length + 2, ...s.rows.slice(0, 200).map((x) => String(x[i] ?? '').length + 2)));
        ws.getColumn(i + 1).width = w;
      });
      if (s.rows.length) {
        const hr = s.title ? (s.subtitle ? 4 : 3) : 1;
        ws.autoFilter = { from: { row: hr, column: 1 }, to: { row: hr, column: s.headers.length } };
      }
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  send(res: Response, buf: Buffer, fileName: string, type: 'csv' | 'xlsx' | 'pdf') {
    const mime = {
      csv: 'text/csv; charset=utf-8',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pdf: 'application/pdf',
    }[type];
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="export.${type}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  }
}

@Global()
@Module({ providers: [ExportService], exports: [ExportService] })
export class ExportModule {}
