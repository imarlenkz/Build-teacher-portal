/**
 * Seed жүйесі.
 *  - Әрқашан: рөлдер мен рұқсаттар, ұлттар анықтамалығы, себептер, бірінші Admin (ADMIN_LOGIN / ADMIN_PASSWORD).
 *  - SEED_DEMO=true: «№1 жалпы білім беретін мектеп» демо деректері — 9 сынып, SEED_STUDENTS (әдепкі 216) оқушы,
 *    сабақ кестесі, I тоқсанның қатысуы, БЖБ/ТЖБ (критерийлерімен), өткен оқу жылы, оқушы қозғалысы.
 *  - SEED_RESET=true: барлық деректі өшіріп, қайта толтырады (тек development).
 *
 * Іске қосу: npm run seed  (production контейнерінде: npm run seed:prod)
 */
import { AttendanceStatus, Gender, MovementType, Prisma, PrismaClient, RoleCode } from '@prisma/client';
import * as argon2 from 'argon2';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/common/permissions';
import { DEFAULT_LEVELS } from '../src/modules/core/levels.service';
import { computeQuarter, DEFAULT_WEIGHTS } from '../src/common/utils/grades';
import { makeIin, PiiCipher } from '../src/common/utils/crypto';
import { addDays, fmtDate, todayStr, toDate, weekday } from '../src/common/utils/dates';

const prisma = new PrismaClient();
const ARGON = { type: 2 as const, memoryCost: 19456, timeCost: 2, parallelism: 1, raw: false as const };

// ───────── детерминистік кездейсоқ сандар ─────────
function rng(seed: number) {
  let s = ((Math.abs(Math.floor(seed)) * 2654435761 + 104729) % 2147483646) + 1;
  const f = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 12; i++) f();
  return f;
}
const R = rng(2026);
const pick = <T>(a: readonly T[], r = R) => a[Math.floor(r() * a.length)];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ───────── анықтамалықтар ─────────
const NATIONALITIES = ['Қазақ', 'Орыс', 'Өзбек', 'Ұйғыр', 'Татар', 'Украин', 'Кәріс', 'Неміс', 'Әзірбайжан', 'Басқа'];
const REASONS = [
  { code: 'sick_note', name: 'Ауру (анықтама бар)', isExcused: true },
  { code: 'family', name: 'Отбасылық жағдай', isExcused: true },
  { code: 'competition', name: 'Олимпиада / жарыс', isExcused: true },
  { code: 'parent_note', name: 'Ата-ана өтініші', isExcused: true },
  { code: 'unknown', name: 'Себебі белгісіз', isExcused: false },
];

const M_FIRST = ['Әлихан', 'Нұрсұлтан', 'Ерасыл', 'Данияр', 'Арман', 'Бекзат', 'Темірлан', 'Алихан', 'Ислам', 'Санжар', 'Азамат', 'Ернұр', 'Мирас', 'Айбек', 'Әділет', 'Нұрлан', 'Ахмет', 'Димаш', 'Жандос', 'Абылай'];
const F_FIRST = ['Айару', 'Аружан', 'Томирис', 'Дана', 'Мадина', 'Інжу', 'Әйгерім', 'Жансая', 'Аяулым', 'Гүлназ', 'Мөлдір', 'Аида', 'Әсем', 'Назерке', 'Сабина', 'Ақбота', 'Балжан', 'Камила', 'Айлин', 'Зере'];
const ROOTS = ['Сейіт', 'Жақсыбек', 'Төлеу', 'Омар', 'Қасым', 'Нұрлан', 'Әбіл', 'Серікбай', 'Бақытжан', 'Мұрат', 'Ермек', 'Сапар', 'Бек', 'Жұмабай', 'Асқар', 'Тұрсын', 'Қали', 'Сұлтан', 'Иса', 'Әбен', 'Оспан', 'Жарылқап', 'Ахмет', 'Нұрбек', 'Тоқтар'];
const FATHERS = ['Серік', 'Ерлан', 'Бауыржан', 'Нұрлан', 'Асқар', 'Қайрат', 'Ержан', 'Марат', 'Талғат', 'Дәурен'];
const MINORITY: [string, string, Gender, string][] = [
  ['Ковалёв', 'Дмитрий', 'M', 'Орыс'],
  ['Петрова', 'Анастасия', 'F', 'Орыс'],
  ['Рахимов', 'Азиз', 'M', 'Өзбек'],
  ['Смирнов', 'Артём', 'M', 'Орыс'],
  ['Юсупов', 'Ринат', 'M', 'Ұйғыр'],
  ['Каримова', 'Камила', 'F', 'Өзбек'],
  ['Ким', 'Виктория', 'F', 'Кәріс'],
  ['Хасанова', 'Мадина', 'F', 'Ұйғыр'],
  ['Юсупова', 'Дильноза', 'F', 'Өзбек'],
  ['Шмидт', 'Артур', 'M', 'Неміс'],
  ['Гарипов', 'Тимур', 'M', 'Татар'],
  ['Мельник', 'Олеся', 'F', 'Украин'],
  ['Алиев', 'Руслан', 'M', 'Әзірбайжан'],
  ['Иванова', 'Полина', 'F', 'Орыс'],
  ['Садыкова', 'Лейла', 'F', 'Татар'],
];
const MOTHERS = ['Гүлнар', 'Сәуле', 'Жанар', 'Бибігүл', 'Ләззат', 'Айгүл', 'Динара', 'Мәдина', 'Ақмарал', 'Роза'];
const PREV_SCHOOLS = ['№12 мектеп-гимназия', '№7 жалпы білім беретін мектеп', '№25 IT-лицей', 'Ақсу ауылының мектебі', '№3 мамандандырылған лицей'];

