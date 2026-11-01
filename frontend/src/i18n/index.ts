import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import kk from './kk.json';

/**
 * Негізгі тіл — қазақша. Беттерде t('кілт', 'Қазақша мәтін') түрінде жазылады:
 * ru/en аудармаларын қосу үшін ru.json/en.json файлдарын resources-қа тіркеу жеткілікті.
 */
void i18n.use(initReactI18next).init({
  resources: { kk: { translation: kk } },
  lng: localStorage.getItem('ustaz.lang') ?? 'kk',
  fallbackLng: 'kk',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export const LANGUAGES = [
  { code: 'kk', label: 'Қазақша', ready: true },
  { code: 'ru', label: 'Русский', ready: false },
  { code: 'en', label: 'English', ready: false },
];

export default i18n;
