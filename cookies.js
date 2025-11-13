// cookies.js - Banner de cookies unificado para todo o site

(function () {
  const COOKIE_KEY = 'cookiesAccepted_v1';
  const bar = document.getElementById('cookies-bar');
  const btn = document.getElementById('acceptCookies');

  if (!bar || !btn) return;

  function show() {
    bar.style.display = 'block';
  }
  function hide() {
    bar.style.display = 'none';
  }

  if (!localStorage.getItem(COOKIE_KEY)) {
    show();
  }

  btn.addEventListener('click', () => {
    localStorage.setItem(COOKIE_KEY, '1');
    hide();
  });
})();