const CLASSES = ['1А', '1Ә', '2А', '2Ә', '5А', '5Ә', '9А', '9Ә', '11А'];
const TIMES: [string, string][] = [
  ['08:30', '09:15'],
  ['09:25', '10:10'],
  ['10:30', '11:15'],
  ['11:25', '12:10'],
  ['12:20', '13:05'],
  ['13:15', '14:00'],
  ['14:10', '14:55'],
];

// Пәндер мен апталық сағат саны (сынып деңгейі бойынша).
const CURRICULUM: Record<number, [string, number][]> = {
  1: [['Сауат ашу', 5], ['Математика', 4], ['Дүниетану', 2], ['Орыс тілі', 2], ['Ағылшын тілі', 2]],
  2: [['Қазақ тілі', 4], ['Әдебиеттік оқу', 3], ['Математика', 4], ['Дүниетану', 2], ['Орыс тілі', 2], ['Ағылшын тілі', 2]],
  5: [['Математика', 5], ['Қазақ тілі', 3], ['Қазақ әдебиеті', 2], ['Орыс тілі', 2], ['Ағылшын тілі', 3], ['Жаратылыстану', 2], ['Информатика', 1], ['Қазақстан тарихы', 1]],
  9: [['Алгебра', 3], ['Геометрия', 2], ['Қазақ тілі', 2], ['Қазақ әдебиеті', 2], ['Орыс тілі', 2], ['Ағылшын тілі', 3], ['Физика', 2], ['Химия', 2], ['Биология', 2], ['Қазақстан тарихы', 2], ['Информатика', 1]],
  11: [['Алгебра', 3], ['Геометрия', 2], ['Қазақ тілі', 1], ['Қазақ әдебиеті', 2], ['Орыс тілі', 2], ['Ағылшын тілі', 3], ['Физика', 3], ['Химия', 2], ['Биология', 2], ['Қазақстан тарихы', 2], ['Информатика', 1]],
};

// Мұғалімдер: [логин, аты-жөні, лауазымы, пәндер, сынып жетекшілігі]
const TEACHERS: [string, string, string, string[], string | null][] = [
  ['akhmetova', 'Ахметова Гүлмира Сериковна', 'Математика · 9А жетекшісі', ['Алгебра', 'Геометрия', 'Математика'], '9А'],
  ['saparova', 'Сапарова Айгүл Ерланқызы', 'Математика · 5А жетекшісі', ['Математика', 'Информатика'], '5А'],
  ['nurlanova', 'Нұрланова Жанар Бақытқызы', 'Бастауыш сынып · 1А', ['Сауат ашу', 'Математика', 'Дүниетану'], '1А'],
  ['tulegenova', 'Төлегенова Сәуле Маратқызы', 'Бастауыш сынып · 1Ә', ['Сауат ашу', 'Математика', 'Дүниетану'], '1Ә'],
  ['kassymova', 'Қасымова Динара Асқарқызы', 'Бастауыш сынып · 2А', ['Қазақ тілі', 'Әдебиеттік оқу', 'Математика', 'Дүниетану'], '2А'],
  ['bekturova', 'Бектұрова Ләззат Нұрланқызы', 'Бастауыш сынып · 2Ә', ['Қазақ тілі', 'Әдебиеттік оқу', 'Математика', 'Дүниетану'], '2Ә'],
  ['omarov', 'Омаров Ержан Талғатұлы', 'Физика · 11А жетекшісі', ['Физика', 'Жаратылыстану'], '11А'],
  ['iskakova', 'Исқақова Мәдина Серікқызы', 'Қазақ тілі мен әдебиеті · 9Ә жетекшісі', ['Қазақ тілі', 'Қазақ әдебиеті'], '9Ә'],
  ['petrova', 'Петрова Елена Викторовна', 'Орыс тілі · 5Ә жетекшісі', ['Орыс тілі'], '5Ә'],
  ['zhakupova', 'Жақыпова Ақмарал Даниярқызы', 'Ағылшын тілі', ['Ағылшын тілі'], null],
  ['serikbayev', 'Серікбаев Марат Қайратұлы', 'Химия, биология', ['Химия', 'Биология'], null],
  ['abenov', 'Әбенов Дәурен Ермекұлы', 'Тарих, информатика', ['Қазақстан тарихы', 'Информатика'], null],
];

