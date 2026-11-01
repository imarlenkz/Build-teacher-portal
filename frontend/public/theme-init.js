// Тақырыпты алғашқы сызудан бұрын қою (жыпылықтамау үшін). CSP үшін бөлек файл.
try {
  var t = localStorage.getItem('ustaz.theme');
  if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.dataset.theme = 'dark';
} catch (e) {}
