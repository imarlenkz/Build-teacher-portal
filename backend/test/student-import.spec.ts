import ExcelJS from 'exceljs';
import { birthFromIin, fixCase, genderOf, parseClass, parseDate, parseStudentWorkbook } from '../src/modules/students/student-import';
import { makeIin } from '../src/common/utils/crypto';

describe('student import helpers', () => {
  it('parses class labels', () => {
    expect(parseClass('1 А')).toEqual({ grade: 1, letter: 'А' });
    expect(parseClass('10Ә')).toEqual({ grade: 10, letter: 'Ә' });
    expect(parseClass('4-ғ')).toEqual({ grade: 4, letter: 'Ғ' });
    expect(parseClass('А1')).toBeNull();
  });
  it('parses dates and rejects impossible ones', () => {
    expect(parseDate('03.12.2019')).toBe('2019-12-03');
    expect(parseDate('2019-12-03')).toBe('2019-12-03');
    expect(parseDate('31.02.2019')).toBeNull();
  });
  it('fixes all-caps names only', () => {
    expect(fixCase('ЕРДЕН')).toBe('Ерден');
    expect(fixCase('АЙБЕКҰЛЫ')).toBe('Айбекұлы');
    expect(fixCase('МакДональд')).toBe('МакДональд');
  });
  it('derives gender from IIN, then patronymic, then surname', () => {
    expect(genderOf('191203602237', null, '')).toBe('F');
    expect(genderOf('190912501829', null, '')).toBe('M');
    expect(genderOf('190912001829', 'Медетқызы', '')).toBe('F');
    expect(genderOf(null, null, '', 'Ибадуллаев')).toBe('M');
    expect(genderOf(null, null, '', 'Ибадуллаева')).toBe('F');
    expect(genderOf(null, null, '', 'Асылбек')).toBeNull();
    expect(genderOf(null, null, 'ер')).toBe('M');
  });
  it('reads birth date from IIN', () => {
    expect(birthFromIin('191203602237')).toBe('2019-12-03');
  });
});

describe('parseStudentWorkbook', () => {
  it('reads a contingent sheet and reports bad rows', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Данные по контингенту');
    const iin = makeIin(new Date(Date.UTC(2019, 11, 3)), 'F', 1);
    ws.addRow(['Тегі', 'Аты', 'Әкесінің аты', 'ЖСН', 'Сынып', 'Туған күні']);
    ws.addRow(['АЗАТ', 'Айжұлдыз', 'Медетқызы', Number(iin), '1 А', '03.12.2019']);
    ws.addRow(['Омаров', 'Али', '', '123456789012', '1 А', '01.01.2019']);
    ws.addRow(['Сейіт', 'Ерлан', '', '', 'X', '01.01.2019']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await parseStudentWorkbook(buf, '2026-11-01');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ lastName: 'Азат', className: '1А', birthDate: '2019-12-03', gender: 'F', iin });
    expect(r.errors.map((e) => e.row)).toEqual([3, 4]);
  });
});