const TJB_CRITERIA: Record<string, [string, string, number, number][]> = {
  Алгебра: [['К1', 'Квадрат теңдеулер', 8, 0.98], ['К2', 'Виет теоремасы', 7, 1.08], ['К3', 'Мәтінді есептер', 8, 0.72], ['К4', 'Бөлшек-рационал теңдеулер', 7, 1.14]],
  Геометрия: [['К1', 'Үшбұрыштардың ұқсастығы', 10, 1.02], ['К2', 'Тригонометриялық қатынастар', 10, 0.86], ['К3', 'Есептер шығару', 10, 0.8]],
  Математика: [['К1', 'Натурал сандар', 8, 1.08], ['К2', 'Жай бөлшектер', 8, 0.84], ['К3', 'Мәтінді есептер', 9, 0.76]],
  Физика: [['К1', 'Кинематика', 10, 0.95], ['К2', 'Динамика заңдары', 10, 0.82], ['К3', 'Есептер шығару', 10, 0.78]],
  'Қазақ тілі': [['К1', 'Тыңдалым', 6, 1.05], ['К2', 'Оқылым', 8, 0.95], ['К3', 'Жазылым', 8, 0.82], ['К4', 'Айтылым', 6, 1.0]],
  'Ағылшын тілі': [['К1', 'Listening', 7, 1.0], ['К2', 'Reading', 8, 0.92], ['К3', 'Writing', 8, 0.8], ['К4', 'Speaking', 7, 1.05]],
};
const BJB_SECTIONS: Record<string, string[]> = {
  Алгебра: ['1-бөлім · Квадрат теңдеулер', '2-бөлім · Виет теоремасы', '3-бөлім · Мәтінді есептер'],
  Геометрия: ['1-бөлім · Ұқсас үшбұрыштар', '2-бөлім · Тригонометрия'],
  Математика: ['1-бөлім · Натурал сандар', '2-бөлім · Жай бөлшектер'],
  Физика: ['1-бөлім · Кинематика', '2-бөлім · Динамика'],
  'Қазақ тілі': ['1-бөлім · Мәтін құрылымы', '2-бөлім · Сөз таптары'],
  'Ағылшын тілі': ['Unit 1 · School life', 'Unit 2 · Hobbies'],
  Химия: ['1-бөлім · Атом құрылысы', '2-бөлім · Химиялық байланыс'],
  Биология: ['1-бөлім · Жасуша', '2-бөлім · Тіршілік процестері'],
  'Қазақстан тарихы': ['1-бөлім · Ежелгі дәуір', '2-бөлім · Орта ғасырлар'],
  'Орыс тілі': ['1-бөлім · Лексика', '2-бөлім · Морфология'],
};

// ───────── көмекші ─────────
function quarterPlan(startYear: number) {
  return [
    { number: 1, startDate: `${startYear}-09-01`, endDate: `${startYear}-10-30`, reportDueDate: `${startYear}-11-06` },
    { number: 2, startDate: `${startYear}-11-09`, endDate: `${startYear}-12-29`, reportDueDate: `${startYear + 1}-01-12` },
    { number: 3, startDate: `${startYear + 1}-01-12`, endDate: `${startYear + 1}-03-20`, reportDueDate: `${startYear + 1}-03-27` },
    { number: 4, startDate: `${startYear + 1}-03-30`, endDate: `${startYear + 1}-05-25`, reportDueDate: `${startYear + 1}-05-29` },
  ];
}

async function base() {
  for (const code of Object.keys(DEFAULT_ROLE_PERMISSIONS) as RoleCode[]) {
    const name = { ADMIN: 'Admin', SCHOOL_ADMIN: 'Мектеп әкімшілігі', TEACHER: 'Мұғалім' }[code];
    await prisma.role.upsert({ where: { code }, create: { code, name, permissions: [...DEFAULT_ROLE_PERMISSIONS[code]] }, update: { permissions: [...DEFAULT_ROLE_PERMISSIONS[code]] } });
  }
  for (const [i, n] of NATIONALITIES.entries()) {
    await prisma.nationality.upsert({ where: { name: n }, create: { name: n, sortOrder: i }, update: { sortOrder: i } });
  }
  for (const r of REASONS) {
    const ex = await prisma.attendanceReason.findFirst({ where: { schoolId: null, code: r.code } });
    if (!ex) await prisma.attendanceReason.create({ data: { ...r, schoolId: null } });
  }
  const adminLogin = (process.env.ADMIN_LOGIN ?? 'admin').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  const exists = await prisma.user.findUnique({ where: { login: adminLogin } });
  if (!exists) {
    if (!adminPassword && process.env.NODE_ENV === 'production') throw new Error('Set ADMIN_PASSWORD for the first admin user');
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    await prisma.user.create({
      data: { login: adminLogin, fullName: process.env.ADMIN_NAME ?? 'Тұрсынов Ерлан', title: 'Жүйе әкімшісі', roleId: role.id, passwordHash: await argon2.hash(adminPassword ?? 'Ustaz2026!', ARGON) },
    });
    console.log(`✓ admin user "${adminLogin}" created`);
  }
}

async function reset() {
  if (process.env.NODE_ENV === 'production') throw new Error('SEED_RESET is not allowed in production');
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  console.log('✓ database truncated');
}

