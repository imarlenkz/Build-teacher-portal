import { Matches } from 'class-validator';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const IsDateStr = () => Matches(DATE_RE, { message: 'Күн форматы YYYY-MM-DD болуы керек' });
