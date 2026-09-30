(function(){
  // Smart online visitors (hour-based, not too fake)
  function smartOnline(){
    const h = new Date().getHours();
    let base = 0;
    if (h >= 1 && h < 7) base = Math.random() < 0.35 ? 1 : 0;
    else if (h >= 7 && h < 10) base = 2 + Math.floor(Math.random()*3);
    else if (h >= 10 && h < 14) base = 4 + Math.floor(Math.random()*5);
    else if (h >= 14 && h < 18) base = 5 + Math.floor(Math.random()*6);
    else if (h >= 18 && h < 22) base = 3 + Math.floor(Math.random()*5);
    else base = Math.random() < 0.5 ? 1 : 0;
    const day = new Date().getDay();
    if (day === 0 || day === 6) base = Math.max(0, base - 1);
    return base;
  }
  function smartVisits(){
    // stable-ish daily seed
    const d = new Date();
    const seed = d.getFullYear()*10000 + (d.getMonth()+1)*100 + d.getDate();
    let x = Math.sin(seed)*10000; x = x - Math.floor(x);
    return 180 + Math.floor(x * 220) + Math.floor(smartOnline()*3);
  }
  function fillStats(){
    const o = document.getElementById('stat-online');
    const v = document.getElementById('stat-visits');
    const u = document.getElementById('stat-users');
    if (o) o.textContent = smartOnline();
    if (v) v.textContent = smartVisits().toLocaleString('fa-IR');
    if (u && u.dataset.count) u.textContent = Number(u.dataset.count).toLocaleString('fa-IR');
  }
  fillStats();
  setInterval(fillStats, 45000);

  // Heartbeat online
  try {
    if (document.body.dataset.auth === '1') {
      fetch('/api/heartbeat', { method:'POST', credentials:'same-origin' }).catch(()=>{});
      setInterval(()=>fetch('/api/heartbeat',{method:'POST',credentials:'same-origin'}).catch(()=>{}), 60000);
    }
  } catch(e){}

  // Phone country selects
  function bindPhone(selectId, inputId){
    const sel = document.getElementById(selectId);
    const inp = document.getElementById(inputId);
    if (!sel || !inp || !window.COUNTRY_CODES) return;
    sel.innerHTML = window.COUNTRY_CODES.map(x =>
      `<option value="${x.d}" ${x.c==='AM'?'selected':''}>${x.d} ${x.n}</option>`
    ).join('');
    const apply = () => {
      const d = sel.value;
      let v = (inp.value||'').replace(/\s/g,'');
      // if user typed full number with +, keep; else ensure starts with dial
      if (!v.startsWith('+')) {
        // strip leading zeros of local part
        const local = v.replace(/^0+/, '');
        inp.dataset.local = local;
      }
    };
    sel.addEventListener('change', apply);
  }
  bindPhone('cc-phone','phone-local');
  bindPhone('cc-login','login-local');
  bindPhone('cc-wa','wa-local');

  // before submit combine
  document.querySelectorAll('form[data-phone-combine]').forEach(form => {
    form.addEventListener('submit', function(e){
      const cc = form.querySelector('[data-cc]');
      const local = form.querySelector('[data-local]');
      const hidden = form.querySelector('[data-full]');
      if (cc && local && hidden) {
        let loc = (local.value||'').replace(/\D/g,'').replace(/^0+/,'');
        hidden.value = cc.value + loc;
      }
      const ccw = form.querySelector('[data-cc-wa]');
      const locw = form.querySelector('[data-local-wa]');
      const hidw = form.querySelector('[data-full-wa]');
      if (ccw && locw && hidw) {
        let loc = (locw.value||'').replace(/\D/g,'').replace(/^0+/,'');
        hidw.value = ccw.value + loc;
      }
    });
  });

  // Simple AI chat widget
  const replies = [
    {k:['ثبت نام','ثبت‌نام','عضویت'], a:'برای ثبت‌نام روی «ثبت‌نام» بزنید، کد کشور و شماره، واتساپ اجباری، نام و رمز و کپچا را پر کنید. پاسپورت بعداً در سفارش لازم است.'},
    {k:['ورود','لاگین','login'], a:'با همان شماره‌ای که ثبت‌نام کردید و رمز عبور وارد شوید. کد کشور را درست انتخاب کنید.'},
    {k:['واریز','کارت','شبا'], a:'بعد از ثبت سفارش، شماره کارت/شبا نمایش داده می‌شود. مبلغ را واریز کنید، رسید را آپلود کنید، سپس اعلامیه را پر کنید.'},
    {k:['رسید','اعلامیه'], a:'اعلامیه شامل نام شما (باید با ثبت‌نام یکی باشد)، کدملی، تاریخ واریز، حساب مبدأ، بانک مبدأ، کارت مقصد و بانک مقصد است. بخش امضای دریافت در دفتر توسط ادمین پر می‌شود.'},
    {k:['تایم','حضور','دفتر','آدرس'], a:'پس از بررسی رسید توسط ادمین، زمان و آدرس دفتر در داشبورد سفارش شما نمایش داده می‌شود. تا تعیین وقت صبور باشید.'},
    {k:['رد','ریجکت','reject'], a:'اگر رسید رد شود وضعیت «رد شده» می‌بینید و باید رسید معتبر دوباره آپلود کنید یا با پشتیبانی تماس بگیرید.'},
    {k:['نرخ','قیمت','ریت'], a:'نرخ‌ها در صفحه اصلی به فارسی و انگلیسی دیده می‌شوند. برای تومان→درام: مبلغ تومان ÷ نرخ = درام.'},
    {k:['درام','تحویل','نقد'], a:'برای تحویل درام نقدی یا سفارش واریز ریال، از منوی داشبورد اقدام کنید. کد پیگیری سفارش را نگه دارید.'},
    {k:['پیگیری','کد','وضعیت'], a:'کد سفارش (TX...) یا کد تحویل درام را در داشبورد ببینید. وضعیت: در انتظار واریز / بررسی / آماده دریافت / تکمیل / رد شده.'}
  ];
  function answer(q){
    q = (q||'').toLowerCase();
    for (const r of replies) {
      if (r.k.some(k => q.includes(k.toLowerCase()))) return r.a;
    }
    return 'سوال شما ثبت شد. خلاصه: ثبت‌نام → سفارش → واریز → آپلود رسید → اعلامیه → بررسی ادمین → تعیین وقت دفتر. برای جزئیات بیشتر از منوی سایت استفاده کنید یا واتساپ دفتر را از «ارتباط با ما» بگیرید.';
  }
  window.fxChatSend = function(){
    const inp = document.getElementById('fx-chat-input');
    const box = document.getElementById('fx-chat-log');
    if (!inp || !box) return;
    const q = inp.value.trim();
    if (!q) return;
    box.innerHTML += `<div class="chat-u">${q.replace(/</g,'&lt;')}</div>`;
    box.innerHTML += `<div class="chat-b">${answer(q)}</div>`;
    inp.value='';
    box.scrollTop = box.scrollHeight;
  };

  // Date converter simple Jalaali approx via Intl if available
  window.convertDate = function(){
    const mode = document.getElementById('dc-mode')?.value;
    const v = document.getElementById('dc-in')?.value;
    const out = document.getElementById('dc-out');
    if (!v || !out) return;
    try {
      if (mode === 'g2j') {
        const d = new Date(v);
        out.textContent = new Intl.DateTimeFormat('fa-IR-u-ca-persian',{dateStyle:'full'}).format(d);
      } else {
        // parse yyyy-mm-dd as gregorian display
        out.textContent = v + ' (برای تبدیل دقیق شمسی→میلادی از انتخابگر تاریخ فرم‌ها استفاده کنید)';
      }
    } catch(e){ out.textContent = 'خطا در تبدیل'; }
  };
})();