async function demo() {
  const pii = new PiiCipher(process.env.PII_ENCRYPTION_KEY!, process.env.PII_HASH_KEY!);
  if (await prisma.school.findFirst({ where: { name: '№1 жалпы білім беретін мектеп' } })) {
    console.log('• demo school already exists — skipping (SEED_RESET=true to rebuild)');
    return;
  }
  const PASSWORD = await argon2.hash(process.env.DEMO_PASSWORD ?? 'Ustaz2026!', ARGON);
  const today = process.env.DEMO_TODAY || todayStr();
  const nat = Object.fromEntries((await prisma.nationality.findMany()).map((n) => [n.name, n.id]));
  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.code, r.id]));

  const school = await prisma.school.create({ data: { name: '№1 жалпы білім беретін мектеп', shortName: '№1 мектеп', city: 'Алматы', address: 'Абай даңғылы, 10' } });
  await prisma.school.create({ data: { name: '№7 жалпы білім беретін мектеп', shortName: '№7 мектеп', city: 'Алматы', address: 'Төле би көшесі, 77' } });
  await prisma.schoolSettings.create({ data: { schoolId: school.id, attendanceThreshold: 80 } });
  await prisma.levelRange.createMany({
    data: [
      { name: 'Төмен', fromPct: 0, toPct: 39, order: 0 },
      { name: 'Орта', fromPct: 40, toPct: 64, order: 1 },
      { name: 'Жақсы', fromPct: 65, toPct: 84, order: 2 },
      { name: 'Жоғары', fromPct: 85, toPct: 100, order: 3 },
    ].map((l) => ({ ...l, schoolId: school.id })),
  });
  await prisma.user.updateMany({ where: { role: { code: 'ADMIN' }, schoolId: null }, data: { schoolId: school.id } });

  const curStart = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 8 ? 1 : 0);
  const mkYear = async (y: number, current: boolean) =>
    prisma.schoolYear.create({
      data: {
        schoolId: school.id,
        name: `${y}–${y + 1}`,
        startDate: toDate(`${y}-09-01`),
        endDate: toDate(`${y + 1}-05-25`),
        isCurrent: current,
        quarters: { create: quarterPlan(y).map((q) => ({ number: q.number, startDate: toDate(q.startDate), endDate: toDate(q.endDate), reportDueDate: toDate(q.reportDueDate) })) },
      },
      include: { quarters: { orderBy: { number: 'asc' } } },
    });
  const prevYear = await mkYear(curStart - 1, false);
  const year = await mkYear(curStart, true);

  // Пәндер
  const subjectNames = [...new Set(Object.values(CURRICULUM).flatMap((c) => c.map(([s]) => s)))];
  const subjects: Record<string, number> = {};
  for (const n of subjectNames) subjects[n] = (await prisma.subject.create({ data: { schoolId: school.id, name: n } })).id;

  // Пайдаланушылар
  await prisma.user.create({
    data: { login: 'bekova', fullName: 'Бекова Роза Асқарқызы', title: 'Директордың оқу ісі орынбасары', roleId: roles.SCHOOL_ADMIN, schoolId: school.id, passwordHash: PASSWORD, teacher: { create: { schoolId: school.id, position: 'Директордың оқу ісі орынбасары' } } },
  });
  const teacherIds: Record<string, number> = {};
  for (const [login, fullName, title] of TEACHERS) {
    const u = await prisma.user.create({
      data: { login, fullName, title, roleId: roles.TEACHER, schoolId: school.id, passwordHash: PASSWORD, teacher: { create: { schoolId: school.id, position: title } } },
      include: { teacher: true },
    });
    teacherIds[login] = u.teacher!.id;
  }

  // Сыныптар (ағымдағы және өткен жыл)
  const classIds: Record<string, number> = {};
  const prevClassIds: Record<string, number> = {};
  for (const name of CLASSES) {
    const grade = parseInt(name);
    const letter = name.replace(/\d+/, '');
    const homeroom = TEACHERS.find((t) => t[4] === name);
    classIds[name] = (await prisma.class.create({ data: { schoolId: school.id, schoolYearId: year.id, grade, letter, name, homeroomTeacherId: homeroom ? teacherIds[homeroom[0]] : null } })).id;
    if (grade > 1) {
      prevClassIds[name] = (await prisma.class.create({ data: { schoolId: school.id, schoolYearId: prevYear.id, grade: grade - 1, letter, name: `${grade - 1}${letter}`, homeroomTeacherId: homeroom ? teacherIds[homeroom[0]] : null } })).id;
    }
  }

  // Пән мұғалімдерін тағайындау: Ахметова — прототиптегідей 9А, 9Ә, 11А алгебрасы, 9А геометриясы, 5А/5Ә математикасы.
  const fixed: Record<string, string> = {
    '9А|Алгебра': 'akhmetova', '9Ә|Алгебра': 'akhmetova', '11А|Алгебра': 'akhmetova', '9А|Геометрия': 'akhmetova',
    '5А|Математика': 'akhmetova', '5Ә|Математика': 'akhmetova', '9Ә|Геометрия': 'saparova', '11А|Геометрия': 'saparova',
    '1А|Сауат ашу': 'nurlanova', '1А|Математика': 'nurlanova', '1А|Дүниетану': 'nurlanova',
    '1Ә|Сауат ашу': 'tulegenova', '1Ә|Математика': 'tulegenova', '1Ә|Дүниетану': 'tulegenova',
    '2А|Қазақ тілі': 'kassymova', '2А|Әдебиеттік оқу': 'kassymova', '2А|Математика': 'kassymova', '2А|Дүниетану': 'kassymova',
    '2Ә|Қазақ тілі': 'bekturova', '2Ә|Әдебиеттік оқу': 'bekturova', '2Ә|Математика': 'bekturova', '2Ә|Дүниетану': 'bekturova',
    '5А|Жаратылыстану': 'omarov', '5Ә|Жаратылыстану': 'omarov', '5А|Информатика': 'saparova', '5Ә|Информатика': 'saparova',
  };
  const teacherFor = (cls: string, subj: string) => fixed[`${cls}|${subj}`] ?? TEACHERS.find((t) => t[3].includes(subj) && !['akhmetova', 'nurlanova', 'tulegenova', 'kassymova', 'bekturova'].includes(t[0]))![0];

  // Сабақ кестесі: мұғалім бір уақытта екі сыныпта болмауы керек.
  const busy = new Set<string>();
  const assignmentIds: Record<string, number> = {};
  const prevAssignment: Record<string, number> = {};
  for (const cls of CLASSES) {
    const grade = parseInt(cls);
    const plan = CURRICULUM[grade];
    const slots: [string, number][] = []; // [subject, weekday]
    const perDay = Math.ceil(plan.reduce((s, [, h]) => s + h, 0) / 5);
    const dayLoad = [0, 0, 0, 0, 0];
    for (const [subj, hours] of plan) {
      for (let h = 0; h < hours; h++) {
        let d = (h * 2 + subjectNames.indexOf(subj)) % 5;
        for (let k = 0; k < 5 && dayLoad[d] >= perDay; k++) d = (d + 1) % 5;
        dayLoad[d]++;
        slots.push([subj, d + 1]);
      }
    }
    for (const [subj] of plan) {
      const tl = teacherFor(cls, subj);
      const a = await prisma.teachingAssignment.create({ data: { schoolId: school.id, schoolYearId: year.id, classId: classIds[cls], subjectId: subjects[subj], teacherId: teacherIds[tl] } });
      assignmentIds[`${cls}|${subj}`] = a.id;
      if (prevClassIds[cls]) {
        const pa = await prisma.teachingAssignment.create({ data: { schoolId: school.id, schoolYearId: prevYear.id, classId: prevClassIds[cls], subjectId: subjects[subj], teacherId: teacherIds[tl] } });
        prevAssignment[`${cls}|${subj}`] = pa.id;
      }
    }
    const classBusy = new Set<string>();
    for (const [subj, wd] of slots) {
      const tl = teacherFor(cls, subj);
      let placed = false;
      for (let period = 1; period <= 7 && !placed; period++) {
        if (classBusy.has(`${wd}|${period}`) || busy.has(`${tl}|${wd}|${period}`)) continue;
        // Бір күнде бір пән қатарынан екі рет болмауы үшін.
        try {
          await prisma.timetableSlot.create({ data: { schoolId: school.id, assignmentId: assignmentIds[`${cls}|${subj}`], weekday: wd, period, startTime: TIMES[period - 1][0], endTime: TIMES[period - 1][1] } });
        } catch {
          continue;
        }
        classBusy.add(`${wd}|${period}`);
        busy.add(`${tl}|${wd}|${period}`);
        placed = true;
      }
    }
  }

  // Оқушылар
  const perClass = Math.max(10, Math.ceil(Number(process.env.SEED_STUDENTS ?? 216) / CLASSES.length));
  type S = { id: number; cls: string; att: number; base: number; seed: number };
  const students: S[] = [];
  let serial = 0;
  let minority = 0;
  let code = 26001;
  for (const cls of CLASSES) {
    const grade = parseInt(cls);
    const n = perClass + Math.floor(R() * 4) - 1;
    const rows: Prisma.StudentCreateManyInput[] = [];
    const meta: Omit<S, 'id'>[] = [];
    for (let i = 0; i < n; i++, serial++) {
      let last: string, first: string, gender: Gender, natName = 'Қазақ';
      if (serial % 13 === 5 && minority < MINORITY.length) [last, first, gender, natName] = MINORITY[minority++];
      else {
        gender = R() < 0.52 ? 'M' : 'F';
        const root = pick(ROOTS);
        last = root.endsWith('ай') ? root.slice(0, -1) + 'ев' : root + 'ов';
        if (gender === 'F') last += 'а';
        first = pick(gender === 'M' ? M_FIRST : F_FIRST);
      }
      const father = pick(FATHERS);
      const middle = natName === 'Қазақ' ? (gender === 'M' ? `${father}ұлы` : `${father}қызы`) : null;
      const by = curStart - 6 - (grade - 1);
      const birth = toDate(`${by}-${String(1 + Math.floor(R() * 12)).padStart(2, '0')}-${String(1 + Math.floor(R() * 28)).padStart(2, '0')}`);
      const iin = makeIin(birth, gender, 1000 + serial * 7);
      const fromOther = R() < 0.18;
      const low = R() < 0.07;
      const weak = R() < 0.1;
      const base = weak ? 0.2 + R() * 0.14 : clamp(0.42 + R() * 0.55 - (low ? 0.15 : 0), 0.28, 0.97);
      const msur = gender === 'F' ? last : /(ов|ев|ёв|ин)$/.test(last) ? last + 'а' : last;
      rows.push({
        schoolId: school.id,
        classId: classIds[cls],
        studentCode: `ST-${code++}`,
        lastName: last,
        firstName: first,
        middleName: middle,
        fullName: [last, first, middle].filter(Boolean).join(' '),
        gender,
        birthDate: birth,
        nationalityId: nat[natName],
        iinEncrypted: pii.encrypt(iin),
        iinLast4: iin.slice(-4),
        iinHash: pii.hash(iin),
        phone: grade >= 5 ? `+7 70${Math.floor(R() * 10)} ${100 + Math.floor(R() * 900)} ${String(Math.floor(R() * 100)).padStart(2, '0')} ${String(Math.floor(R() * 100)).padStart(2, '0')}` : null,
        parentName: `${msur} ${pick(MOTHERS)}`,
        parentPhone: `+7 77${Math.floor(R() * 10)} ${100 + Math.floor(R() * 900)} ${String(Math.floor(R() * 100)).padStart(2, '0')} ${String(Math.floor(R() * 100)).padStart(2, '0')}`,
        enrolledAt: toDate(fromOther ? `${curStart - Math.floor(R() * Math.max(1, grade - 1))}-09-0${1 + Math.floor(R() * 5)}` : `${curStart - grade + 1}-09-01`),
        previousSchool: fromOther ? pick(PREV_SCHOOLS) : null,
        notes: R() < 0.05 ? 'Денсаулығына байланысты дене шынықтырудан босатылған' : null,
      });
      meta.push({ cls, att: low ? 0.72 + R() * 0.07 : 0.86 + R() * 0.135, base, seed: Math.floor(R() * 1e6) });
    }
    await prisma.student.createMany({ data: rows });
    const created = await prisma.student.findMany({ where: { classId: classIds[cls] }, orderBy: { id: 'asc' }, select: { id: true } });
    created.forEach((c, i) => students.push({ id: c.id, ...meta[i] }));
  }
  console.log(`✓ ${students.length} students`);

  // Қозғалыс (прототиптегі 8 жазба сияқты), жанама әсерлерімен.
  const byCls = (c: string) => students.filter((s) => s.cls === c);
  const q1 = year.quarters[0];
  const q1s = fmtDate(q1.startDate)!;
  const dIn = (n: number) => minDate2(addDays(q1s, n), addDays(today, -1));
  function minDate2(a: string, b: string) {
    return a < b ? a : b;
  }
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { code: 'ADMIN' } } });
  const mv = async (s: S, type: MovementType, date: string, from: string | null, to: string | null, extra: Partial<Prisma.StudentMovementUncheckedCreateInput>) => {
    await prisma.studentMovement.create({
      data: {
        schoolId: school.id,
        studentId: s.id,
        type,
        date: toDate(date),
        fromClassId: from ? classIds[from] : null,
        toClassId: to ? classIds[to] : null,
        orderDate: toDate(addDays(date, -1)),
        createdById: admin.id,
        reason: 'Ата-ана өтініші',
        orderNumber: '№000',
        ...extra,
      },
    });
  };
  const mvList: [S, MovementType, string, string | null, string | null, Partial<Prisma.StudentMovementUncheckedCreateInput>][] = [
    [byCls('9А')[4], 'ARRIVED_FROM_SCHOOL', dIn(1), null, '9А', { fromSchool: '№12 мектеп-гимназия', toSchool: '№1 мектеп', reason: 'Тұрғылықты жерін ауыстыруы', orderNumber: '№112-о' }],
    [byCls('5А')[2], 'ADMITTED', dIn(4), null, '5А', { reason: 'Жаңа оқушы', orderNumber: '№114-о' }],
    [byCls('9А')[11], 'TRANSFERRED_CLASS', dIn(13), '9Ә', '9А', { reason: 'Бейіндік топ', orderNumber: '№117-о' }],
    [byCls('11А')[17], 'LEFT_TO_SCHOOL', dIn(20), '11А', null, { fromSchool: '№1 мектеп', toSchool: '№7 мектеп', reason: 'Отбасылық жағдай', orderNumber: '№121-о', comment: 'Жеке іс берілді' }],
    [byCls('5Ә')[12], 'ARRIVED_FROM_SCHOOL', dIn(32), null, '5Ә', { fromSchool: '№25 IT-лицей', toSchool: '№1 мектеп', reason: 'Тұрғылықты жерін ауыстыруы', orderNumber: '№129-о' }],
    [byCls('11А')[3], 'EXPELLED', dIn(39), '11А', null, { reason: 'Ата-ана өтініші', orderNumber: '№136-о' }],
    [byCls('9Ә')[6], 'READMITTED', dIn(44), null, '9Ә', { reason: 'Шетелден оралуы', orderNumber: '№141-о', comment: 'Құжаттар толық' }],
    [byCls('5А')[9], 'TRANSFERRED_CLASS', dIn(49), '5А', '5Ә', { reason: 'Ата-ана өтініші', orderNumber: '№148-о' }],
  ];
  for (const [s, type, date, from, to, extra] of mvList) {
    if (date > today) continue;
    await mv(s, type, date, from, to, extra);
    if (type === 'LEFT_TO_SCHOOL') await prisma.student.update({ where: { id: s.id }, data: { status: 'LEFT' } });
    if (type === 'EXPELLED') await prisma.student.update({ where: { id: s.id }, data: { status: 'EXPELLED' } });
    if (type === 'TRANSFERRED_CLASS' && to) {
      await prisma.student.update({ where: { id: s.id }, data: { classId: classIds[to] } });
      s.cls = to;
    }
    if (type === 'ARRIVED_FROM_SCHOOL') await prisma.student.update({ where: { id: s.id }, data: { enrolledAt: toDate(date), previousSchool: extra.fromSchool } });
  }
  const leftIds = new Set(mvList.filter(([, t, d]) => (t === 'LEFT_TO_SCHOOL' || t === 'EXPELLED') && d <= today).map(([s, , d]) => [s.id, d] as const).map(([id]) => id));
  const leftDate = new Map(mvList.filter(([, t]) => t === 'LEFT_TO_SCHOOL' || t === 'EXPELLED').map(([s, , d]) => [s.id, d]));
  const arriveDate = new Map(mvList.filter(([, t]) => t === 'ARRIVED_FROM_SCHOOL' || t === 'ADMITTED' || t === 'READMITTED').map(([s, , d]) => [s.id, d]));
  const transfer = new Map(mvList.filter(([, t]) => t === 'TRANSFERRED_CLASS').map(([s, , d, f, t]) => [s.id, { d, f: f!, t: t! }]));

  // Қатысу: тоқсан ішіндегі әр жұмыс күні, бүгіннен бұрынғы барлық сабақ; бүгін — 1–5 сабақ.
  const slots = await prisma.timetableSlot.findMany({ where: { schoolId: school.id }, include: { assignment: { include: { class: true } } } });
  const teacherOfAssign = new Map((await prisma.teachingAssignment.findMany({ where: { schoolYearId: year.id } })).map((a) => [a.id, a.teacherId]));
  let lessonCount = 0;
  let attCount = 0;
  const statuses: AttendanceStatus[] = ['N', 'S', 'A', 'K', 'S', 'A', 'K'];
  for (const q of year.quarters) {
    for (let d = fmtDate(q.startDate)!; d <= fmtDate(q.endDate)! && d <= today; d = addDays(d, 1)) {
      const wd = weekday(d);
      if (wd > 5) continue;
      const daySlots = slots.filter((s) => s.weekday === wd && (d < today || s.period <= 5));
      const lessonsData = daySlots.map((s) => ({
        schoolId: school.id,
        classId: s.assignment.classId,
        subjectId: s.assignment.subjectId,
        teacherId: teacherOfAssign.get(s.assignmentId) ?? null,
        date: toDate(d),
        period: s.period,
        startTime: s.startTime,
        markedAt: new Date(`${d}T${s.startTime}:00+05:00`),
      }));
      if (!lessonsData.length) continue;
      await prisma.lesson.createMany({ data: lessonsData });
      const lessons = await prisma.lesson.findMany({ where: { schoolId: school.id, date: toDate(d) } });
      lessonCount += lessons.length;
      const att: Prisma.AttendanceCreateManyInput[] = [];
      for (const l of lessons) {
        const cname = CLASSES.find((c) => classIds[c] === l.classId)!;
        const r = rng(l.id * 131 + 7);
        for (const s of students) {
          // Сабақ күніндегі сынып құрамы (қозғалысты ескере отырып).
          const tr = transfer.get(s.id);
          const clsOnDay = tr ? (d < tr.d ? tr.f : tr.t) : s.cls;
          if (clsOnDay !== cname) continue;
          const ld = leftDate.get(s.id);
          if (ld && d >= ld) continue;
          const ad = arriveDate.get(s.id);
          if (ad && d < ad) continue;
          const x = r();
          const status: AttendanceStatus = x < s.att ? (r() < 0.04 ? 'K' : 'P') : statuses[Math.floor(r() * statuses.length)];
          att.push({ schoolId: school.id, lessonId: l.id, studentId: s.id, date: toDate(d), status, reasonId: null, updatedById: null });
        }
      }
      for (let i = 0; i < att.length; i += 5000) await prisma.attendance.createMany({ data: att.slice(i, i + 5000) });
      attCount += att.length;
    }
  }
  console.log(`✓ ${lessonCount} lessons, ${attCount} attendance marks`);

  // БЖБ / ТЖБ
  const assessed = Object.keys(assignmentIds).filter((k) => {
    const [cls, subj] = k.split('|');
    return parseInt(cls) >= 2 && BJB_SECTIONS[subj];
  });
  const createAssessments = async (yearQuarters: typeof year.quarters, classMap: Record<string, number>, upToQuarter: number, isPrev: boolean) => {
    for (const k of assessed) {
      const [cls, subj] = k.split('|');
      if (!classMap[cls]) continue;
      const tl = teacherFor(cls, subj);
      const members = students.filter((s) => s.cls === cls || transfer.get(s.id)?.f === cls).filter((s) => isPrev || !leftIds.has(s.id) || true);
      for (const q of yearQuarters.filter((x) => x.number <= upToQuarter)) {
        const drift = isPrev ? -0.04 + q.number * 0.012 : 0;
        const secs = BJB_SECTIONS[subj].slice(0, 2 + (q.number % 2));
        for (const [si, sec] of secs.entries()) {
          if (!isPrev && q.number === upToQuarter && si >= 2) continue;
          const a = await prisma.assessment.create({
            data: { schoolId: school.id, type: 'BJB', classId: classMap[cls], subjectId: subjects[subj], quarterId: q.id, teacherId: teacherIds[tl], section: sec, title: `БЖБ-${si + 1}`, maxScore: 15, date: toDate(addDays(fmtDate(q.startDate)!, 14 + si * 18)) },
          });
          await prisma.assessmentResult.createMany({
            data: members.map((s) => {
              const r = rng(s.seed + a.id);
              const sc = clamp(Math.round(15 * (s.base * (1.04 - si * 0.03) + drift + (r() - 0.5) * 0.2)), 0, 15);
              return { assessmentId: a.id, studentId: s.id, score: sc, percent: Math.round((sc / 15) * 1000) / 10 };
            }),
          });
        }
        const crit = TJB_CRITERIA[subj];
        if (!crit) continue;
        const max = crit.reduce((s, c) => s + c[2], 0);
        const tj = await prisma.assessment.create({
          data: {
            schoolId: school.id,
            type: 'TJB',
            classId: classMap[cls],
            subjectId: subjects[subj],
            quarterId: q.id,
            teacherId: teacherIds[tl],
            title: `${['I', 'II', 'III', 'IV'][q.number - 1]} тоқсан ТЖБ`,
            maxScore: max,
            date: toDate(addDays(fmtDate(q.endDate)!, -8)),
            criteria: { create: crit.map(([code, topic, m], i) => ({ code, topic, maxScore: m, order: i })) },
          },
          include: { criteria: { orderBy: { order: 'asc' } } },
        });
        for (const s of members) {
          const r = rng(s.seed + 7 + tj.id);
          const scores = crit.map(([, , m, k]) => clamp(Math.round(m * (s.base * k + drift + (r() - 0.5) * 0.25)), 0, m));
          const total = scores.reduce((a, b) => a + b, 0);
          await prisma.assessmentResult.create({
            data: {
              assessmentId: tj.id,
              studentId: s.id,
              score: total,
              percent: Math.round((total / max) * 1000) / 10,
              criterionResults: { create: tj.criteria.map((c, i) => ({ criterionId: c.id, score: scores[i] })) },
            },
          });
        }
      }
    }
  };
  const curQ = year.quarters.find((q) => fmtDate(q.startDate)! <= today && today <= fmtDate(q.endDate)!) ?? [...year.quarters].reverse().find((q) => fmtDate(q.startDate)! <= today);
  await createAssessments(prevYear.quarters, prevClassIds, 4, true);
  if (curQ) await createAssessments(year.quarters, classIds, curQ.number, false);
  console.log('✓ assessments (БЖБ/ТЖБ)');

  // Журнал: ағымдағы бағалар (1–10) және аяқталған тоқсандардың қорытынды бағалары.
  if (curQ) {
    for (const k of assessed) {
      const [cls, subj] = k.split('|');
      if (!classIds[cls]) continue;
      const tl = teacherFor(cls, subj);
      const members = students.filter((s) => s.cls === cls);
      for (const q of year.quarters.filter((x) => x.number <= curQ.number)) {
        const qs = fmtDate(q.startDate)!;
        const qe = fmtDate(q.endDate)!;
        const last = q.number === curQ.number && today < qe ? today : qe;
        const colIds: number[] = [];
        for (let d = addDays(qs, 2), i = 0; d <= last && i < 10; d = addDays(d, 6), i++) {
          if (weekday(d) > 5) continue;
          const c = await prisma.gradeColumn.create({ data: { schoolId: school.id, classId: classIds[cls], subjectId: subjects[subj], quarterId: q.id, teacherId: teacherIds[tl], date: toDate(d) } });
          colIds.push(c.id);
        }
        await prisma.grade.createMany({
          data: colIds.flatMap((cid) =>
            members.flatMap((s) => {
              const r = rng(s.seed + cid * 31);
              if (r() < 0.35) return [];
              return [{ columnId: cid, studentId: s.id, value: clamp(Math.round(10 * (s.base + (r() - 0.5) * 0.3)), 1, 10) }];
            }),
          ),
        });
        if (q.number >= curQ.number) continue;
        const [grades, results] = await Promise.all([
          prisma.grade.findMany({ where: { columnId: { in: colIds } } }),
          prisma.assessmentResult.findMany({ where: { assessment: { classId: classIds[cls], subjectId: subjects[subj], quarterId: q.id } }, include: { assessment: true } }),
        ]);
        await prisma.quarterGrade.createMany({
          data: members.flatMap((s) => {
            const mine = results.filter((r) => r.studentId === s.id && !r.absent);
            const t = mine.find((r) => r.assessment.type === 'TJB');
            const c = computeQuarter(
              {
                fo: grades.filter((g) => g.studentId === s.id).map((g) => g.value),
                bjb: mine.filter((r) => r.assessment.type === 'BJB').map((r) => ({ score: Number(r.score), max: Number(r.assessment.maxScore) })),
                tjb: t ? { score: Number(t.score), max: Number(t.assessment.maxScore) } : null,
              },
              DEFAULT_WEIGHTS,
              DEFAULT_LEVELS,
            );
            return c.mark == null ? [] : [{ schoolId: school.id, quarterId: q.id, classId: classIds[cls], subjectId: subjects[subj], studentId: s.id, mark: c.mark, computedPct: c.pct }];
          }),
        });
      }
    }
    console.log('✓ journal (ағымдағы және тоқсандық бағалар)');
  }

  // Өткен жылдың тоқсандық есептері тапсырылған; ағымдағы тоқсанда бірнешеуі тапсырылған.
  for (const k of Object.keys(prevAssignment)) {
    const [cls, subj] = k.split('|');
    for (const q of prevYear.quarters) {
      await prisma.quarterReport.create({ data: { schoolId: school.id, quarterId: q.id, classId: prevClassIds[cls], subjectId: subjects[subj], teacherId: teacherIds[teacherFor(cls, subj)], status: 'SUBMITTED', submittedAt: toDate(fmtDate(q.reportDueDate)!) } });
    }
  }
  if (curQ) {
    for (const k of ['9Ә|Алгебра', '11А|Алгебра', '5А|Математика']) {
      const [cls, subj] = k.split('|');
      await prisma.quarterReport.create({ data: { schoolId: school.id, quarterId: curQ.id, classId: classIds[cls], subjectId: subjects[subj], teacherId: teacherIds['akhmetova'], status: 'SUBMITTED', submittedAt: new Date() } });
    }
  }
  console.log('✓ demo data ready. Logins: admin / bekova / akhmetova (password: DEMO_PASSWORD or Ustaz2026!)');
}

/**
 * Таза орнатуда (демо жоқ) бірінші мектеп пен ағымдағы оқу жылы жасалады — әйтпесе admin кіргенде
 * жұмыс істейтін мектеп болмайды. Атауы SCHOOL_NAME / SCHOOL_SHORT_NAME арқылы беріледі; кейін «Басқару» бетінде өзгертіледі.
 */
async function firstSchool() {
  if (await prisma.school.findFirst()) return;
  const today = todayStr();
  const y = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 8 ? 1 : 0);
  const name = process.env.SCHOOL_NAME ?? 'Жалпы білім беретін мектеп';
  await prisma.school.create({
    data: {
      name,
      shortName: process.env.SCHOOL_SHORT_NAME ?? name.slice(0, 60),
      settings: { create: {} },
      levelRanges: { create: DEFAULT_LEVELS.map((l) => ({ ...l })) },
      schoolYears: {
        create: {
          name: `${y}–${y + 1}`,
          startDate: toDate(`${y}-09-01`),
          endDate: toDate(`${y + 1}-05-25`),
          isCurrent: true,
          quarters: { create: quarterPlan(y).map((q) => ({ number: q.number, startDate: toDate(q.startDate), endDate: toDate(q.endDate), reportDueDate: toDate(q.reportDueDate) })) },
        },
      },
    },
  });
  console.log(`✓ first school "${name}" and school year ${y}–${y + 1} created`);
}

async function main() {
  if (process.env.SEED_RESET === 'true') await reset();
  await base();
  if (process.env.SEED_DEMO === 'true') await demo();
  else await firstSchool();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
